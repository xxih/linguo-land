import nlp from 'compromise';
import { DictionaryLoader } from './dictionaryLoader';
import { WORD_CARD_HOST } from '../../const';
import { Logger } from '../../utils/logger';

/**
 * 文本处理工具类
 * 负责文本节点提取、单词收集和分词处理
 */
export class TextProcessor {
  private static readonly MIN_WORD_LENGTH = 2;
  private static readonly logger = new Logger('TextProcessor');

  /**
   * 检查元素是否可见
   */
  static isElementVisible(element: Element): boolean {
    let current: Element | null = element;

    while (current && current !== document.body) {
      const style = window.getComputedStyle(current);

      // 检查常见的隐藏样式
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0' ||
        // 很奇怪，不知道为什么，youtube 字幕的 parent 计算高度是 0px，但是实际上是可见的
        // style.height === '0px' ||
        style.width === '0px' ||
        style.maxHeight === '0px' ||
        style.maxWidth === '0px'
      ) {
        return false;
      }

      // 检查是否有 hidden 属性
      if (current.hasAttribute('hidden')) {
        return false;
      }

      // 检查下拉框等特殊情况
      if (current.tagName === 'OPTION' && current.parentElement) {
        const select = current.parentElement as HTMLSelectElement;
        if (select.tagName === 'SELECT' && !select.matches(':focus')) {
          this.logger.debug('rejectedNodes 5', current);
          return false;
        }
      }

      // 检查弹出框、菜单等
      if (
        current.classList.contains('dropdown-menu') ||
        current.classList.contains('popover') ||
        current.classList.contains('tooltip') ||
        current.classList.contains('menu') ||
        (current.hasAttribute('aria-hidden') && current.getAttribute('aria-hidden') === 'true')
      ) {
        return false;
      }

      current = current.parentElement;
    }

    // 检查元素是否有实际的边界框
    const rect = element.getBoundingClientRect();
    this.logger.debug('isElementVisible', element);
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * 提取所有有效的文本节点
   */
  static extractTextNodes(rootEl: HTMLElement): Text[] {
    this.logger.debug('Starting text node extraction');
    const startTime = performance.now();

    let totalNodes = 0;
    let rejectedNodes = 0;
    let acceptedNodes = 0;

    const treeWalker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        totalNodes++;

        // 过滤掉 script, style, textarea 等标签内的文本，以及纯空白文本
        if (node.parentElement?.closest('script,style,noscript') || !node.textContent?.trim()) {
          rejectedNodes++;
          this.logger.debug('chaxi rejectedNodes 1', node);
          return NodeFilter.FILTER_REJECT;
        }

        // 过滤掉我们的弹窗相关元素
        if (node.parentElement?.closest(`#${WORD_CARD_HOST}`)) {
          rejectedNodes++;
          return NodeFilter.FILTER_REJECT;
        }

        // 检查父元素是否可见
        if (node.parentElement && !this.isElementVisible(node.parentElement)) {
          rejectedNodes++;
          this.logger.debug('rejectedNodes 2', node);
          return NodeFilter.FILTER_REJECT;
        }

        acceptedNodes++;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const nodes: Text[] = [];
    while (treeWalker.nextNode()) {
      nodes.push(treeWalker.currentNode as Text);
    }

    const endTime = performance.now();
    const duration = endTime - startTime;

    this.logger.debug('Text node extraction completed', {
      duration: `${duration.toFixed(2)}ms`,
      totalChecked: totalNodes,
      accepted: acceptedNodes,
      rejected: rejectedNodes,
      finalCollected: nodes.length,
    });

    return nodes;
  }

