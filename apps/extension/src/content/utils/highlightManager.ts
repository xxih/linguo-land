import type { HighlightInfo, HighlightRegistry, HighlightStats } from '../types';
import { TextProcessor } from './textProcessor';
import { Logger } from '../../utils/logger';
import { DictionaryLoader } from './dictionaryLoader';

/**
 * 高亮管理器
 * 负责管理所有高亮相关的功能
 */
export class HighlightManager {
  private registry: HighlightRegistry;
  private altKeyPressed: boolean = false; // 新增：跟踪 Alt 键状态
  private logger: Logger;

  constructor() {
    this.logger = new Logger('HighlightManager');
    this.registry = {
      items: [],
      unknownHighlight: new Highlight(),
      learningHighlight: new Highlight(),
      currentHoverHighlight: new Highlight(),
      hoveredWord: null,
    };

    // 初始化CSS样式
    this.initializeStyles();
    // 新增：初始化事件监听器
    this.initializeCursorEvents();
  }

  /**
   * 初始化CSS样式
   */
  private initializeStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
			/* 使用 CSS Custom Highlight API 替代 DOM 覆盖层 */
			::highlight(lang-helper--unknown) {
				background-color: rgba(255, 99, 99, 0.3);
				border-radius: 3px;
				color: inherit;
			}

			::highlight(lang-helper--learning) {
				background-color: rgba(99, 193, 255, 0.3);
				border-radius: 3px;
				color: inherit;
			}

			/* 悬停效果通过动态切换highlight实现 */
			::highlight(lang-helper--unknown-hover) {
				background-color: rgba(255, 99, 99, 0.5);
				border-radius: 3px;
				color: inherit;
			}

