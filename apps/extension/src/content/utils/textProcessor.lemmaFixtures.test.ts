import { describe, it, expect, beforeAll } from 'vitest';
import { TextProcessor } from './textProcessor';
import fixtures from './lemmaFixtures.json' with { type: 'json' };
import dictionaryWhitelist from '../../../../server/src/data/dictionary-whitelist.json' with { type: 'json' };
import verbInflectionMap from '../../../../server/src/data/verb-inflection-map.json' with { type: 'json' };
import nounInflectionMap from '../../../../server/src/data/noun-inflection-map.json' with { type: 'json' };
import adjInflectionMap from '../../../../server/src/data/adj-inflection-map.json' with { type: 'json' };

/**
 * 词形还原 ground truth 回归集
 *
 * 数据源：UniMorph English (CC-BY-SA, https://github.com/unimorph/eng) 抽样，
 * 按词频分层。生成脚本见 `scripts/build-lemma-fixtures.mjs`。
 *
 * 测试时注入 server 的真实白名单 + 不规则映射（同 prod runtime），保证 ADR 0017
 * 的 rule-based 路径与生产行为一致。
 */

const TP = TextProcessor as unknown as {
  getLemmasForWord: (word: string) => string[];
};

interface Fixture {
  category: string;
  word: string;
  expectedLemmas: string[];
}

beforeAll(() => {
  TextProcessor.setAdverbMap(null);
  TextProcessor.setInflectionMaps({
    verbInflectionMap,
    nounInflectionMap,
    adjInflectionMap,
    dictionarySet: new Set((dictionaryWhitelist as string[]).map((w) => w.toLowerCase())),
  });
});

describe('TextProcessor.getLemmasForWord — UniMorph 抽样回归集', () => {
  it.each(fixtures as Fixture[])(
    '[$category] $word → expect any of $expectedLemmas',
    ({ word, expectedLemmas }) => {
      const lemmas = TP.getLemmasForWord(word);
      const hit = lemmas.some((l) => expectedLemmas.includes(l));
      expect(
        hit,
        `lemmatizer returned [${lemmas.join(',')}], none matched expected [${expectedLemmas.join(',')}]`,
      ).toBe(true);
    },
  );
});

describe('TextProcessor.getLemmasForWord — 副词→形容词', () => {
  describe('未注入 adverbMap：靠 -ly 后缀启发式 + 字典验证', () => {
    beforeAll(() => {
      TextProcessor.setAdverbMap(null);
    });

    it.each([
      { word: 'quickly', expected: 'quick' },
      { word: 'frequently', expected: 'frequent' },
      { word: 'silently', expected: 'silent' },
    ])('$word → $expected', ({ word, expected }) => {
      expect(TP.getLemmasForWord(word)).toContain(expected);
    });
  });

  describe('注入 adverbMap：覆盖不规则副词', () => {
    beforeAll(() => {
      TextProcessor.setAdverbMap({
        happily: 'happy',
        easily: 'easy',
        gently: 'gentle',
        truly: 'true',
      });
    });

    it.each([
      { word: 'happily', expected: 'happy' },
      { word: 'easily', expected: 'easy' },
      { word: 'gently', expected: 'gentle' },
      { word: 'truly', expected: 'true' },
    ])('$word → $expected', ({ word, expected }) => {
      expect(TP.getLemmasForWord(word)).toContain(expected);
    });
  });
});
