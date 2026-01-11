import { logger } from '../../utils/logger';

const ABBREVIATION_FILTER_WORDS = [
  // --- 否定形式 (Not) ---
  "aren't",
  "can't",
  "couldn't",
  "didn't",
  "doesn't",
  "don't",
  "hadn't",
  "hasn't",
  "haven't",
  "isn't",
  "mustn't",
  "needn't",
  "shan't",
  "shouldn't",
  "wasn't",
  "weren't",
  "won't",
  "wouldn't",

  // --- "is" / "has" / "us" ---
  "he's",
  "here's",
  "how's",
  "it's",
  "she's",
  "that's",
  "there's",
  "what's",
  "when's",
  "where's",
  "who's",
  "why's",

  // --- "will" ---
  "he'll",
  "i'll",
  "it'll",
  "she'll",
  "that'll",
  "there'll",
  "they'll",
  "we'll",
  "who'll",
  "you'll",

  // --- "would" / "had" ---
  "he'd",
  "i'd",
  "it'd",
  "she'd",
  "that'd",
  "there'd",
  "they'd",
  "we'd",
  "who'd",
  "you'd",

  // --- "are" ---
  "they're",
  "we're",
  "you're",

  // --- "have" ---
  "i've",
  "they've",
  "we've",
  "you've",

  // --- "am" ---
  "i'm",
];
/**
 * 词典加载器
 * 负责加载白名单词典并提供词汇验证功能
 */
export class DictionaryLoader {
  private static instance: DictionaryLoader | null = null;
  private dictionarySet: Set<string> | null = null;
  private ignoredWords: Set<string> = new Set();
  private loading: Promise<void> | null = null;

  // 添加要过滤的缩写词列表
  private static readonly ABBREVIATION_FILTER_WORDS = new Set([
    ...ABBREVIATION_FILTER_WORDS,
    ...ABBREVIATION_FILTER_WORDS.map((word) => word.replace("'", '’')),
  ]);

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): DictionaryLoader {
    if (!DictionaryLoader.instance) {
      DictionaryLoader.instance = new DictionaryLoader();
    }
    return DictionaryLoader.instance;
  }

  /**
   * 初始化词典（异步加载）
   */
  async initialize(): Promise<void> {
    if (this.loading) {
      return this.loading;
    }

    this.loading = this.loadDictionary();
    return this.loading;
  }

  /**
   * 加载词典文件
   */
  private async loadDictionary(): Promise<void> {
    try {
      logger.info('📖 开始加载词典文件...');
      const startTime = performance.now();

      // 从extension的public目录加载词典
      const response = await fetch(chrome.runtime.getURL('dictionary.json'));
      if (!response.ok) {
        throw new Error(`Failed to load dictionary: ${response.status}`);
      }

      const words: string[] = await response.json();

      // 转换为Set以提高查询效率
      this.dictionarySet = new Set(words.map((word) => word.toLowerCase()));

      // 同时加载用户的忽略列表
      await this.loadIgnoredWords();

      const endTime = performance.now();
      logger.info(`📖 词典加载完成:`);
      logger.info(`  ⏱️  用时: ${(endTime - startTime).toFixed(2)}ms`);
      logger.info(`  📝 词汇数量: ${this.dictionarySet.size}`);
      logger.info(`  🚫 忽略词汇: ${this.ignoredWords.size}`);
    } catch (error) {
      logger.error('词典加载失败', error as Error);
      // 如果加载失败，创建一个空的Set作为降级方案
      this.dictionarySet = new Set();
    }
  }

  /**
   * 从chrome.storage加载用户的忽略列表
   */
  private async loadIgnoredWords(): Promise<void> {
    try {
      const result = await chrome.storage.sync.get(['ignoredWords']);
      const ignoredWordsArray: string[] = result.ignoredWords || [];
      this.ignoredWords = new Set(ignoredWordsArray.map((word) => word.toLowerCase()));
    } catch (error) {
      logger.error('加载忽略列表失败', error as Error);
      this.ignoredWords = new Set();
    }
  }

  /**
   * 检查一个词是否在白名单词典中
   */
  isValidWord(word: string): boolean {
    if (!this.dictionarySet) {
      logger.warn('词典尚未加载，跳过白名单检查');
      return true; // 词典未加载时允许所有词汇通过
    }

    const wordLower = word.toLowerCase();

    // 如果词汇在忽略列表中，直接返回false
    if (this.ignoredWords.has(wordLower)) {
      return false;
    }

    // 检查是否在白名单词典中
    const isValid = this.dictionarySet.has(wordLower);

    return isValid;
  }

  /**
   * 检查一个词是否被用户忽略
   */
  isIgnoredWord(word: string): boolean {
    return this.ignoredWords.has(word.toLowerCase());
  }

  /**
   * 添加词汇到忽略列表
   */
  async addIgnoredWord(word: string): Promise<void> {
    const wordLower = word.toLowerCase();
    this.ignoredWords.add(wordLower);

    try {
      // 保存到chrome.storage
      const ignoredWordsArray = Array.from(this.ignoredWords);
      await chrome.storage.sync.set({ ignoredWords: ignoredWordsArray });
      logger.info(`🚫 已将 "${word}" 添加到忽略列表`);
    } catch (error) {
      logger.error('保存忽略列表失败', error as Error);
      // 如果保存失败，从内存中移除
      this.ignoredWords.delete(wordLower);
      throw error;
    }
  }

  /**
   * 从忽略列表移除词汇
   */
  async removeIgnoredWord(word: string): Promise<void> {
    const wordLower = word.toLowerCase();
    this.ignoredWords.delete(wordLower);

    try {
      // 保存到chrome.storage
      const ignoredWordsArray = Array.from(this.ignoredWords);
      await chrome.storage.sync.set({ ignoredWords: ignoredWordsArray });
      logger.info(`✅ 已将 "${word}" 从忽略列表中移除`);
    } catch (error) {
      logger.error('保存忽略列表失败', error as Error);
      // 如果保存失败，重新添加到内存中
      this.ignoredWords.add(wordLower);
      throw error;
    }
  }

  /**
   * 获取所有忽略的词汇
   */
  getIgnoredWords(): string[] {
    return Array.from(this.ignoredWords);
  }

  /**
   * 检查词典是否已加载
   */
  isDictionaryLoaded(): boolean {
    return this.dictionarySet !== null;
  }

  /**
   * 获取词典统计信息
   */
  getStats(): { dictionarySize: number; ignoredWordsCount: number } {
    return {
      dictionarySize: this.dictionarySet?.size || 0,
      ignoredWordsCount: this.ignoredWords.size,
    };
  }

  /**
   * 检查一个词是否为需要过滤的缩写词（如 don't, doesn't 等）
   */
  isAbbreviationFilterWord(word: string): boolean {
    return DictionaryLoader.ABBREVIATION_FILTER_WORDS.has(word.toLowerCase());
  }

  /**
   * 从存储中重新加载忽略列表（供外部调用）
   */
  async loadIgnoredWordsFromStorage(): Promise<void> {
    await this.loadIgnoredWords();
  }
}
