import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import {
  createShadowRootUi,
  type ShadowRootContentScriptUi,
} from 'wxt/utils/content-script-ui/shadow-root';
import type { WordDetails, WordFamiliarityStatus } from 'shared-types';

import WordCard from '@/content-ui/WordCard';
import TranslationCard from '@/content-ui/TranslationCard';
import ToastNotification from '@/content-ui/ToastNotification';
import { ShadowDomProvider } from '@/lib/shadow-dom-context';
import { ErrorBoundary } from '@/lib/ErrorBoundary';
import { UISettingsManager } from '@/content-ui/utils/uiSettingsManager';
import { Logger } from '../../utils/logger';

const logger = new Logger('WordCardManager');

const WORD_CARD_HOST_TAG = 'linguo-word-card';
const TRANSLATION_CARD_HOST_TAG = 'linguo-translation-card';
const TOAST_HOST_TAG = 'linguo-toast';

type Anchored = ShadowRootContentScriptUi<Root>;

/**
 * 单词卡 / 翻译卡 / Toast 的 Shadow DOM UI 管理器。
 * 通过 WXT 的 `createShadowRootUi` 接管 ShadowRoot 创建与 Tailwind 样式注入。
 */
export class WordCardManager {
  private static readonly CARD_WIDTH = 320;
  private static readonly CARD_HEIGHT = 200;
  private static readonly MARGIN = 16;
  private static readonly OFFSET = 8;

  private readonly ctx: ContentScriptContext;
  private currentUi: Anchored | null = null;
  private currentCloseHandler: ((e: MouseEvent) => void) | null = null;
  private loadingIndicator: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private clickPosition: { x: number; y: number } | null = null;

  constructor(ctx: ContentScriptContext) {
    this.ctx = ctx;
  }

  /** 显示 loading 指示器（在 light DOM，使用 inline style） */
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

  removeLoadingIndicator(): void {
    if (this.loadingIndicator) {
      this.loadingIndicator.remove();
      this.loadingIndicator = null;
    }
  }

  async showWordCard(
    word: string,
    lemmas: string[],
    familyRoot: string | undefined,
    details: WordDetails,
    x: number,
    y: number,
    context?: string,
    status?: WordFamiliarityStatus | 'ignored',
    familiarityLevel?: number,
  ): Promise<void> {
    this.removeLoadingIndicator();
    this.removeExistingWordCard();

    this.clickPosition = { x, y };
    const aiMode = UISettingsManager.getInstance().getAiMode();

    const ui = await createShadowRootUi<Root>(this.ctx, {
      name: WORD_CARD_HOST_TAG,
      position: 'inline',
      anchor: 'body',
      onMount: (container, shadow) => {
        const root = createRoot(container);
        root.render(
          <React.StrictMode>
            <ErrorBoundary scope="ContentUI:WordCard">
              <ShadowDomProvider shadowRoot={shadow}>
                <WordCard
                  word={word}
                  lemmas={lemmas}
                  familyRoot={familyRoot}
                  details={details}
                  context={context}
                  status={status}
                  familiarityLevel={familiarityLevel}
                  aiMode={aiMode}
                />
              </ShadowDomProvider>
            </ErrorBoundary>
          </React.StrictMode>,
        );
        return root;
      },
      onRemove: (root) => root?.unmount(),
    });

    this.applyHostStyles(ui.shadowHost, x, y);
    ui.mount();
    this.currentUi = ui;

    this.scheduleRepositionAndShow(ui.shadowHost, x, y);
    this.setupClickOutsideHandler(ui.shadowHost);
  }

  async showTranslationCard(
    paragraph: string,
    sentence: string,
    translation: string | undefined,
    sentenceAnalysis: string | undefined,
    x: number,
    y: number,
    isStreaming: boolean = false,
  ): Promise<void> {
    this.removeLoadingIndicator();
    this.removeExistingWordCard();

    this.clickPosition = { x, y };

    const ui = await createShadowRootUi<Root>(this.ctx, {
      name: TRANSLATION_CARD_HOST_TAG,
      position: 'inline',
      anchor: 'body',
      onMount: (container, shadow) => {
        const root = createRoot(container);
        root.render(
          <React.StrictMode>
            <ErrorBoundary scope="ContentUI:TranslationCard">
              <ShadowDomProvider shadowRoot={shadow}>
                <TranslationCard
                  paragraph={paragraph}
                  sentence={sentence}
                  translation={translation}
                  sentenceAnalysis={sentenceAnalysis}
                  isStreaming={isStreaming}
                />
              </ShadowDomProvider>
            </ErrorBoundary>
          </React.StrictMode>,
        );
        return root;
      },
      onRemove: (root) => root?.unmount(),
    });

    this.applyHostStyles(ui.shadowHost, x, y);
    ui.mount();
    this.currentUi = ui;

    this.scheduleRepositionAndShow(ui.shadowHost, x, y);
    this.setupClickOutsideHandler(ui.shadowHost);
  }