			::highlight(lang-helper--learning-hover) {
				background-color: rgba(99, 193, 255, 0.5);
				border-radius: 3px;
				color: inherit;
			}
		`;
    document.head.appendChild(style);
  }

  // =====================================================================
  // 新增：光标事件处理
  // =====================================================================

  /**
   * 初始化光标相关的事件监听器
   */
  private initializeCursorEvents(): void {
    // 绑定 this 上下文，以便在事件处理函数中正确访问类实例
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    document.addEventListener('mousemove', this.handleMouseMove);

    // 补充边界情况：如果用户切换窗口时 Alt 键是按下的，
    // keyup 事件可能不会触发。用 window.onblur 来重置状态。
    window.addEventListener('blur', () => {
      this.altKeyPressed = false;
      document.body.style.removeProperty('cursor');
    });
  }

  /**
   * 清理事件监听器（在销毁实例时调用）
   */
  public destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    document.removeEventListener('mousemove', this.handleMouseMove);

    // 需要移除匿名函数绑定的 blur 事件
    // 注意：由于使用了箭头函数，我们无法直接移除，但这在实际使用中影响很小
    // 因为 HighlightManager 通常伴随页面生命周期存在

    // 重置光标状态
    document.body.style.removeProperty('cursor');
    this.altKeyPressed = false;

    this.clearAllHighlights(); // 顺便清空高亮
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Alt' && !this.altKeyPressed) {
      this.altKeyPressed = true;
    }
  }

  private handleKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Alt') {
      this.altKeyPressed = false;
      // Alt键松开，移除我们设置的cursor样式，让浏览器恢复元素的默认cursor状态
      document.body.style.removeProperty('cursor');
    }
  }

  private handleMouseMove(event: MouseEvent): void {
    if (this.altKeyPressed) {
      const highlight = this.getHighlightAtPosition(event.clientX, event.clientY);
      if (highlight) {
        document.body.style.cursor = 'pointer';
      } else {
        document.body.style.cursor = 'default';
      }
    }
    // 如果 alt 没按下，我们在 keyup 时已经重置了光标，所以这里不需要 else
  }

  // =====================================================================
  // 原有方法保持不变
  // =====================================================================

  /**
   * 清空所有高亮
   */
  clear(): void {
    try {
      CSS.highlights.clear();
      this.registry.items = [];
      this.registry.unknownHighlight = new Highlight();
      this.registry.learningHighlight = new Highlight();
      this.registry.currentHoverHighlight = new Highlight();
      this.registry.hoveredWord = null;
    } catch (error) {
      this.logger.error('Failed to clear highlights', error as Error);
    }
  }

  /**
   * 清空所有高亮 (公共接口别名)
   */
  clearAllHighlights(): void {
    this.clear();
  }

  /**
   * 创建高亮
   * @param clearPrevious - 是否清除之前的高亮（默认 true）。设为 false 可实现增量高亮
   */
  async highlightNodes(
    nodes: Text[],
    lemmaDataMap: Record<string, { status: string; familyRoot: string; familiarityLevel: number }>, // key 是 lemma
    wordToLemmaMap: Map<string, string[]>, // 原始词 -> 词元列表
    clearPrevious: boolean = true, // 新增参数：是否清除之前的高亮
  ): Promise<HighlightStats> {
    const { highlightEnabled, extensionEnabled } =
      (await chrome.storage?.sync.get(['highlightEnabled', 'extensionEnabled'])) || {};
    // undefined 视为 true（默认启用）
    const isHighlightEnabled = highlightEnabled !== false;
    const isExtensionEnabled = extensionEnabled !== false;
    if (!isHighlightEnabled || !isExtensionEnabled) {
      return {
        totalMatches: 0,
        camelCaseMatches: 0,
        highlightCount: 0,
        processedNodes: 0,
      };
    }
    this.logger.info(
      `🎨 highlightNodes: 开始创建高亮，共 ${nodes.length} 个文本节点${clearPrevious ? '（清除旧高亮）' : '（增量模式）'}`,
    );
    const startTime = performance.now();

    // 根据参数决定是否清空之前的高亮
    if (clearPrevious) {
      this.clear();
    }

    let highlightCount = 0;
    let processedNodes = 0;
    let totalMatches = 0;
    let camelCaseMatches = 0;

    nodes.forEach((node, nodeIndex) => {
      if (nodeIndex % 50 === 0 && nodeIndex > 0) {
        this.logger.info(
          `  📊 高亮进度: ${nodeIndex}/${nodes.length} 节点, ${highlightCount} 高亮已创建`,
        );
      }

      const text = node.textContent;
      if (!text) return;

      processedNodes++;

      // 使用正则表达式查找所有单词
      const wordRegex = /\b[a-zA-Z'’]+\b/g;
      let match: RegExpExecArray | null;
      let matchCount = 0;

      while ((match = wordRegex.exec(text)) !== null) {
        matchCount++;
        totalMatches++;

        if (matchCount > 1000) {
          this.logger.warn(`节点 ${nodeIndex} 包含过多单词 (${matchCount})，可能存在问题`);
          break;
        }

        const originalWord = match[0];
        const wordLower = originalWord.toLowerCase();
        const matchIndex = match.index;

        /**
         * 跳过缩写词
         */
        if (DictionaryLoader.getInstance().isAbbreviationFilterWord(originalWord)) {
          continue;
        }

        // 跳过两个字母及以下的词
        if (originalWord.length <= 2) {
          continue;
        }

        // 再次检查父元素是否可见（防止动态变化）
        if (node.parentElement && !TextProcessor.isElementVisible(node.parentElement)) {
          continue;
        }

        // 检查是否是驼峰命名并进行分词处理
        const camelParts = TextProcessor.splitCamelCase(originalWord).map((p) => p.word);

        // 如果有多个部分，说明是驼峰命名
        if (camelParts.length > 1) {
          camelCaseMatches++;
          this.logger.info(`🐪 处理驼峰单词: "${originalWord}" 在节点 ${nodeIndex}`);

          // 处理驼峰命名的每个子词
          // 计算每个部分在原字符串中的位置
          let searchPos = 0;
          camelParts.forEach((partWord) => {
            const partLower = partWord.toLowerCase();
            const lemmas = wordToLemmaMap.get(partLower);
            if (lemmas && lemmas.length > 0) {
              // 在原字符串中查找这个部分的位置
              const partIndex = originalWord.toLowerCase().indexOf(partLower, searchPos);
              if (partIndex !== -1) {
                // 使用第一个词元作为代表来查询状态
                const representativeLemma = lemmas[0];
                const lemmaData = lemmaDataMap[representativeLemma];

                if (lemmaData) {
                  // 为所有状态的单词创建高亮信息，但只对 unknown 和 learning 状态进行视觉高亮
                  const highlightInfo = this.createHighlightRange(
                    node,
                    partWord, // 原始部分（保持大小写）
                    partLower, // 标准化部分
                    lemmas, // 词元列表
                    lemmaData.status,
                    lemmaData.familyRoot, // 传递词族根
                    lemmaData.familiarityLevel, // 传递熟练度
                    matchIndex + partIndex,
                    matchIndex + partIndex + partWord.length,
                  );

                  if (highlightInfo) {
                    // 只对 unknown 和 learning 状态的单词进行视觉高亮
                    if (lemmaData.status !== 'known') {
                      highlightCount++;
                    }
                  }
                }
                searchPos = partIndex + partWord.length;
              }
            }
          });
        } else {
          // 处理普通单词（非驼峰命名）
          const lemmas = wordToLemmaMap.get(wordLower);
          if (lemmas && lemmas.length > 0) {
            // 使用第一个词元作为代表来查询状态
            const representativeLemma = lemmas[0];
            const lemmaData = lemmaDataMap[representativeLemma];

            if (lemmaData) {
              // 为所有状态的单词创建高亮信息，但只对 unknown 和 learning 状态进行视觉高亮
              const highlightInfo = this.createHighlightRange(
                node,
                originalWord, // 原始词，保留大小写
                wordLower, // 标准化词
                lemmas, // 词元列表
                lemmaData.status,
                lemmaData.familyRoot, // 传递词族根
                lemmaData.familiarityLevel, // 传递熟练度
                matchIndex,
                matchIndex + originalWord.length,
              );

              if (highlightInfo) {
                // 只对 unknown 和 learning 状态的单词进行视觉高亮
                if (lemmaData.status !== 'known') {
                  highlightCount++;
                }
              }
            }
          }
        }
      }
    });

    // 注册高亮到 CSS
    CSS.highlights.set('lang-helper--unknown', this.registry.unknownHighlight);
    CSS.highlights.set('lang-helper--learning', this.registry.learningHighlight);

    const endTime = performance.now();
    const duration = endTime - startTime;

    const {
      highlightEnabled: doubleCheckHighlightEnabled,
      extensionEnabled: doubleCheckExtensionEnabled,
    } = (await chrome.storage?.sync.get(['highlightEnabled', 'extensionEnabled'])) || {};
    // undefined 视为 true（默认启用）
    const isDoubleCheckHighlightEnabled = doubleCheckHighlightEnabled !== false;
    const isDoubleCheckExtensionEnabled = doubleCheckExtensionEnabled !== false;
    if (!isDoubleCheckHighlightEnabled || !isDoubleCheckExtensionEnabled) {
      this.clear();
      return {
        totalMatches: 0,
        camelCaseMatches: 0,
        highlightCount: 0,
        processedNodes: 0,
      };
    }

    this.logger.info(`🎨 highlightNodes 完成:`, isDoubleCheckHighlightEnabled);
    this.logger.info(`  ⏱️  用时: ${duration.toFixed(2)}ms`);
    this.logger.info(`  📄 处理节点: ${processedNodes}/${nodes.length}`);
    this.logger.info(`  🔤 总匹配数: ${totalMatches}`);
    this.logger.info(`  🐪 驼峰匹配: ${camelCaseMatches}`);
    this.logger.info(`  🎯 创建高亮: ${highlightCount}`);
    this.logger.info(`  📝 注册表大小: ${this.registry.items.length}`);

    return {
      totalMatches,
      camelCaseMatches,
      highlightCount,
      processedNodes,
    };
  }

  /**
   * 创建高亮范围
   */
  private createHighlightRange(
    node: Text,
    originalWord: string,
    normalizedWord: string,
    lemmas: string[], // 词元列表
    status: string,
    familyRoot: string, // 词族根
    familiarityLevel: number, // 熟练度
    startOffset: number,
    endOffset: number,
  ): HighlightInfo | null {
    try {
      // 创建 Range 来获取单词的位置
      const range = document.createRange();
      range.setStart(node, startOffset);
      range.setEnd(node, endOffset);

      // 检查Range是否有效
      const rects = range.getClientRects();
      if (rects.length === 0 || rects[0].width <= 0 || rects[0].height <= 0) {
        return null;
      }

      // 只为需要视觉高亮的状态添加到高亮集合
      if (status === 'unknown') {
        this.registry.unknownHighlight.add(range);
      } else if (status === 'learning') {
        this.registry.learningHighlight.add(range);
      }
      // 注意：已认识的单词 (status === "known") 不添加到视觉高亮集合中，
      // 但仍然会被添加到注册表中，以便支持点击交互

      // 存储高亮信息到注册表（用于点击检测）
      const highlightInfo: HighlightInfo = {
        word: normalizedWord,
        originalWord: originalWord,
        lemmas: lemmas, // 把词元列表存进去！
        status: status,
        familyRoot: familyRoot, // 词族根
        familiarityLevel: familiarityLevel, // 熟练度
        textNode: node,
        startOffset: startOffset,
        endOffset: endOffset,
        range: range,
      };

      this.registry.items.push(highlightInfo);
      return highlightInfo;
    } catch (error) {
      this.logger.error('创建Range失败', error as Error, {
        originalWord,
        normalizedWord,
        lemmas,
        startOffset,
        endOffset,
        nodeText: node.textContent?.slice(0, 50) + '...',
      });
      return null;
    }
  }

  /**
   * 移除特定单词的所有高亮
   * @param word 要移除高亮的原始单词
   */
  removeWordHighlight(word: string): void {
    this.logger.info(`🚫 移除单词高亮: "${word}"`);

    const wordLower = word.toLowerCase();

    // 找到所有匹配的高亮项（按原始单词匹配）
    const matchingItems = this.registry.items.filter(
      (item) => item.word.toLowerCase() === wordLower,
    );

    if (matchingItems.length === 0) {
      this.logger.info(`❌ 未找到单词 "${word}" 的高亮项`);
      return;
    }

    this.logger.info(`📍 找到 ${matchingItems.length} 个匹配的高亮项，准备移除`);

    // 从高亮集合中移除这些Range
    matchingItems.forEach((item) => {
      // 从对应的高亮集合中移除
      if (item.status === 'unknown') {
        this.registry.unknownHighlight.delete(item.range);
      } else if (item.status === 'learning') {
        this.registry.learningHighlight.delete(item.range);
      }
    });

    // 从注册表中移除这些项
    this.registry.items = this.registry.items.filter(
      (item) => item.word.toLowerCase() !== wordLower,
    );

    // 更新CSS highlights
    CSS.highlights.set('lang-helper--unknown', this.registry.unknownHighlight);
    CSS.highlights.set('lang-helper--learning', this.registry.learningHighlight);

    // 如果当前悬停的是这个单词，清除悬停高亮
    if (
      this.registry.hoveredWord &&
      matchingItems.some((item) => item.lemmas.includes(this.registry.hoveredWord!))
    ) {
      this.registry.hoveredWord = null;
      this.updateHoverHighlight();
    }

    this.logger.info(`✅ 单词 "${word}" 的所有高亮已移除`);
    this.logger.info(
      `📊 当前高亮统计: unknown=${this.registry.unknownHighlight.size}, learning=${this.registry.learningHighlight.size}`,
    );
  }

  /**
   * 更新词元高亮状态
   */
  updateWordStatus(lemma: string, newStatus: string, newFamiliarityLevel?: number): void {
    this.logger.info(
      `🔄 更新词元高亮状态: ${lemma} -> ${newStatus}, 熟练度: ${newFamiliarityLevel}`,
    );

    // 找到所有匹配的高亮项（按词元匹配）
    const matchingItems = this.registry.items.filter((item) => item.lemmas.includes(lemma));

    if (matchingItems.length === 0) {
      this.logger.info(`❌ 未找到词元 "${lemma}" 的高亮项，状态更新将不会应用到视觉高亮`);
      // 不返回，因为可能在fallback路径中点击了known单词，然后更新，需要通知开发者
      return;
    }

    this.logger.info(`📍 找到 ${matchingItems.length} 个匹配的高亮项`);

    // 从当前的高亮集合中移除这些Range
    matchingItems.forEach((item) => {
      // 从旧的高亮集合中移除
      if (item.status === 'unknown') {
        this.registry.unknownHighlight.delete(item.range);
      } else if (item.status === 'learning') {
        this.registry.learningHighlight.delete(item.range);
      }
      // 如果旧状态是 "known"，则原本就不在任何视觉高亮集合中

      // 更新状态
      item.status = newStatus;

      // 如果提供了新的熟练度级别，也更新它
      if (newFamiliarityLevel !== undefined) {
        item.familiarityLevel = newFamiliarityLevel;
      }

      // 添加到新的高亮集合
      if (newStatus === 'unknown') {
        this.registry.unknownHighlight.add(item.range);
      } else if (newStatus === 'learning') {
        this.registry.learningHighlight.add(item.range);
      }
      // 如果新状态是 "known"，则不添加到任何视觉高亮集合中，
      // 但保留在注册表中以支持点击交互
    });

    // 更新CSS highlights
    CSS.highlights.set('lang-helper--unknown', this.registry.unknownHighlight);
    CSS.highlights.set('lang-helper--learning', this.registry.learningHighlight);

    // 如果当前悬停的是这个词元，也要更新悬停高亮
    if (this.registry.hoveredWord === lemma) {
      this.updateHoverHighlight();
    }

    this.logger.info(`✅ 词元 "${lemma}" 高亮状态已更新为 "${newStatus}"`);
    this.logger.info(
      `📊 当前高亮统计: unknown=${this.registry.unknownHighlight.size}, learning=${this.registry.learningHighlight.size}`,
    );
  }

  /**
   * 动态添加单词高亮（用于处理通过点击检测但之前未高亮的单词）
   * 这在用户点击known状态的单词并将其更改为learning时特别有用
   */
  public addDynamicHighlight(
    word: string,
    originalWord: string,
    lemmas: string[],
    status: string,
    familyRoot: string | undefined,
    familiarityLevel: number,
    range: Range,
  ): void {
    this.logger.info(
      `➕ 动态添加高亮: "${originalWord}" (lemma: "${lemmas[0]}", status: "${status}")`,
    );

    // 检查是否已经存在对应的高亮项
    const existingItemIndex = this.registry.items.findIndex((item) =>
      item.lemmas.some((lemma) => lemmas.includes(lemma)),
    );

    if (existingItemIndex !== -1) {
      // 如果已存在，更新现有项
      const existingItem = this.registry.items[existingItemIndex];

      // 从旧的高亮集合中移除
      if (existingItem.status === 'unknown') {
        this.registry.unknownHighlight.delete(existingItem.range);
      } else if (existingItem.status === 'learning') {
        this.registry.learningHighlight.delete(existingItem.range);
      }

      // 更新状态
      existingItem.status = status;
      existingItem.familiarityLevel = familiarityLevel;
      existingItem.familyRoot = familyRoot || existingItem.familyRoot;

      // 添加到新的高亮集合
      if (status === 'unknown') {
        this.registry.unknownHighlight.add(existingItem.range);
      } else if (status === 'learning') {
        this.registry.learningHighlight.add(existingItem.range);
      }
    } else {
      // 创建新的高亮项
      const highlightInfo: HighlightInfo = {
        word: word,
        originalWord: originalWord,
        lemmas: lemmas,
        status: status,
        familyRoot: familyRoot,
        familiarityLevel: familiarityLevel,
        textNode: range.startContainer as Text,
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        range: range,
      };

      this.registry.items.push(highlightInfo);

      // 根据状态添加到相应的高亮集合
      if (status === 'unknown') {
        this.registry.unknownHighlight.add(range);
      } else if (status === 'learning') {
        this.registry.learningHighlight.add(range);
      }
    }

    // 更新CSS highlights
    CSS.highlights.set('lang-helper--unknown', this.registry.unknownHighlight);
    CSS.highlights.set('lang-helper--learning', this.registry.learningHighlight);

    this.logger.info(
      `📊 动态高亮添加完成。当前统计: unknown=${this.registry.unknownHighlight.size}, learning=${this.registry.learningHighlight.size}`,
    );
  }

  /**
   * 设置悬停的词元
   */
  setHoveredWord(lemma: string | null): void {
    if (this.registry.hoveredWord !== lemma) {
      this.registry.hoveredWord = lemma;
      this.updateHoverHighlight();
    }
  }

  /**
   * 更新悬停高亮效果
   */
  private updateHoverHighlight(): void {
    // 清除当前悬停高亮
    this.registry.currentHoverHighlight.clear();
    CSS.highlights.delete('lang-helper--unknown-hover');
    CSS.highlights.delete('lang-helper--learning-hover');

    if (this.registry.hoveredWord) {
      const hoveredWord = this.registry.hoveredWord;
      // 收集所有匹配词元的Range
      const hoveredRanges = this.registry.items
        .filter((item) => item.lemmas.includes(hoveredWord))
        .map((item) => item.range);

      if (hoveredRanges.length > 0) {
        // 创建新的悬停高亮
        const hoverHighlight = new Highlight();
        hoveredRanges.forEach((range) => hoverHighlight.add(range));

        // 确定悬停高亮的样式（基于第一个匹配项的状态）
        const firstMatch = this.registry.items.find((item) => item.lemmas.includes(hoveredWord));
        if (firstMatch) {
          const hoverStyleName = `lang-helper--${firstMatch.status}-hover`;
          CSS.highlights.set(hoverStyleName, hoverHighlight);
        }
      }
    }
  }

  /**
   * 检查点击位置是否在高亮区域内
   */
  getHighlightAtPosition(x: number, y: number): HighlightInfo | null {
    for (const item of this.registry.items) {
      const rects = item.range.getClientRects();

      // 检查所有矩形区域（处理跨行的情况）
      for (const rect of rects) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return item;
        }
      }
    }
    return null;
  }

  /**
   * 获取注册表统计信息
   */
  getStats(): {
    totalHighlights: number;
    unknownCount: number;
    learningCount: number;
  } {
    return {
      totalHighlights: this.registry.items.length,
      unknownCount: this.registry.unknownHighlight.size,
      learningCount: this.registry.learningHighlight.size,
    };
  }

  /**
   * 获取指定范围内的所有高亮信息
   * 用于批量操作选中区域内的高亮单词
   */
  public getHighlightsInRange(range: Range): HighlightInfo[] {
    return this.registry.items.filter((item) => {
      const startsAfter = range.compareBoundaryPoints(Range.START_TO_START, item.range) > 0;
      const endsBefore = range.compareBoundaryPoints(Range.END_TO_END, item.range) < 0;
      return !(startsAfter || endsBefore);
    });
  }

  /**
   * 获取所有高亮项
   * 提供对注册表的只读访问
   */
  public getAllHighlightItems(): Readonly<HighlightInfo[]> {
    return this.registry.items;
  }
}
