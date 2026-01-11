import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChromeMessage } from 'shared-types';
import { Logger } from '../utils/logger';
import { X } from 'lucide-react';

const logger = new Logger('TranslationCard');

interface TranslationCardProps {
  paragraph: string;
  sentence: string;
  translation?: string;
  sentenceAnalysis?: string;
  isStreaming?: boolean;
}

/**
 * TranslationCard 组件
 * 显示句子翻译结果和长难句分析
 */
const TranslationCard: React.FC<TranslationCardProps> = ({
  paragraph,
  sentence,
  translation: initialTranslation,
  sentenceAnalysis: initialSentenceAnalysis,
  isStreaming = false,
}) => {
  const [translation, setTranslation] = useState(initialTranslation || '');
  const [sentenceAnalysis, setSentenceAnalysis] = useState(initialSentenceAnalysis);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreamingNow, setIsStreamingNow] = useState(isStreaming);
  const [error, setError] = useState<string | null>(null);

  // 监听流式消息
  useEffect(() => {
    const messageListener = (message: ChromeMessage) => {
      // 确保消息是针对当前段落和句子的
      if (message.paragraph !== paragraph || message.sentence !== sentence) {
        return;
      }

      switch (message.type) {
        case 'TRANSLATE_STREAM_DATA':
          // 收到流式数据，实时更新内容
          if (message.content) {
            setStreamingContent(message.content);
            setIsStreamingNow(true);
          }
          break;

        case 'TRANSLATE_STREAM_COMPLETE':
          // 流式完成，解析 JSON 并设置最终数据
          setIsStreamingNow(false);
          try {
            if (message.content) {
              const result = JSON.parse(message.content);
              setTranslation(result.translation || '');
              setSentenceAnalysis(result.sentenceAnalysis);
            }
          } catch (parseError) {
            logger.error('Failed to parse translation result', parseError as Error);
            setError('解析翻译结果失败');
          }
          setStreamingContent('');
          break;

        case 'TRANSLATE_STREAM_ERROR':
          // 流式错误
          logger.error(
            '[TranslationCard] 收到翻译错误消息: ' + message.error,
            new Error(message.error),
          );
          setIsStreamingNow(false);
          setError(message.error || '翻译失败，请稍后重试');
          setStreamingContent('');
          break;
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, [paragraph, sentence]);

  // 关闭句子卡片
  const handleClose = () => {
    // 移除 shadow host
    const shadowHost = document.getElementById('lang-helper-word-card-host');
    if (shadowHost) {
      shadowHost.remove();
    }
  };

  // 监听键盘事件，关闭句子卡片
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 检查卡片是否还在 DOM 中（防止卡片已关闭但监听器未清理的情况）
      const shadowHost = document.getElementById('lang-helper-word-card-host');
      if (!shadowHost) {
        return; // 卡片已关闭，不处理任何按键
      }

      // ESC 键总是关闭卡片
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        handleClose();
        return;
      }

      // 单独按 Meta 键（Mac 的 Command）或 Control 键时关闭卡片
      // 但不拦截组合键（如 cmd+c, cmd+a）
      if (e.key === 'Meta' || e.key === 'Control') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        handleClose();
      }
    };

    // 使用捕获阶段，确保优先处理
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);

  const closeButtonHoverHandlers = {
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      const el = e.currentTarget as HTMLElement;
      el.classList.add('bg-danger');
      el.classList.add('text-white');
      el.classList.add('rotate-90');
    },
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      const el = e.currentTarget as HTMLElement;
      el.classList.remove('bg-danger');
      el.classList.remove('text-white');
      el.classList.remove('rotate-90');
    },
  };

  return (
    <>
      <div
        className="rounded-xl border-0 p-4 w-xl bg-bg-base overflow-hidden pointer-events-auto"
        style={{ boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-font-secondary text-sm my-0 flex items-center gap-2">
            <span>翻译</span>
          </h3>
          <div
            className="text-center flex items-center justify-center rounded-lg bg-bg-base size-6 font-semibold text-font-secondary  border-0 cursor-pointer transition"
            onClick={handleClose}
            {...(closeButtonHoverHandlers as any)}
            title="关闭"
          >
            <X size={13} strokeWidth={3} />
          </div>
        </div>

        {/* Content */}
        <div className="space-y-3">
          {/* 错误信息 - 优先显示 */}
          {error && (
            <div className="bg-danger-100 text-danger-600 text-sm font-semibold px-3.5 py-2.5 rounded-sm flex items-center gap-2">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {/* Loading 状态 - 仅在没有错误时显示 */}
          {!error && isStreamingNow && !streamingContent && (
            <div className="flex items-center gap-2 text-font-base text-sm">
              <span className="inline-block w-2 h-2 bg-primary rounded-full animate-pulse"></span>
              AI 正在翻译中...
            </div>
          )}

          {/* 流式内容显示 - 仅在没有错误时显示 */}
          {!error && isStreamingNow && streamingContent && (
            <>
              <div className="text-xs mb-1 text-font-secondary flex items-center gap-2">
                <span>译文</span>
                <span className="inline-block w-2 h-2 bg-primary rounded-full animate-pulse"></span>
              </div>
              <div className="text-sm leading-relaxed text-font-base font-semibold">
                {streamingContent}
              </div>
            </>
          )}

          {/* 最终翻译结果 - 仅在没有错误且有翻译时显示 */}
          {!error && !isStreamingNow && translation && (
            <>
              <div className="text-xs mb-1 text-font-secondary">译文</div>
              <div className="text-sm leading-relaxed text-font-base font-semibold markdown-content">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    strong: ({ children }) => (
                      <strong className="font-bold text-font-base">{children}</strong>
                    ),
                    p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                  }}
                >
                  {translation}
                </ReactMarkdown>
              </div>
            </>
          )}

          {/* Sentence Analysis - 仅在没有错误时显示 */}
          {!error && !isStreamingNow && sentenceAnalysis && (
            <>
              <div className="border-t border-bg-700 my-3" />
              <div>
                <div className="text-xs mb-1 text-font-secondary">长难句分析</div>
                <div className="text-xs leading-relaxed text-font-base markdown-content">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      strong: ({ children }) => (
                        <strong className="font-bold text-font-base">{children}</strong>
                      ),
                      p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                      ul: ({ children }) => <ul className="list-disc pl-4 my-1">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal pl-4 my-1">{children}</ol>,
                      li: ({ children }) => <li className="mb-0.5">{children}</li>,
                    }}
                  >
                    {sentenceAnalysis}
                  </ReactMarkdown>
                </div>
              </div>
            </>
          )}

          {/* 原文 - 始终显示 */}
          <div>
            <div className="text-xs mb-1 text-font-secondary">原文</div>
            <div className="text-xs leading-relaxed text-font-secondary">{sentence}</div>
          </div>

          {/* Original Paragraph */}
          {/* {!isStreamingNow && (
            <>
              <div className="text-xs mb-1 text-font-secondary">原文</div>
              <div className="text-xs leading-relaxed text-font-secondary">{paragraph}</div>
            </>
          )} */}
        </div>
      </div>
    </>
  );
};

export default TranslationCard;
