/**
 * Storage Adapter
 * 统一处理 chrome.storage 访问，支持开发环境 mock
 */

import { Logger } from '../../utils/logger';

const logger = new Logger('StorageAdapter');

// 开发环境的 mock 数据
const DEV_MOCK_DATA = {
  // Sync storage mock
  sync: {
    aiMode: 'auto' as 'auto' | 'manual' | 'off',
    showFamiliarityInCard: true,
    enhancedPhraseDetection: true,
    extensionEnabled: true,
    highlightEnabled: true,
  },
  // Local storage mock
  local: {
    studySessionActive: false,
    studySessionLogs: [],
  },
};

/**
 * 检测是否在开发环境
 */
function isDevelopment(): boolean {
  // 如果 chrome.storage 不存在，说明在开发环境
  return typeof chrome === 'undefined' || !chrome.storage;
}

/**
 * Storage Adapter 类
 * 提供统一的存储访问接口
 */
export class StorageAdapter {
  private static mockData = DEV_MOCK_DATA;

  /**
   * 获取 sync storage 数据
   */
  static async getSync<T extends Record<string, any>>(
    keys: string | string[],
  ): Promise<Partial<T>> {
    if (isDevelopment()) {
      logger.debug('[StorageAdapter] Development mode - using mock data');
      const keyArray = typeof keys === 'string' ? [keys] : keys;
      const result: any = {};
      keyArray.forEach((key) => {
        if (key in this.mockData.sync) {
          result[key] = this.mockData.sync[key as keyof typeof this.mockData.sync];
        }
      });
      return result as Partial<T>;
    }

    return new Promise((resolve) => {
      chrome.storage.sync.get(keys, (result) => {
        resolve(result as Partial<T>);
      });
    });
  }

  /**
   * 设置 sync storage 数据
   */
  static async setSync(items: Record<string, any>): Promise<void> {
    if (isDevelopment()) {
      logger.debug(
        '[StorageAdapter] Development mode - updating mock data: ' + JSON.stringify(items),
      );
      Object.assign(this.mockData.sync, items);
      return;
    }

    return new Promise((resolve) => {
      chrome.storage.sync.set(items, () => {
        resolve();
      });
    });
  }

  /**
   * 获取 local storage 数据
   */
  static async getLocal<T extends Record<string, any>>(
    keys: string | string[],
  ): Promise<Partial<T>> {
    if (isDevelopment()) {
      logger.debug('[StorageAdapter] Development mode - using mock local data');
      const keyArray = typeof keys === 'string' ? [keys] : keys;
      const result: any = {};
      keyArray.forEach((key) => {
        if (key in this.mockData.local) {
          result[key] = this.mockData.local[key as keyof typeof this.mockData.local];
        }
      });
      return result as Partial<T>;
    }

    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => {
        resolve(result as Partial<T>);
      });
    });
  }

  /**
   * 设置 local storage 数据
   */
  static async setLocal(items: Record<string, any>): Promise<void> {
    if (isDevelopment()) {
      logger.debug(
        '[StorageAdapter] Development mode - updating mock local data: ' + JSON.stringify(items),
      );
      Object.assign(this.mockData.local, items);
      return;
    }

    return new Promise((resolve) => {
      chrome.storage.local.set(items, () => {
        resolve();
      });
    });
  }

  /**
   * 监听 storage 变化
   */
  static onChanged(
    callback: (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => void,
  ): void {
    if (isDevelopment()) {
      logger.debug('[StorageAdapter] Development mode - storage change listener registered');
      // 开发环境不需要监听
      return;
    }

    chrome.storage.onChanged.addListener(callback);
  }

  /**
   * 更新开发环境 mock 数据（仅用于测试）
   */
  static updateMockData(data: Partial<typeof DEV_MOCK_DATA>): void {
    if (data.sync) {
      Object.assign(this.mockData.sync, data.sync);
    }
    if (data.local) {
      Object.assign(this.mockData.local, data.local);
    }
  }

  /**
   * 获取当前 mock 数据（仅用于调试）
   */
  static getMockData() {
    return { ...this.mockData };
  }
}
