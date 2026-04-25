import type {
  VocabularySyncFamily,
  VocabularySyncResponse,
  WordFamilyInfo,
  WordQueryResponse,
} from 'shared-types';
import { Logger } from '../utils/logger';
import { fetchJsonWithAuth } from './api/fetchWithAuth';
import { getApiBaseUrl } from './api/apiConfig';

const STORAGE_KEY = 'vocabularyMirror';
const SYNC_TIMEOUT_MS = 30_000;

interface PersistedSnapshot {
  syncedAt: string;
  families: VocabularySyncFamily[];
}

/**
 * 用户词库的客户端镜像。
 *
 * 设计要点：
 * - 读路径（QUERY_WORDS_STATUS）100% 走本地，从不回落网络。
 * - 写路径仍以后端为权威，写成功后用响应里的 `family` 字段更新镜像。
 * - 持久化在 chrome.storage.local——service worker 重启后能立刻提供查询，
 *   同时异步拉一次最新数据兜底。
 */
export class VocabularyMirror {
  private static instance: VocabularyMirror | null = null;

  private byLemma: Map<string, WordFamilyInfo> = new Map();
  private byFamily: Map<string, VocabularySyncFamily> = new Map();
  private syncedAt: string | null = null;
  private initPromise: Promise<void> | null = null;
  private logger = new Logger('VocabularyMirror');

  private constructor() {}

  static getInstance(): VocabularyMirror {
    if (!VocabularyMirror.instance) {
      VocabularyMirror.instance = new VocabularyMirror();
    }
    return VocabularyMirror.instance;
  }

  /**
   * 初始化：先从 storage 还原快照（service worker 重启时立即可用），
   * 然后异步触发一次远端 sync 兜底。
   */
  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const snapshot = await this.readSnapshot();
      if (snapshot) {
        this.applySnapshot(snapshot);
        this.logger.info('Mirror restored from storage', {
          familyCount: snapshot.families.length,
          syncedAt: snapshot.syncedAt,
        });
      }

      // 不阻塞 init——sync 在后台跑
      this.syncFromRemote().catch((err) => {
        this.logger.warn('Background sync failed; using cached snapshot', err);
      });
    })();

    return this.initPromise;
  }

  /**
   * 主动从后端拉取全量最新数据，覆盖本地镜像。
   */
  async syncFromRemote(): Promise<void> {
    const baseUrl = await getApiBaseUrl();
    const data = await fetchJsonWithAuth<VocabularySyncResponse>(`${baseUrl}/vocabulary/sync`, {
      method: 'GET',
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });

    this.applySnapshot(data);
    await this.persist();

    this.logger.info('Mirror synced from remote', {
      familyCount: data.families.length,
      syncedAt: data.syncedAt,
    });
  }

  /**
   * 纯本地查询：传入若干 lemma，返回每个 lemma 对应的词族状态。
   * 镜像里没有的 lemma 视为 unknown（默认行为），不返回——与原 /vocabulary/query 行为一致。
   */
  query(lemmas: string[]): WordQueryResponse {
    const result: WordQueryResponse = {};
    for (const lemma of lemmas) {
      const hit = this.byLemma.get(lemma.toLowerCase());
      if (hit) {
        result[lemma] = hit;
      }
    }
    return result;
  }

  /**
   * 写成功后调用：用 family 最新状态覆盖本地镜像里的同 family。
   * 传 null 表示 family 已被从用户词库移除（status='unknown'）——按 familyRoot 删除。
   */
  async applyFamily(family: VocabularySyncFamily | null, removedFamilyRoot?: string): Promise<void> {
    if (family) {
      this.upsertFamilyInMemory(family);
    } else if (removedFamilyRoot) {
      this.removeFamilyInMemory(removedFamilyRoot);
    }
    await this.persist();
  }

  /**
   * 登出 / 换号时清空。
   */
  async clear(): Promise<void> {
    this.byLemma.clear();
    this.byFamily.clear();
    this.syncedAt = null;
    await chrome.storage.local.remove(STORAGE_KEY);
    this.logger.info('Mirror cleared');
  }

  getStats(): {
    familyCount: number;
    lemmaCount: number;
    syncedAt: string | null;
  } {
    return {
      familyCount: this.byFamily.size,
      lemmaCount: this.byLemma.size,
      syncedAt: this.syncedAt,
    };
  }

  // ---- internal ----

  private applySnapshot(snapshot: PersistedSnapshot): void {
    this.byLemma.clear();
    this.byFamily.clear();
    this.syncedAt = snapshot.syncedAt;
    for (const family of snapshot.families) {
      this.upsertFamilyInMemory(family);
    }
  }

  private upsertFamilyInMemory(family: VocabularySyncFamily): void {
    // 先把旧 family 的 lemma 全部清掉，避免词形变更后产生残留
    const existing = this.byFamily.get(family.familyRoot);
    if (existing) {
      for (const oldLemma of existing.lemmas) {
        this.byLemma.delete(oldLemma.toLowerCase());
      }
    }

    this.byFamily.set(family.familyRoot, family);
    const info: WordFamilyInfo = {
      status: family.status,
      familyRoot: family.familyRoot,
      familiarityLevel: family.familiarityLevel,
    };
    for (const lemma of family.lemmas) {
      this.byLemma.set(lemma.toLowerCase(), info);
    }
  }

  private removeFamilyInMemory(familyRoot: string): void {
    const existing = this.byFamily.get(familyRoot);
    if (!existing) return;
    for (const lemma of existing.lemmas) {
      this.byLemma.delete(lemma.toLowerCase());
    }
    this.byFamily.delete(familyRoot);
  }

  private async readSnapshot(): Promise<PersistedSnapshot | null> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const snapshot = result[STORAGE_KEY] as PersistedSnapshot | undefined;
    if (!snapshot || !Array.isArray(snapshot.families)) return null;
    return snapshot;
  }

  private async persist(): Promise<void> {
    const snapshot: PersistedSnapshot = {
      syncedAt: this.syncedAt ?? new Date().toISOString(),
      families: Array.from(this.byFamily.values()),
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: snapshot });
  }
}
