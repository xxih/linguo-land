import type {
  ChromeMessage,
  ChromeMessageResponse,
  WordDetails,
  WordFamiliarityStatus,
  WordQueryResponse,
  AIEnrichmentData,
} from 'shared-types';
import { VocabularyApi } from './api/vocabularyApi';
import { DictionaryService } from './api/dictionaryApi';
import { ResponseHandler } from './utils/responseHandler';
import { Logger } from '../utils/logger';
import { fetchJsonWithAuth } from './api/fetchWithAuth';

/**
 * Chrome消息处理器
 * 统一处理所有来自content script的消息
 */
export class MessageHandlers {
  private vocabularyApi: VocabularyApi;
  private dictionaryService: DictionaryService;
  private logger: Logger;

  constructor() {
    this.vocabularyApi = new VocabularyApi();
    this.dictionaryService = new DictionaryService();
    this.logger = new Logger('MessageHandlers');
  }

  /**
   * 处理词汇状态查询
   */
  async handleQueryWordsStatus(words: string[]): Promise<WordQueryResponse> {
    this.logger.debug('Handling query words status', { wordCount: words.length });
    return await this.vocabularyApi.queryWordsStatus(words);
  }

  /**
   * 处理获取单词详情（保留用于向后兼容）
   */
  async handleGetWordDetails(word: string): Promise<WordDetails> {
    this.logger.debug('Handling get word details (legacy)', { word });
    return await this.dictionaryService.getWordDetails(word);
  }

  /**
   * 处理获取内部词典定义（新方法）
   */
  async handleGetInternalDefinition(word: string): Promise<WordDetails> {
    this.logger.debug('Handling get internal word definition', { word });
    return await this.dictionaryService.getWordDetails(word);
  }

  /**
   * 处理更新单词状态
   */
  async handleUpdateWordStatus(
    word: string,
    status: WordFamiliarityStatus,
    familiarityLevel?: number,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.debug('Handling update word status', {
      word,
      status,
      familiarityLevel,
    });

    // ✨ 新增逻辑：如果单词状态从 "ignored" 改变，先从忽略列表中移除
    await this.removeFromIgnoredList(word);

    return await this.vocabularyApi.updateWordStatus(word, status, familiarityLevel);
  }

  /**
   * 从忽略列表中移除单词
   */
  private async removeFromIgnoredList(word: string): Promise<void> {
    try {
      const result = await chrome.storage.sync.get(['ignoredWords']);
      const ignoredWords: string[] = result.ignoredWords || [];
      const wordLower = word.toLowerCase();
      if (ignoredWords.includes(wordLower)) {
        const updatedWords = ignoredWords.filter((w) => w !== wordLower);
        await chrome.storage.sync.set({ ignoredWords: updatedWords });
        this.logger.info('Word removed from ignore list', { word });
      }
    } catch (error) {
      this.logger.error('Failed to remove from ignore list', error as Error, {
        word,
      });
    }
  }

  /**
   * 处理忽略单词
   */
  async handleIgnoreWord(word: string): Promise<{ success: boolean; message: string }> {
    this.logger.debug('Handling ignore word', { word });

    try {
      // 获取当前的忽略列表
      const result = await chrome.storage.sync.get(['ignoredWords']);
      const ignoredWords: string[] = result.ignoredWords || [];

      // 添加新的忽略单词（转为小写避免重复）
      const wordLower = word.toLowerCase();
      if (!ignoredWords.includes(wordLower)) {
        ignoredWords.push(wordLower);
        await chrome.storage.sync.set({ ignoredWords });
        this.logger.info('Word added to ignore list', { word });
        return { success: true, message: `单词 "${word}" 已添加到忽略列表` };
      } else {
        this.logger.info('Word already in ignore list', { word });
        return { success: true, message: `单词 "${word}" 已经在忽略列表中` };
      }
    } catch (error) {
      this.logger.error('Failed to ignore word', error as Error, { word });
      return {
        success: false,
        message: error instanceof Error ? error.message : '未知错误',
      };
    }
  }

