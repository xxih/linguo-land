import type { WordQueryResponse, WordFamiliarityStatus } from 'shared-types';
import type { WordUpdateRequest, ApiConfig } from '../types';
import { ResponseHandler } from '../utils/responseHandler';
import { logger } from '../../utils/logger';
import { fetchWithAuth, fetchJsonWithAuth } from './fetchWithAuth';
import { getApiBaseUrl } from './apiConfig';

/**
 * 词汇API管理器
 * 负责与后端API的所有词汇相关通信
 */
export class VocabularyApi {
  private static readonly DEFAULT_TIMEOUT = 10000;

  public config: ApiConfig;

  constructor(config?: Partial<ApiConfig>) {
    this.config = {
      baseUrl: '', // 将在运行时从配置获取
      timeout: config?.timeout || VocabularyApi.DEFAULT_TIMEOUT,
    };
  }

  /**
   * 确保配置中有基础 URL
   */
  private async ensureBaseUrl(): Promise<void> {
    if (!this.config.baseUrl) {
      this.config.baseUrl = await getApiBaseUrl();
    }
  }

  /**
   * 查询多个单词的状态
   */
  async queryWordsStatus(words: string[]): Promise<WordQueryResponse> {
    if (words.length === 0) {
      return {};
    }

    await this.ensureBaseUrl();
    logger.info(`Querying ${words.length} words:`, words.slice(0, 10));

    try {
      const data = await fetchJsonWithAuth<WordQueryResponse>(
        `${this.config.baseUrl}/vocabulary/query`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ words }),
          signal: AbortSignal.timeout(this.config.timeout),
        },
      );

      logger.info(`Received status for ${Object.keys(data).length} words`);

      return data;
    } catch (error) {
      ResponseHandler.logError('Failed to query word status', error, {
        wordsCount: words.length,
        sampleWords: words.slice(0, 5),
      });
      throw error;
    }
  }

  /**
   * 更新单词状态
   */
  async updateWordStatus(
    word: string,
    status: WordFamiliarityStatus,
    familiarityLevel?: number,
  ): Promise<{ success: boolean; message: string }> {
    await this.ensureBaseUrl();
    logger.info(`Updating word status: ${word} -> ${status}`, {
      familiarityLevel,
    });

    try {
      const requestBody: WordUpdateRequest = {
        status,
        familiarityLevel,
        // userId 从 JWT 令牌中获取，不需要在这里传递
      };

      const data = await fetchJsonWithAuth<{ success: boolean; message: string }>(
        `${this.config.baseUrl}/vocabulary/${encodeURIComponent(word)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(this.config.timeout),
        },
      );

      logger.info(`Word status updated successfully:`, data);

      return data;
    } catch (error) {
      ResponseHandler.logError('Failed to update word status', error, {
        word,
        status,
        familiarityLevel,
      });
      throw error;
    }
  }

  /**
   * 自动提升熟练度
   */
  async autoIncreaseFamiliarity(word: string): Promise<{ success: boolean; message: string }> {
    await this.ensureBaseUrl();
    logger.debug('[VocabularyApi] 开始调用自动提升熟练度API');
    logger.debug('[VocabularyApi] 请求参数 - 词元: ' + word);
    logger.debug('[VocabularyApi] API URL: ' + `${this.config.baseUrl}/vocabulary/${encodeURIComponent(word)}/increase-familiarity`);

    logger.info(`Auto-increasing familiarity for word: ${word}`);

    try {
      const data = await fetchJsonWithAuth<{ success: boolean; message: string }>(
        `${this.config.baseUrl}/vocabulary/${encodeURIComponent(word)}/increase-familiarity`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(this.config.timeout),
        },
      );

      logger.debug('[VocabularyApi] 自动提升熟练度API成功响应: ' + JSON.stringify(data));
      logger.info(`Familiarity increased successfully for word: ${word}`, data);

      return data;
    } catch (error) {
      logger.error('[VocabularyApi] 自动提升熟练度API失败', error as Error, {
        word,
        stack: error instanceof Error ? error.stack : undefined,
      });
      ResponseHandler.logError('Failed to auto-increase familiarity', error, {
        word,
      });
      throw error;
    }
  }

  /**
   * 批量查询单词状态（支持分页）
   */
  async batchQueryWords(words: string[], batchSize: number = 100): Promise<WordQueryResponse> {
    if (words.length <= batchSize) {
      return this.queryWordsStatus(words);
    }

    logger.info(`Batch querying ${words.length} words in batches of ${batchSize}`);

    const results: WordQueryResponse = {};
    const batches = this.createBatches(words, batchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      logger.info(`Processing batch ${i + 1}/${batches.length} (${batch.length} words)`);

      try {
        const batchResult = await this.queryWordsStatus(batch);
        Object.assign(results, batchResult);

        // 添加批次间的小延迟，避免API限制
        if (i < batches.length - 1) {
          await this.delay(100);
        }
      } catch (error) {
        logger.error(`Batch ${i + 1} failed:`, error as Error);
        // 继续处理下一批，不中断整个流程
      }
    }

    logger.info(`Batch query completed. Total results: ${Object.keys(results).length}`);
    return results;
  }

  /**
   * 将数组分割为批次
   */
  private createBatches<T>(array: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.ensureBaseUrl();
      const response = await fetchWithAuth(`${this.config.baseUrl}/vocabulary/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000), // 健康检查超时设置为5秒
      });

      return response.ok;
    } catch (error: any) {
      logger.warn('API health check failed:', error);
      return false;
    }
  }
}
