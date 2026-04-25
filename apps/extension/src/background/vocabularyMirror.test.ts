import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VocabularySyncFamily } from 'shared-types';

// 把 chrome.storage / chrome.runtime 等 background 依赖 stub 掉，再 import 模块。
const storageStore: Record<string, unknown> = {};

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: storageStore[key] })),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        Object.assign(storageStore, obj);
      }),
      remove: vi.fn(async (key: string) => {
        delete storageStore[key];
      }),
    },
  },
});

vi.mock('./api/fetchWithAuth', () => ({
  fetchJsonWithAuth: vi.fn(),
}));
vi.mock('./api/apiConfig', () => ({
  getApiBaseUrl: vi.fn(async () => 'http://test'),
}));

import { VocabularyMirror } from './vocabularyMirror';

const runFamily: VocabularySyncFamily = {
  familyRoot: 'run',
  lemmas: ['run', 'runs', 'running', 'ran'],
  status: 'known',
  familiarityLevel: 7,
};

const eatFamily: VocabularySyncFamily = {
  familyRoot: 'eat',
  lemmas: ['eat', 'eats', 'eating', 'ate'],
  status: 'learning',
  familiarityLevel: 3,
};

describe('VocabularyMirror', () => {
  beforeEach(() => {
    // 单例需要在每个 case 之前重置
    (VocabularyMirror as unknown as { instance: VocabularyMirror | null }).instance = null;
    Object.keys(storageStore).forEach((k) => delete storageStore[k]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('apply 后能按词族下任一 lemma 查到（含变形）', async () => {
    const mirror = VocabularyMirror.getInstance();
    await mirror.applyFamily(runFamily);

    expect(mirror.query(['running'])).toEqual({
      running: { status: 'known', familyRoot: 'run', familiarityLevel: 7 },
    });
    expect(mirror.query(['ran'])).toEqual({
      ran: { status: 'known', familyRoot: 'run', familiarityLevel: 7 },
    });
  });

  it('查询是大小写不敏感的（页面输入 Running 应能命中）', async () => {
    const mirror = VocabularyMirror.getInstance();
    await mirror.applyFamily(runFamily);

    expect(mirror.query(['Running', 'RAN'])).toEqual({
      Running: { status: 'known', familyRoot: 'run', familiarityLevel: 7 },
      RAN: { status: 'known', familyRoot: 'run', familiarityLevel: 7 },
    });
  });

  it('未知 lemma 不返回（保持与原 /vocabulary/query 行为一致）', async () => {
    const mirror = VocabularyMirror.getInstance();
    await mirror.applyFamily(runFamily);

    expect(mirror.query(['xenophobia', 'undiscovered'])).toEqual({});
  });

  it('removedFamilyRoot 把整个词族（含所有 lemma）从镜像清掉', async () => {
    const mirror = VocabularyMirror.getInstance();
    await mirror.applyFamily(runFamily);
    await mirror.applyFamily(eatFamily);

    await mirror.applyFamily(null, 'run');

    expect(mirror.query(['running', 'ran'])).toEqual({});
    // 同时未删的另一个词族不受影响
    expect(mirror.query(['eating'])).toEqual({
      eating: { status: 'learning', familyRoot: 'eat', familiarityLevel: 3 },
    });
  });

  it('重新 apply 同一词族（lemma 列表变了）会先清旧 lemma 再写新的', async () => {
    const mirror = VocabularyMirror.getInstance();
    await mirror.applyFamily(runFamily);

    // 模拟后端把 "ran" 拆出去，词族里只剩 run/runs/running
    const trimmed: VocabularySyncFamily = {
      ...runFamily,
      lemmas: ['run', 'runs', 'running'],
    };
    await mirror.applyFamily(trimmed);

    expect(mirror.query(['ran'])).toEqual({}); // 不再属于该词族
    expect(mirror.query(['running'])).toEqual({
      running: { status: 'known', familyRoot: 'run', familiarityLevel: 7 },
    });
  });

  it('数据落到 chrome.storage.local，重启后能直接还原', async () => {
    const mirror1 = VocabularyMirror.getInstance();
    await mirror1.applyFamily(runFamily);
    await mirror1.applyFamily(eatFamily);

    // 模拟 service worker 重启：清掉单例但保留 storage
    (VocabularyMirror as unknown as { instance: VocabularyMirror | null }).instance = null;
    const mirror2 = VocabularyMirror.getInstance();

    // init 内部会触发 syncFromRemote（已 mock），抛错也不影响 storage 兜底
    const { fetchJsonWithAuth } = await import('./api/fetchWithAuth');
    (fetchJsonWithAuth as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('offline'),
    );

    await mirror2.init();

    expect(mirror2.query(['running', 'eating'])).toEqual({
      running: { status: 'known', familyRoot: 'run', familiarityLevel: 7 },
      eating: { status: 'learning', familyRoot: 'eat', familiarityLevel: 3 },
    });
  });

  it('clear 清空内存与 storage', async () => {
    const mirror = VocabularyMirror.getInstance();
    await mirror.applyFamily(runFamily);
    expect(mirror.getStats().familyCount).toBe(1);

    await mirror.clear();

    expect(mirror.query(['running'])).toEqual({});
    expect(mirror.getStats()).toEqual({ familyCount: 0, lemmaCount: 0, syncedAt: null });
    expect(storageStore.vocabularyMirror).toBeUndefined();
  });
});