  /**
   * 批量处理忽略单词
   */
  async handleBatchIgnoreWords(
    words: string[],
  ): Promise<{ success: boolean; message: string; addedCount: number }> {
    this.logger.debug('Handling batch ignore words', { count: words.length });

    try {
      // 获取当前的忽略列表
      const result = await chrome.storage.sync.get(['ignoredWords']);
      const ignoredWords: string[] = result.ignoredWords || [];

      // 批量添加新的忽略单词（转为小写避免重复）
      let addedCount = 0;
      words.forEach((word) => {
        const wordLower = word.toLowerCase();
        if (!ignoredWords.includes(wordLower)) {
          ignoredWords.push(wordLower);
          addedCount++;
        }
      });

      // 一次性保存
      if (addedCount > 0) {
        await chrome.storage.sync.set({ ignoredWords });
        this.logger.info('Batch words added to ignore list', {
          count: addedCount,
          total: ignoredWords.length,
        });
      }

      return {
        success: true,
        message: `已添加 ${addedCount} 个单词到忽略列表`,
        addedCount,
      };
    } catch (error) {
      this.logger.error('Failed to batch ignore words', error as Error);
      return {
        success: false,
        message: error instanceof Error ? error.message : '未知错误',
        addedCount: 0,
      };
    }
  }

  /**
   * 批量更新单词状态
   */
  async handleBatchUpdateWordStatus(
    words: string[],
    status: WordFamiliarityStatus,
    familiarityLevel?: number,
  ): Promise<{ success: boolean; message: string; updatedCount: number }> {
    this.logger.debug('Handling batch update word status', {
      count: words.length,
      status,
    });

    try {
      let updatedCount = 0;
      // 逐个更新，但使用 Promise.all 并行处理
      await Promise.all(
        words.map((word) =>
          this.vocabularyApi
            .updateWordStatus(word, status, familiarityLevel)
            .then(() => {
              updatedCount++;
              return true;
            })
            .catch((error) => {
              this.logger.warn('Failed to update word status in batch', {
                word,
                error,
              });
              return false;
            }),
        ),
      );

      this.logger.info('Batch update word status completed', {
        updatedCount,
        total: words.length,
      });

      return {
        success: true,
        message: `已更新 ${updatedCount} 个单词状态`,
        updatedCount,
      };
    } catch (error) {
      this.logger.error('Failed to batch update word status', error as Error);
      return {
        success: false,
        message: error instanceof Error ? error.message : '未知错误',
        updatedCount: 0,
      };
    }
  }

