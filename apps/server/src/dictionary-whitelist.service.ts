import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface DictionaryWhitelistSnapshot {
  version: string; // 由 whitelist + adverbMap 内容共同算出的指纹
  words: string[];
  /**
   * 副词→形容词映射。客户端 textProcessor.getLemmasForWord 在 #Adverb 分支用它
   * 把 happily → happy 之类的不规则变形还原。下沉到后端的好处是新增条目不需要
   * 发扩展新版本，热更即可生效。
   */
  adverbMap: Record<string, string>;
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

    const version = createHash('sha1')
      .update(whitelistRaw)
      .update(adverbMapRaw)
      .digest('hex')
      .slice(0, 12);

    this.snapshot = { version, words, adverbMap };
    this.logger.log(
      `Whitelist 加载完成: ${words.length} 词 + ${Object.keys(adverbMap).length} 副词映射，version=${version}`,
    );
  }

  getSnapshot(): DictionaryWhitelistSnapshot {
    if (!this.snapshot) {
      throw new Error('DictionaryWhitelistService 尚未初始化');
    }
    return this.snapshot;
  }
}
