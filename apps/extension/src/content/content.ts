import type { ChromeMessage, ChromeMessageResponse } from 'shared-types';
import { TextProcessor } from './utils/textProcessor';
import { HighlightManager } from './utils/highlightManager';
import { EventHandlers } from './utils/eventHandlers';
import { DebugUtils } from './utils/debugUtils';
import { DictionaryLoader } from './utils/dictionaryLoader';
import { SettingsManager } from './utils/settingsManager';
import { debounce } from './utils/helpers';
import { HighlightAPIChecker, PageInfo } from './utils/helpers';
import { Logger } from '../utils/logger';

const logger = new Logger('ContentScript');

logger.info('Content script loaded', { version: 'v5' });

// 检查浏览器是否支持 CSS Custom Highlight API
HighlightAPIChecker.logSupport();

// 核心管理器实例
let highlightManager: HighlightManager;
let debugUtils: DebugUtils;
let dictionaryLoader: DictionaryLoader;
let settingsManager: SettingsManager;

/**
 * 应用自定义颜色设置
 */
function applyCustomColors(): void {
  // 移除旧的样式
  const existingStyle = document.getElementById('lang-helper-custom-colors');
  if (existingStyle) {
    existingStyle.remove();
  }

  const highlightSettings = settingsManager.getHighlightSettings();

  // 创建新的样式
  const style = document.createElement('style');
  style.id = 'lang-helper-custom-colors';
  style.textContent = `
		.lang-helper-highlight-unknown {
			background-color: ${highlightSettings.unknown} !important;
		}
		.lang-helper-highlight-learning {
			background-color: ${highlightSettings.learning} !important;
			border-bottom: 2px solid #3b82f6 !important;
		}
		.lang-helper-highlight-known {
			background-color: ${highlightSettings.known} !important;
		}
	`;

  document.head.appendChild(style);
  logger.debug('Custom colors applied');
}

// 初始化所有管理器
async function initializeManagers(): Promise<void> {
  highlightManager = new HighlightManager();
  // 初始化事件处理器
  new EventHandlers(highlightManager);
  debugUtils = new DebugUtils(highlightManager);

  // 初始化词典加载器
  dictionaryLoader = DictionaryLoader.getInstance();
  await dictionaryLoader.initialize();
  logger.info('Dictionary loader initialized');
}

/**
 * 主要的扫描和高亮函数（全量扫描）
 */
