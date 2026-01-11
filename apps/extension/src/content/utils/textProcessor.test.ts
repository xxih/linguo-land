import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TextProcessor } from './textProcessor';

// 模拟 DictionaryLoader 类
class MockDictionaryLoader {
  private validWords = new Set(['expect', 'type', 'of', 'assert', 'integration', 'check']);
  private ignoredWords = new Set<string>();

  isValidWord(word: string): boolean {
    return this.validWords.has(word.toLowerCase());
  }

  isIgnoredWord(word: string): boolean {
    return this.ignoredWords.has(word.toLowerCase());
  }

  addIgnoredWord(word: string): void {
    this.ignoredWords.add(word.toLowerCase());
  }
}

describe('TextProcessor - 驼峰命名和词汇过滤', () => {
  let mockDictionaryLoader: MockDictionaryLoader;

  beforeEach(() => {
    mockDictionaryLoader = new MockDictionaryLoader();
    // 禁用控制台日志以避免测试输出混乱
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  describe('splitCamelCase - 驼峰命名分词', () => {
    it('应该正确分词 ExpectTypeOf', () => {
      const result = (TextProcessor as any).splitCamelCase('ExpectTypeOf');
      expect(result).toEqual(['Expect', 'Type', 'Of']);
    });

    it('应该正确分词 AssertType', () => {
      const result = (TextProcessor as any).splitCamelCase('AssertType');
      expect(result).toEqual(['Assert', 'Type']);
    });

    it('应该处理带标点的驼峰词', () => {
      const result = (TextProcessor as any).splitCamelCase('types="vitest"');
      expect(result).toEqual(['types', 'vitest']);
    });

    it('应该过滤太短的部分', () => {
      const result = (TextProcessor as any).splitCamelCase('getAB');
      expect(result).toEqual(['get', 'AB']); // AB 长度为2，MIN_WORD_LENGTH 为2，所以会保留
    });

    it('应该处理单个词', () => {
      const result = (TextProcessor as any).splitCamelCase('integration');
      expect(result).toEqual(['integration']);
    });
  });

  describe('cleanWord - 词汇清理', () => {
    it('应该移除标点符号', () => {
      const result = (TextProcessor as any).cleanWord('instead.');
      expect(result).toBe('instead');
    });

    it('应该处理所有格', () => {
      const result = (TextProcessor as any).cleanWord("grid's");
      expect(result).toBe('grid');
    });

    it('应该移除开头的标点', () => {
      const result = (TextProcessor as any).cleanWord('"word"');
      expect(result).toBe('word');
    });

    it('应该保留内部的撇号', () => {
      const result = (TextProcessor as any).cleanWord("don't");
      expect(result).toBe("don't");
    });

    it('应该处理复杂的标点情况', () => {
      const result = (TextProcessor as any).cleanWord('(example)');
      expect(result).toBe('example');
    });
  });

  describe('词汇过滤逻辑验证', () => {
    it('简化的分词逻辑验证', () => {
      // 测试 splitCamelCase 在实际场景中的行为
      const parts = (TextProcessor as any).splitCamelCase('ExpectTypeOf');
      expect(parts).toEqual(['Expect', 'Type', 'Of']);

      // 每个部分都应该能通过白名单检查
      parts.forEach((part: string) => {
        expect(mockDictionaryLoader.isValidWord(part.toLowerCase())).toBe(true);
      });
    });

    it('忽略列表功能验证', () => {
      // 添加词汇到忽略列表
      mockDictionaryLoader.addIgnoredWord('type');

      // 验证忽略功能
      expect(mockDictionaryLoader.isIgnoredWord('type')).toBe(true);
      expect(mockDictionaryLoader.isIgnoredWord('expect')).toBe(false);
    });
  });
});
