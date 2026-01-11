import type { WordDetails, WordFamiliarityStatus } from 'shared-types';
import { WORD_CARD_HOST } from '../../const';

/**
 * 单词卡片管理器
 * 负责管理单词弹窗的显示和隐藏
 */
export class WordCardManager {
  private static readonly CARD_WIDTH = 320;
  private static readonly CARD_HEIGHT = 200;
  private static readonly MARGIN = 16;
  private static readonly OFFSET = 8;

  private currentCloseHandler: ((e: MouseEvent) => void) | null = null;
  private loadingIndicator: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private clickPosition: { x: number; y: number } | null = null;

  /**
   * 显示 loading 指示器
   */
  showLoadingIndicator(x: number, y: number): void {
    this.removeLoadingIndicator();

    const indicator = document.createElement('div');
    indicator.id = 'linguo-word-loading';
    indicator.style.cssText = `
      position: absolute;
      left: ${x + 10}px;
      top: ${y - 10}px;
      width: 16px;
      height: 16px;
      border: 2px solid #e0e0e0;
      border-top: 2px solid #ffc700;
      border-radius: 50%;
      animation: linguo-spin 0.6s linear infinite;
      z-index: 999999;
      pointer-events: none;
    `;

    // 添加动画样式
    if (!document.getElementById('linguo-loading-style')) {
      const style = document.createElement('style');
      style.id = 'linguo-loading-style';
      style.textContent = `
        @keyframes linguo-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(indicator);
    this.loadingIndicator = indicator;
  }

  /**
   * 移除 loading 指示器
   */
  removeLoadingIndicator(): void {
    if (this.loadingIndicator) {
      this.loadingIndicator.remove();
      this.loadingIndicator = null;
    }
  }

  /**
   * 显示单词卡片（两阶段渲染：先隐藏渲染、测量尺寸、再定位显示）
   */
  showWordCard(
    word: string,
    lemmas: string[],
    familyRoot: string | undefined,
    details: WordDetails,
    x: number,
    y: number,
    context?: string,
    status?: WordFamiliarityStatus | 'ignored',
    familiarityLevel?: number,
  ): void {
    // 移除 loading 指示器
    this.removeLoadingIndicator();

    // 移除现有的弹窗
    this.removeExistingWordCard();

    // 保存点击位置，供后续重新计算使用
    this.clickPosition = { x, y };

    // 创建 Shadow Host
    const shadowHost = this.createShadowHost();

    // 第一阶段：设置为不可见，先渲染到 DOM
    shadowHost.style.visibility = 'hidden';
    shadowHost.style.left = `${x}px`;
    shadowHost.style.top = `${y}px`;

    // 创建 Shadow DOM
    const shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    // 创建 React 应用挂载点
    const reactRoot = document.createElement('div');
    reactRoot.id = 'word-card-react-root';
    shadowRoot.appendChild(reactRoot);

    // 将 Shadow Host 添加到页面（不可见）
    document.body.appendChild(shadowHost);

    // 通过自定义事件传递数据给 React 应用
    const position = this.calculatePosition(x, y);
    this.dispatchShowCardEvent(
      word,
      lemmas,
      familyRoot,
      details,
      shadowRoot,
      position,
      context,
      status,
      familiarityLevel,
    );

    // 第二阶段：等待 React 渲染完成后，测量尺寸并重新定位
    // 使用 requestAnimationFrame 确保浏览器完成渲染
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // 获取卡片的真实尺寸
        const rect = shadowHost.getBoundingClientRect();
        const cardWidth = rect.width;
        const cardHeight = rect.height;

        // 只有当卡片有内容时才重新定位（避免空卡片）
        if (cardWidth > 0 && cardHeight > 0) {
          // 根据真实尺寸重新计算位置
          const newPosition = this.calculatePosition(x, y, cardWidth, cardHeight);

          // 应用新位置
          shadowHost.style.left = `${newPosition.left}px`;
          shadowHost.style.top = `${newPosition.top}px`;

          // 设置为可见
          shadowHost.style.visibility = 'visible';

          // 设置 ResizeObserver 监听后续的尺寸变化（例如流式内容增加）
          this.setupResizeObserver(shadowHost);
        } else {
          // 如果卡片为空，延迟再试
          setTimeout(() => {
            const newRect = shadowHost.getBoundingClientRect();
            if (newRect.width > 0 && newRect.height > 0) {
              const finalPosition = this.calculatePosition(x, y, newRect.width, newRect.height);
              shadowHost.style.left = `${finalPosition.left}px`;
              shadowHost.style.top = `${finalPosition.top}px`;
              shadowHost.style.visibility = 'visible';
              this.setupResizeObserver(shadowHost);
            } else {
              // 最终兜底：直接显示
              shadowHost.style.visibility = 'visible';
              this.setupResizeObserver(shadowHost);
            }
          }, 200);
        }
      });
    });

    // 设置点击外部关闭弹窗
    this.setupClickOutsideHandler(shadowHost);
  }

  /**
   * 创建 Shadow Host 元素
   */
  private createShadowHost(): HTMLDivElement {
    const shadowHost = document.createElement('div');
    shadowHost.id = WORD_CARD_HOST;
    shadowHost.style.cssText = `
			position: absolute;
			z-index:999998;
			pointer-events: none;
		`;
    return shadowHost;
  }

  /**
   * 计算弹窗位置（使用真实的卡片尺寸）
   */
  private calculatePosition(
    x: number,
    y: number,
    cardWidth?: number,
    cardHeight?: number,
  ): { left: number; top: number } {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    // 使用真实的卡片尺寸，如果没有提供则使用默认值
    const width = cardWidth || WordCardManager.CARD_WIDTH;
    const height = cardHeight || WordCardManager.CARD_HEIGHT;

    // 计算视窗坐标（相对于视窗的位置）
    const viewportX = x - scrollX;
    const viewportY = y - scrollY;

    // 垂直方向：优先在点击位置下方显示
    let top: number;
    const spaceBelow = viewportHeight - viewportY;
    const spaceAbove = viewportY;

    if (spaceBelow >= height + WordCardManager.OFFSET) {
      // 下方空间充足，在下方显示
      top = y + WordCardManager.OFFSET;
    } else if (spaceAbove >= height + WordCardManager.OFFSET) {
      // 下方空间不足但上方空间充足，在上方显示
      top = y - height - WordCardManager.OFFSET;
    } else {
      // 上下空间都不足，贴近视窗底部显示
      top = scrollY + viewportHeight - height - WordCardManager.MARGIN;
      // 确保不会超出视窗顶部
      top = Math.max(scrollY + WordCardManager.MARGIN, top);
    }

    // 水平方向：优先在点击位置右侧显示
    let left: number;
    const spaceRight = viewportWidth - viewportX;
    const spaceLeft = viewportX;

    if (spaceRight >= width + WordCardManager.OFFSET) {
      // 右侧空间充足
      left = x + WordCardManager.OFFSET;
    } else if (spaceLeft >= width + WordCardManager.OFFSET) {
      // 右侧空间不足但左侧空间充足
      left = x - width - WordCardManager.OFFSET;
    } else {
      // 左右空间都不足，居中显示
      left = scrollX + (viewportWidth - width) / 2;
      // 确保不会超出边界
      left = Math.max(scrollX + WordCardManager.MARGIN, left);
      left = Math.min(scrollX + viewportWidth - width - WordCardManager.MARGIN, left);
    }

    return { left, top };
  }

  /**
   * 根据卡片真实尺寸重新调整位置
   */
  private adjustCardPosition(shadowHost: HTMLElement): void {
    if (!this.clickPosition) return;

    // 获取卡片的真实尺寸
    const rect = shadowHost.getBoundingClientRect();
    const cardWidth = rect.width;
    const cardHeight = rect.height;

    // 重新计算位置
    const newPosition = this.calculatePosition(
      this.clickPosition.x,
      this.clickPosition.y,
      cardWidth,
      cardHeight,
    );

    // 应用新位置
    shadowHost.style.left = `${newPosition.left}px`;
    shadowHost.style.top = `${newPosition.top}px`;
  }

  /**
   * 设置 ResizeObserver 监听卡片尺寸变化
   */
  private setupResizeObserver(shadowHost: HTMLElement): void {
    // 清理旧的 observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    // 创建新的 ResizeObserver
    this.resizeObserver = new ResizeObserver(() => {
      this.adjustCardPosition(shadowHost);
    });

    // 开始监听
    this.resizeObserver.observe(shadowHost);
  }

  /**
   * 发送显示卡片事件
   */
  private dispatchShowCardEvent(
    word: string,
    lemmas: string[],
    familyRoot: string | undefined,
    details: WordDetails,
    shadowRoot: ShadowRoot,
    position: { left: number; top: number },
    context?: string,
    status?: WordFamiliarityStatus | 'ignored',
    familiarityLevel?: number,
  ): void {
    const showCardEvent = new CustomEvent('lang-helper-show-card', {
      detail: {
        word,
        lemmas,
        familyRoot,
        details,
        shadowRoot,
        position,
        context,
        status,
        familiarityLevel,
      },
    });

    // 延迟发送事件，确保 React 应用已经加载
    setTimeout(() => {
      document.dispatchEvent(showCardEvent);
    }, 100);
  }

  /**
   * 设置点击外部关闭处理器
   */
  private setupClickOutsideHandler(shadowHost: HTMLElement): void {
    const closeHandler = (e: MouseEvent) => {
      if (!shadowHost.contains(e.target as Node)) {
        this.removeExistingWordCard();
        document.removeEventListener('click', closeHandler);
        this.currentCloseHandler = null;
      }
    };

    // 清理之前的处理器
    if (this.currentCloseHandler) {
      document.removeEventListener('click', this.currentCloseHandler);
    }

    this.currentCloseHandler = closeHandler;

    setTimeout(() => {
      document.addEventListener('click', closeHandler);
    }, 100);
  }

  /**
   * 移除现有的单词卡片
   */
  removeExistingWordCard(): void {
    const existingHost = document.getElementById(WORD_CARD_HOST);
    if (existingHost) {
      existingHost.remove();
    }

    // 清理 ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // 清理点击位置记录
    this.clickPosition = null;

    // 清理事件监听器
    if (this.currentCloseHandler) {
      document.removeEventListener('click', this.currentCloseHandler);
      this.currentCloseHandler = null;
    }
  }

  /**
   * 显示翻译卡片（两阶段渲染：先隐藏渲染、测量尺寸、再定位显示）
   */
  showTranslationCard(
    paragraph: string,
    sentence: string,
    translation: string | undefined,
    sentenceAnalysis: string | undefined,
    x: number,
    y: number,
    isStreaming: boolean = false,
  ): void {
    // 移除 loading 指示器
    this.removeLoadingIndicator();

    // 移除现有的弹窗
    this.removeExistingWordCard();

    // 保存点击位置，供后续重新计算使用
    this.clickPosition = { x, y };

    // 创建 Shadow Host
    const shadowHost = this.createShadowHost();

    // 第一阶段：设置为不可见，先渲染到 DOM
    shadowHost.style.visibility = 'hidden';
    shadowHost.style.left = `${x}px`;
    shadowHost.style.top = `${y}px`;

    // 创建 Shadow DOM
    const shadowRoot = shadowHost.attachShadow({ mode: 'open' });

    // 创建 React 应用挂载点
    const reactRoot = document.createElement('div');
    reactRoot.id = 'word-card-react-root';
    shadowRoot.appendChild(reactRoot);

    // 将 Shadow Host 添加到页面（不可见）
    document.body.appendChild(shadowHost);

    // 通过自定义事件传递翻译数据给 React 应用
    const position = this.calculatePosition(x, y);
    this.dispatchShowTranslationEvent(
      paragraph,
      sentence,
      translation,
      sentenceAnalysis,
      shadowRoot,
      position,
      isStreaming,
    );

    // 第二阶段：等待 React 渲染完成后，测量尺寸并重新定位
    // 使用 requestAnimationFrame 确保浏览器完成渲染
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // 获取卡片的真实尺寸
        const rect = shadowHost.getBoundingClientRect();
        const cardWidth = rect.width;
        const cardHeight = rect.height;

        // 只有当卡片有内容时才重新定位（避免空卡片）
        if (cardWidth > 0 && cardHeight > 0) {
          // 根据真实尺寸重新计算位置
          const newPosition = this.calculatePosition(x, y, cardWidth, cardHeight);

          // 应用新位置
          shadowHost.style.left = `${newPosition.left}px`;
          shadowHost.style.top = `${newPosition.top}px`;

          // 设置为可见
          shadowHost.style.visibility = 'visible';

          // 设置 ResizeObserver 监听后续的尺寸变化（例如流式内容增加）
          this.setupResizeObserver(shadowHost);
        } else {
          // 如果卡片为空，延迟再试
          setTimeout(() => {
            const newRect = shadowHost.getBoundingClientRect();
            if (newRect.width > 0 && newRect.height > 0) {
              const finalPosition = this.calculatePosition(x, y, newRect.width, newRect.height);
              shadowHost.style.left = `${finalPosition.left}px`;
              shadowHost.style.top = `${finalPosition.top}px`;
              shadowHost.style.visibility = 'visible';
              this.setupResizeObserver(shadowHost);
            } else {
              // 最终兜底：直接显示
              shadowHost.style.visibility = 'visible';
              this.setupResizeObserver(shadowHost);
            }
          }, 200);
        }
      });
    });

    // 设置点击外部关闭弹窗
    this.setupClickOutsideHandler(shadowHost);
  }

  /**
   * 发送显示翻译卡片事件
   */
  private dispatchShowTranslationEvent(
    paragraph: string,
    sentence: string,
    translation: string | undefined,
    sentenceAnalysis: string | undefined,
    shadowRoot: ShadowRoot,
    position: { left: number; top: number },
    isStreaming: boolean = false,
  ): void {
    const showTranslationEvent = new CustomEvent('lang-helper-show-translation', {
      detail: {
        paragraph,
        sentence,
        translation,
        sentenceAnalysis,
        shadowRoot,
        position,
        isStreaming,
      },
    });

    // 延迟发送事件，确保 React 应用已经加载
    setTimeout(() => {
      document.dispatchEvent(showTranslationEvent);
    }, 100);
  }

  /**
   * 销毁管理器
   */
  destroy(): void {
    this.removeExistingWordCard();
    this.removeLoadingIndicator();

    // 确保 ResizeObserver 被清理
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }
}