function scanAndHighlight(): void {
  // 检查高亮功能是否启用
  if (!settingsManager.isHighlightEnabled()) {
    logger.info('Highlight is disabled, skipping scan');
    return;
  }

  logger.info('Starting page scan and highlight');
  const startTime = performance.now();

  // 检查是否可以开始处理
  if (!debugUtils.startProcessing()) {
    return;
  }

  try {
    // 提取文本节点和收集单词
    logger.debug('Extracting text nodes');
    const textNodes = TextProcessor.extractTextNodes(document.body);
    logger.debug('Found text nodes', { count: textNodes.length });

    logger.debug('Collecting and lemmatizing words');
    const { lemmasToQuery, wordToLemmaMap } = TextProcessor.collectWordsFromNodes(
      textNodes,
      dictionaryLoader,
    );
    logger.debug('Word to lemma mapping collected', {
      mapSize: wordToLemmaMap.size,
    });

    if (lemmasToQuery.length === 0) {
      logger.warn('No valid lemmas found for querying');
      debugUtils.endProcessing();
      return;
    }

    logger.info('Valid lemmas found', { count: lemmasToQuery.length });
    logger.debug('First 10 lemmas', { lemmas: lemmasToQuery.slice(0, 10) });

    // 发送给背景脚本查询状态
    queryWordStatus(lemmasToQuery, wordToLemmaMap, textNodes, startTime);
  } catch (error) {
    logger.error('scanAndHighlight execution failed', error as Error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    debugUtils.emergencyStop(`执行异常: ${errorMessage}`);
  }
}

/**
 * 增量扫描和高亮函数（只处理新增的节点）
 * @param elements - 需要扫描的 HTML 元素数组
 */
function scanAndHighlightNodes(elements: HTMLElement[]): void {
  // 检查高亮功能是否启用
  if (!settingsManager.isHighlightEnabled()) {
    logger.debug('Highlight is disabled, skipping incremental scan');
    return;
  }

  logger.info('Starting incremental scan and highlight', {
    elementCount: elements.length,
  });
  const startTime = performance.now();

  // 检查是否可以开始处理
  if (!debugUtils.startProcessing()) {
    logger.debug('startProcessing failed');
    return;
  }

  try {
    // 从新增的元素中提取文本节点
    logger.debug('Extracting text nodes from new elements');
    const textNodes: Text[] = [];

    elements.forEach((element) => {
      const nodes = TextProcessor.extractTextNodes(element);
      textNodes.push(...nodes);
    });

    logger.debug('Found text nodes in new elements', {
      count: textNodes.length,
    });

    if (textNodes.length === 0) {
      logger.debug('No text nodes found in new elements');
      debugUtils.endProcessing();
      return;
    }

    logger.debug('Collecting and lemmatizing words from new nodes');
    const { lemmasToQuery, wordToLemmaMap } = TextProcessor.collectWordsFromNodes(
      textNodes,
      dictionaryLoader,
    );
    logger.debug('Word to lemma mapping collected', {
      mapSize: wordToLemmaMap.size,
    });

    if (lemmasToQuery.length === 0) {
      logger.debug('No valid lemmas found in new nodes');
      debugUtils.endProcessing();
      return;
    }

    logger.info('Valid lemmas found in new nodes', {
      count: lemmasToQuery.length,
    });
    logger.debug('First 10 lemmas', { lemmas: lemmasToQuery.slice(0, 10) });

    // 发送给背景脚本查询状态 - 增量模式，不清除旧高亮
    queryWordStatus(lemmasToQuery, wordToLemmaMap, textNodes, startTime, true);
  } catch (error) {
    logger.error('scanAndHighlightNodes execution failed', error as Error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    debugUtils.emergencyStop(`执行异常: ${errorMessage}`);
  }
}

/**
 * 查询单词状态
 * @param isIncremental - 是否为增量扫描模式（不清除旧高亮）
 */
function queryWordStatus(
  lemmas: string[],
  wordToLemmaMap: Map<string, string[]>,
  textNodes: Text[],
  startTime: number,
  isIncremental: boolean = false,
): void {
  logger.debug('Sending lemmas to background script', {
    lemmaCount: lemmas.length,
    mode: isIncremental ? 'incremental' : 'full',
  });
  const message: ChromeMessage = { type: 'QUERY_WORDS_STATUS', words: lemmas };

  chrome.runtime.sendMessage(message, (response: ChromeMessageResponse) => {
    try {
      if (chrome.runtime.lastError) {
        logger.error('Chrome runtime error', new Error(chrome.runtime.lastError.message));
        debugUtils.endProcessing();
        return;
      }

      if (response && response.success && response.data) {
        const lemmaDataMap = response.data as Record<
          string,
          { status: string; familyRoot: string; familiarityLevel: number }
        >;
        logger.info('Received word status from background', {
          lemmaCount: Object.keys(lemmaDataMap).length,
          mode: isIncremental ? 'incremental' : 'full',
        });

        // 显示状态分布
        logStatusDistribution(lemmaDataMap);

        // 执行高亮，把所有需要的数据都传进去
        logger.debug('Starting highlight creation');
        // 增量模式不清除旧高亮 (clearPrevious = !isIncremental)
        const stats = highlightManager.highlightNodes(
          textNodes,
          lemmaDataMap,
          wordToLemmaMap,
          !isIncremental,
        );

        const endTime = performance.now();
        const totalDuration = endTime - startTime;
        logger.info('scanAndHighlight completed', {
          duration: `${totalDuration.toFixed(2)}ms`,
          stats,
        });
      } else {
        logger.error('Failed to get word status', new Error(response?.error || 'Unknown error'));
      }
    } catch (error) {
      logger.error('Error processing response', error as Error);
    } finally {
      debugUtils.endProcessing();
    }
  });
}

/**
 * 记录状态分布
 */
function logStatusDistribution(
  statusData: Record<string, { status: string; familyRoot: string }>,
): void {
  const statusCounts = Object.values(statusData).reduce(
    (acc, data) => {
      acc[data.status] = (acc[data.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  logger.debug('Word status distribution', statusCounts);
}

/**
 * 检测是否为字幕元素（YouTube、Netflix 等视频网站）
 */
function isSubtitleElement(element: HTMLElement): boolean {
  // YouTube 字幕 - 检查元素自身
  if (
    element.classList.contains('ytp-caption-segment') ||
    element.classList.contains('captions-text') ||
    element.classList.contains('caption-visual-line') ||
    element.classList.contains('caption-window')
  ) {
    return true;
  }

  // YouTube 字幕 - 检查父元素
  if (
    element.closest('.caption-window') ||
    element.closest('.captions-text') ||
    element.closest('.ytp-caption-window-container')
  ) {
    return true;
  }

  // Netflix 字幕
  if (
    element.classList.contains('player-timedtext') ||
    element.closest('.player-timedtext-text-container')
  ) {
    return true;
  }

  // 通用字幕检测：包含 caption, subtitle 等关键词
  const classNames = element.className.toString().toLowerCase();
  if (
    classNames.includes('caption') ||
    classNames.includes('subtitle') ||
    classNames.includes('sub-title')
  ) {
    return true;
  }

  return false;
}

/**
 * 获取字幕容器元素（用于高亮）
 */
function getSubtitleContainer(element: HTMLElement): HTMLElement | null {
  // 查找最合适的字幕容器
  // 优先级：caption-window > captions-text > ytp-caption-segment
  const captionWindow = element.closest('.caption-window') as HTMLElement;
  if (captionWindow) {
    return captionWindow;
  }

  const captionsText = element.closest('.captions-text') as HTMLElement;
  if (captionsText) {
    return captionsText;
  }

  // 如果元素本身就是字幕段，返回自身
  if (element.classList.contains('ytp-caption-segment')) {
    return element;
  }

  return null;
}

/**
 * DOM 变化监听器（增量更新优化版，针对字幕优化）
 */
function setupDOMObserver(): void {
  // 为字幕创建单独的、更快速的处理机制
  let subtitleTimer: number | undefined;
  const subtitleElements = new Set<HTMLElement>();

  // 字幕快速处理函数（100ms debounce）
  const processSubtitles = () => {
    if (subtitleElements.size > 0) {
      const elementsArray = Array.from(subtitleElements);
      subtitleElements.clear();
      logger.debug('Subtitle changes detected, fast scanning', {
        elementCount: elementsArray.length,
      });
      scanAndHighlightNodes(elementsArray);
      logger.debug('processSubtitles', elementsArray);
    }
  };

  // 常规内容处理（通过 debounce）
  const processRegularContent = debounce((needsFullScan: boolean, elements: HTMLElement[]) => {
    if (needsFullScan) {
      logger.debug('Character data change detected, full rescan required');
      scanAndHighlight();
    } else if (elements.length > 0) {
      logger.debug('Incremental changes detected, scanning new nodes only', {
        elementCount: elements.length,
      });
      scanAndHighlightNodes(elements);
    }
  }, 500);

  const observer = new MutationObserver((mutations: MutationRecord[]) => {
    // 如果正在处理中，忽略所有变化
    const processingState = debugUtils.getProcessingState();
    if (processingState.isProcessing) return;

    // 标志：是否需要全量扫描
    let needsFullScan = false;
    // 收集所有新增的元素节点
    const addedElements: HTMLElement[] = [];
    // 标志：是否有字幕变化
    let hasSubtitleChange = false;

    mutations.forEach((mutation) => {
      // 文本内容变化
      if (mutation.type === 'characterData') {
        // 检查是否是字幕元素的文本变化
        const parentElement = mutation.target.parentElement;
        if (parentElement && isSubtitleElement(parentElement)) {
          hasSubtitleChange = true;
          const container = getSubtitleContainer(parentElement);
          if (container) {
            subtitleElements.add(container);
            logger.debug('Detected characterData change in subtitle', {
              elementClass: container.className,
            });
          }
        } else {
          needsFullScan = true;
        }
        return;
      }

      // 处理新增和移除的节点（字幕通常是替换）
      if (mutation.type === 'childList') {
        const target = mutation.target as HTMLElement;

        // 特殊处理：YouTube 字幕容器（ytp-caption-window-container）
        // YouTube 字幕更新机制：先移除旧 caption-window，再添加新 caption-window
        if (
          target &&
          (target.id === 'ytp-caption-window-container' ||
            target.classList.contains('ytp-caption-window-container'))
        ) {
          // 检查新增的节点中是否有 caption-window
          if (mutation.addedNodes.length > 0) {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const element = node as HTMLElement;
                // 检查是否是 caption-window
                if (
                  element.classList.contains('caption-window') ||
                  element.id?.startsWith('caption-window')
                ) {
                  hasSubtitleChange = true;
                  subtitleElements.add(element);
                  logger.debug('Detected YouTube caption-window replacement', {
                    elementId: element.id,
                    elementClass: element.className,
                    textPreview: element.textContent?.substring(0, 50),
                  });
                }
              }
            });
          }
          return;
        }

        // 检查变化是否发生在字幕容器内
        const isInSubtitleContainer = target && isSubtitleElement(target);

        if (isInSubtitleContainer) {
          // 字幕容器内的变化，直接标记为字幕变化
          hasSubtitleChange = true;
          const container = getSubtitleContainer(target);
          if (container) {
            subtitleElements.add(container);
            logger.debug('Detected childList change in subtitle container', {
              targetClass: target.className,
              containerClass: container.className,
              addedNodes: mutation.addedNodes.length,
              removedNodes: mutation.removedNodes.length,
            });
          }
          return;
        }

        // 处理新增的节点
        if (mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach((node) => {
            // 跳过我们自己的 UI 元素
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as HTMLElement;
              const isOurElement =
                (element.id && element.id.includes('lang-helper')) ||
                (element.className &&
                  typeof element.className === 'string' &&
                  element.className.includes('lang-helper'));

              if (!isOurElement) {
                // 检查是否有文本内容
                if (element.textContent?.trim()) {
                  // 检查是否是字幕元素
                  if (isSubtitleElement(element)) {
                    hasSubtitleChange = true;
                    const container = getSubtitleContainer(element);
                    if (container) {
                      subtitleElements.add(container);
                      logger.debug('Detected new subtitle element', {
                        elementClass: element.className,
                        containerClass: container.className,
                      });
                    }
                  } else {
                    addedElements.push(element);
                  }
                }
              }
            }
          });
        }
      }
    });

    // 字幕变化 - 使用更短的 debounce 时间（100ms）以获得更快的响应
    if (hasSubtitleChange) {
      if (subtitleTimer) {
        clearTimeout(subtitleTimer);
      }
      subtitleTimer = window.setTimeout(processSubtitles, 100);
    }

    // 常规内容变化 - 使用标准 debounce（500ms）
    if (needsFullScan || addedElements.length > 0) {
      processRegularContent(needsFullScan, addedElements);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

/**
 * 监听设置变化
 */
function setupSettingsListener(): void {
  // 使用 SettingsManager 的统一监听器
  settingsManager.onSettingsChange((changedSettings) => {
    // 监听全局开关变化
    if (changedSettings.extensionEnabled !== undefined) {
      logger.debug('Extension enabled setting updated', {
        enabled: changedSettings.extensionEnabled,
      });
      if (changedSettings.extensionEnabled) {
        // 如果启用插件，重新加载页面以完全重新初始化
        logger.info('Extension enabled, reloading page...');
        window.location.reload();
      } else {
        // 如果禁用插件，清除所有高亮（如果管理器已初始化）
        logger.info('Extension disabled, cleaning up...');
        if (highlightManager) {
          highlightManager.clearAllHighlights();
        }
      }
      return;
    }

    // 监听高亮开关变化
    if (changedSettings.highlightEnabled !== undefined) {
      logger.debug('Highlight enabled setting updated', {
        enabled: changedSettings.highlightEnabled,
      });
      if (changedSettings.highlightEnabled) {
        // 如果启用高亮，重新加载页面
        window.location.reload();
      } else {
        // 如果禁用高亮，清除所有高亮（如果管理器已初始化）
        if (highlightManager) {
          highlightManager.clearAllHighlights();
        }
      }
      return;
    }

    // 监听颜色设置变化
    if (changedSettings.highlightSettings) {
      logger.debug('Highlight colors updated');
      // 只有在核心功能已初始化时才应用颜色
      if (highlightManager) {
        applyCustomColors();
      }
    }

    // 监听网站设置变化
    if (changedSettings.siteSettings) {
      logger.debug('Site settings updated');
      // 只有在核心功能已初始化时才处理网站设置变化
      if (highlightManager) {
        if (settingsManager.isCurrentSiteDisabled()) {
          // 如果网站被禁用，清除所有高亮
          highlightManager.clearAllHighlights();
        } else {
          // 如果网站被启用，重新扫描
          setTimeout(() => scanAndHighlight(), 100);
        }
      }
    }
  });

  // 监听忽略列表变化（不在 SettingsManager 中）
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.ignoredWords) {
      logger.debug('Ignored words list updated, reloading');
      // 只有在核心功能已初始化时才处理忽略列表变化
      if (dictionaryLoader) {
        dictionaryLoader.loadIgnoredWordsFromStorage().then(() => {
          // 重新扫描页面以应用新的忽略列表
          setTimeout(() => scanAndHighlight(), 100);
        });
      }
    }
  });
}

/**
 * 显示 Toast 通知
 */
function showToast(message: string, words: string[], type: 'success' | 'info' = 'success'): void {
  const toastEvent = new CustomEvent('lang-helper-show-toast', {
    detail: { message, words, type },
  });
  document.dispatchEvent(toastEvent);
}

/**
 * 处理批量操作
 * @param operation - 操作类型：'ignore' 或 'known'
 */
function handleBatchOperation(operation: 'ignore' | 'known'): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    logger.warn('批量操作失败：未找到选区。');
    showToast('批量操作失败：未找到选区', [], 'info');
    return;
  }

  const selectionRange = selection.getRangeAt(0);
  if (selectionRange.collapsed) {
    logger.warn('批量操作失败：选区为空。');
    showToast('批量操作失败：选区为空', [], 'info');
    return;
  }

  // 从 HighlightManager 获取在选区内的高亮单词
  const allWordsInRange = highlightManager.getHighlightsInRange(selectionRange);

  // 根据操作类型过滤单词
  let wordsToProcess = allWordsInRange;
  if (operation === 'ignore') {
    // 批量忽略：只处理 unknown 和 learning 状态的单词，不处理已掌握的单词
    wordsToProcess = allWordsInRange.filter(
      (item) => item.status === 'unknown' || item.status === 'learning',
    );

    if (wordsToProcess.length < allWordsInRange.length) {
      const skippedCount = allWordsInRange.length - wordsToProcess.length;
      logger.info(`跳过 ${skippedCount} 个已掌握的单词，不加入忽略列表`);
    }
  } else if (operation === 'known') {
    // 批量掌握：只处理 unknown 和 learning 状态的单词
    wordsToProcess = allWordsInRange.filter(
      (item) => item.status === 'unknown' || item.status === 'learning',
    );

    if (wordsToProcess.length < allWordsInRange.length) {
      const skippedCount = allWordsInRange.length - wordsToProcess.length;
      logger.info(`跳过 ${skippedCount} 个已掌握的单词`);
    }
  }

  if (wordsToProcess.length === 0) {
    logger.info('在选中区域未找到可操作的高亮单词。');
    showToast('在选中区域未找到可操作的单词', [], 'info');
    return;
  }

  logger.info(
    `开始批量操作: ${operation}，共 ${wordsToProcess.length} 个单词（总共 ${allWordsInRange.length} 个）。`,
    wordsToProcess,
  );

  // 执行操作
  if (operation === 'ignore') {
    // 批量发送忽略消息 - 一次性发送所有单词
    const uniqueWords = [...new Set(wordsToProcess.map((item) => item.word))];
    const displayWords = [...new Set(wordsToProcess.map((item) => item.originalWord ?? item.word))];

    chrome.runtime.sendMessage(
      {
        type: 'BATCH_IGNORE_WORDS',
        words: uniqueWords,
      },
      (response) => {
        if (response?.success) {
          const batchResult = response.data as {
            success: boolean;
            message: string;
            addedCount: number;
          };
          logger.info('批量忽略完成', {
            addedCount: batchResult.addedCount,
            totalCount: uniqueWords.length,
          });
          // 批量移除高亮
          uniqueWords.forEach((word) => {
            highlightManager.removeWordHighlight(word);
          });

          // 显示成功通知
          showToast(`已忽略 ${batchResult.addedCount} 个单词`, displayWords, 'success');
        } else {
          logger.error('批量忽略失败:', response?.error);
          showToast('批量忽略失败', [], 'info');
        }
      },
    );
  } else if (operation === 'known') {
    // 批量发送更新状态消息 - 一次性发送所有词元
    const uniqueLemmas = [...new Set(wordsToProcess.flatMap((item) => item.lemmas))];

    // 获取原始单词用于显示
    const displayWords = [...new Set(wordsToProcess.map((item) => item.originalWord ?? item.word))];

    chrome.runtime.sendMessage(
      {
        type: 'BATCH_UPDATE_WORD_STATUS',
        words: uniqueLemmas,
        status: 'known',
        familiarityLevel: 7,
      },
      (response) => {
        if (response?.success) {
          const batchResult = response.data as {
            success: boolean;
            message: string;
            updatedCount: number;
          };
          logger.info('批量标记为已掌握完成', {
            updatedCount: batchResult.updatedCount,
            totalCount: uniqueLemmas.length,
          });
          // 批量更新高亮状态
          uniqueLemmas.forEach((lemma) => {
            highlightManager.updateWordStatus(lemma, 'known');
          });

          // 显示成功通知
          showToast(`已标记 ${batchResult.updatedCount} 个单词为"已掌握"`, displayWords, 'success');
        } else {
          logger.error('批量更新状态失败:', response?.error);
          showToast('批量更新状态失败', [], 'info');
        }
      },
    );
  }
}

/**
 * 设置批量操作消息监听器
 */
function setupBatchOperationListener(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'BATCH_IGNORE_IN_SELECTION') {
      logger.info('收到批量忽略消息');
      handleBatchOperation('ignore');
      sendResponse({ success: true });
    } else if (message.type === 'BATCH_KNOW_IN_SELECTION') {
      logger.info('收到批量标记为已掌握消息');
      handleBatchOperation('known');
      sendResponse({ success: true });
    }
    // 确保对其他消息类型不产生影响
    return false;
  });
}

