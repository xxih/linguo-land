import { StorageAdapter } from './storageAdapter';
import { Logger } from '../../utils/logger';

const logger = new Logger('UISettingsManager');

/**
 * UI 相关配置接口
 */
export interface UISettings {
  // AI 模式
  aiMode: 'auto' | 'manual' | 'off';
  // 是否在卡片中显示熟练度
  showFamiliarityInCard: boolean;
  // 是否启用增强词组检测
  enhancedPhraseDetection: boolean;
  // 学习会话状态
  studySessionActive: boolean;
}

/**
 * 默认 UI 配置
 */
const DEFAULT_UI_SETTINGS: UISettings = {
  aiMode: 'auto',
  showFamiliarityInCard: true,
  enhancedPhraseDetection: true,
  studySessionActive: false,
};

/**
 * 配置变更回调函数类型
 */
type UISettingsChangeCallback = (
  changedSettings: Partial<UISettings>,
  allSettings: UISettings,
) => void;

/**
 * UI 设置管理器
 * 负责管理 content-ui 相关的配置
 * 单例模式，全局唯一实例
 */
export class UISettingsManager {
  private static instance: UISettingsManager | null = null;
  private settings: UISettings = DEFAULT_UI_SETTINGS;
  private listeners: Set<UISettingsChangeCallback> = new Set();
  private initialized = false;

  private constructor() {
    // 私有构造函数，防止外部实例化
  }

  /**
   * 获取单例实例
   */
  static getInstance(): UISettingsManager {
    if (!UISettingsManager.instance) {
      UISettingsManager.instance = new UISettingsManager();
    }
    return UISettingsManager.instance;
  }

  /**
   * 初始化设置管理器
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('[UISettingsManager] Already initialized');
      return;
    }

    try {
      // 读取 sync 配置
      const syncResult = await StorageAdapter.getSync<{
        aiMode: 'auto' | 'manual' | 'off';
        showFamiliarityInCard: boolean;
        enhancedPhraseDetection: boolean;
      }>(['aiMode', 'showFamiliarityInCard', 'enhancedPhraseDetection']);

      // 读取 local 配置
      const localResult = await StorageAdapter.getLocal<{
        studySessionActive: boolean;
      }>(['studySessionActive']);

      // 合并配置
      this.settings = {
        ...DEFAULT_UI_SETTINGS,
        ...(syncResult.aiMode !== undefined && { aiMode: syncResult.aiMode }),
        ...(syncResult.showFamiliarityInCard !== undefined && {
          showFamiliarityInCard: syncResult.showFamiliarityInCard,
        }),
        ...(syncResult.enhancedPhraseDetection !== undefined && {
          enhancedPhraseDetection: syncResult.enhancedPhraseDetection,
        }),
        ...(localResult.studySessionActive !== undefined && {
          studySessionActive: localResult.studySessionActive,
        }),
      };

      // 设置监听器
      this.setupStorageListener();

      this.initialized = true;
      logger.debug('[UISettingsManager] Initialized', this.settings);
    } catch (error) {
      logger.error('[UISettingsManager] Failed to initialize', error as Error);
      this.settings = DEFAULT_UI_SETTINGS;
    }
  }

  /**
   * 设置 storage 监听器
   */
  private setupStorageListener(): void {
    StorageAdapter.onChanged((changes, namespace) => {
      const changedSettings: Partial<UISettings> = {};

      if (namespace === 'sync') {
        if (changes.aiMode) {
          this.settings.aiMode = changes.aiMode.newValue;
          changedSettings.aiMode = changes.aiMode.newValue;
        }

        if (changes.showFamiliarityInCard !== undefined) {
          this.settings.showFamiliarityInCard = changes.showFamiliarityInCard.newValue;
          changedSettings.showFamiliarityInCard = changes.showFamiliarityInCard.newValue;
        }

        if (changes.enhancedPhraseDetection !== undefined) {
          this.settings.enhancedPhraseDetection = changes.enhancedPhraseDetection.newValue;
          changedSettings.enhancedPhraseDetection = changes.enhancedPhraseDetection.newValue;
        }
      }

      if (namespace === 'local') {
        if (changes.studySessionActive !== undefined) {
          this.settings.studySessionActive = changes.studySessionActive.newValue;
          changedSettings.studySessionActive = changes.studySessionActive.newValue;
        }
      }

      // 如果有变化，通知所有监听器
      if (Object.keys(changedSettings).length > 0) {
        logger.debug('[UISettingsManager] Settings changed', changedSettings);
        this.notifyListeners(changedSettings);
      }
    });
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(changedSettings: Partial<UISettings>): void {
    this.listeners.forEach((callback) => {
      try {
        callback(changedSettings, this.settings);
      } catch (error) {
        logger.error('[UISettingsManager] Error in settings change callback', error as Error);
      }
    });
  }

  /**
   * 添加配置变更监听器
   * @returns 取消监听的函数
   */
  onSettingsChange(callback: UISettingsChangeCallback): () => void {
    this.listeners.add(callback);
    // 返回取消监听的函数
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * 获取所有设置
   */
  getSettings(): UISettings {
    return { ...this.settings };
  }

  /**
   * 获取 AI 模式
   */
  getAiMode(): 'auto' | 'manual' | 'off' {
    return this.settings.aiMode;
  }

  /**
   * 设置 AI 模式
   */
  async setAiMode(mode: 'auto' | 'manual' | 'off'): Promise<void> {
    await StorageAdapter.setSync({ aiMode: mode });
    this.settings.aiMode = mode;
  }

  /**
   * 是否显示熟练度
   */
  shouldShowFamiliarity(): boolean {
    return this.settings.showFamiliarityInCard;
  }

  /**
   * 设置是否显示熟练度
   */
  async setShowFamiliarity(show: boolean): Promise<void> {
    await StorageAdapter.setSync({ showFamiliarityInCard: show });
    this.settings.showFamiliarityInCard = show;
  }

  /**
   * 是否启用增强词组检测
   */
  isEnhancedPhraseDetectionEnabled(): boolean {
    return this.settings.enhancedPhraseDetection;
  }

  /**
   * 设置是否启用增强词组检测
   */
  async setEnhancedPhraseDetection(enabled: boolean): Promise<void> {
    await StorageAdapter.setSync({ enhancedPhraseDetection: enabled });
    this.settings.enhancedPhraseDetection = enabled;
  }

  /**
   * 是否在学习会话中
   */
  isStudySessionActive(): boolean {
    return this.settings.studySessionActive;
  }

  /**
   * 销毁实例（主要用于测试）
   */
  static destroy(): void {
    if (UISettingsManager.instance) {
      UISettingsManager.instance.listeners.clear();
      UISettingsManager.instance = null;
    }
  }
}
