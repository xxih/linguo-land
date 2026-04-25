import { Logger } from '../utils/logger';
import { getApiBaseUrl } from './api/apiConfig';

const STORAGE_KEY = 'dictionaryWhitelist';
const SYNC_TIMEOUT_MS = 30_000;

interface RemoteSnapshot {
  version: string;
  words: string[];
  adverbMap?: Record<string, string>;
}

interface PersistedSnapshot extends RemoteSnapshot {
  syncedAt: string;
}

export interface DictionaryWhitelistResult {
  ok: boolean;
  words?: string[];
  version?: string;
  syncedAt?: string;
  adverbMap?: Record<string, string>;
  error?: string;
}

/**
 * 词典白名单的客户端镜像（背景脚本侧的单一权威）。
 *
 * - 数据来源是后端的 `GET /api/v1/dictionary-whitelist`（公开接口，无需登录）
 * - 持久化在 chrome.storage.local，service worker 重启后立即可用
 * - 启动时先回填快照，再异步从后端拉一次最新版本
 * - 内容脚本通过 `GET_DICTIONARY_WHITELIST` 消息一次性取走 words 数组并自建 Set
 *
 * 故意不在内容脚本里写 fetch——背景统一收口，避免每个 frame 各自请求和重复写 storage。
 */
export class DictionaryMirror {
  private static instance: DictionaryMirror | null = null;

  private snapshot: PersistedSnapshot | null = null;
  private initPromise: Promise<void> | null = null;
  private syncPromise: Promise<void> | null = null;
  private lastSyncError: Error | null = null;
  private logger = new Logger('DictionaryMirror');

  private constructor() {}

  static getInstance(): DictionaryMirror {
    if (!DictionaryMirror.instance) {
      DictionaryMirror.instance = new DictionaryMirror();
    }
    return DictionaryMirror.instance;
  }

  /**
   * 启动初始化：先从 storage 还原（service worker 重启时立即可用），
   * 然后异步触发一次远端 sync。第一次安装且远端不可达时，
   * snapshot 仍为 null，由 getResult() 暴露失败给调用方。
   */
  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.snapshot = await this.readSnapshot();
      if (this.snapshot) {
        this.logger.info('Whitelist 镜像从 storage 恢复', {
          wordCount: this.snapshot.words.length,
          version: this.snapshot.version,
          syncedAt: this.snapshot.syncedAt,
        });
      } else {
        this.logger.info('storage 内无白名单镜像，准备首次拉取');
      }

      // 后台拉一次最新；失败不阻塞 init。
      this.syncFromRemote().catch(() => {
        // 错误已经在 syncFromRemote 内记录到 lastSyncError
      });
    })();

    return this.initPromise;
  }

  /**
   * 从远端拉取并覆盖本地。如果首次安装且无 snapshot，
   * 调用方应该 await 这个 Promise；后续启动可以让它后台跑。
   */
  syncFromRemote(): Promise<void> {
    if (this.syncPromise) return this.syncPromise;

    this.syncPromise = (async () => {
      try {
        const baseUrl = await getApiBaseUrl();
        const url = `${baseUrl}/dictionary-whitelist`;
        const response = await fetch(url, {
          method: 'GET',
          signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as RemoteSnapshot;
        if (!data || !Array.isArray(data.words) || typeof data.version !== 'string') {
          throw new Error('白名单接口返回格式异常');
        }

        const next: PersistedSnapshot = {
          version: data.version,
          words: data.words,
          adverbMap: data.adverbMap,
          syncedAt: new Date().toISOString(),
        };

        // 同 version 跳过持久化，省掉一次 storage 写
        if (this.snapshot?.version === next.version) {
          this.snapshot = { ...this.snapshot, syncedAt: next.syncedAt };
          this.logger.info('白名单 version 未变，跳过持久化', { version: next.version });
        } else {
          this.snapshot = next;
          await this.persist();
          this.logger.info('白名单镜像已更新', {
            wordCount: next.words.length,
            version: next.version,
          });
        }
        this.lastSyncError = null;
      } catch (err) {
        this.lastSyncError = err as Error;
        this.logger.warn('白名单远端拉取失败', err as Error);
        throw err;
      } finally {
        // 允许下次 onStartup / 手动重试
        this.syncPromise = null;
      }
    })();

    return this.syncPromise;
  }

  /**
   * 给消息处理器用：返回当前可用快照。如果没有 snapshot 又拉不到远端，
   * 返回 ok=false 让内容脚本据此弹 toast。
   */
  async getResult(): Promise<DictionaryWhitelistResult> {
    await this.init();

    // 没有 snapshot 时再 await 一次 sync —— 首次安装的关键路径
    if (!this.snapshot) {
      try {
        await this.syncFromRemote();
      } catch {
        // 错误已存到 lastSyncError
      }
    }

    if (this.snapshot) {
      return {
        ok: true,
        words: this.snapshot.words,
        version: this.snapshot.version,
        syncedAt: this.snapshot.syncedAt,
        adverbMap: this.snapshot.adverbMap,
      };
    }

    return {
      ok: false,
      error: this.lastSyncError?.message ?? '白名单尚未加载',
    };
  }

  private async readSnapshot(): Promise<PersistedSnapshot | null> {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const raw = result[STORAGE_KEY] as PersistedSnapshot | undefined;
    if (!raw || !Array.isArray(raw.words) || typeof raw.version !== 'string') {
      return null;
    }
    return raw;
  }

  private async persist(): Promise<void> {
    if (!this.snapshot) return;
    await chrome.storage.local.set({ [STORAGE_KEY]: this.snapshot });
  }
}
