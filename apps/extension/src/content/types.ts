// Content script 专用类型定义
export interface HighlightInfo {
  word: string; // 标准化单词（通常为小写，用于状态/忽略操作）
  originalWord: string; // 原始单词（保留大小写，用于展示）
  lemmas: string[]; // 词元列表
  status: string;
  familyRoot: string | undefined; // 词族根
  familiarityLevel: number; // 熟练度 0-7
  textNode: Text;
  startOffset: number;
  endOffset: number;
  range: Range;
}

export interface WordPart {
  word: string;
  start: number;
  end: number;
}

export interface ProcessingState {
  isProcessing: boolean;
  processingStartTime: number;
}

export interface HighlightRegistry {
  items: HighlightInfo[];
  unknownHighlight: Highlight;
  learningHighlight: Highlight;
  currentHoverHighlight: Highlight;
  hoveredWord: string | null;
}

export interface ScanResult {
  nodes: Text[];
  words: string[];
}

export interface HighlightStats {
  totalMatches: number;
  camelCaseMatches: number;
  highlightCount: number;
  processedNodes: number;
}
