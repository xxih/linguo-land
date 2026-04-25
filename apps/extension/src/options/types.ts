export interface VocabularyFamily {
  familyRoot: string;
  wordCount: number;
  status: 'unknown' | 'learning' | 'known';
  familiarityLevel: number;
  lookupCount: number;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PresetList {
  key: string;
  name: string;
  description: string;
}

export interface VocabularyListResponse {
  families: VocabularyFamily[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface VocabularyStats {
  unknown: number;
  learning: number;
  known: number;
  total: number;
  recentFamilies: Array<{
    familyRoot: string;
    lastSeenAt: string;
    lookupCount: number;
  }>;
}

export interface SettingsData {
  enabledSites: string[];
  disabledSites: string[];
  aiMode: 'auto' | 'manual' | 'off';
  autoIncreaseFamiliarity: boolean;
  showFamiliarityInCard: boolean;
  enhancedPhraseDetection: boolean;
  sentenceAnalysisMode: 'always' | 'smart' | 'off';
  extensionEnabled: boolean;
  highlightEnabled: boolean;
}

export type ActiveTab =
  | 'overview'
  | 'vocabulary-list'
  | 'vocabulary-ignored'
  | 'vocabulary-import'
  | 'features'
  | 'article-analysis';
