/**
 * 工具函数集合
 */

import { logger } from '../../utils/logger';

/**
 * 防抖函数
 */
export function debounce<T extends (...args: any[]) => void>(func: T, delay: number): T {
  let timeout: NodeJS.Timeout;
  return ((...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), delay);
  }) as T;
}

/**
 * 性能测量装饰器
 */
export function measurePerformance(label: string) {
  return function <T extends (...args: any[]) => any>(
    target: any,
    _propertyName: string,
    descriptor: TypedPropertyDescriptor<T>,
  ) {
    const method = descriptor.value!;

    descriptor.value = ((...args: any[]) => {
      const startTime = performance.now();
      const result = method.apply(target, args);

      if (result instanceof Promise) {
        return result.finally(() => {
          const endTime = performance.now();
          logger.info(`⏱️  ${label}: ${(endTime - startTime).toFixed(2)}ms`);
        });
      } else {
        const endTime = performance.now();
        logger.info(`⏱️  ${label}: ${(endTime - startTime).toFixed(2)}ms`);
        return result;
      }
    }) as T;

    return descriptor;
  };
}

/**
 * 安全的 DOM 操作
 */
export class SafeDOM {
  /**
   * 安全地获取元素
   */
  static safeQuerySelector<T extends Element = Element>(
    selector: string,
    context: Document | Element = document,
  ): T | null {
    try {
      return context.querySelector<T>(selector);
    } catch (error) {
      logger.error(`查询选择器失败: ${selector}`, error as Error);
      return null;
    }
  }

  /**
   * 安全地创建元素
   */
  static safeCreateElement<K extends keyof HTMLElementTagNameMap>(
    tagName: K,
    attributes?: Record<string, string>,
  ): HTMLElementTagNameMap[K] | null {
    try {
      const element = document.createElement(tagName);
      if (attributes) {
        Object.entries(attributes).forEach(([key, value]) => {
          element.setAttribute(key, value);
        });
      }
      return element;
    } catch (error) {
      logger.error(`创建元素失败: ${tagName}`, error as Error);
      return null;
    }
  }

  /**
   * 安全地移除元素
   */
  static safeRemoveElement(element: Element | null): boolean {
    try {
      if (element && element.parentNode) {
        element.parentNode.removeChild(element);
        return true;
      }
      return false;
    } catch (error) {
      logger.error('移除元素失败', error as Error);
      return false;
    }
  }
}

/**
 * CSS Custom Highlight API 检查
 */
export class HighlightAPIChecker {
  /**
   * 检查浏览器是否支持 CSS Custom Highlight API
   */
  static isSupported(): boolean {
    return !!(CSS && CSS.highlights);
  }

  /**
   * 记录支持状态
   */
  static logSupport(): void {
    if (this.isSupported()) {
      logger.info('✅ CSS Custom Highlight API 支持');
    } else {
      logger.error('CSS Custom Highlight API 不支持，扩展可能无法正常工作', new Error('CSS Custom Highlight API not supported'));
    }
  }
}

/**
 * 页面信息工具
 */
export class PageInfo {
  /**
   * 获取页面基本信息
   */
  static getBasicInfo(): {
    url: string;
    title: string;
    width: number;
    height: number;
  } {
    return {
      url: window.location.href,
      title: document.title,
      width: document.body.clientWidth,
      height: document.body.clientHeight,
    };
  }

  /**
   * 记录页面信息
   */
  static logInfo(): void {
    const info = this.getBasicInfo();
    logger.info(`📍 页面URL: ${info.url}`);
    logger.info(`📄 页面标题: ${info.title}`);
    logger.info(`📏 页面大小: ${info.width}x${info.height}`);
  }
}
