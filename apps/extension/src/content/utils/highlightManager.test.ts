/**
 * HighlightManager 跨 frame 整族匹配回归。
 *
 * jsdom 没有 CSS Custom Highlight API，先 stub 掉 `Highlight` 构造和
 * `CSS.highlights`；保留所需最小行为（add / delete / size / Map）。
 * 命中查询路径（caretRangeFromPoint）jsdom 也不支持，本文件不覆盖。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { HighlightInfo } from '../types';

beforeAll(() => {
  class FakeHighlight {
    private items = new Set<Range>();
    add(r: Range) {
      this.items.add(r);
    }
    delete(r: Range) {
      return this.items.delete(r);
    }
    clear() {
      this.items.clear();
    }
    get size() {
      return this.items.size;
    }
  }
  (globalThis as unknown as { Highlight: typeof FakeHighlight }).Highlight = FakeHighlight;
  (globalThis as unknown as { CSS: { highlights: Map<string, FakeHighlight> } }).CSS = {
    highlights: new Map<string, FakeHighlight>(),
  };
});

// 在 stub 装好之后再 import，避免类静态字段在文件加载阶段就尝试 new Highlight()
async function importManager() {
  const mod = await import('./highlightManager');
  return mod.HighlightManager;
}

function makeItem(
  partial: Partial<HighlightInfo> & { word: string; familyRoot: string; lemmas: string[] },
): HighlightInfo {
  const node = document.createTextNode(partial.word);
  document.body.appendChild(node);
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, partial.word.length);
  return {
    word: partial.word,
    originalWord: partial.word,
    lemmas: partial.lemmas,
    status: partial.status ?? 'unknown',
    familyRoot: partial.familyRoot,
    familiarityLevel: partial.familiarityLevel ?? 0,
    textNode: node,
    startOffset: 0,
    endOffset: partial.word.length,
    range,
  };
}

describe('HighlightManager.updateWordStatus 跨 frame 整族匹配', () => {
  let HighlightManager: Awaited<ReturnType<typeof importManager>>;

  beforeAll(async () => {
    HighlightManager = await importManager();
  });

  let mgr: InstanceType<typeof HighlightManager>;
  beforeEach(() => {
    document.body.innerHTML = '';
    (globalThis as { CSS: { highlights: Map<string, unknown> } }).CSS.highlights.clear();
    mgr = new HighlightManager();
  });

  it('传 familyRoot 时，所有同 family 的高亮一起切到新状态——即使 lemmas 不含 word', () => {
    // 模拟 iframe 的注册表：高亮的是 "ran"（lemmas: ["run"]、family: "run"）
    const ranItem = makeItem({ word: 'ran', familyRoot: 'run', lemmas: ['run'] });
    // 私有字段直接塞进去——只测 update 路径，不走 createHighlightRange 的视觉副作用
    (mgr as unknown as { registry: { items: HighlightInfo[] } }).registry.items.push(ranItem);

    // main 页用户标了 "running" 为 known，广播到 iframe，带 familyRoot="run"
    mgr.updateWordStatus('running', 'known', 7, 'run');

    expect(ranItem.status).toBe('known');
    expect(ranItem.familiarityLevel).toBe(7);
  });

  it('传 familyRoot 不命中时，不会误伤其它 family 的高亮', () => {
    const otherItem = makeItem({ word: 'cat', familyRoot: 'cat', lemmas: ['cat'] });
    (mgr as unknown as { registry: { items: HighlightInfo[] } }).registry.items.push(otherItem);

    mgr.updateWordStatus('running', 'known', 7, 'run');

    expect(otherItem.status).toBe('unknown');
  });

  it('未传 familyRoot 时走 lemma includes 兼容路径', () => {
    const runItem = makeItem({ word: 'running', familyRoot: 'run', lemmas: ['run', 'running'] });
    (mgr as unknown as { registry: { items: HighlightInfo[] } }).registry.items.push(runItem);

    mgr.updateWordStatus('running', 'learning', 3);

    expect(runItem.status).toBe('learning');
    expect(runItem.familiarityLevel).toBe(3);
  });
});
