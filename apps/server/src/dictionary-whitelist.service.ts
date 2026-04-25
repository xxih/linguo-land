import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface DictionaryWhitelistSnapshot {
  version: string;
  words: string[];
}

@Injectable()
export class DictionaryWhitelistService implements OnModuleInit {
  private readonly logger = new Logger(DictionaryWhitelistService.name);
  private snapshot: DictionaryWhitelistSnapshot | null = null;

  onModuleInit(): void {
    const dataPath = join(__dirname, 'data', 'dictionary-whitelist.json');
    const raw = readFileSync(dataPath, 'utf-8');
    const words = JSON.parse(raw) as string[];

    if (!Array.isArray(words)) {
      throw new Error('dictionary-whitelist.json 顶层不是数组');
    }

    const version = createHash('sha1').update(raw).digest('hex').slice(0, 12);
    this.snapshot = { version, words };
    this.logger.log(`Whitelist 加载完成: ${words.length} 个词，version=${version}`);
  }

  getSnapshot(): DictionaryWhitelistSnapshot {
    if (!this.snapshot) {
      throw new Error('DictionaryWhitelistService 尚未初始化');
    }
    return this.snapshot;
  }
}
