import type { ChromeMessage, ChromeMessageResponse, DictionaryWhitelistResponse } from 'shared-types';
import { logger } from '../../utils/logger';

export interface DictionaryLoadResult {
  ok: boolean;
  error?: string;
}

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
  private loading: Promise<DictionaryLoadResult> | null = null;
  private lastLoadResult: DictionaryLoadResult | null = null;

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
   * 初始化词典（异步加载）。返回值由调用方决定要不要弹 toast。
   */
  async initialize(): Promise<DictionaryLoadResult> {
    if (this.loading) {
      return this.loading;
    }

    this.loading = this.loadDictionary();
    this.lastLoadResult = await this.loading;
    return this.lastLoadResult;
  }

  /**
   * 加载白名单。**不再读 chrome.runtime.getURL('dictionary.json')**——
   * 数据从背景脚本的 DictionaryMirror 拿，背景再向后端 sync。失败不再
   * 静默降级到空 Set（那会让所有词都过不了白名单 / 高亮全静默关闭），
   * 而是把 ok=false 抛回给调用方，由 content.ts 弹 toast 让用户看见。
   */
  private async loadDictionary(): Promise<DictionaryLoadResult> {
    logger.info('📖 通过 background 加载词典白名单...');
    const startTime = performance.now();

    const result = await new Promise<DictionaryWhitelistResponse | null>((resolve) => {
      const message: ChromeMessage = { type: 'GET_DICTIONARY_WHITELIST' };
      try {
        chrome.runtime.sendMessage(message, (response: ChromeMessageResponse) => {
          if (chrome.runtime.lastError) {
            logger.error(
              'GET_DICTIONARY_WHITELIST runtime 错误',
              new Error(chrome.runtime.lastError.message),
            );
            resolve(null);
            return;
          }
          resolve((response?.data as DictionaryWhitelistResponse | undefined) ?? null);
        });
      } catch (err) {
        logger.error('GET_DICTIONARY_WHITELIST 发送失败', err as Error);
        resolve(null);
      }
    });

    if (!result || !result.ok || !result.words) {
      this.dictionarySet = null;
      const errorMsg = result?.error ?? '无法连接服务器获取词典白名单';
      logger.error('词典白名单加载失败', new Error(errorMsg));
      return { ok: false, error: errorMsg };
    }

    this.dictionarySet = new Set(result.words.map((word) => word.toLowerCase()));
    await this.loadIgnoredWords();

    const endTime = performance.now();
    logger.info('📖 词典白名单加载完成', {
      durationMs: Number((endTime - startTime).toFixed(2)),
      wordCount: this.dictionarySet.size,
      ignoredCount: this.ignoredWords.size,
      version: result.version,
      syncedAt: result.syncedAt,
    });

    return { ok: true };
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
   * 检查一个词是否在白名单词典中。
   *
   * 词典未加载（initialize 失败 / 还没跑完）时返回 false ——
   * 不再做"全词放行"的隐式降级。白名单缺失时高亮全停，
   * 由调用方根据 initialize() 的返回结果显式弹 toast。
   */
  isValidWord(word: string): boolean {
    if (!this.dictionarySet) {
      return false;
    }

    const wordLower = word.toLowerCase();

    // 如果词汇在忽略列表中，直接返回false
    if (this.ignoredWords.has(wordLower)) {
      return false;
    }

    // 检查是否在白名单词典中
    return this.dictionarySet.has(wordLower);
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
