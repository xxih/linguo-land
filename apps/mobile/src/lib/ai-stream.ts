/**
 * AI 流式消费器：从 NestJS 的 SSE 端点读 `data: {...}\n\n` 事件，回调累加。
 *
 * 后端约定（apps/server/src/ai/ai.controller.ts）：
 *   - text/event-stream 响应
 *   - 每帧 `data: {"content": "...partial..."}\n\n` 或 `data: [DONE]`
 *   - 错误时 `data: {"error": "..."}` 然后 close
 *
 * RN 的 fetch (网址 https://github.com/facebook/react-native/blob/main/packages/react-native/Libraries/Network/fetch.js)
 * 在新架构下支持 ReadableStream，新版本 Hermes 也支持 ReadableStream。
 * 但 Android 旧 Hermes 上可能不支持，所以用 XHR 的 `progress` 事件做兜底
 * 是更鲁棒的写法——这里采用 XHR 路线，跨设备一致。
 */
import { ACCESS_TOKEN_KEY, getApiBaseUrl } from './api';
import { readSecure } from './secure-storage';
import { createLogger } from '../utils/logger';

const log = createLogger('ai-stream');

export interface StreamHandlers {
  onChunk?: (text: string) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
}

export interface AiStreamHandle {
  abort: () => void;
}

interface StreamRequest {
  path: '/api/v1/ai/enrich-stream' | '/api/v1/ai/translate-stream';
  body: Record<string, unknown>;
  handlers: StreamHandlers;
}

/**
 * 启一条 SSE 流。返回 abort 句柄；调用 abort() 立即关闭连接。
 */
export async function streamAi(req: StreamRequest): Promise<AiStreamHandle> {
  const baseURL = await getApiBaseUrl();
  const token = await readSecure(ACCESS_TOKEN_KEY);

  const xhr = new XMLHttpRequest();
  let aborted = false;
  let buffered = ''; // 累计未消费的 chunk，按 \n\n 切帧
  let lastSeenLen = 0;

  function emitFrames(): void {
    const newPart = xhr.responseText.slice(lastSeenLen);
    lastSeenLen = xhr.responseText.length;
    if (!newPart) return;
    buffered += newPart;

    // SSE 帧用空行分隔（\n\n 或 \r\n\r\n）
    const frames = buffered.split(/\r?\n\r?\n/);
    buffered = frames.pop() ?? ''; // 最后一段可能还没收全，留待下次

    for (const frame of frames) {
      const lines = frame.split(/\r?\n/);
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        if (payload === '[DONE]') {
          if (!aborted) req.handlers.onDone?.();
          return;
        }
        try {
          const parsed = JSON.parse(payload) as {
            content?: string;
            error?: string;
          };
          if (parsed.error) {
            if (!aborted) req.handlers.onError?.(new Error(parsed.error));
            return;
          }
          if (typeof parsed.content === 'string') {
            if (!aborted) req.handlers.onChunk?.(parsed.content);
          }
        } catch (err) {
          log.warn('parse SSE frame failed', payload, err);
        }
      }
    }
  }

  xhr.open('POST', `${baseURL}${req.path}`);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Accept', 'text/event-stream');
  if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

  xhr.onreadystatechange = () => {
    if (aborted) return;
    if (xhr.readyState === 3) {
      // RECEIVING：每收到字节就刷一次帧
      emitFrames();
    } else if (xhr.readyState === 4) {
      emitFrames();
      if (xhr.status >= 400) {
        req.handlers.onError?.(new Error(`AI stream HTTP ${xhr.status}`));
      } else {
        req.handlers.onDone?.();
      }
    }
  };
  xhr.onerror = () => {
    if (aborted) return;
    req.handlers.onError?.(new Error('AI stream network error'));
  };

  xhr.send(JSON.stringify(req.body));

  return {
    abort: () => {
      aborted = true;
      try {
        xhr.abort();
      } catch {
        /* noop */
      }
    },
  };
}

export interface EnrichStreamInput {
  word: string;
  context: string;
  enhancedPhraseDetection?: boolean;
}

export function streamEnrichWord(
  input: EnrichStreamInput,
  handlers: StreamHandlers,
): Promise<AiStreamHandle> {
  return streamAi({
    path: '/api/v1/ai/enrich-stream',
    body: {
      word: input.word,
      context: input.context,
      enhancedPhraseDetection: input.enhancedPhraseDetection ?? false,
    },
    handlers,
  });
}

export interface TranslateStreamInput {
  sentence: string;
  targetSentence?: string;
  sentenceAnalysisMode?: 'always' | 'smart' | 'off';
}

export function streamTranslateSentence(
  input: TranslateStreamInput,
  handlers: StreamHandlers,
): Promise<AiStreamHandle> {
  return streamAi({
    path: '/api/v1/ai/translate-stream',
    body: {
      sentence: input.sentence,
      targetSentence: input.targetSentence,
      sentenceAnalysisMode: input.sentenceAnalysisMode ?? 'off',
    },
    handlers,
  });
}