/**
 * 初始化核心功能（高亮、扫描等）
 */
async function initializeCoreFeatures(): Promise<void> {
  // 检查当前网站是否被禁用
  if (settingsManager.isCurrentSiteDisabled()) {
    logger.info('Current site is disabled, skipping core features initialization');
    return;
  }

  // 应用自定义颜色设置
  applyCustomColors();

  // 初始化管理器
  await initializeManagers();

  // 设置DOM观察器
  setupDOMObserver();

  // 监听强制重新扫描事件
  document.addEventListener('lang-helper-force-rescan', () => {
    setTimeout(() => {
      scanAndHighlight();
    }, 500);
  });

  // 延迟一下，让页面完全加载
  setTimeout(() => {
    logger.debug('Starting initial scan after delay');
    scanAndHighlight();
  }, 100);
}

/**
 * 初始化应用程序
 */
async function initializeApp(): Promise<void> {
  logger.info('Content script ready, starting initialization');

  // 记录页面基本信息
  PageInfo.logInfo();

  // 初始化设置管理器
  settingsManager = SettingsManager.getInstance();
  await settingsManager.initialize();

  // 无论插件是否启用，都要设置监听器
  // 这样当用户后来启用插件时，监听器能够响应
  setupSettingsListener();
  setupBatchOperationListener();

  // 检查插件是否被全局启用
  if (!settingsManager.isExtensionEnabled()) {
    logger.info('Extension is globally disabled, skipping core features initialization');
    logger.info('Listeners are set up and will respond when extension is enabled');
    return;
  }

  // 插件已启用，初始化核心功能
  await initializeCoreFeatures();
}

// 启动应用程序
initializeApp();
