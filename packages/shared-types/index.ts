// 定义单词的熟悉度状态
export type WordFamiliarityStatus = 'unknown' | 'learning' | 'known';

// 定义 API 返回的单个单词对象结构（旧版，保留以兼容）
export interface WordState {
  word: string; // 单词原文（小写词元）
  status: WordFamiliarityStatus;
  familiarityLevel?: number; // 0-5
  lastSeenAt?: Date;
  encounterCount?: number;
}

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

// 定义 /api/v1/vocabulary/:word 的请求体类型
export interface WordUpdateRequest {
  status?: WordFamiliarityStatus; // 改为可选，支持只更新熟练度
  familiarityLevel?: number;
  userId?: string;
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
    | 'AUTO_INCREASE_FAMILIARITY'; // background -> content script 自动提升熟练度
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

export interface ChromeMessageResponse {
  success: boolean;
  data?:
    | Record<string, string>
    | Record<string, WordFamilyInfo>
    | WordDetails
    | { success: boolean; message: string };
  error?: string;
  message?: string;
  addedCount?: number; // 批量忽略返回的添加数量
  updatedCount?: number; // 批量更新返回的更新数量
}
