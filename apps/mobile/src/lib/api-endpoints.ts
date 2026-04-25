/**
 * 后端接口的轻封装。每个函数只负责 url + method + payload 形态，
 * 让上层 zustand store / hooks 不直接依赖 axios 的形状。
 */
import { api, getApiBaseUrl } from './api';
import type {
  DocumentMeta,
  DocumentListResponse,
  ReadingProgressDto,
  UpsertReadingProgressRequest,
  WordQueryResponse,
  WordMutationResponse,
  WordFamiliarityStatus,
  DictionaryEntry,
  AIEnrichmentData,
  VocabularySyncResponse,
} from 'shared-types';

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: { id: number; email: string; createdAt: string };
}

export const authApi = {
  async login(email: string, password: string): Promise<LoginResponse> {
    const { data } = await api.post<LoginResponse>('/api/v1/auth/login', {
      email,
      password,
    });
    return data;
  },
  async register(email: string, password: string): Promise<{ id: number; email: string }> {
    const { data } = await api.post<{ user: { id: number; email: string } }>(
      '/api/v1/auth/register',
      { email, password },
    );
    return data.user;
  },
  async profile(): Promise<{ id: number; email: string; createdAt: string }> {
    const { data } = await api.get('/api/v1/auth/profile');
    return data;
  },
};

export const documentsApi = {
  async list(): Promise<DocumentMeta[]> {
    const { data } = await api.get<DocumentListResponse>('/api/v1/documents');
    return data.documents;
  },
  async get(id: number): Promise<DocumentMeta> {
    const { data } = await api.get<DocumentMeta>(`/api/v1/documents/${id}`);
    return data;
  },
  /** 文件下载 URL（外部 fetch / WebView 用） */
  async fileUrl(id: number): Promise<string> {
    const baseURL = await getApiBaseUrl();
    return `${baseURL}/api/v1/documents/${id}/file`;
  },
  async delete(id: number): Promise<void> {
    await api.delete(`/api/v1/documents/${id}`);
  },
};

export const progressApi = {
  async get(documentId: number): Promise<ReadingProgressDto | null> {
    const { data } = await api.get<{ progress: ReadingProgressDto | null }>(
      `/api/v1/reading-progress/by-document/${documentId}`,
    );
    return data.progress;
  },
  async upsert(input: UpsertReadingProgressRequest): Promise<ReadingProgressDto> {
    const { data } = await api.post<{ progress: ReadingProgressDto }>(
      '/api/v1/reading-progress',
      input,
    );
    return data.progress;
  },
  async listAll(): Promise<ReadingProgressDto[]> {
    const { data } = await api.get<{ progress: ReadingProgressDto[] }>(
      '/api/v1/reading-progress',
    );
    return data.progress;
  },
};

export const dictionaryApi = {
  async lookup(word: string): Promise<DictionaryEntry | null> {
    try {
      const { data } = await api.get<DictionaryEntry>(
        `/api/v1/dictionary/${encodeURIComponent(word.toLowerCase())}`,
      );
      return data;
    } catch (err: any) {
      if (err?.response?.status === 404) return null;
      throw err;
    }
  },
};

export const vocabularyApi = {
  async query(words: string[]): Promise<WordQueryResponse> {
    const { data } = await api.post<WordQueryResponse>(
      '/api/v1/vocabulary/query',
      { words },
    );
    return data;
  },
  async update(
    word: string,
    payload: { status?: WordFamiliarityStatus; familiarityLevel?: number },
  ): Promise<WordMutationResponse> {
    const { data } = await api.put<WordMutationResponse>(
      `/api/v1/vocabulary/${encodeURIComponent(word)}`,
      payload,
    );
    return data;
  },
  async increaseFamiliarity(word: string): Promise<WordMutationResponse> {
    const { data } = await api.post<WordMutationResponse>(
      `/api/v1/vocabulary/${encodeURIComponent(word)}/increase-familiarity`,
    );
    return data;
  },
  async list(params: {
    page?: number;
    limit?: number;
    sortBy?: 'familyRoot' | 'status' | 'lastSeenAt' | 'lookupCount' | 'createdAt';
    sortOrder?: 'asc' | 'desc';
    status?: WordFamiliarityStatus;
    search?: string;
    importSource?: 'manual' | 'preset' | 'all';
  }): Promise<any> {
    const { data } = await api.get('/api/v1/vocabulary/list', { params });
    return data;
  },
  async stats(): Promise<{
    unknown: number;
    learning: number;
    known: number;
    total: number;
    recentFamilies: Array<{
      familyRoot: string;
      lastSeenAt: string;
      lookupCount: number;
    }>;
  }> {
    const { data } = await api.get('/api/v1/vocabulary/stats');
    return data;
  },
  async sync(): Promise<VocabularySyncResponse> {
    const { data } = await api.get<VocabularySyncResponse>('/api/v1/vocabulary/sync');
    return data;
  },
};

export const aiApi = {
  async enrich(
    word: string,
    context: string,
    enhancedPhraseDetection?: boolean,
  ): Promise<AIEnrichmentData> {
    const { data } = await api.post<AIEnrichmentData>('/api/v1/ai/enrich', {
      word,
      context,
      enhancedPhraseDetection: enhancedPhraseDetection ?? false,
    });
    return data;
  },
  async translate(
    sentence: string,
    targetSentence?: string,
    sentenceAnalysisMode: 'always' | 'smart' | 'off' = 'off',
  ): Promise<{ translation: string; analysis?: string }> {
    const { data } = await api.post('/api/v1/ai/translate', {
      sentence,
      targetSentence,
      sentenceAnalysisMode,
    });
    return data;
  },
};
