import { logger } from '../../utils/logger';

/**
 * 用户设置接口
 */
export interface UserSettings {
  highlightSettings: {
    unknown: string;
    learning: string;
    known: string;
  };
  siteSettings: {
    enabled: string[];
    disabled: string[];
  };
  displaySettings: {
    showDefinitions: boolean;
  };
  highlightEnabled: boolean;
  extensionEnabled: boolean;
}

/**
 * 默认设置
 */
const DEFAULT_SETTINGS: UserSettings = {
  highlightSettings: {
    unknown: '#fef3c7',
    learning: '#dbeafe',
    known: '#d1fae5',
  },
  siteSettings: {
    enabled: [],
    disabled: [],
  },
  displaySettings: {
    showDefinitions: true,
  },
  highlightEnabled: true,
  extensionEnabled: true,
};

/**
 * 设置变更回调函数类型
 */
type SettingsChangeCallback = (
  changedSettings: Partial<UserSettings>,
  allSettings: UserSettings,
) => void;

/**
 * 统一的设置管理器
 * 负责读取、缓存和监听所有 chrome.storage.sync 配置
 * 单例模式，全局唯一实例
 */
export class SettingsManager {
  private static instance: SettingsManager | null = null;
  private settings: UserSettings = DEFAULT_SETTINGS;
  private listeners: Set<SettingsChangeCallback> = new Set();
  private initialized = false;

  private constructor() {
    // 私有构造函数，防止外部实例化
  }

  /**
   * 获取单例实例
   */
  static getInstance(): SettingsManager {
    if (!SettingsManager.instance) {
      SettingsManager.instance = new SettingsManager();
    }
    return SettingsManager.instance;
  }

  /**
   * 初始化设置管理器
   * 读取配置并设置监听器
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('SettingsManager already initialized');
      return;
    }

    try {
      // 读取所有配置
      const result = await chrome.storage.sync.get([
        'highlightSettings',
        'siteSettings',
        'displaySettings',
        'highlightEnabled',
        'extensionEnabled',
      ]);

      // 合并配置
      this.settings = {
        ...DEFAULT_SETTINGS,
        ...(result.highlightSettings && {
          highlightSettings: result.highlightSettings,
        }),
        ...(result.siteSettings && { siteSettings: result.siteSettings }),
        ...(result.displaySettings && { displaySettings: result.displaySettings }),
        ...(result.highlightEnabled !== undefined && {
          highlightEnabled: result.highlightEnabled,
        }),
        ...(result.extensionEnabled !== undefined && {
          extensionEnabled: result.extensionEnabled,
        }),
      };

      // 如果 storage 中没有这些关键配置，写入默认值
      const needsInitialization: Record<string, any> = {};
      if (result.highlightEnabled === undefined) {
        needsInitialization.highlightEnabled = DEFAULT_SETTINGS.highlightEnabled;
      }
      if (result.extensionEnabled === undefined) {
        needsInitialization.extensionEnabled = DEFAULT_SETTINGS.extensionEnabled;
      }
      if (Object.keys(needsInitialization).length > 0) {
        logger.info('Initializing missing settings in storage', needsInitialization);
        await chrome.storage.sync.set(needsInitialization);
      }

      // 设置监听器
      this.setupStorageListener();

      this.initialized = true;
      logger.info('SettingsManager initialized', this.settings);
    } catch (error) {
      logger.error('Failed to initialize SettingsManager', error as Error);
      this.settings = DEFAULT_SETTINGS;
    }
  }

  /**
   * 设置 storage 监听器
   */
  private setupStorageListener(): void {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace !== 'sync') return;

      const changedSettings: Partial<UserSettings> = {};

      // 检查各个配置项的变化
      if (changes.highlightSettings) {
        this.settings.highlightSettings = changes.highlightSettings.newValue;
        changedSettings.highlightSettings = changes.highlightSettings.newValue;
      }

      if (changes.siteSettings) {
        this.settings.siteSettings = changes.siteSettings.newValue;
        changedSettings.siteSettings = changes.siteSettings.newValue;
      }

      if (changes.displaySettings) {
        this.settings.displaySettings = changes.displaySettings.newValue;
        changedSettings.displaySettings = changes.displaySettings.newValue;
      }

      if (changes.highlightEnabled !== undefined) {
        this.settings.highlightEnabled = changes.highlightEnabled.newValue;
        changedSettings.highlightEnabled = changes.highlightEnabled.newValue;
      }

      if (changes.extensionEnabled !== undefined) {
        this.settings.extensionEnabled = changes.extensionEnabled.newValue;
        changedSettings.extensionEnabled = changes.extensionEnabled.newValue;
      }

      // 如果有变化，通知所有监听器
      if (Object.keys(changedSettings).length > 0) {
        logger.debug('Settings changed', changedSettings);
        this.notifyListeners(changedSettings);
      }
    });
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(changedSettings: Partial<UserSettings>): void {
    this.listeners.forEach((callback) => {
      try {
        callback(changedSettings, this.settings);
      } catch (error) {
        logger.error('Error in settings change callback', error as Error);
      }
    });
  }

  /**
   * 添加配置变更监听器
   * @returns 取消监听的函数
   */
  onSettingsChange(callback: SettingsChangeCallback): () => void {
    this.listeners.add(callback);
    // 返回取消监听的函数
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * 获取所有设置
   */
  getSettings(): UserSettings {
    return { ...this.settings };
  }

  /**
   * 获取插件是否启用
   */
  isExtensionEnabled(): boolean {
    return this.settings.extensionEnabled;
  }

  /**
   * 获取高亮是否启用
   */
  isHighlightEnabled(): boolean {
    return this.settings.highlightEnabled;
  }

  /**
   * 获取高亮颜色设置
   */
  getHighlightSettings() {
    return { ...this.settings.highlightSettings };
  }

  /**
   * 获取网站设置
   */
  getSiteSettings() {
    return { ...this.settings.siteSettings };
  }

  /**
   * 获取显示设置
   */
  getDisplaySettings() {
    return { ...this.settings.displaySettings };
  }

  /**
   * 检查当前网站是否被禁用
   */
  isCurrentSiteDisabled(): boolean {
    const currentDomain = window.location.hostname;

    // 检查是否在禁用列表中
    const isDisabled = this.settings.siteSettings.disabled.some((disabledSite) => {
      // 支持精确匹配和子域名匹配
      return currentDomain === disabledSite || currentDomain.endsWith('.' + disabledSite);
    });

    if (isDisabled) {
      logger.debug('Current site is disabled', { domain: currentDomain });
    }

    return isDisabled;
  }

  /**
   * 销毁实例（主要用于测试）
   */
  static destroy(): void {
    if (SettingsManager.instance) {
      SettingsManager.instance.listeners.clear();
      SettingsManager.instance = null;
    }
  }
}
