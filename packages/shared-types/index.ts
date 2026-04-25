// 定义单词的熟悉度状态
export type WordFamiliarityStatus = 'unknown' | 'learning' | 'known';

// 定义词族信息
export interface WordFamilyInfo {
  status: WordFamiliarityStatus;
  familyRoot: string; // 词族的根词
  familiarityLevel: number; // 熟练度 0-7
}

// 定义 /api/v1/vocabulary/query 的响应体类型（新版：基于词族）
export type WordQueryResponse = Record<string, WordFamilyInfo>;

// 定义 /api/v1/vocabulary/query 的请求体类型
export interface WordQueryRequest {
  words: string[];
}

// /api/v1/vocabulary/sync 全量同步——一次性返回当前用户拥有的所有词族 + 该词族下所有词形
export interface VocabularySyncFamily {
  familyRoot: string;
  lemmas: string[]; // 词族下所有 word 形态（含词根本身）
  status: WordFamiliarityStatus;
  familiarityLevel: number;
}

export interface VocabularySyncResponse {
  syncedAt: string; // ISO 8601 时间戳，扩展端可用于判断陈旧
  families: VocabularySyncFamily[];
}

// 定义 /api/v1/vocabulary/:word 的请求体类型
export interface WordUpdateRequest {
  status?: WordFamiliarityStatus; // 改为可选，支持只更新熟练度
  familiarityLevel?: number;
  userId?: string;
}

// 写入接口（PUT /vocabulary/:word, POST /vocabulary/:word/increase-familiarity）的响应。
// 写成功后告知扩展端如何更新本地 mirror：要么 upsert family，要么 remove 整个 family。
export interface WordMutationResponse {
  success: boolean;
  message: string;
  family?: VocabularySyncFamily; // 写入或更新——upsert 到镜像
  removedFamilyRoot?: string;    // 状态被设为 unknown / 词族被移出用户词库——按 root 删
  // family 与 removedFamilyRoot 互斥；都缺省表示 lemma 不在系统词表 / no-op
}

// --- 新的词典数据类型 ---

export interface Sense {
  glosses: string[];
  examples: string[];
}

export interface DefinitionEntry {
  pos: string;
  senses: Sense[];
}

// 标签信息
export interface TagInfo {
  id: number;
  key: string;
  name: string;
  description?: string;
}

export interface DictionaryEntry {
  id: number;
  word: string;
  phonetics: string[];
  audio: string[];
  forms: string[];
  entries: DefinitionEntry[];
  chineseEntriesShort?: any; // JSON 类型，用于存储中文释义
  source?: 'db' | 'ai'; // 标识数据来源：数据库 或 AI 生成
  tags?: TagInfo[]; // 标签信息
}

// 单词详细信息接口 - 现在使用新的 DictionaryEntry 结构
export type WordDetails = DictionaryEntry;

// AI 增强信息接口
export interface AIEnrichmentData {
  contextualDefinitions: string[]; // 改为数组以支持多行显示
  exampleSentence: string;
  synonym: string;
}

// Chrome 扩展消息类型
export interface ChromeMessage {
  type:
    | 'QUERY_WORDS_STATUS'
    | 'GET_WORD_DETAILS' // 保留用于向后兼容
    | 'GET_INTERNAL_DEFINITION' // 新的消息类型：使用内部词典 API
    | 'UPDATE_WORD_STATUS'
    | 'IGNORE_WORD'
    | 'BATCH_IGNORE_WORDS' // 批量忽略单词
    | 'BATCH_UPDATE_WORD_STATUS' // 批量更新单词状态
    | 'ENRICH_WORD' // AI 解析单词（非流式）
    | 'ENRICH_WORD_STREAM' // AI 解析单词（流式）
    | 'TRANSLATE_SENTENCE' // AI 翻译句子（非流式）
    | 'TRANSLATE_SENTENCE_STREAM' // AI 翻译句子（流式）
    | 'WORD_STATUS_UPDATED' // background -> content script 状态更新通知
    | 'WORD_IGNORED' // background -> content script 忽略通知
    | 'ENRICH_STREAM_DATA' // background -> content script 流式数据
    | 'ENRICH_STREAM_COMPLETE' // background -> content script 流式完成
    | 'ENRICH_STREAM_ERROR' // background -> content script 流式错误
    | 'TRANSLATE_STREAM_DATA' // background -> content script 翻译流式数据
    | 'TRANSLATE_STREAM_COMPLETE' // background -> content script 翻译流式完成
    | 'TRANSLATE_STREAM_ERROR' // background -> content script 翻译流式错误
    | 'AUTO_INCREASE_FAMILIARITY' // background -> content script 自动提升熟练度
    | 'GET_DICTIONARY_WHITELIST'; // 获取后端白名单（背景脚本镜像兜底）
  words?: string[];
  word?: string;
  context?: string; // AI 解析所需的上下文 / 翻译的段落
  sentence?: string; // 需要分析的完整句子
  status?: WordFamiliarityStatus;
  familiarityLevel?: number;
  enhancedPhraseDetection?: boolean; // AI 增强词组检测开关
  enableSentenceAnalysis?: boolean; // 长难句分析开关（已弃用，使用 sentenceAnalysisMode）
  sentenceAnalysisMode?: 'always' | 'smart' | 'off'; // 长难句分析模式
  content?: string; // 流式内容
  error?: string; // 错误信息
  translation?: string; // 翻译内容
  sentenceAnalysis?: string; // 句子分析
  paragraph?: string; // 段落（原文）
}

/** 词典白名单响应（背景脚本 → 内容脚本） */
export interface DictionaryWhitelistResponse {
  ok: boolean;
  words?: string[];
  version?: string;
  syncedAt?: string;
  error?: string;
}

export interface ChromeMessageResponse {
  success: boolean;
  data?:
    | Record<string, string>
    | Record<string, WordFamilyInfo>
    | WordDetails
    | DictionaryWhitelistResponse
    | { success: boolean; message: string };
  error?: string;
  message?: string;
  addedCount?: number; // 批量忽略返回的添加数量
  updatedCount?: number; // 批量更新返回的更新数量
}
