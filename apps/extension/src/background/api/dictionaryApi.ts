import type { WordDetails } from 'shared-types';
import { logger } from '../../utils/logger';
import { fetchJsonWithAuth } from './fetchWithAuth';
import { getApiBaseUrl } from './apiConfig';

/**
 * 词典服务 - 使用内部数据库
 * 替代了之前的有道词典和 FreeDictionary API
 */
export class DictionaryService {
  public getProviderName(): string {
    return 'InternalDB';
  }

  /**
   * 从内部 API 获取单词详情
   */
  async getWordDetails(word: string): Promise<WordDetails> {
    logger.info(`[${this.getProviderName()}] Getting details for word: ${word}`);

    try {
      const API_BASE_URL = await getApiBaseUrl();
      const data = await fetchJsonWithAuth<WordDetails>(
        `${API_BASE_URL}/dictionary/${encodeURIComponent(word)}`,
      );
      return data;
    } catch (error: any) {
      logger.error('Failed to get word details from internal API', error, {
        word,
      });
      // 返回一个符合新结构的 fallback 对象
      return this.createFallbackWordDetails(word, error.message || 'Definition not found');
    }
  }

  /**
   * 创建 fallback 词典数据
   */
  private createFallbackWordDetails(word: string, message: string): WordDetails {
    return {
      id: -1,
      word: word,
      phonetics: [],
      audio: [],
      forms: [],
      entries: [
        {
          pos: 'error',
          senses: [{ glosses: [message], examples: [] }],
        },
      ],
    };
  }

  /**
   * 检查单词是否存在
   */
  async isWordExists(word: string): Promise<boolean> {
    try {
      const details = await this.getWordDetails(word);
      return details.id !== -1 && details.entries.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * 获取单词的简短定义（仅第一个定义）
   */
  async getShortDefinition(word: string): Promise<string> {
    try {
      const details = await this.getWordDetails(word);
      if (details.entries.length > 0 && details.entries[0].senses.length > 0) {
        return details.entries[0].senses[0].glosses[0] || 'Definition not available';
      }
      return 'Definition not available';
    } catch (error) {
      logger.error(`Failed to get short definition for word: ${word}`, error as Error);
      return 'Definition not available';
    }
  }

  /**
   * 批量获取单词详情
   */
  async batchGetWordDetails(
    words: string[],
    maxConcurrent: number = 5,
  ): Promise<Record<string, WordDetails>> {
    const results: Record<string, WordDetails> = {};
    const promises: Promise<void>[] = [];

    // 控制并发数量
    for (let i = 0; i < words.length; i += maxConcurrent) {
      const batch = words.slice(i, i + maxConcurrent);

      const batchPromises = batch.map(async (word) => {
        try {
          const details = await this.getWordDetails(word);
          results[word] = details;
        } catch (error) {
          logger.error(`Failed to get details for word: ${word}`, error as Error);
          results[word] = this.createFallbackWordDetails(word, 'Definition not available');
        }
      });

      promises.push(...batchPromises);

      // 等待当前批次完成再处理下一批次
      await Promise.allSettled(batchPromises);

      // 本地 API 不需要太长延迟
      if (i + maxConcurrent < words.length) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    await Promise.allSettled(promises);
    return results;
  }
}
