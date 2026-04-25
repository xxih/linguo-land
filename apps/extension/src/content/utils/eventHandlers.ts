import type {
  ChromeMessage,
  ChromeMessageResponse,
  WordDetails,
  WordFamiliarityStatus,
} from 'shared-types';
import type { HighlightManager } from './highlightManager';
import type { WordCardManager } from './wordCardManager';
import { DictionaryLoader } from './dictionaryLoader';
import { SettingsManager } from './settingsManager';
import { TextProcessor } from './textProcessor';
import nlp from 'compromise';
import { logger } from '../../utils/logger';

/**
 * 事件处理器
 * 负责处理所有用户交互事件
 */
export class EventHandlers {
  private highlightManager: HighlightManager;
  private wordCardManager: WordCardManager;
  private dictionaryLoader: DictionaryLoader;
  private settingsManager: SettingsManager;

  constructor(highlightManager: HighlightManager, wordCardManager: WordCardManager) {
    this.highlightManager = highlightManager;
    this.wordCardManager = wordCardManager;
    this.dictionaryLoader = DictionaryLoader.getInstance();
    this.settingsManager = SettingsManager.getInstance();
    this.initializeEventListeners();
  }

  /**
   * 初始化事件监听器
   */
  private initializeEventListeners(): void {
    // 使用捕获阶段来确保我们的事件处理器最先执行
    // 这样可以在其他监听器（如链接的默认行为）之前阻止事件
    document.body.addEventListener('click', this.handleGlobalClick.bind(this), true);
    document.body.addEventListener('mousedown', this.handleMouseDown.bind(this), true);
    document.body.addEventListener('mousemove', this.handleGlobalMouseMove.bind(this));

    // 监听来自background的状态更新消息
    chrome.runtime.onMessage.addListener(this.handleRuntimeMessage.bind(this));
  }