  /**
   * 处理 AI 增强单词释义（非流式）
   */
  async handleEnrichWord(
    word: string,
    context: string,
    enhancedPhraseDetection?: boolean,
  ): Promise<AIEnrichmentData> {
    this.logger.debug('Handling enrich word', { word, context, enhancedPhraseDetection });

    this.logger.debug('enhancedPhraseDetection: ' + enhancedPhraseDetection);
    try {
      const data = await fetchJsonWithAuth<AIEnrichmentData>(
        `${this.vocabularyApi.config.baseUrl}/ai/enrich`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word, context, enhancedPhraseDetection }),
        },
      );

      this.logger.info('Word enriched successfully', { word });
      return data;
    } catch (error) {
      this.logger.error('Failed to enrich word', error as Error, { word });
      throw error;
    }
  }

  /**
   * 处理 AI 增强单词释义（流式）
   */
  async handleEnrichWordStream(
    word: string,
    context: string,
    enhancedPhraseDetection: boolean = true,
    sender: chrome.runtime.MessageSender,
  ): Promise<void> {
    this.logger.debug('Handling enrich word stream', { word, context, enhancedPhraseDetection });

    try {
      // 获取 accessToken
      const storage = await chrome.storage.local.get('accessToken');
      const accessToken = storage.accessToken;

      if (!accessToken) {
        throw new Error('No access token available');
      }

      const response = await fetch(`${this.vocabularyApi.config.baseUrl}/ai/enrich-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ word, context, enhancedPhraseDetection }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedContent = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          this.logger.debug('Stream completed');
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();

            if (data === '[DONE]') {
              // 流结束，发送完成信号，包装成 contextualDefinitions 数组格式
              if (sender.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, {
                  type: 'ENRICH_STREAM_COMPLETE',
                  word,
                  content: JSON.stringify({ contextualDefinitions: [accumulatedContent.trim()] }),
                });
              }
              return;
            }

            try {
              const chunk = JSON.parse(data);

              // 从 chunk 中提取内容
              if (chunk.choices && chunk.choices.length > 0) {
                const content = chunk.choices[0]?.delta?.content || '';
                if (content) {
                  accumulatedContent += content;

                  // 实时发送数据块给 content script
                  if (sender.tab?.id) {
                    chrome.tabs
                      .sendMessage(sender.tab.id, {
                        type: 'ENRICH_STREAM_DATA',
                        word,
                        content: accumulatedContent,
                      })
                      .catch(() => {
                        // 忽略发送失败
                      });
                  }
                }
              }
            } catch (parseError) {
              this.logger.error('Failed to parse chunk', parseError as Error);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Failed to enrich word stream', error as Error, { word });

      // 发送错误信息
      if (sender.tab?.id) {
        chrome.tabs
          .sendMessage(sender.tab.id, {
            type: 'ENRICH_STREAM_ERROR',
            word,
            error: error instanceof Error ? error.message : 'Unknown error',
          })
          .catch(() => {
            // 忽略发送失败
          });
      }

      throw error;
    }
  }

  /**
   * 处理 AI 翻译句子（流式）
   */
  async handleTranslateSentenceStream(
    paragraph: string,
    targetSentence: string,
    sentenceAnalysisMode: 'always' | 'smart' | 'off',
    sender: chrome.runtime.MessageSender,
  ): Promise<void> {
    this.logger.debug('[MessageHandlers] ========== 开始处理翻译句子流式请求 ==========');
    this.logger.debug('[MessageHandlers] 段落长度: ' + paragraph.length);
    this.logger.debug('[MessageHandlers] 目标句子长度: ' + targetSentence?.length);
    this.logger.debug('[MessageHandlers] 分析模式: ' + sentenceAnalysisMode);
    this.logger.debug('[MessageHandlers] 请求来源: ' + sender.tab?.id);

    this.logger.debug('Handling translate sentence stream', {
      paragraphLength: paragraph.length,
      targetSentenceLength: targetSentence?.length,
      sentenceAnalysisMode,
    });

    try {
      // 获取 accessToken
      this.logger.debug('[MessageHandlers] 获取 accessToken');
      const storage = await chrome.storage.local.get('accessToken');
      const accessToken = storage.accessToken;

      if (!accessToken) {
        this.logger.error(
          '[MessageHandlers] accessToken 不存在',
          new Error('No access token available'),
        );
        throw new Error('No access token available');
      }
      this.logger.debug('[MessageHandlers] accessToken 获取成功');

      const requestBody: any = { sentence: paragraph };
      if (targetSentence) {
        requestBody.targetSentence = targetSentence;
        requestBody.sentenceAnalysisMode = sentenceAnalysisMode;
      }
      this.logger.debug(
        '[MessageHandlers] 请求体: ' +
          JSON.stringify({
            sentenceLength: requestBody.sentence?.length,
            hasTargetSentence: !!requestBody.targetSentence,
            sentenceAnalysisMode: requestBody.sentenceAnalysisMode,
          }),
      );

      const apiUrl = `${this.vocabularyApi.config.baseUrl}/ai/translate-stream`;
      this.logger.debug('[MessageHandlers] 发起请求到: ' + apiUrl);

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(requestBody),
      });

      this.logger.debug(
        '[MessageHandlers] 收到响应: ' +
          JSON.stringify({
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
          }),
      );

      if (!response.ok) {
        this.logger.error(
          '[MessageHandlers] HTTP请求失败',
          new Error(`HTTP ${response.status}: ${response.statusText}`),
        );
        this.logger.error(
          '[MessageHandlers] 状态码: ' + response.status,
          new Error(response.statusText),
        );
        this.logger.error(
          '[MessageHandlers] 状态文本: ' + response.statusText,
          new Error(response.statusText),
        );
        let errorDetails = '';
        try {
          const errorText = await response.text();
          this.logger.error('[MessageHandlers] 错误响应体: ' + errorText, new Error(errorText));
          errorDetails = errorText;
        } catch (e) {
          this.logger.error('[MessageHandlers] 无法读取错误响应体', e as Error);
        }
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}${errorDetails ? ' - ' + errorDetails : ''}`,
        );
      }

      this.logger.debug('[MessageHandlers] HTTP请求成功，开始读取流式响应');

      if (!response.body) {
        this.logger.error('[MessageHandlers] 响应体为空', new Error('Response body is null'));
        throw new Error('Response body is null');
      }

      this.logger.debug('[MessageHandlers] 开始读取流式数据');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedContent = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          this.logger.debug('Translation stream completed');
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();

            if (data === '[DONE]') {
              // 流结束，解析并发送完成信号
              const parsedData = this.parseTranslationContent(accumulatedContent);

              if (sender.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, {
                  type: 'TRANSLATE_STREAM_COMPLETE',
                  paragraph,
                  sentence: targetSentence,
                  content: JSON.stringify(parsedData),
                });
              }
              return;
            }

            try {
              const chunk = JSON.parse(data);

              // 从 chunk 中提取内容
              if (chunk.choices && chunk.choices.length > 0) {
                const content = chunk.choices[0]?.delta?.content || '';
                if (content) {
                  accumulatedContent += content;

                  // 实时发送数据块给 content script
                  if (sender.tab?.id) {
                    chrome.tabs
                      .sendMessage(sender.tab.id, {
                        type: 'TRANSLATE_STREAM_DATA',
                        paragraph,
                        sentence: targetSentence,
                        content: accumulatedContent,
                      })
                      .catch(() => {
                        // 忽略发送失败
                      });
                  }
                }
              }
            } catch (parseError) {
              this.logger.error('Failed to parse translation chunk', parseError as Error);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('[MessageHandlers] ========== 翻译流式请求失败 ==========', error as Error);
      this.logger.error(
        '[MessageHandlers] 错误类型: ' +
          (error instanceof Error ? error.constructor.name : typeof error),
        error as Error,
      );
      this.logger.error(
        '[MessageHandlers] 错误信息: ' + (error instanceof Error ? error.message : String(error)),
        error as Error,
      );
      this.logger.error(
        '[MessageHandlers] 错误堆栈: ' + (error instanceof Error ? error.stack : 'No stack'),
        error as Error,
      );
      this.logger.error(
        '[MessageHandlers] 请求参数: ' +
          JSON.stringify({
            paragraphLength: paragraph?.length,
            targetSentenceLength: targetSentence?.length,
            sentenceAnalysisMode,
            apiUrl: `${this.vocabularyApi.config.baseUrl}/ai/translate-stream`,
          }),
        error as Error,
      );

      this.logger.error('Failed to translate sentence stream', error as Error);

      // 发送详细的错误信息
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.debug('[MessageHandlers] 向content script发送错误消息: ' + errorMessage);

      if (sender.tab?.id) {
        chrome.tabs
          .sendMessage(sender.tab.id, {
            type: 'TRANSLATE_STREAM_ERROR',
            paragraph,
            sentence: targetSentence,
            error: errorMessage,
          })
          .then(() => {
            this.logger.debug('[MessageHandlers] 错误消息发送成功');
          })
          .catch((sendError) => {
            this.logger.error('[MessageHandlers] 发送错误消息失败', sendError as Error);
          });
      }

      throw error;
    } finally {
      this.logger.debug('[MessageHandlers] ========== 翻译流式请求处理结束 ==========');
    }
  }

  /**
   * 处理 AI 翻译句子（非流式）
   */
  async handleTranslateSentence(
    paragraph: string,
    targetSentence?: string,
    sentenceAnalysisMode?: 'always' | 'smart' | 'off',
  ): Promise<{ translation: string; sentenceAnalysis?: string }> {
    this.logger.debug('Handling translate sentence', {
      paragraphLength: paragraph.length,
      paragraph: paragraph.substring(0, 50),
      targetSentenceLength: targetSentence?.length,
      targetSentence: targetSentence?.substring(0, 50),
      sentenceAnalysisMode,
    });

    try {
      const requestBody: any = { sentence: paragraph };
      if (targetSentence) {
        requestBody.targetSentence = targetSentence;
        requestBody.sentenceAnalysisMode = sentenceAnalysisMode;
      }

      this.logger.debug('Sending translation request', {
        url: `${this.vocabularyApi.config.baseUrl}/ai/translate`,
        bodyKeys: Object.keys(requestBody),
      });

      const data = await fetchJsonWithAuth<{ translation: string; sentenceAnalysis?: string }>(
        `${this.vocabularyApi.config.baseUrl}/ai/translate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        },
      );

      this.logger.info('Sentence translated successfully');
      return data;
    } catch (error) {
      this.logger.error('Failed to translate sentence', error as Error, {
        paragraphLength: paragraph.length,
        targetSentenceLength: targetSentence?.length,
      });
      throw error;
    }
  }

  /**
   * 主要的消息路由处理器
   */
  routeMessage(
    message: ChromeMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: ChromeMessageResponse) => void,
  ): boolean {
    this.logger.debug('Received message', {
      type: message.type,
      tabId: sender.tab?.id,
      url: sender.tab?.url,
    });

    try {
      switch (message.type) {
        case 'QUERY_WORDS_STATUS':
          // 异步处理，立即返回 true
          ResponseHandler.handleAsyncMessage(
            () => this.handleQueryWordsStatus(message.words!),
            sendResponse,
          );
          return true;

        case 'GET_WORD_DETAILS':
          // 保留用于向后兼容
          ResponseHandler.handleAsyncMessage(
            () => this.handleGetWordDetails(message.word!),
            sendResponse,
          );
          return true;

        case 'GET_INTERNAL_DEFINITION':
          // 使用新的内部词典 API
          ResponseHandler.handleAsyncMessage(
            () => this.handleGetInternalDefinition(message.word!),
            sendResponse,
          );
          return true;

        case 'UPDATE_WORD_STATUS':
          // 异步处理，立即返回 true
          ResponseHandler.handleAsyncMessage(async () => {
            const result = await this.handleUpdateWordStatus(
              message.word!,
              message.status!,
              message.familiarityLevel,
            );

            // 通知content script更新UI
            this.notifyContentScriptUpdate(
              sender,
              message.word!,
              message.status!,
              message.familiarityLevel,
            );

            return result;
          }, sendResponse);
          return true;

        case 'IGNORE_WORD':
          // 异步处理，立即返回 true
          ResponseHandler.handleAsyncMessage(async () => {
            const result = await this.handleIgnoreWord(message.word!);

            // 如果成功添加到忽略列表，通知content script立即移除高亮
            if (result.success) {
              this.notifyContentScriptWordIgnored(sender, message.word!);
            }

            return result;
          }, sendResponse);
          return true;

        case 'BATCH_IGNORE_WORDS':
          // 批量忽略单词
          ResponseHandler.handleAsyncMessage(async () => {
            const result = await this.handleBatchIgnoreWords(message.words!);
            return result;
          }, sendResponse);
          return true;

        case 'BATCH_UPDATE_WORD_STATUS':
          // 批量更新单词状态
          ResponseHandler.handleAsyncMessage(async () => {
            const result = await this.handleBatchUpdateWordStatus(
              message.words!,
              message.status!,
              message.familiarityLevel,
            );

            // 通知content script更新每个单词的高亮
            if (result.success) {
              message.words!.forEach((word) => {
                this.notifyContentScriptUpdate(
                  sender,
                  word,
                  message.status!,
                  message.familiarityLevel,
                );
              });
            }

            return result;
          }, sendResponse);
          return true;

        case 'AUTO_INCREASE_FAMILIARITY':
          // 自动提升熟练度
          this.logger.debug(
            '[MessageHandlers] 收到 AUTO_INCREASE_FAMILIARITY 消息, 词元: ' + message.word,
          );
          ResponseHandler.handleAsyncMessage(async () => {
            this.logger.debug('[MessageHandlers] 开始处理自动提升熟练度请求');
            const result = await this.vocabularyApi.autoIncreaseFamiliarity(message.word!);
            this.logger.debug(
              '[MessageHandlers] 自动提升熟练度处理完成: ' + JSON.stringify(result),
            );

            // 如果成功提升了熟练度，通知content script更新UI
            if (result.success) {
              // 获取更新后的完整单词信息
              const updatedWordInfo = await this.vocabularyApi.queryWordsStatus([message.word!]);
              if (updatedWordInfo && updatedWordInfo[message.word!]) {
                this.notifyContentScriptUpdate(
                  sender,
                  message.word!,
                  updatedWordInfo[message.word!].status as WordFamiliarityStatus,
                  updatedWordInfo[message.word!].familiarityLevel,
                );
              }
            }

            return result;
          }, sendResponse);
          return true;

        case 'ENRICH_WORD':
          // 异步处理，立即返回 true
          ResponseHandler.handleAsyncMessage(
            () =>
              this.handleEnrichWord(
                message.word!,
                message.context!,
                message.enhancedPhraseDetection,
              ),
            sendResponse,
          );
          return true;

        case 'ENRICH_WORD_STREAM':
          // 流式处理，不通过 sendResponse 返回
          this.handleEnrichWordStream(
            message.word!,
            message.context!,
            message.enhancedPhraseDetection || true,
            sender,
          )
            .then(() => {
              // 流式处理完成，返回成功
              sendResponse(ResponseHandler.createSuccessResponse({ streaming: true }));
            })
            .catch((error) => {
              sendResponse(ResponseHandler.createErrorResponse(error.message));
            });
          return true;

        case 'TRANSLATE_SENTENCE':
          // 异步处理，立即返回 true
          ResponseHandler.handleAsyncMessage(
            () =>
              this.handleTranslateSentence(
                message.context!, // 段落
                message.sentence, // 完整句子
                message.sentenceAnalysisMode || 'off',
              ),
            sendResponse,
          );
          return true;

        case 'TRANSLATE_SENTENCE_STREAM':
          // 流式翻译处理
          this.handleTranslateSentenceStream(
            message.context!,
            message.sentence!,
            message.sentenceAnalysisMode || 'off',
            sender,
          )
            .then(() => {
              sendResponse(ResponseHandler.createSuccessResponse({ streaming: true }));
            })
            .catch((error) => {
              sendResponse(ResponseHandler.createErrorResponse(error.message));
            });
          return true;

        default:
          this.logger.warn('Unknown message type', { type: message.type });
          sendResponse(
            ResponseHandler.createErrorResponse(`Unknown message type: ${message.type}`),
          );
          return false;
      }
    } catch (error) {
      ResponseHandler.logError('Message routing error', error, {
        messageType: message.type,
        tabId: sender.tab?.id,
      });
      sendResponse(
        ResponseHandler.createErrorResponse(error instanceof Error ? error.message : String(error)),
      );
      return false;
    }
  }

  /**
   * 通知content script单词状态更新
   */
  private notifyContentScriptUpdate(
    sender: chrome.runtime.MessageSender,
    word: string,
    status: WordFamiliarityStatus,
    familiarityLevel?: number,
  ): void {
    if (sender.tab?.id) {
      chrome.tabs
        .sendMessage(sender.tab.id, {
          type: 'WORD_STATUS_UPDATED',
          word: word,
          status: status,
          familiarityLevel: familiarityLevel,
        })
        .catch((error) => {
          // 忽略发送失败的错误（页面可能已经关闭）
          this.logger.debug('Failed to notify content script', error as Error);
        });
    }
  }

  /**
   * 通知content script单词已被忽略
   */
  private notifyContentScriptWordIgnored(sender: chrome.runtime.MessageSender, word: string): void {
    if (sender.tab?.id) {
      chrome.tabs
        .sendMessage(sender.tab.id, {
          type: 'WORD_IGNORED',
          word: word,
        })
        .catch((error) => {
          // 忽略发送失败的错误（页面可能已经关闭）
          this.logger.debug('Failed to notify content script about ignored word', error as Error);
        });
    }
  }

  /**
   * 手动设置词典提供商到存储
   */
  async setDictionaryProviderSetting(providerName: string): Promise<void> {
    try {
      await chrome.storage.sync.set({ dictionaryProvider: providerName });
      this.logger.info('Dictionary provider setting updated', {
        provider: providerName,
      });

      // 验证设置
      const result = await chrome.storage.sync.get('dictionaryProvider');
      this.logger.debug('Current storage setting', result);
    } catch (error) {
      this.logger.error('Failed to set dictionary provider', error as Error, {
        provider: providerName,
      });
    }
  }

  /**
   * 获取处理器统计信息
   */
  getStats(): {
    vocabularyApiHealthy: boolean;
    handlersRegistered: number;
  } {
    return {
      vocabularyApiHealthy: true, // 可以通过健康检查实现
      handlersRegistered: 5, // 当前支持的消息类型数量（增加了IGNORE_WORD和ENRICH_WORD）
    };
  }

  /**
   * 解析翻译内容，提取翻译和分析部分
   */
  private parseTranslationContent(content: string): {
    translation: string;
    sentenceAnalysis?: string;
  } {
    const trimmedContent = content.trim();

    // 尝试匹配 [翻译] 和 [分析] 分隔符
    const translationMatch = trimmedContent.match(/\[翻译\]\s*([\s\S]*?)(?:\[分析\]|$)/);
    const analysisMatch = trimmedContent.match(/\[分析\]\s*([\s\S]*?)$/);

    if (translationMatch || analysisMatch) {
      return {
        translation: translationMatch ? translationMatch[1].trim() : trimmedContent,
        sentenceAnalysis: analysisMatch ? analysisMatch[1].trim() : undefined,
      };
    }

    // 如果没有分隔符，说明只有翻译
    return {
      translation: trimmedContent,
    };
  }

  /**
   * 执行健康检查
   */
  async performHealthCheck(): Promise<{
    vocabulary: boolean;
    dictionary: boolean;
    overall: boolean;
  }> {
    try {
      const [vocabularyHealthy, dictionaryHealthy] = await Promise.allSettled([
        this.vocabularyApi.healthCheck(),
        this.dictionaryService.isWordExists('test'),
      ]);

      const vocabResult =
        vocabularyHealthy.status === 'fulfilled' ? vocabularyHealthy.value : false;
      const dictResult = dictionaryHealthy.status === 'fulfilled' ? dictionaryHealthy.value : false;

      return {
        vocabulary: vocabResult,
        dictionary: dictResult,
        overall: vocabResult && dictResult,
      };
    } catch (error) {
      ResponseHandler.logError('Health check failed', error);
      return {
        vocabulary: false,
        dictionary: false,
        overall: false,
      };
    }
  }
}
