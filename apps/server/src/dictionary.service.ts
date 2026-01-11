import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class DictionaryService {
  private readonly logger = new Logger(DictionaryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findWord(word: string) {
    const searchWord = word.toLowerCase();

    // 尝试通过词族表找到词根和标签
    const wordRecord = await this.prisma.word.findUnique({
      where: { text: searchWord },
      include: {
        family: {
          include: {
            // 关键：同时包含词族关联的标签
            tags: {
              select: { id: true, key: true, name: true, description: true },
            },
          },
        },
      },
    });

    // 确定要查询的词（rootWord）和标签
    const queryWord = wordRecord ? wordRecord.family.rootWord : searchWord;
    const tags = wordRecord ? wordRecord.family.tags : [];

    this.logger.debug(`Querying dictionary for "${queryWord}" with tags: ${tags.map(t => t.name).join(', ')}`);

    // 使用词根或原词查询词典
    const entry = await this.prisma.dictionaryEntry.findUnique({
      where: { word: queryWord },
      include: {
        entries: {
          include: {
            senses: true,
          },
        },
      },
    });

    if (!entry) {
      throw new NotFoundException(`Word '${word}' not found in the dictionary.`);
    }

    // 将查询到的 entry 和 tags 组合起来返回
    return { ...entry, tags };
  }
}