  /**
   * 处理运行时消息
   */
  private handleRuntimeMessage(
    message: any,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: any) => void,
  ): boolean {
    if (message.type === 'WORD_STATUS_UPDATED') {
      logger.info(
        `收到词元状态更新消息: ${message.word} -> ${message.status}, 熟练度: ${message.familiarityLevel}, familyRoot: ${message.familyRoot}`,
      );

      // background 广播带 familyRoot——跨 frame 时按词族整族匹配，
      // iframe 高亮的"ran"也能跟着主页面"running"一起切到 known
      this.highlightManager.updateWordStatus(
        message.word,
        message.status,
        message.familiarityLevel,
        message.familyRoot,
      );

      // 如果单词未在注册表中找到，尝试动态创建高亮
      // 这在用户点击回退路径的单词（如known状态）并改变其状态时特别有用
      if (message.status === 'learning' || message.status === 'unknown') {
        this.tryAddDynamicHighlight(
          message.word,
          message.status,
          message.familiarityLevel,
          message.familyRoot,
        );
      }

      sendResponse({ success: true });
    } else if (message.type === 'WORD_IGNORED') {
      logger.info(`收到单词忽略消息: ${message.word}`);
      this.highlightManager.removeWordHighlight(message.word);
      sendResponse({ success: true });
    }
    return false;
  }

  /**
   * 处理 mousedown 事件
   * 在捕获阶段阻止 Alt+Click 的 mousedown 事件，防止触发链接跳转等默认行为
   */
  private handleMouseDown(event: MouseEvent): void {
    if (event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  }

  // 新增：记录学习操作
  private async logStudyAction(type: string, data: any): Promise<void> {
    try {
      const result = await chrome.storage.local.get(['studySessionActive', 'studySessionLogs']);
      if (result.studySessionActive) {
        const logs = result.studySessionLogs || [];
        logs.push({
          type,
          timestamp: Date.now(),
          ...data,
        });
        await chrome.storage.local.set({ studySessionLogs: logs });
      }
    } catch (error) {
      logger.error('Failed to log study action', error as Error);
    }
  }
  /**
   * 处理全局点击事件 - 混合方案
   * Primary Path: 优先查询预计算的高亮信息（快速、一致）
   * Fallback Path: 如果没找到高亮，则使用野蛮抓取逻辑（通用查词）
   * Alt+Shift+Click: 翻译当前句子
   */
  private async handleGlobalClick(event: MouseEvent): Promise<void> {
    // 1. 检查是否按下了 Alt 键（包括 Alt+Shift 组合）
    // 如果没有按下 Alt，直接返回，不处理
    if (!event.altKey) {
      return;
    }

    // 2. 立即阻止默认行为，防止浏览器原生行为（如 Alt+Click 下载）
    // 必须在任何异步操作之前调用，否则会有延迟导致默认行为已经触发
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    // 3. 检查插件是否全局启用（同步读取缓存值）
    if (!this.settingsManager.isExtensionEnabled()) {
      return; // 插件已禁用，不处理任何事件（但已经阻止了默认行为）
    }

    // 4. 检查 Alt+Shift+Click - 翻译句子功能
    if (event.altKey && event.shiftKey) {
      const paragraph = this.getContextSentence(event.clientX, event.clientY);
      if (paragraph) {
        const sentence = this.extractClickedSentence(event.clientX, event.clientY);
        // 如果句子提取失败，使用段落作为 fallback
        const targetSentence = sentence && sentence.length > 10 ? sentence : paragraph;
        this.getSentenceTranslation(paragraph, targetSentence, event.pageX, event.pageY);
      } else {
        logger.warn('无法获取上下文句子进行翻译。');
      }
      return;
    }

    // 5. 处理单词查询功能（只有 Alt 键，没有 Shift）

    // -------------------------------------------------
    // PRIMARY PATH: 尝试查找现有的高亮信息
    // -------------------------------------------------
    logger.info(`🎯 Alt+Click detected. 检查现有高亮位置 (${event.clientX}, ${event.clientY})...`);
    const highlightInfo = this.highlightManager.getHighlightAtPosition(
      event.clientX,
      event.clientY,
    );

    // 如果找到了高亮信息，我们的工作就简单而一致了！
    if (highlightInfo) {
      const originalWord = highlightInfo.originalWord ?? highlightInfo.word;
      logger.info(`✅ 成功！找到高亮单词: "${originalWord}"`, {
        lemmas: highlightInfo.lemmas,
        status: highlightInfo.status,
        familyRoot: highlightInfo.familyRoot,
      });

      // 显示 loading 指示器
      this.wordCardManager.showLoadingIndicator(event.pageX, event.pageY);

      // 获取包含完整句子的上下文
      const contextSentence = this.getWordContext(event.clientX, event.clientY);

      // 3.6 检查自动提升熟练度开关，如果打开则调用API（PRIMARY PATH）
      const settings = await chrome.storage.sync.get(['autoIncreaseFamiliarity']);
      if (
        settings.autoIncreaseFamiliarity === undefined ||
        settings.autoIncreaseFamiliarity === null
      ) {
        settings.autoIncreaseFamiliarity = true;
      }
      logger.debug(
        '[EventHandlers] PRIMARY PATH - 自动提升熟练度开关状态: ' +
          settings.autoIncreaseFamiliarity,
      );

      // 准备传递给单词卡片的熟练度值
      let displayFamiliarityLevel = highlightInfo.familiarityLevel;
      if (settings.autoIncreaseFamiliarity && highlightInfo.lemmas.length > 0) {
        logger.debug(
          '[EventHandlers] PRIMARY PATH - 准备调用自动提升熟练度API, 词元: ' +
            highlightInfo.lemmas[0],
        );

        // 如果是学习中的单词，且自动提升开关打开，则显示的熟练度应加1
        if (highlightInfo.status === 'learning') {
          displayFamiliarityLevel = Math.min(7, (highlightInfo.familiarityLevel || 0) + 1);
          logger.debug(
            `[EventHandlers] PRIMARY PATH - 学习中词汇 "${originalWord}" 的显示熟练度调整为: ${displayFamiliarityLevel}`,
          );
        }

        // 调用自动提升熟练度API（异步，不阻塞显示）
        chrome.runtime
          .sendMessage({
            type: 'AUTO_INCREASE_FAMILIARITY',
            word: highlightInfo.lemmas[0],
          })
          .then((response) => {
            logger.debug(
              '[EventHandlers] PRIMARY PATH - 自动提升熟练度API响应: ' + JSON.stringify(response),
            );
          })
          .catch((error: Error) => {
            logger.error('[EventHandlers] PRIMARY PATH - 自动提升熟练度失败', error);
          });
      } else {
        logger.debug(
          '[EventHandlers] PRIMARY PATH - 跳过自动提升熟练度 - 开关: ' +
            settings.autoIncreaseFamiliarity +
            ' 词元数量: ' +
            highlightInfo.lemmas.length,
        );
      }

      this.getWordDetails(
        originalWord,
        highlightInfo.lemmas,
        highlightInfo.familyRoot, // 传递词族根
        event.pageX,
        event.pageY,
        contextSentence, // 传递上下文
        highlightInfo.status as WordFamiliarityStatus, // 传递当前状态
        displayFamiliarityLevel, // 传递可能调整后的熟练度
      );

      return; // 重要：完成后直接退出函数
    }

    // -------------------------------------------------
    // FALLBACK PATH: 仅在没有找到高亮时执行
    // -------------------------------------------------
    logger.info('🤔 未找到高亮。回退到即时单词检测...');

    // 使用原有的"野蛮抓取"逻辑来检测鼠标位置的单词
    const range = document.caretRangeFromPoint(event.clientX, event.clientY);
    if (!range || !range.startContainer) {
      logger.warn('❌ 回退失败：无法从点击位置创建 range。');
      return;
    }

    let textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) {
      const textNodes = this.findTextNodesInElement(textNode as Element);
      if (textNodes.length === 0) {
        logger.warn('❌ 回退失败：点击的元素不包含文本节点。');
        return;
      }
      textNode = textNodes[0];
      range.selectNodeContents(textNode);
    }

    // 手动扩展范围以捕获完整单词
    this.manuallyExpandToWord(range);
    const clickedWord = range.toString().trim();

    // 验证回退逻辑的结果
    if (!clickedWord || !/^[a-zA-Z]/.test(clickedWord)) {
      logger.info(`❌ 回退失败：提取的文本不是有效单词: "${clickedWord}"`);
      return;
    }

    logger.info(`👍 回退成功：检测到单词 "${clickedWord}"`);

    // 显示 loading 指示器
    this.wordCardManager.showLoadingIndicator(event.pageX, event.pageY);

    // 对检测到的单词进行即时词元化
    const lemmas = this.getLemmasOnTheFly(clickedWord);
    logger.info(`🔄 即时词元化: "${clickedWord}" -> [${lemmas.join(', ')}]`);

    // 获取包含完整句子的上下文
    const contextSentence = this.getWordContext(event.clientX, event.clientY);

    try {
      let status: WordFamiliarityStatus | 'ignored' = 'unknown';
      let familyRoot: string | undefined;
      let familiarityLevel: number = 0;

      // 1. 检查是否为本地忽略的单词
      if (this.dictionaryLoader.isIgnoredWord(clickedWord)) {
        status = 'ignored';
      } else {
        // 2. 如果不是，则从后端查询状态
        const statusResponse = await this.sendMessageAsync({
          type: 'QUERY_WORDS_STATUS',
          words: lemmas,
        });
        const statusData = statusResponse.data as Record<
          string,
          { status: WordFamiliarityStatus; familyRoot: string; familiarityLevel: number }
        >;
        if (statusData && lemmas[0] && statusData[lemmas[0]]) {
          status = statusData[lemmas[0]].status;
          familyRoot = statusData[lemmas[0]].familyRoot;
          familiarityLevel = statusData[lemmas[0]].familiarityLevel || 0;
        }
      }

      // 3. 获取单词释义
      const queryWord = familyRoot || (lemmas.length > 0 ? lemmas[0] : clickedWord);
      const detailsResponse = await this.sendMessageAsync({
        type: 'GET_INTERNAL_DEFINITION',
        word: queryWord,
      });
      const details = detailsResponse.data as WordDetails;

      // 3.5 记录查词操作
      await this.logStudyAction('WORD_LOOKUP', {
        word: clickedWord,
        lemmas,
        familyRoot,
        status,
      });

      // 3.6 检查自动提升熟练度开关，如果打开则调用API（FALLBACK PATH）
      const settings = await chrome.storage.sync.get(['autoIncreaseFamiliarity']);
      logger.debug(
        '[EventHandlers] FALLBACK PATH - 自动提升熟练度开关状态: ' +
          settings.autoIncreaseFamiliarity,
      );

      // 准备传递给单词卡片的熟练度值
      let displayFamiliarityLevel = familiarityLevel;
      if (settings.autoIncreaseFamiliarity && lemmas.length > 0) {
        logger.debug(
          '[EventHandlers] FALLBACK PATH - 准备调用自动提升熟练度API, 词元: ' + lemmas[0],
        );

        // 如果是学习中的单词，且自动提升开关打开，则显示的熟练度应加1
        if (status === 'learning') {
          displayFamiliarityLevel = Math.min(7, (familiarityLevel || 0) + 1);
          logger.debug(
            `[EventHandlers] FALLBACK PATH - 学习中词汇 "${clickedWord}" 的显示熟练度调整为: ${displayFamiliarityLevel}`,
          );
        }

        // 调用自动提升熟练度API（异步，不阻塞显示）
        chrome.runtime
          .sendMessage({
            type: 'AUTO_INCREASE_FAMILIARITY',
            word: lemmas[0],
          })
          .then((response) => {
            logger.debug(
              '[EventHandlers] FALLBACK PATH - 自动提升熟练度API响应: ' + JSON.stringify(response),
            );
          })
          .catch((error: Error) => {
            logger.error('[EventHandlers] FALLBACK PATH - 自动提升熟练度失败', error);
          });
      } else {
        logger.debug(
          '[EventHandlers] FALLBACK PATH - 跳过自动提升熟练度 - 开关: ' +
            settings.autoIncreaseFamiliarity +
            ' 词元数量: ' +
            lemmas.length,
        );
      }

      // 4. 显示卡片，并传入完整的状态信息
      this.wordCardManager.showWordCard(
        clickedWord,
        lemmas,
        familyRoot,
        details,
        event.pageX,
        event.pageY,
        contextSentence,
        status as WordFamiliarityStatus, // 我们在 WordCard 中处理 'ignored'
        displayFamiliarityLevel,
      );
    } catch (error) {
      logger.error('在 fallback 路径中获取单词信息失败:', error as Error);
      // 移除 loading 指示器
      this.wordCardManager.removeLoadingIndicator();
      // 即使失败，也弹出一个基础卡片提示用户
      this.wordCardManager.showWordCard(
        clickedWord,
        lemmas,
        undefined,
        {
          id: -1,
          word: clickedWord,
          entries: [
            {
              pos: 'error',
              senses: [{ glosses: ['信息获取失败'], examples: [] }],
            },
          ],
          phonetics: [],
          audio: [],
          forms: [],
        },
        event.pageX,
        event.pageY,
        contextSentence,
        'unknown',
        0, // familiarityLevel
      );
    }
  }

  /**
   * 在元素中查找文本节点
   */
  private findTextNodesInElement(element: Node): Text[] {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (node.textContent?.trim()) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    });

    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }
    return textNodes;
  }

  /**
   * 手动扩展Range到完整单词
   */
  private manuallyExpandToWord(range: Range): void {
    const text = range.startContainer.textContent || '';
    const offset = range.startOffset;

    // 向前扩展到单词边界
    let start = offset;
    while (start > 0 && /[a-zA-Z'’]/.test(text[start - 1])) {
      start--;
    }

    // 向后扩展到单词边界
    let end = offset;
    while (end < text.length && /[a-zA-Z'’]/.test(text[end])) {
      end++;
    }

    range.setStart(range.startContainer, start);
    range.setEnd(range.startContainer, end);
  }

  /**
   * 即时词元化方法
   */
  private getLemmasOnTheFly(word: string): string[] {
    try {
      // 清理单词，移除标点符号和所有格
      const cleanedWord = this.cleanWord(word);
      if (!cleanedWord) {
        return [word.toLowerCase()];
      }

      const doc = nlp(cleanedWord);
      const root =
        doc.verbs().toInfinitive().text() || doc.nouns().toSingular().text() || cleanedWord;

      // 返回词元列表，包括原词的小写形式作为后备
      const lemmas = [root.toLowerCase()];
      if (cleanedWord.toLowerCase() !== root.toLowerCase()) {
        lemmas.push(cleanedWord.toLowerCase());
      }

      return lemmas;
    } catch (error) {
      logger.error('词元化失败', error as Error);
      return [word.toLowerCase()];
    }
  }

  /**
   * 清理单词，移除标点符号和处理所有格（复制自TextProcessor）
   */
  private cleanWord(word: string): string {
    // 移除开头和结尾的标点符号，但保留内部的撇号（如 don't, it's）
    let cleaned = word.replace(/^[^\w']+|[^\w']+$/g, '');

    // 处理所有格形式：将 "word's" 转换为 "word"
    cleaned = cleaned.replace(/'s$/i, '');

    // 移除其他尾部的撇号和字母组合（如 "word'" -> "word"）
    // cleaned = cleaned.replace(/'[a-z]*$/i, '');

    return cleaned;
  }

  /**
   * 处理全局鼠标移动事件
   */
  private handleGlobalMouseMove(event: MouseEvent): void {
    const mouseX = event.clientX;
    const mouseY = event.clientY;

    // 检查是否悬停在高亮区域上
    const highlightInfo = this.highlightManager.getHighlightAtPosition(mouseX, mouseY);
    // 使用第一个词元作为悬停标识
    const hoveredLemma =
      highlightInfo && highlightInfo.lemmas.length > 0 ? highlightInfo.lemmas[0] : null;

    // 更新悬停状态（使用词元）
    this.highlightManager.setHoveredWord(hoveredLemma);
  }

  /**
   * 获取单词的上下文（包含完整句子）
   * 用于 AI 解析，确保至少包含点击单词所在的完整句子
   */
  private getWordContext(clientX: number, clientY: number): string {
    try {
      const range = document.caretRangeFromPoint(clientX, clientY);
      if (!range || !range.startContainer) return '';

      // 获取点击位置的文本节点
      let textNode = range.startContainer;

      // 如果不是文本节点，尝试获取其文本子节点
      if (textNode.nodeType !== Node.TEXT_NODE) {
        const walker = document.createTreeWalker(textNode, NodeFilter.SHOW_TEXT, null);
        textNode = walker.nextNode() || textNode;
      }

      if (!textNode.textContent) return '';

      // 获取父元素
      const parentElement = textNode.parentElement;
      if (!parentElement) return textNode.textContent.trim();

      // 向上查找段落级别的元素
      let contextElement: Element | null = parentElement;
      while (
        contextElement &&
        ![
          'P',
          'LI',
          'DIV',
          'TD',
          'H1',
          'H2',
          'H3',
          'H4',
          'H5',
          'H6',
          'ARTICLE',
          'SECTION',
        ].includes(contextElement.tagName)
      ) {
        contextElement = contextElement.parentElement;
      }

      const fullText = contextElement
        ? contextElement.textContent?.trim() || ''
        : parentElement.textContent?.trim() || '';

      if (!fullText) return '';

      // 如果文本较短，直接返回
      if (fullText.length <= 200) {
        return fullText;
      }

      // 计算点击位置在完整文本中的准确位置
      let clickPosition = 0;

      // 使用 TreeWalker 遍历所有文本节点来准确定位
      const container = contextElement || parentElement;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);

      let currentNode;
      let found = false;
      while ((currentNode = walker.nextNode())) {
        if (currentNode === textNode) {
          clickPosition += range.startOffset;
          found = true;
          break;
        } else {
          clickPosition += currentNode.textContent?.length || 0;
        }
      }

      // 如果没找到精确位置，使用简单方法
      if (!found) {
        const beforeClickText = textNode.textContent.substring(0, range.startOffset);
        clickPosition = fullText.indexOf(beforeClickText) + beforeClickText.length;
      }

      // 从点击位置向前查找句子开始（最多2个句子）
      let contextStart = 0;
      let sentencesFound = 0;
      for (let i = clickPosition - 1; i >= 0 && sentencesFound < 2; i--) {
        const char = fullText[i];
        if (char === '.' || char === '!' || char === '?') {
          if (i === fullText.length - 1 || /\s/.test(fullText[i + 1])) {
            const before = fullText.substring(Math.max(0, i - 4), i + 1).toLowerCase();
            if (!before.match(/\b(mr|mrs|ms|dr|prof|sr|jr|st|ave|etc|inc|ltd|vs)\./)) {
              sentencesFound++;
              if (sentencesFound === 2) {
                contextStart = i + 1;
                break;
              }
            }
          }
        }
      }

      // 从点击位置向后查找句子结束（最多2个句子）
      let contextEnd = fullText.length;
      sentencesFound = 0;
      for (let i = clickPosition; i < fullText.length && sentencesFound < 2; i++) {
        const char = fullText[i];
        if (char === '.' || char === '!' || char === '?') {
          if (i === fullText.length - 1 || /\s/.test(fullText[i + 1])) {
            const before = fullText.substring(Math.max(0, i - 4), i + 1).toLowerCase();
            if (!before.match(/\b(mr|mrs|ms|dr|prof|sr|jr|st|ave|etc|inc|ltd|vs)\./)) {
              sentencesFound++;
              if (sentencesFound === 2) {
                contextEnd = i + 1;
                break;
              }
            }
          }
        }
      }

      // 提取上下文
      let context = fullText.substring(contextStart, contextEnd).trim();

      // 限制最大长度为 400 字符
      if (context.length > 400) {
        // 如果太长，尝试只保留包含点击位置的一个句子
        const clickRelativePos = clickPosition - contextStart;

        // 找到包含点击位置的句子
        let sentenceStart = 0;
        for (let i = clickRelativePos - 1; i >= 0; i--) {
          const char = context[i];
          if (char === '.' || char === '!' || char === '?') {
            if (i === context.length - 1 || /\s/.test(context[i + 1])) {
              const before = context.substring(Math.max(0, i - 4), i + 1).toLowerCase();
              if (!before.match(/\b(mr|mrs|ms|dr|prof|sr|jr|st|ave|etc|inc|ltd|vs)\./)) {
                sentenceStart = i + 1;
                break;
              }
            }
          }
        }

        let sentenceEnd = context.length;
        for (let i = clickRelativePos; i < context.length; i++) {
          const char = context[i];
          if (char === '.' || char === '!' || char === '?') {
            if (i === context.length - 1 || /\s/.test(context[i + 1])) {
              const before = context.substring(Math.max(0, i - 4), i + 1).toLowerCase();
              if (!before.match(/\b(mr|mrs|ms|dr|prof|sr|jr|st|ave|etc|inc|ltd|vs)\./)) {
                sentenceEnd = i + 1;
                break;
              }
            }
          }
        }

        context = context.substring(sentenceStart, sentenceEnd).trim();

        // 如果单个句子还是太长，截断到 400 字符
        if (context.length > 400) {
          context = context.substring(0, 400);
        }
      }

      logger.debug('Word context extracted', {
        clickPosition,
        fullTextLength: fullText.length,
        contextStart,
        contextEnd,
        contextLength: context.length,
        preview: context.substring(0, 50) + '...',
      });

      return context;
    } catch (error) {
      logger.warn('Failed to get word context', error as Error);
      return '';
    }
  }

  /**
   * 获取上下文句子（段落）
   * 用于翻译功能，可能返回较长的段落
   */
  private getContextSentence(clientX: number, clientY: number): string {
    try {
      const range = document.caretRangeFromPoint(clientX, clientY);
      if (!range || !range.startContainer) return '';

      const parentElement = range.startContainer.parentElement;
      if (!parentElement) return '';

      // 尝试获取包含句子的父元素
      let contextElement: Element | null = parentElement;

      // 向上遍历找到包含完整句子的元素（段落、列表项等）
      while (
        contextElement &&
        !['P', 'LI', 'DIV', 'TD', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(
          contextElement.tagName,
        )
      ) {
        contextElement = contextElement.parentElement;
      }

      const contextText = contextElement
        ? contextElement.textContent?.trim()
        : parentElement.textContent?.trim();

      // 限制上下文长度，避免过长
      if (contextText && contextText.length > 500) {
        return contextText.substring(0, 500) + '...';
      }

      return contextText || '';
    } catch (error) {
      logger.warn('Failed to get context sentence', error as Error);
      return '';
    }
  }

  /**
   * 提取点击位置所在的完整句子
   * 策略：从点击位置向前后扩展，找到最近的句子边界
   */
  private extractClickedSentence(clientX: number, clientY: number): string {
    try {
      const range = document.caretRangeFromPoint(clientX, clientY);
      if (!range || !range.startContainer) return '';

      // 获取点击位置的文本节点
      let textNode = range.startContainer;

      // 如果不是文本节点，尝试获取其文本子节点
      if (textNode.nodeType !== Node.TEXT_NODE) {
        const walker = document.createTreeWalker(textNode, NodeFilter.SHOW_TEXT, null);
        textNode = walker.nextNode() || textNode;
      }

      if (!textNode.textContent) return '';

      // 获取父元素
      const parentElement = textNode.parentElement;
      if (!parentElement) return textNode.textContent.trim();

      // 向上查找段落级别的元素
      let contextElement: Element | null = parentElement;
      while (
        contextElement &&
        ![
          'P',
          'LI',
          'DIV',
          'TD',
          'H1',
          'H2',
          'H3',
          'H4',
          'H5',
          'H6',
          'ARTICLE',
          'SECTION',
        ].includes(contextElement.tagName)
      ) {
        contextElement = contextElement.parentElement;
      }

      const fullText = contextElement
        ? contextElement.textContent?.trim() || ''
        : parentElement.textContent?.trim() || '';

      if (!fullText) return '';

      // 计算点击位置在完整文本中的准确位置
      let clickPosition = 0;

      // 使用 TreeWalker 遍历所有文本节点来准确定位
      const container = contextElement || parentElement;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);

      let currentNode;
      let found = false;
      while ((currentNode = walker.nextNode())) {
        if (currentNode === textNode) {
          clickPosition += range.startOffset;
          found = true;
          break;
        } else {
          clickPosition += currentNode.textContent?.length || 0;
        }
      }

      // 如果没找到精确位置，使用简单方法
      if (!found) {
        const beforeClickText = textNode.textContent.substring(0, range.startOffset);
        clickPosition = fullText.indexOf(beforeClickText) + beforeClickText.length;
      }

      logger.debug('Click position calculated', {
        clickPosition,
        fullTextLength: fullText.length,
        percentage: Math.round((clickPosition / fullText.length) * 100) + '%',
      });

      // 从点击位置向前查找句子开始
      let sentenceStart = 0;
      for (let i = clickPosition - 1; i >= 0; i--) {
        const char = fullText[i];
        // 找到句子结束符
        if (char === '.' || char === '!' || char === '?') {
          // 检查是否是真正的句子结束（后面跟空格或开头）
          if (i === fullText.length - 1 || /\s/.test(fullText[i + 1])) {
            // 检查是否是缩写
            const before = fullText.substring(Math.max(0, i - 4), i + 1).toLowerCase();
            if (!before.match(/\b(mr|mrs|ms|dr|prof|sr|jr|st|ave|etc|inc|ltd|vs)\./)) {
              sentenceStart = i + 1;
              break;
            }
          }
        }
      }

      // 从点击位置向后查找句子结束
      let sentenceEnd = fullText.length;
      for (let i = clickPosition; i < fullText.length; i++) {
        const char = fullText[i];
        // 找到句子结束符
        if (char === '.' || char === '!' || char === '?') {
          // 检查是否是真正的句子结束（后面跟空格、换行或结尾）
          if (i === fullText.length - 1 || /\s/.test(fullText[i + 1])) {
            // 检查是否是缩写
            const before = fullText.substring(Math.max(0, i - 4), i + 1).toLowerCase();
            if (!before.match(/\b(mr|mrs|ms|dr|prof|sr|jr|st|ave|etc|inc|ltd|vs)\./)) {
              sentenceEnd = i + 1;
              break;
            }
          }
        }
      }

      // 提取句子
      let sentence = fullText.substring(sentenceStart, sentenceEnd).trim();

      // 限制句子长度
      if (sentence.length > 300) {
        sentence = sentence.substring(0, 300);
      }

      logger.debug('Extracted sentence', {
        sentenceStart,
        sentenceEnd,
        sentenceLength: sentence.length,
        preview: sentence.substring(0, 50) + '...',
      });

      return sentence;
    } catch (error) {
      logger.warn('Failed to extract clicked sentence', error as Error);
      return '';
    }
  }

  /**
   * 获取单词详细信息
   */
  private getWordDetails(
    word: string,
    lemmas: string[],
    familyRoot: string | undefined,
    x: number,
    y: number,
    context?: string,
    status?: WordFamiliarityStatus,
    familiarityLevel?: number,
  ): void {
    // 查释义时优先使用词根，以提高命中率
    // 1. 优先使用 familyRoot（来自词族系统，最准确）
    // 2. 其次使用 lemmas[0]（通过 compromise 词元化得到）
    // 3. 最后使用原词
    const queryWord = familyRoot || (lemmas.length > 0 ? lemmas[0] : word);

    logger.info(
      `🔍 查询词典: "${word}" -> "${queryWord}" (familyRoot: ${familyRoot}, lemmas: [${lemmas.join(
        ', ',
      )}])`,
    );

    const message: ChromeMessage = {
      type: 'GET_INTERNAL_DEFINITION',
      word: queryWord, // 使用词根查询
    };

    chrome.runtime.sendMessage(message, (response: ChromeMessageResponse) => {
      if (chrome.runtime.lastError) {
        logger.error(
          'Failed to get word details: ' + chrome.runtime.lastError.message,
          new Error(chrome.runtime.lastError.message),
        );
        return;
      }

      if (response && response.success && response.data) {
        // 显示单词卡片，把 lemmas、familyRoot、context 和 status 也传过去
        this.wordCardManager.showWordCard(
          word,
          lemmas, // 传 lemmas
          familyRoot, // 传 familyRoot
          response.data as WordDetails,
          x,
          y,
          context, // 传递上下文
          status, // 传递当前状态
          familiarityLevel, // 传递熟练度
        );
      } else {
        logger.error('Failed to get word details: ' + response?.error, new Error(response?.error));
      }
    });
  }

  /**
   * 获取句子翻译
   */
  private async getSentenceTranslation(
    paragraph: string,
    sentence: string,
    x: number,
    y: number,
  ): Promise<void> {
    // 验证输入
    if (!paragraph || paragraph.length < 5) {
      logger.warn('Paragraph too short for translation');
      return;
    }

    logger.info('Requesting sentence translation', {
      paragraph: paragraph.substring(0, 50),
      sentence: sentence.substring(0, 50),
    });

    // 显示 loading 指示器
    this.wordCardManager.showLoadingIndicator(x, y);

    try {
      // 获取配置
      const result = await chrome.storage?.sync.get(['sentenceAnalysisMode']);
      const sentenceAnalysisMode = result?.sentenceAnalysisMode || 'smart';

      logger.info(`Sentence analysis mode: ${sentenceAnalysisMode}`);

      // 使用流式翻译，直接传递模式到后端，让 AI 判断
      const message: ChromeMessage = {
        type: 'TRANSLATE_SENTENCE_STREAM',
        context: paragraph, // 段落用于翻译
        sentence: sentence, // 完整句子用于分析
        sentenceAnalysisMode: sentenceAnalysisMode,
      };

      // 先显示流式卡片
      this.wordCardManager.showTranslationCard(
        paragraph,
        sentence,
        undefined, // 没有初始翻译
        undefined, // 没有初始分析
        x,
        y,
        true, // 开启流式模式
      );

      chrome.runtime.sendMessage(message, (response: ChromeMessageResponse) => {
        if (chrome.runtime.lastError || !response?.success) {
          const errorMsg = response?.error || chrome.runtime.lastError?.message || 'Unknown error';
          logger.warn('Translation stream failed: ' + errorMsg);
          return;
        }

        // 记录翻译操作
        this.logStudyAction('SENTENCE_TRANSLATION', {
          paragraph: paragraph.substring(0, 50),
          sentence: sentence.substring(0, 50),
          analysisMode: sentenceAnalysisMode,
        });
      });
    } catch (error) {
      logger.error('Failed to get sentence translation', error as Error);
      // 移除 loading 指示器
      this.wordCardManager.removeLoadingIndicator();
    }
  }

  /**
   * Promise化的消息发送辅助方法
   */
  private sendMessageAsync(message: ChromeMessage): Promise<ChromeMessageResponse> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response: ChromeMessageResponse) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (response && response.success) {
          resolve(response);
        } else {
          reject(new Error(response?.error || 'Unknown error'));
        }
      });
    });
  }

  /**
   * 尝试为一个单词动态添加高亮，如果它不在高亮注册表中
   * 这在用户点击一个known状态的单词（初始不会被高亮）并改为学习状态时特别有用
   */
  private async tryAddDynamicHighlight(
    lemma: string,
    status: WordFamiliarityStatus,
    familiarityLevel: number = 0,
    familyRoot?: string,
  ): Promise<void> {
    logger.info(`🔄 尝试为词元 "${lemma}" 动态添加高亮，状态: ${status}`);

    // 搜索页面上的文本节点，查找匹配的单词
    const allTextNodes: Text[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node: Text) => {
        // 只接受包含目标单词的文本节点
        if (
          node.parentElement &&
          TextProcessor.isElementVisible(node.parentElement) &&
          node.textContent &&
          node.textContent.toLowerCase().includes(lemma.toLowerCase())
        ) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_REJECT;
      },
    } as NodeFilter);

    let node;
    while ((node = walker.nextNode())) {
      allTextNodes.push(node as Text);
    }

    logger.info(`🔍 在页面上找到 ${allTextNodes.length} 个可能包含 "${lemma}" 的文本节点`);

    // 遍历每个文本节点，查找匹配的单词
    for (const textNode of allTextNodes) {
      const text = textNode.textContent || '';
      const wordRegex = new RegExp(`\\b${lemma}\\b`, 'gi'); // 使用全局不区分大小写的匹配
      let match;

      while ((match = wordRegex.exec(text)) !== null) {
        const matchedWord = match[0];
        const startIndex = match.index;
        const endIndex = startIndex + matchedWord.length;

        // 创建 Range 对象
        try {
          const range = document.createRange();
          range.setStart(textNode, startIndex);
          range.setEnd(textNode, endIndex);

          // 检查Range是否有效
          const rects = range.getClientRects();
          if (rects.length > 0 && rects[0].width > 0 && rects[0].height > 0) {
            logger.info(`✅ 找到 "${matchedWord}" 的位置，添加动态高亮`);

            // 使用高亮管理器的动态添加方法
            this.highlightManager.addDynamicHighlight(
              matchedWord.toLowerCase(),
              matchedWord,
              [lemma], // 词元列表
              status,
              familyRoot,
              familiarityLevel,
              range,
            );

            // 只添加第一个匹配项，避免重复
            return;
          }
        } catch (rangeError: unknown) {
          logger.warn(
            `⚠️ 无法为 "${matchedWord}" 创建 Range:`,
            rangeError instanceof Error ? rangeError : new Error(String(rangeError)),
          );
          continue;
        }
      }
    }

    logger.info(`❌ 未能为词元 "${lemma}" 动态创建高亮`);
  }

  /**
   * 销毁事件监听器
   */
  destroy(): void {
    document.body.removeEventListener('click', this.handleGlobalClick.bind(this), true);
    document.body.removeEventListener('mousedown', this.handleMouseDown.bind(this), true);
    document.body.removeEventListener('mousemove', this.handleGlobalMouseMove.bind(this));
    this.wordCardManager.destroy();
    this.highlightManager.destroy(); // 确保清理 HighlightManager 的事件监听器
  }
}