  /**
   * 清理单词，移除标点符号和处理所有格
   */
  private static cleanWord(word: string): string {
    // 移除开头和结尾的标点符号，但保留内部的撇号（如 don't, it's）
    let cleaned = word.replace(/^[^\w']+|[^\w']+$/g, '');

    // 处理所有格形式：将 "word's" 转换为 "word"
    cleaned = cleaned.replace(/'s$/i, '');

    // 只移除单独的撇号，但保留合法的缩写如 don't, can't, won't
    cleaned = cleaned.replace(/'$/g, '');

    return cleaned;
  }

  /**
   * 专业分词函数，融合了正则表达式的准确性和 `split-case` 的健壮性。
   * - 正确处理 LLMs, MLPs 等缩写词。
   * - 完全支持 Unicode 字符 (例如: `motÉtat`)。
   * - 能够保留并忽略前后缀特殊字符 (例如: `_myVariable_`)。
   * - 对于编程字符串和特殊缩写（如 toISOString、MaaS），不进行拆分。
   *
   * @param word The string to split.
   * @returns An array of word parts with their positions.
   */
  static splitCamelCase(word: string): { word: string; start: number; end: number }[] {
    if (!word) {
      return [];
    }

    try {
      // 1. 借鉴 `split-case` 的思想，分离前后缀
      let prefixIndex = 0;
      while (prefixIndex < word.length && '_-'.includes(word[prefixIndex])) {
        prefixIndex++;
      }

      let suffixIndex = word.length;
      while (suffixIndex > prefixIndex && '_-'.includes(word[suffixIndex - 1])) {
        suffixIndex--;
      }

      const coreWord = word.slice(prefixIndex, suffixIndex);
      if (!coreWord) {
        // 如果核心部分为空 (例如，输入是 "___")，返回原词
        return [{ word: word, start: 0, end: word.length }];
      }

      // 2. 检查是否是技术术语（驼峰命名或大小写混合）
      // 正常英语单词：首字母大写、全大写、全小写、带连字符
      // 技术术语特征：
      // - 小写字母后跟大写字母（如 userName, toISOString, iOS）
      // - 两个大写字母后跟小写字母（如 DWUri 中的 WUr, XMLHttpRequest 中的 LHt）
      if (/[a-z][A-Z]/.test(coreWord) || /[A-Z]{2}[a-z]/.test(coreWord)) {
        this.logger.debug('Detected technical term, not splitting', {
          word: word,
        });
        return [{ word: word, start: 0, end: word.length }];
      }

      // 3. 使用强大的 Unicode 正则表达式在核心部分进行分词
      // \p{Lu}{2,}(?!s\p{Ll})s?: 匹配缩写词 (如 LLMs, HTTP, API)
      // \p{Lu}?\p{Ll}+: 匹配标准单词 (如 Case, case, État)
      // \p{Lu}: 匹配单个大写字母 (后备)
      // \d+: 匹配数字序列
      const regex = /\p{Lu}{2,}(?!s\p{Ll})s?|\p{Lu}?\p{Ll}+|\p{Lu}|\d+/gu;
      const result: { word: string; start: number; end: number }[] = [];
      let match: RegExpExecArray | null;

      while ((match = regex.exec(coreWord)) !== null) {
        const matchedWord = match[0];

        result.push({
          word: matchedWord,
          // 关键：将匹配的索引用前缀长度进行偏移，得到在原始字符串中的正确位置
          start: match.index + prefixIndex,
          end: match.index + prefixIndex + matchedWord.length,
        });
      }

      if (result.length === 0) {
        return [{ word: word, start: 0, end: word.length }];
      }

      this.logger.debug('Final word splitting result', {
        originalWord: word,
        parts: result.map((p) => p.word).join(' + '),
      });

      return result;
    } catch (error) {
      this.logger.error('Error during professional word splitting', error as Error, { word });
      return [{ word: word, start: 0, end: word.length }];
    }
  }

  /**
   * 【核心重构方法】
   * 使用 compromise 获取单词的所有可能词元
   */
  private static getLemmasForWord(word: string): string[] {
    const doc = nlp(word);
    const lemmas = new Set<string>();

    // 1. 获取基本词元
    const root = doc.verbs().toInfinitive().text() || doc.nouns().toSingular().text();
    if (root) {
      lemmas.add(root.toLowerCase());
    }

    // 2. 处理形容词/副词 (例如 'frequently' -> 'frequent')
    if (doc.has('#Adverb')) {
      const wordLower = word.toLowerCase();

      // 特殊副词到形容词的映射表
      const specialMappings: { [key: string]: string } = {
        // 类别一: -ily => -y
        happily: 'happy',
        easily: 'easy',
        busily: 'busy',
        heavily: 'heavy',
        angrily: 'angry',
        readily: 'ready',
        steadily: 'steady',
        luckily: 'lucky',
        prettily: 'pretty',
        lazily: 'lazy',
        greedily: 'greedy',
        noisily: 'noisy',
        clumsily: 'clumsy',
        nastily: 'nasty',
        heartily: 'hearty',
        drowsily: 'drowsy',
        gloomily: 'gloomy',
        hastily: 'hasty',
        merrily: 'merry',
        paltry: 'paltry',
        chillily: 'chilly',
        sillily: 'silly',
        jollily: 'jolly', // 新增
        wilily: 'wily',
        craftily: 'crafty',
        surlily: 'surly', // 新增

        // 类别二: -ly => -le
        simply: 'simple',
        gently: 'gentle',
        subtly: 'subtle',
        ably: 'able',
        horribly: 'horrible',
        terribly: 'terrible',
        incredibly: 'incredible',
        possibly: 'possible',
        probably: 'probable',
        visibly: 'visible',
        invisibly: 'invisible',
        sensibly: 'sensible',
        nobly: 'noble',
        humbly: 'humble',
        idly: 'idle',
        considerably: 'considerable',
        responsibly: 'responsible',
        fashionably: 'fashionable',
        comfortably: 'comfortable',
        admirably: 'admirable',
        miserably: 'miserable',
        remarkably: 'remarkable',
        reasonably: 'reasonable',
        doubly: 'double',
        trebly: 'treble',
        capably: 'capable',
        singly: 'single',
        amply: 'ample',
        feebly: 'feeble',
        supply: 'supple', // 新增

        // 类别三: -ally => -ic(al)
        basically: 'basic',
        dramatically: 'dramatic',
        tragically: 'tragic',
        fantastically: 'fantastic',
        automatically: 'automatic',
        scientifically: 'scientific',
        specifically: 'specific',
        historically: 'historical',
        economically: 'economic',
        academically: 'academic',
        artistically: 'artistic',
        energetically: 'energetic',
        enthusiastically: 'enthusiastic',
        frantically: 'frantic',
        generically: 'generic',
        logically: 'logical',
        magically: 'magical',
        organically: 'organic',
        poetically: 'poetic',
        realistically: 'realistic',
        strategically: 'strategic',
        symbolically: 'symbolic',
        systematically: 'systematic',
        theatrically: 'theatrical',
        diagonally: 'diagonal', // 新增 (-ally => -al)
        peripherally: 'peripheral', // 新增 (-ally => -al)
        // 特殊例外
        publicly: 'public',
        specially: 'special', // 不是 -ally 规则，但常混淆

        // 类别四: 还原词尾的 "e"
        truly: 'true',
        duly: 'due',
        unduly: 'undue',
        wholly: 'whole',
        arguably: 'arguable',
        solely: 'sole', // 新增

        // 类别五: -lly => -ll
        fully: 'full',
        dully: 'dull',
        shrilly: 'shrill',

        // 类别六: 完全不规则变形
        well: 'good',

        // 类别九: 源自过去分词 (-edly => -ed) (新增类别)
        allegedly: 'alleged',
        reportedly: 'reported',
        supposedly: 'supposed',
        assuredly: 'assured',
        markedly: 'marked',
        undoubtedly: 'undoubted',
        deservedly: 'deserved',
        repeatedly: 'repeated',
        decidedly: 'decided',
        hurriedly: 'hurried',
        confessedly: 'confessed',

        // 类别十 & 混合情况
        drily: 'dry',
        shyly: 'shy',
        coyly: 'coy',
        slyly: 'sly',
        wryly: 'wry',
        inwardly: 'inward',
        outwardly: 'outward',
        upwardly: 'upward',
        downwardly: 'downward', // *-wardly => *-ward
      };

      // 首先检查特殊映射
      if (specialMappings[wordLower]) {
        const adjective = specialMappings[wordLower];
        // 验证这个形容词是否被 compromise 识别
        const adjDoc = nlp(adjective);
        if (adjDoc.has('#Adjective')) {
          lemmas.add(adjective);
        }
      }
      // 对于以 -ly 结尾的副词，尝试移除后缀
      else if (wordLower.endsWith('ly') && wordLower.length > 4) {
        const potentialAdjective = wordLower.slice(0, -2);
        // 使用 compromise 验证移除 -ly 后是否是有效的形容词
        const adjDoc = nlp(potentialAdjective);
        if (adjDoc.has('#Adjective')) {
          lemmas.add(potentialAdjective);
          this.logger.debug('Adverb to adjective conversion', {
            adverb: wordLower,
            adjective: potentialAdjective,
          });
        }
      }
    }

    // 3. 处理形容词的基本形式
    const adjRoot = doc.adjectives().json();
    if (adjRoot.length > 0) {
      lemmas.add(adjRoot[0].text.toLowerCase());
    }

    // 4. 添加原始词的小写形式作为后备
    if (lemmas.size === 0) {
      lemmas.add(word.toLowerCase());
    }

    this.logger.debug('Word lemmatization result', {
      originalWord: word,
      lemmas: Array.from(lemmas),
    });
    return Array.from(lemmas);
  }

  /**
   * 【核心重构方法】带白名单过滤
   * 从文本节点中收集所有单词，并进行词元化
   * 只返回通过白名单验证的合法词汇
   */
  static collectWordsFromNodes(
    nodes: Text[],
    dictionaryLoader: DictionaryLoader,
  ): {
    lemmasToQuery: string[]; // 只包含合法词的词元
    wordToLemmaMap: Map<string, string[]>; // 原始词 -> 词元列表
  } {
    this.logger.debug('Starting word collection and lemmatization', {
      nodeCount: nodes.length,
    });
    const startTime = performance.now();

    const wordToLemmaMap = new Map<string, string[]>();
    const uniqueLegitLemmas = new Set<string>(); // 只包含合法词的词元

    let totalWords = 0;
    let whitelistRejected = 0;
    let ignoredWords = 0;
    let acceptedWords = 0;

    // 将所有文本节点内容合并成一个大字符串，用换行符分隔以保持句子边界
    const fullText = nodes
      .map((node, nodeIndex) => {
        // 这个可能是个句子，把这个句子中的 camelCase 的单词分解成多个单词

        const text = node.textContent;
        if (!text) return;

        // 使用正则表达式查找所有单词
        const wordRegex = /\b[a-zA-Z'’]+\b/g;
        let match: RegExpExecArray | null;
        let matchCount = 0;

        while ((match = wordRegex.exec(text)) !== null) {
          if (dictionaryLoader.isAbbreviationFilterWord(match[0])) {
            ignoredWords++;
            this.logger.debug('Abbreviation filter word skipped', {
              originalWord: match[0],
            });
            continue;
          }
          matchCount++;

          if (matchCount > 1000) {
            this.logger.warn('Node contains too many words, possible issue', {
              nodeIndex,
              matchCount,
            });
            break;
          }

          const originalWord = match[0];
          // 再次检查父元素是否可见（防止动态变化）
          if (node.parentElement && !TextProcessor.isElementVisible(node.parentElement)) {
            continue;
          }

          // 检查是否是驼峰命名并进行分词处理
          const camelParts = TextProcessor.splitCamelCase(originalWord).map((p) => p.word);

          // 如果有多个部分，说明是驼峰命名
          if (camelParts.length > 1) {
            return camelParts.join(' ');
          }
        }
        return node.textContent || '';
      })
      .join('\n');
    const doc = nlp(fullText);

    // 使用 compromise 的 .terms() 方法获取所有单词（token）
    doc.terms().forEach((term) => {
      const rawWord = term.text('clean');
      totalWords++;

      // 清理单词：移除标点符号，处理所有格等
      const cleanedWord = this.cleanWord(rawWord);

      // 过滤掉太短的词或纯数字，或者清理后为空的词
      if (!cleanedWord || cleanedWord.length < this.MIN_WORD_LENGTH || /^\d+$/.test(cleanedWord)) {
        return;
      }

      const wordLower = cleanedWord.toLowerCase();
      if (wordToLemmaMap.has(wordLower)) {
        this.logger.debug('Duplicate word skipped', {
          originalWord: rawWord,
          cleanedWord,
        });
        return; // 已经处理过，跳过
      }

      // 立即标记为处理中，防止 nlp 返回的多个版本造成重复处理
      wordToLemmaMap.set(wordLower, []);

      // 🚪 第一道门卫：忽略列表检查
      if (dictionaryLoader.isIgnoredWord(wordLower)) {
        ignoredWords++;
        this.logger.debug('Ignored word skipped', {
          originalWord: rawWord,
          cleanedWord,
        });
        return;
      }

      // 处理驼峰命名或普通单词
      const camelParts = this.splitCamelCase(cleanedWord).map((p) => p.word);
      if (camelParts.length > 1) {
        // 驼峰命名处理
        this.logger.debug('Processing camelCase word', { originalWord: rawWord });

        const allPartLemmas = new Set<string>();
        let validPartsCount = 0;

        camelParts.forEach((part) => {
          const cleanedPart = this.cleanWord(part);
          if (!cleanedPart || cleanedPart.length < this.MIN_WORD_LENGTH) {
            return; // 跳过太短的部分
          }

          const partLower = cleanedPart.toLowerCase();

          // 🚪 忽略列表检查
          if (dictionaryLoader.isIgnoredWord(partLower)) {
            return; // 跳过这个部分
          }

          // 🚪 先进行词元化，然后用词元做白名单检查
          const partLemmas = this.getLemmasForWord(cleanedPart);

          // 检查任一词元是否在白名单中
          const hasValidLemma = partLemmas.some((lemma) => dictionaryLoader.isValidWord(lemma));
          if (!hasValidLemma) {
            this.logger.debug('Whitelist rejected camelCase part', {
              cleanedPart,
              partLemmas,
            });
            return; // 跳过这个部分
          }

          validPartsCount++;
          if (!wordToLemmaMap.has(partLower)) {
            wordToLemmaMap.set(partLower, partLemmas);
            partLemmas.forEach((lemma) => {
              uniqueLegitLemmas.add(lemma);
              allPartLemmas.add(lemma);
            });
          } else {
            wordToLemmaMap.get(partLower)?.forEach((lemma) => allPartLemmas.add(lemma));
          }
        });

        // 只有当至少有一个部分是合法的时候，才记录这个驼峰词
        if (validPartsCount > 0) {
          wordToLemmaMap.set(wordLower, Array.from(allPartLemmas));
          acceptedWords++;
        }
      } else {
        // 普通单词处理
        // 🚪 先进行词元化，然后用词元做白名单检查
        const lemmas = this.getLemmasForWord(cleanedWord);

        // 检查任一词元是否在白名单中
        const hasValidLemma = lemmas.some((lemma) => dictionaryLoader.isValidWord(lemma));
        if (!hasValidLemma) {
          whitelistRejected++;
          this.logger.debug('Whitelist rejected word', {
            originalWord: rawWord,
            cleanedWord,
            lemmas,
          });
          return;
        }

        wordToLemmaMap.set(wordLower, lemmas);
        lemmas.forEach((lemma) => uniqueLegitLemmas.add(lemma));
        acceptedWords++;
      }
    });

    const endTime = performance.now();
    this.logger.debug('Word collection and lemmatization completed (with whitelist filtering)', {
      duration: `${(endTime - startTime).toFixed(2)}ms`,
      totalScanned: totalWords,
      accepted: acceptedWords,
      whitelistRejected,
      ignored: ignoredWords,
      validLemmas: uniqueLegitLemmas.size,
    });

    return {
      lemmasToQuery: Array.from(uniqueLegitLemmas),
      wordToLemmaMap,
    };
  }
}
