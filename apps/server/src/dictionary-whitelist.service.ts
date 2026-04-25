import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface DictionaryWhitelistSnapshot {
  version: string; // 由所有数据文件内容共同算出的指纹
  words: string[];
  /**
   * 副词→形容词映射。客户端 textProcessor.getLemmasForWord 在 #Adverb 分支用它
   * 把 happily → happy 之类的不规则变形还原。
   */
  adverbMap: Record<string, string>;
  /**
   * 动词不规则变形→原形（broken→break, left→leave, ran→run）。
   * 数据来自 wink-lexicon（WordNet 派生，BSD 兼容许可），生成脚本见
   * scripts/build-inflection-maps.mjs。
   */
  verbInflectionMap: Record<string, string>;
  /** 名词不规则复数→单数（children→child, mice→mouse, geese→goose）。 */
  nounInflectionMap: Record<string, string>;
  /** 形容词不规则比较级/最高级→原形（better→good, worst→bad, farthest→far）。 */
  adjInflectionMap: Record<string, string>;
}

@Injectable()
export class DictionaryWhitelistService implements OnModuleInit {
  private readonly logger = new Logger(DictionaryWhitelistService.name);
  private snapshot: DictionaryWhitelistSnapshot | null = null;

  onModuleInit(): void {
    const dataDir = join(__dirname, 'data');

    const whitelistRaw = readFileSync(join(dataDir, 'dictionary-whitelist.json'), 'utf-8');
    const words = JSON.parse(whitelistRaw) as string[];
    if (!Array.isArray(words)) {
      throw new Error('dictionary-whitelist.json 顶层不是数组');
    }

    const adverbMapRaw = readFileSync(join(dataDir, 'adverb-map.json'), 'utf-8');
    const adverbMap = JSON.parse(adverbMapRaw) as Record<string, string>;
    if (!adverbMap || typeof adverbMap !== 'object' || Array.isArray(adverbMap)) {
      throw new Error('adverb-map.json 顶层不是普通对象');
    }

    const verbRaw = readFileSync(join(dataDir, 'verb-inflection-map.json'), 'utf-8');
    const nounRaw = readFileSync(join(dataDir, 'noun-inflection-map.json'), 'utf-8');
    const adjRaw = readFileSync(join(dataDir, 'adj-inflection-map.json'), 'utf-8');
    // wink 同等金标处理的 overrides（ADR 0020 follow-up）：
    //   - irregular-plural-overrides.json：-man→-men 复合 + 学术不规则复数
    //   - irregular-adj-overrides.json：wink 漏的形容词比较级（far→farther 等）
    const pluralOvRaw = readFileSync(join(dataDir, 'irregular-plural-overrides.json'), 'utf-8');
    const adjOvRaw = readFileSync(join(dataDir, 'irregular-adj-overrides.json'), 'utf-8');
    const verbInflectionMap = JSON.parse(verbRaw) as Record<string, string>;
    const baseNounMap = JSON.parse(nounRaw) as Record<string, string>;
    const baseAdjMap = JSON.parse(adjRaw) as Record<string, string>;
    const pluralOverrides = JSON.parse(pluralOvRaw) as Record<string, string>;
    const adjOverrides = JSON.parse(adjOvRaw) as Record<string, string>;
    const nounInflectionMap: Record<string, string> = { ...baseNounMap, ...pluralOverrides };
    const adjInflectionMap: Record<string, string> = { ...baseAdjMap, ...adjOverrides };

    const version = createHash('sha1')
      .update(whitelistRaw)
      .update(adverbMapRaw)
      .update(verbRaw)
      .update(nounRaw)
      .update(adjRaw)
      .update(pluralOvRaw)
      .update(adjOvRaw)
      .digest('hex')
      .slice(0, 12);

    this.snapshot = {
      version,
      words,
      adverbMap,
      verbInflectionMap,
      nounInflectionMap,
      adjInflectionMap,
    };
    this.logger.log(
      `Whitelist 加载完成: ${words.length} 词 + ${Object.keys(adverbMap).length} 副词 + ${Object.keys(verbInflectionMap).length}/${Object.keys(nounInflectionMap).length}/${Object.keys(adjInflectionMap).length} 动/名/形不规则变形, version=${version}`,
    );
  }

  getSnapshot(): DictionaryWhitelistSnapshot {
    if (!this.snapshot) {
      throw new Error('DictionaryWhitelistService 尚未初始化');
    }
    return this.snapshot;
  }
}
