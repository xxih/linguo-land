import type { ChromeMessageResponse } from 'shared-types';
import { Logger } from '../../utils/logger';

const logger = new Logger('ResponseHandler');

/**
 * 响应处理工具类
 * 统一处理Chrome消息响应和错误处理
 */
export class ResponseHandler {
  /**
   * 处理异步Chrome消息
   */
  static async handleAsyncMessage(
    handler: () => Promise<any>,
    sendResponse: (response: ChromeMessageResponse) => void,
  ): Promise<void> {
    try {
      const data = await handler();
      const response: ChromeMessageResponse = {
        success: true,
        data,
      };
      sendResponse(response);
    } catch (error: any) {
      logger.error('Message handler error:', error);
      const response: ChromeMessageResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
      sendResponse(response);
    }
  }

  /**
   * 包装异步消息处理器
   */
  static wrapAsyncHandler(
    handler: () => Promise<any>,
  ): (sendResponse: (response: ChromeMessageResponse) => void) => Promise<void> {
    return async (sendResponse: (response: ChromeMessageResponse) => void) => {
      await this.handleAsyncMessage(handler, sendResponse);
    };
  }

  /**
   * 创建成功响应
   */
  static createSuccessResponse(data: any): ChromeMessageResponse {
    return {
      success: true,
      data,
    };
  }

  /**
   * 创建错误响应
   */
  static createErrorResponse(error: string | Error): ChromeMessageResponse {
    return {
      success: false,
      error: error instanceof Error ? error.message : error,
    };
  }

  /**
   * 安全的JSON解析
   */
  static safeJsonParse<T>(jsonString: string, fallback: T): T {
    try {
      return JSON.parse(jsonString);
    } catch (error: any) {
      logger.error('JSON解析失败:', error);
      return fallback;
    }
  }

  /**
   * 通用的API响应检查
   */
  static async checkApiResponse(response: Response): Promise<any> {
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    } else {
      return await response.text();
    }
  }

  /**
   * 记录错误信息
   */
  static logError(context: string, error: any, additionalInfo?: any): void {
    logger.error(`❌ ${context}:`, error);
    if (additionalInfo) {
      logger.error(`📄 附加信息:`, additionalInfo);
    }
  }
}
