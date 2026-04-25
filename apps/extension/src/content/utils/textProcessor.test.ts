import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TextProcessor } from './textProcessor';

// access private statics through any-cast，避免把内部 API 在 prod 暴露
const TP = TextProcessor as unknown as {
  splitCamelCase: (word: string) => { word: string; start: number; end: number }[];
  cleanWord: (word: string) => string;
  getLemmasForWord: (word: string) => string[];
  lemmaCache: Map<string, string[]>;
};

describe('TextProcessor.splitCamelCase', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('技术术语（小写后接大写）不拆分，避免把代码标识符当英语', () => {
    // ExpectTypeOf / userName / toISOString 等都属于 programmer identifier，
    // 拆分后用单个英语单词查词典是噪音；故意不拆。
    const result = TP.splitCamelCase('ExpectTypeOf');
    expect(result).toEqual([{ word: 'ExpectTypeOf', start: 0, end: 12 }]);
  });

  it('两个大写后接小写也算技术术语（XMLHttpRequest / DWUri）', () => {
    const result = TP.splitCamelCase('XMLHttpRequest');
    expect(result).toEqual([{ word: 'XMLHttpRequest', start: 0, end: 14 }]);
  });

  it('普通单词原样返回（带 start/end）', () => {
    const result = TP.splitCamelCase('integration');
    expect(result).toEqual([{ word: 'integration', start: 0, end: 11 }]);
  });

  it('代码片段里的标点能切开词（types="vitest"）', () => {
    const result = TP.splitCamelCase('types="vitest"');
    expect(result.map((p) => p.word)).toEqual(['types', 'vitest']);
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(5);
  });

  it('空字符串返回空数组', () => {
    expect(TP.splitCamelCase('')).toEqual([]);
  });
});

describe('TextProcessor.cleanWord', () => {
  it('去掉首尾标点', () => {
    expect(TP.cleanWord('instead.')).toBe('instead');
    expect(TP.cleanWord('"word"')).toBe('word');
    expect(TP.cleanWord('(example)')).toBe('example');
  });

  it("处理所有格 's", () => {
    expect(TP.cleanWord("grid's")).toBe('grid');
  });

  it("保留缩写内部的撇号", () => {
    expect(TP.cleanWord("don't")).toBe("don't");
  });
});

describe('TextProcessor.getLemmasForWord 缓存', () => {
  beforeEach(() => {
    TP.lemmaCache.clear();
  });

  it('首次调用进缓存', () => {
    expect(TP.lemmaCache.has('running')).toBe(false);
    const first = TP.getLemmasForWord('running');
    expect(TP.lemmaCache.has('running')).toBe(true);
    expect(TP.lemmaCache.get('running')).toBe(first); // 缓存的是同一个数组引用
  });

  it('重复调用命中缓存——返回与首次相同的数组引用，不重新走 nlp', () => {
    const first = TP.getLemmasForWord('running');
    const second = TP.getLemmasForWord('running');
    expect(second).toBe(first); // 同引用 = 完全没重算
  });

  it('大小写不影响命中（缓存 key 统一小写）', () => {
    const lower = TP.getLemmasForWord('running');
    const upper = TP.getLemmasForWord('RUNNING');
    expect(upper).toBe(lower);
    // 缓存里只该有一个 key
    expect(Array.from(TP.lemmaCache.keys()).filter((k) => k === 'running').length).toBe(1);
  });
});
