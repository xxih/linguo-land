import type {
  VocabularySyncResponse,
  WordFamiliarityStatus,
  WordMutationResponse,
} from 'shared-types';
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
   * 更新单词状态——后端返回的 family / removedFamilyRoot 用于扩展端镜像同步。
   */
  async updateWordStatus(
    word: string,
    status: WordFamiliarityStatus | null,
    familiarityLevel?: number,
  ): Promise<WordMutationResponse> {
    await this.ensureBaseUrl();
    logger.info(`Updating word status: ${word} -> ${status}`, { familiarityLevel });

    try {
      const requestBody: WordUpdateRequest = { status: status ?? undefined, familiarityLevel };

      const data = await fetchJsonWithAuth<WordMutationResponse>(
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
  async autoIncreaseFamiliarity(word: string): Promise<WordMutationResponse> {
    await this.ensureBaseUrl();
    logger.info(`Auto-increasing familiarity for word: ${word}`);

    try {
      const data = await fetchJsonWithAuth<WordMutationResponse>(
        `${this.config.baseUrl}/vocabulary/${encodeURIComponent(word)}/increase-familiarity`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(this.config.timeout),
        },
      );
      logger.info(`Familiarity increased for word: ${word}`, data);
      return data;
    } catch (error) {
      ResponseHandler.logError('Failed to auto-increase familiarity', error, { word });
      throw error;
    }
  }

  /**
   * 全量同步：拉取当前用户的所有词族（用于本地镜像）。
   */
  async syncVocabulary(): Promise<VocabularySyncResponse> {
    await this.ensureBaseUrl();
    return fetchJsonWithAuth<VocabularySyncResponse>(`${this.config.baseUrl}/vocabulary/sync`, {
      method: 'GET',
      signal: AbortSignal.timeout(this.config.timeout),
    });
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
