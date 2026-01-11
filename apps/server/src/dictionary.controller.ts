import { Controller, Get, Param, UseGuards, NotFoundException } from '@nestjs/common';
import { DictionaryService } from './dictionary.service';
import { AiService } from './ai/ai.service';
import { JwtAuthGuard } from './auth/guards';

@Controller('api/v1/dictionary')
@UseGuards(JwtAuthGuard)
export class DictionaryController {
  constructor(
    private readonly dictionaryService: DictionaryService,
    private readonly aiService: AiService,
  ) {}

  @Get(':word')
  async getWordDefinition(@Param('word') word: string) {
    // 1. 优先从数据库查询
    try {
      const dbEntry = await this.dictionaryService.findWord(word);
      // 找到了，返回并标记来源为 'db'
      return { ...dbEntry, source: 'db' };
    } catch (dbError) {
      // 数据库未找到，继续尝试 AI 回退
      if (!(dbError instanceof NotFoundException)) {
        // 如果不是 NotFound 异常，而是其他错误，直接抛出
        throw dbError;
      }
    }

    // 2. 数据库未命中，调用 AI 服务作为回退
    try {
      const aiDefinition = await this.aiService.getDefinitionForWord(word);

      // 如果 AI 返回了有效的释义
      if (aiDefinition.chinese_entries_short.length > 0) {
        // 3. 构建一个符合前端期望的 DictionaryEntry-like 对象
        const aiEntry = {
          id: -1, // 表示非数据库条目
          word: word,
          phonetics: [], // AI 不提供音标
          audio: [], // AI 不提供音频
          forms: [], // AI 不提供其他形式
          entries: [], // 英文释义为空
          chineseEntriesShort: aiDefinition.chinese_entries_short,
          createdAt: new Date().toISOString(),
          source: 'ai', // 标记来源为 'ai'
        };
        return aiEntry;
      }
    } catch (aiError) {
      // 如果 AI 服务也失败了，记录错误但最终还是抛出 NotFound
      console.error(`AI fallback failed for word "${word}":`, aiError);
    }

    // 4. 如果 DB 和 AI 都失败了，才抛出 404
    throw new NotFoundException(`Word '${word}' not found in DB or via AI.`);
  }
}
