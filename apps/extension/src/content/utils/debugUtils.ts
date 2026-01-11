import type { ProcessingState } from '../types';
import type { HighlightManager } from './highlightManager';
import { Logger } from '../../utils/logger';

/**
 * 调试工具类
 * 提供调试功能和性能监控
 */
export class DebugUtils {
  private static readonly MAX_PROCESSING_TIME = 30000; // 30秒超时
  private static readonly CHECK_INTERVAL = 5000; // 每5秒检查一次
  private static readonly MEMORY_CHECK_INTERVAL = 10000; // 每10秒检查一次内存

  private processingState: ProcessingState;
  private highlightManager: HighlightManager;
  private checkInterval: NodeJS.Timeout | null = null;
  private memoryInterval: NodeJS.Timeout | null = null;
  private logger: Logger;

  constructor(highlightManager: HighlightManager) {
    this.logger = new Logger('DebugUtils');
    this.processingState = {
      isProcessing: false,
      processingStartTime: 0,
    };
    this.highlightManager = highlightManager;
    this.initializeDebugFeatures();
  }

  /**
   * 初始化调试功能
   */
  private initializeDebugFeatures(): void {
    this.setupGlobalErrorHandling();
    this.setupMemoryMonitoring();
    this.setupProcessingTimeoutCheck();
    this.setupDebugKeyboardShortcuts();
    this.logDebugInfo();
  }

  /**
   * 设置全局错误处理
   */
  private setupGlobalErrorHandling(): void {
    window.addEventListener('error', (event) => {
      this.logger.error('Global error occurred', event.error as Error, {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
    });
  }

  /**
   * 设置内存监控
   */
  private setupMemoryMonitoring(): void {
    if ('memory' in performance) {
      this.memoryInterval = setInterval(() => {
        const memory = (performance as any).memory;
        if (memory) {
          this.logger.debug('Memory usage', {
            used: `${(memory.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB`,
            total: `${(memory.totalJSHeapSize / 1024 / 1024).toFixed(2)}MB`,
            limit: `${(memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2)}MB`,
          });
        }
      }, DebugUtils.MEMORY_CHECK_INTERVAL);
    }
  }

  /**
   * 设置处理超时检查
   */
  private setupProcessingTimeoutCheck(): void {
    this.checkInterval = setInterval(() => {
      if (this.processingState.isProcessing && this.processingState.processingStartTime > 0) {
        const elapsed = Date.now() - this.processingState.processingStartTime;
        if (elapsed > DebugUtils.MAX_PROCESSING_TIME) {
          this.emergencyStop(`处理超时 (${elapsed}ms)`);
        }
      }
    }, DebugUtils.CHECK_INTERVAL);
  }

  /**
   * 设置调试快捷键
   */
  private setupDebugKeyboardShortcuts(): void {
    document.addEventListener('keydown', (event) => {
      // Ctrl + Shift + D 触发调试信息
      if (event.ctrlKey && event.shiftKey && event.key === 'D') {
        this.showDebugInfo();
        event.preventDefault();
      }

      // Ctrl + Shift + R 强制重新扫描
      if (event.ctrlKey && event.shiftKey && event.key === 'R') {
        this.logger.debug('Manual rescan triggered');
        this.emergencyStop('手动重置');
        // 触发重新扫描的事件
        document.dispatchEvent(new CustomEvent('lang-helper-force-rescan'));
        event.preventDefault();
      }

      // Ctrl + Shift + S 应急停止
      if (event.ctrlKey && event.shiftKey && event.key === 'S') {
        this.logger.debug('Manual emergency stop triggered');
        this.emergencyStop('手动停止');
        event.preventDefault();
      }
    });
  }

  /**
   * 记录调试信息
   */
  private logDebugInfo(): void {
    this.logger.info('Content script setup complete');
    this.logger.info('Debug shortcuts', {
      shortcuts: [
        'Ctrl + Shift + D: Show debug info',
        'Ctrl + Shift + R: Force rescan',
        'Ctrl + Shift + S: Emergency stop',
      ],
    });
  }

  /**
   * 显示调试信息
   */
  showDebugInfo(): void {
    const stats = this.highlightManager.getStats();
    const highlights = [];
    for (const [name, highlight] of CSS.highlights) {
      highlights.push(`${name}: ${highlight.size} ranges`);
    }

    this.logger.info('Manual debug info', {
      isProcessing: this.processingState.isProcessing,
      processingStartTime: this.processingState.processingStartTime,
      totalHighlights: stats.totalHighlights,
      cssHighlightsSize: CSS.highlights.size,
      highlights,
    });
  }

  /**
   * 应急停止机制
   */
  emergencyStop(reason: string): void {
    this.logger.error('Emergency stop triggered', new Error(reason));
    this.processingState.isProcessing = false;
    this.processingState.processingStartTime = 0;

    // 清空所有高亮
    this.highlightManager.clear();
  }

  /**
   * 开始处理
   */
  startProcessing(): boolean {
    if (this.processingState.isProcessing) {
      this.logger.debug('Already processing, skipping');
      return false;
    }

    this.processingState.isProcessing = true;
    this.processingState.processingStartTime = Date.now();
    return true;
  }

  /**
   * 结束处理
   */
  endProcessing(): void {
    this.processingState.isProcessing = false;
    this.processingState.processingStartTime = 0;
  }

  /**
   * 获取处理状态
   */
  getProcessingState(): ProcessingState {
    return { ...this.processingState };
  }

  /**
   * 销毁调试工具
   */
  destroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    if (this.memoryInterval) {
      clearInterval(this.memoryInterval);
      this.memoryInterval = null;
    }
  }
}