  async showToast(
    message: string,
    words: string[],
    type: 'success' | 'info' = 'success',
  ): Promise<void> {
    const toastUi = await createShadowRootUi<Root>(this.ctx, {
      name: TOAST_HOST_TAG,
      position: 'inline',
      anchor: 'body',
      onMount: (container, shadow) => {
        const root = createRoot(container);
        root.render(
          <React.StrictMode>
            <ErrorBoundary scope="ContentUI:Toast">
              <ShadowDomProvider shadowRoot={shadow}>
                <ToastNotification
                  message={message}
                  words={words}
                  type={type}
                  onClose={() => {
                    toastUi?.remove();
                  }}
                />
              </ShadowDomProvider>
            </ErrorBoundary>
          </React.StrictMode>,
        );
        return root;
      },
      onRemove: (root) => root?.unmount(),
    });

    // 同样要带 !important，否则会被 WXT 默认的 :host{all:initial!important} 重置成 static
    toastUi.shadowHost.style.setProperty('position', 'fixed', 'important');
    toastUi.shadowHost.style.setProperty('top', '0', 'important');
    toastUi.shadowHost.style.setProperty('right', '0', 'important');
    toastUi.shadowHost.style.setProperty('z-index', '49', 'important');
    toastUi.shadowHost.style.setProperty('pointer-events', 'none', 'important');

    toastUi.mount();
  }

  private applyHostStyles(host: HTMLElement, x: number, y: number): void {
    // 必须用 !important——WXT 默认在 shadow root 里注入 `:host { all: initial !important }`
    // 重置规则，普通 inline style 会被它压掉，导致 position 退回 static、host 错位到文档底部。
    host.style.setProperty('position', 'absolute', 'important');
    host.style.setProperty('visibility', 'hidden', 'important');
    host.style.setProperty('left', `${x}px`, 'important');
    host.style.setProperty('top', `${y}px`, 'important');
    host.style.setProperty('z-index', '999998', 'important');
    host.style.setProperty('pointer-events', 'auto', 'important');
  }

  private scheduleRepositionAndShow(host: HTMLElement, x: number, y: number): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const rect = host.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const pos = this.calculatePosition(x, y, rect.width, rect.height);
          host.style.setProperty('left', `${pos.left}px`, 'important');
          host.style.setProperty('top', `${pos.top}px`, 'important');
          host.style.setProperty('visibility', 'visible', 'important');
          this.setupResizeObserver(host);
          return;
        }

        setTimeout(() => {
          const newRect = host.getBoundingClientRect();
          if (newRect.width > 0 && newRect.height > 0) {
            const finalPos = this.calculatePosition(x, y, newRect.width, newRect.height);
            host.style.setProperty('left', `${finalPos.left}px`, 'important');
            host.style.setProperty('top', `${finalPos.top}px`, 'important');
          }
          host.style.setProperty('visibility', 'visible', 'important');
          this.setupResizeObserver(host);
        }, 200);
      });
    });
  }

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

    const width = cardWidth || WordCardManager.CARD_WIDTH;
    const height = cardHeight || WordCardManager.CARD_HEIGHT;

    const viewportX = x - scrollX;
    const viewportY = y - scrollY;

    let top: number;
    const spaceBelow = viewportHeight - viewportY;
    const spaceAbove = viewportY;

    if (spaceBelow >= height + WordCardManager.OFFSET) {
      top = y + WordCardManager.OFFSET;
    } else if (spaceAbove >= height + WordCardManager.OFFSET) {
      top = y - height - WordCardManager.OFFSET;
    } else {
      top = scrollY + viewportHeight - height - WordCardManager.MARGIN;
      top = Math.max(scrollY + WordCardManager.MARGIN, top);
    }

    let left: number;
    const spaceRight = viewportWidth - viewportX;
    const spaceLeft = viewportX;

    if (spaceRight >= width + WordCardManager.OFFSET) {
      left = x + WordCardManager.OFFSET;
    } else if (spaceLeft >= width + WordCardManager.OFFSET) {
      left = x - width - WordCardManager.OFFSET;
    } else {
      left = scrollX + (viewportWidth - width) / 2;
      left = Math.max(scrollX + WordCardManager.MARGIN, left);
      left = Math.min(scrollX + viewportWidth - width - WordCardManager.MARGIN, left);
    }

    return { left, top };
  }

  private setupResizeObserver(host: HTMLElement): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.clickPosition) return;
      const rect = host.getBoundingClientRect();
      const pos = this.calculatePosition(
        this.clickPosition.x,
        this.clickPosition.y,
        rect.width,
        rect.height,
      );
      host.style.setProperty('left', `${pos.left}px`, 'important');
      host.style.setProperty('top', `${pos.top}px`, 'important');
    });

    this.resizeObserver.observe(host);
  }

  private setupClickOutsideHandler(host: HTMLElement): void {
    const closeHandler = (e: MouseEvent) => {
      if (!host.contains(e.target as Node)) {
        this.removeExistingWordCard();
        document.removeEventListener('click', closeHandler);
        this.currentCloseHandler = null;
      }
    };

    if (this.currentCloseHandler) {
      document.removeEventListener('click', this.currentCloseHandler);
    }
    this.currentCloseHandler = closeHandler;

    setTimeout(() => {
      document.addEventListener('click', closeHandler);
    }, 100);
  }

  removeExistingWordCard(): void {
    if (this.currentUi) {
      try {
        this.currentUi.remove();
      } catch (err) {
        logger.warn('Failed to remove current UI', err as Error);
      }
      this.currentUi = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.clickPosition = null;

    if (this.currentCloseHandler) {
      document.removeEventListener('click', this.currentCloseHandler);
      this.currentCloseHandler = null;
    }
  }

  destroy(): void {
    this.removeExistingWordCard();
    this.removeLoadingIndicator();
  }
}
