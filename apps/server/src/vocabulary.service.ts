import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import type { WordFamiliarityStatus } from 'shared-types';
import { WordFamiliarityStatus as PrismaWordStatus } from '../generated/prisma';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class VocabularyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 查询词元的状态（基于词族）
   * @param lemmas 词元列表（已还原的基本形式）
   * @param userId 用户ID
   * @returns 返回每个词元对应的词族状态
   */
  async queryWordsStatus(
    lemmas: string[],
    userId: number,
  ): Promise<
    Record<string, { status: WordFamiliarityStatus; familyRoot: string; familiarityLevel: number }>
  > {
    if (lemmas.length === 0) return {};

    // 1. 查找这些词元属于哪些词族
    const wordsWithFamily = await this.prisma.word.findMany({
      where: { text: { in: lemmas } },
      select: {
        text: true,
        family: {
          select: {
            id: true,
            rootWord: true,
          },
        },
      },
    });

    const familyIds = [...new Set(wordsWithFamily.map((w) => w.family.id))];

    // 2. 查询这些词族的状态和熟练度
    const familyStatuses = await this.prisma.userFamilyStatus.findMany({
      where: { userId, familyId: { in: familyIds } },
      select: { familyId: true, status: true, familiarityLevel: true },
    });

    const statusMap = new Map<
      number,
      { status: WordFamiliarityStatus; familiarityLevel: number }
    >();
    familyStatuses.forEach((s) => {
      statusMap.set(s.familyId, {
        status: this.mapPrismaStatusToStatus(s.status),
        familiarityLevel: s.familiarityLevel,
      });
    });

    // 3. 构建返回给前端的最终结果：{ lemma -> { status, familyRoot, familiarityLevel } }
    const result: Record<
      string,
      { status: WordFamiliarityStatus; familyRoot: string; familiarityLevel: number }
    > = {};
    wordsWithFamily.forEach((word) => {
      const familyData = statusMap.get(word.family.id);
      result[word.text] = {
        // 如果数据库没记录，则为 UNKNOWN
        status: familyData?.status || 'unknown',
        familyRoot: word.family.rootWord,
        familiarityLevel: familyData?.familiarityLevel || 0,
      };
    });

    return result;
  }

  async updateWordEncounter(word: string, userId: number): Promise<void> {
    // UserVocabulary 是旧表，userId 字段是 string 类型
    const userIdString = String(userId);
    await this.prisma.userVocabulary.upsert({
      where: {
        userId_word: {
          userId: userIdString,
          word,
        },
      },
      update: {
        lookupCount: { increment: 1 },
        lastSeenAt: new Date(),
      },
      create: {
        userId: userIdString,
        word,
        status: PrismaWordStatus.UNKNOWN,
        familiarityLevel: 0,
        lookupCount: 1,
        lastSeenAt: new Date(),
      },
    });
  }

  /**
   * 更新词族状态（基于词元）
   * @param lemma 词元（已还原的基本形式）
   * @param status 新状态（可选）
   * @param userId 用户ID
   * @param familiarityLevel 熟练度（可选）
   */
  async updateWordStatus(
    lemma: string,
    status: WordFamiliarityStatus | null,
    userId: number,
    familiarityLevel?: number,
  ): Promise<void> {
    // 1. 找到词元所属的词族
    const wordInfo = await this.prisma.word.findUnique({
      where: { text: lemma },
      select: { familyId: true, family: { select: { rootWord: true } } },
    });

    if (!wordInfo) {
      console.warn(`无法更新单词 "${lemma}" 的状态，因为它不属于任何词族。`);
      return;
    }

    const { familyId } = wordInfo;

    // 特殊处理：标记为"陌生"实际上是从词库中删除
    if (status === 'unknown') {
      console.log(`标记词族 "${wordInfo.family.rootWord}" (词元: "${lemma}") 为陌生，从词库中删除`);
      await this.prisma.userFamilyStatus.deleteMany({
        where: {
          userId,
          familyId,
        },
      });
      return;
    }

    // 如果只更新熟练度（不改变状态）
    if (status === null && familiarityLevel !== undefined) {
      const existing = await this.prisma.userFamilyStatus.findUnique({
        where: { userId_familyId: { userId, familyId } },
      });

      if (existing) {
        await this.prisma.userFamilyStatus.update({
          where: { userId_familyId: { userId, familyId } },
          data: {
            familiarityLevel,
            updatedAt: new Date(),
          },
        });
        console.log(
          `[UPDATE] 已更新词族 "${wordInfo.family.rootWord}" (词元: "${lemma}") 熟练度为 ${familiarityLevel}`,
        );
      }
      return;
    }

    // 将前端状态转换为Prisma状态
    const prismaStatus = status ? this.mapStatusToPrismaStatus(status) : undefined;

    // 根据状态设置默认熟练度等级
    let finalFamiliarityLevel = familiarityLevel;
    if (finalFamiliarityLevel === undefined && status) {
      switch (status) {
        case 'learning':
          finalFamiliarityLevel = 1;
          break;
        case 'known':
          finalFamiliarityLevel = 7;
          break;
        default:
          finalFamiliarityLevel = 0;
      }
    }

    // 2. 更新或创建该词族的状态记录
    if (prismaStatus) {
      await this.prisma.userFamilyStatus.upsert({
        where: { userId_familyId: { userId, familyId } },
        update: {
          status: prismaStatus,
          ...(finalFamiliarityLevel !== undefined && { familiarityLevel: finalFamiliarityLevel }),
          updatedAt: new Date(),
        },
        create: {
          userId,
          familyId,
          status: prismaStatus,
          familiarityLevel: finalFamiliarityLevel ?? 0,
          lastSeenAt: new Date(),
        },
      });

      console.log(
        `[UPDATE] 已更新词族 "${wordInfo.family.rootWord}" (词元: "${lemma}") 状态为 "${status}"`,
      );
    }
  }

  /**
   * 自动提升熟练度（最高到7）并增加查词次数
   * @param lemma 词元
   * @param userId 用户ID
   */
  async autoIncreaseFamiliarity(lemma: string, userId: number): Promise<void> {
    console.log('[VocabularyService] ========== 开始自动提升熟练度 ==========');
    console.log('[VocabularyService] 输入参数 - 词元:', lemma, '用户ID:', userId);

    const wordInfo = await this.prisma.word.findUnique({
      where: { text: lemma },
      select: { familyId: true, family: { select: { rootWord: true } } },
    });

    console.log('[VocabularyService] 查询词族信息:', wordInfo);

    if (!wordInfo) {
      console.log('[VocabularyService] 词元不存在于词族表中，终止处理');
      return;
    }

    const { familyId } = wordInfo;
    console.log('[VocabularyService] 词族ID:', familyId, '词族根:', wordInfo.family.rootWord);

    const existing = await this.prisma.userFamilyStatus.findUnique({
      where: { userId_familyId: { userId, familyId } },
    });

    console.log(
      '[VocabularyService] 查询用户词族状态:',
      existing
        ? {
            status: existing.status,
            familiarityLevel: existing.familiarityLevel,
            lookupCount: existing.lookupCount,
          }
        : '不存在',
    );

    if (existing) {
      // 如果记录已存在
      console.log('[VocabularyService] 记录已存在，检查状态和熟练度');
      console.log(
        '[VocabularyService] 当前状态:',
        existing.status,
        '当前熟练度:',
        existing.familiarityLevel,
      );

      // 如果是陌生状态，不记录查词次数，直接返回
      if (existing.status === PrismaWordStatus.UNKNOWN) {
        console.log('[VocabularyService] 状态为 UNKNOWN，不记录查词次数，直接返回');
        console.log(`[AUTO] 词族 "${wordInfo.family.rootWord}" 为陌生状态，跳过记录`);
        return;
      }

      if (existing.status === PrismaWordStatus.LEARNING && existing.familiarityLevel < 7) {
        // learning 状态且熟练度未满：提升熟练度并增加查词次数
        console.log('[VocabularyService] 满足提升条件：learning状态且熟练度<7，准备更新');
        const updated = await this.prisma.userFamilyStatus.update({
          where: { userId_familyId: { userId, familyId } },
          data: {
            familiarityLevel: existing.familiarityLevel + 1,
            lookupCount: { increment: 1 },
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          },
        });
        console.log('[VocabularyService] 更新成功:', {
          familiarityLevel: `${existing.familiarityLevel} -> ${updated.familiarityLevel}`,
          lookupCount: updated.lookupCount,
        });
        console.log(
          `[AUTO] 自动提升词族 "${wordInfo.family.rootWord}" 熟练度: ${existing.familiarityLevel} -> ${existing.familiarityLevel + 1}, 查词次数: ${updated.lookupCount}`,
        );
      } else {
        // 其他情况（已达最高熟练度、known状态等）：仅增加查词次数
        console.log('[VocabularyService] 不满足提升条件，仅增加查词次数');
        console.log(
          '[VocabularyService] 原因:',
          existing.status !== PrismaWordStatus.LEARNING ? '状态不是learning' : '熟练度已达最高',
        );
        const updated = await this.prisma.userFamilyStatus.update({
          where: { userId_familyId: { userId, familyId } },
          data: {
            lookupCount: { increment: 1 },
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          },
        });
        console.log('[VocabularyService] 更新查词次数成功:', updated.lookupCount);
        console.log(
          `[AUTO] 词族 "${wordInfo.family.rootWord}" 仅增加查词次数: ${updated.lookupCount}`,
        );
      }
    } else {
      // 如果记录不存在：不做任何操作（陌生词不记录）
      console.log('[VocabularyService] 记录不存在，不创建记录（陌生词不记录查词次数）');
      console.log(`[AUTO] 词族 "${wordInfo.family.rootWord}" 不在学习列表中，跳过记录`);
    }

    console.log('[VocabularyService] ========== 自动提升熟练度完成 ==========');
  }

  private mapPrismaStatusToStatus(prismaStatus: PrismaWordStatus): WordFamiliarityStatus {
    switch (prismaStatus) {
      case PrismaWordStatus.UNKNOWN:
        return 'unknown';
      case PrismaWordStatus.LEARNING:
        return 'learning';
      case PrismaWordStatus.KNOWN:
        return 'known';
      default:
        return 'unknown';
    }
  }

  private mapStatusToPrismaStatus(status: WordFamiliarityStatus): PrismaWordStatus {
    switch (status) {
      case 'unknown':
        return PrismaWordStatus.UNKNOWN;
      case 'learning':
        return PrismaWordStatus.LEARNING;
      case 'known':
        return PrismaWordStatus.KNOWN;
      default:
        return PrismaWordStatus.UNKNOWN;
    }
  }

  async getVocabularyStats(userId: number): Promise<{
    unknown: number;
    learning: number;
    known: number;
    total: number;
    recentFamilies: Array<{
      familyRoot: string;
      lastSeenAt: Date;
      lookupCount: number;
    }>;
  }> {
    // 基于词族的统计
    const stats = await this.prisma.userFamilyStatus.groupBy({
      by: ['status'],
      _count: {
        status: true,
      },
      where: {
        userId,
      },
    });

    // 初始化统计结果
    const result: {
      unknown: number;
      learning: number;
      known: number;
      total: number;
      recentFamilies: Array<{
        familyRoot: string;
        lastSeenAt: Date;
        lookupCount: number;
      }>;
    } = {
      unknown: 0,
      learning: 0,
      known: 0,
      total: 0,
      recentFamilies: [],
    };

    // 处理统计数据
    stats.forEach((stat) => {
      const count = stat._count.status;
      result.total += count;

      switch (stat.status) {
        case PrismaWordStatus.UNKNOWN:
          result.unknown = count;
          break;
        case PrismaWordStatus.LEARNING:
          result.learning = count;
          break;
        case PrismaWordStatus.KNOWN:
          result.known = count;
          break;
      }
    });

    // 获取最近遇到的生词族（unknown状态，按最后见到时间排序）
    const recentUnknownFamilies = await this.prisma.userFamilyStatus.findMany({
      where: {
        userId,
        status: PrismaWordStatus.UNKNOWN,
        lastSeenAt: { not: null },
      },
      select: {
        family: { select: { rootWord: true } },
        lastSeenAt: true,
        lookupCount: true,
      },
      orderBy: {
        lastSeenAt: 'desc',
      },
      take: 10, // 最多返回10个最近的生词族
    });

    result.recentFamilies = recentUnknownFamilies.map((item) => ({
      familyRoot: item.family.rootWord,
      lastSeenAt: item.lastSeenAt!,
      lookupCount: item.lookupCount,
    }));

    return result;
  }

  /**
   * 获取词族内的所有单词
   */
  async getWordsInFamily(familyRoot: string, userId: number): Promise<string[]> {
    const family = await this.prisma.wordFamily.findUnique({
      where: { rootWord: familyRoot },
      include: { words: { select: { text: true } } },
    });

    if (!family) {
      return [];
    }

    return family.words.map((w) => w.text);
  }

  async getAllVocabulary(
    userId: number,
    options: {
      page?: number;
      limit?: number;
      sortBy?: 'familyRoot' | 'status' | 'lastSeenAt' | 'lookupCount' | 'createdAt';
      sortOrder?: 'asc' | 'desc';
      status?: WordFamiliarityStatus;
      search?: string;
      importSource?: 'manual' | 'preset' | 'all'; // 新增：来源筛选
    } = {},
  ): Promise<{
    families: Array<{
      familyRoot: string;
      wordCount: number;
      status: WordFamiliarityStatus;
      familiarityLevel: number;
      lookupCount: number;
      lastSeenAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const {
      page = 1,
      limit = 20,
      sortBy = 'lastSeenAt',
      sortOrder = 'desc',
      status,
      search,
      importSource = 'all',
    } = options;

    const skip = (page - 1) * limit;

    // 构建where条件
    const where: {
      userId: number;
      status?: PrismaWordStatus;
      importSource?: any;
      family?: {
        rootWord?: {
          contains: string;
          mode: 'insensitive';
        };
      };
    } = { userId };

    if (status) {
      where.status = this.mapStatusToPrismaStatus(status);
    }

    if (search) {
      where.family = {
        rootWord: {
          contains: search,
          mode: 'insensitive',
        },
      };
    }

    // 来源筛选
    if (importSource === 'manual') {
      where.importSource = null; // 手动添加的词汇没有importSource
    } else if (importSource === 'preset') {
      where.importSource = { not: null }; // 预设导入的词汇有importSource
    }
    // 'all' 则不添加筛选条件

    // 获取总数
    const total = await this.prisma.userFamilyStatus.count({ where });

    // 构建排序条件 - 添加稳定的二级排序
    let orderBy: any;
    if (sortBy === 'familyRoot') {
      orderBy = [
        { family: { rootWord: sortOrder } },
        { id: 'asc' }, // 添加id作为稳定的二级排序
      ];
    } else if (sortBy === 'lastSeenAt') {
      // lastSeenAt 特殊处理：null值统一放到最后，然后按id排序保证稳定性
      orderBy = [{ [sortBy]: { sort: sortOrder, nulls: 'last' } }, { id: 'asc' }];
    } else {
      orderBy = [
        { [sortBy]: sortOrder },
        { id: 'asc' }, // 添加id作为稳定的二级排序
      ];
    }

    // 获取数据
    const families = await this.prisma.userFamilyStatus.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        family: {
          include: {
            _count: {
              select: { words: true },
            },
          },
        },
      },
    });

    const totalPages = Math.ceil(total / limit);

    return {
      families: families.map((item) => ({
        familyRoot: item.family.rootWord,
        wordCount: item.family._count.words,
        status: this.mapPrismaStatusToStatus(item.status),
        familiarityLevel: item.familiarityLevel,
        lookupCount: item.lookupCount,
        lastSeenAt: item.lastSeenAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      total,
      page,
      limit,
      totalPages,
    };
  }

  // 新增方法：加载预设词库
  private _loadPresetList(listKey: string): Promise<{ name: string; words: string[] }> {
    return new Promise((resolve, reject) => {
      // 尝试多个可能的路径
      const possiblePaths = [
        path.join(__dirname, 'data', `${listKey}.json`), // 编译后的路径
        path.join(__dirname, '..', 'data', `${listKey}.json`), // 可能的相对路径
        path.join(process.cwd(), 'apps', 'server', 'src', 'data', `${listKey}.json`), // 开发模式路径
        path.join(process.cwd(), 'src', 'data', `${listKey}.json`), // 当前工作目录
      ];

      let filePath: string | null = null;
      for (const testPath of possiblePaths) {
        if (fs.existsSync(testPath)) {
          filePath = testPath;
          break;
        }
      }

      if (!filePath) {
        reject(
          new Error(
            `Preset list '${listKey}' not found. Searched paths: ${possiblePaths.join(', ')}`,
          ),
        );
        return;
      }

      try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(fileContent) as {
          name: string;
          words: string[];
        };
        resolve({ name: data.name, words: data.words });
      } catch (error) {
        reject(error);
      }
    });
  }

  // 通用的预设词库添加方法
  async addPresetVocabulary(
    listKey: string,
    userId: number,
  ): Promise<{ message: string; count: number; familiesAdded: number }> {
    const { name, words } = await this._loadPresetList(listKey);

    console.log(`为用户 ${userId} 添加 '${name}' 词库, 共 ${words.length} 个单词`);

    // 新逻辑：基于词族
    // 1. 查找这些词元对应的词族
    const wordsWithFamily = await this.prisma.word.findMany({
      where: { text: { in: words } },
      select: {
        text: true,
        familyId: true,
        family: { select: { rootWord: true } },
      },
    });

    // 获取所有唯一的词族ID
    const uniqueFamilyIds = [...new Set(wordsWithFamily.map((w) => w.familyId))];

    console.log(
      `  找到 ${wordsWithFamily.length}/${words.length} 个词元，涉及 ${uniqueFamilyIds.length} 个词族`,
    );

    // 2. 为每个词族创建或更新状态记录
    let familiesAdded = 0;
    const importSource = `preset:${listKey}`; // 标记来源，如 "preset:cet4"
    for (const familyId of uniqueFamilyIds) {
      try {
        await this.prisma.userFamilyStatus.upsert({
          where: { userId_familyId: { userId, familyId } },
          update: {
            // 如果已存在，不覆盖（用户可能已经调整过状态）
          },
          create: {
            userId,
            familyId,
            status: PrismaWordStatus.KNOWN, // 预设词库默认都认识
            familiarityLevel: 7,
            importSource, // 标记导入来源
          },
        });
        familiesAdded++;
      } catch (error) {
        console.error(`创建词族状态失败 (familyId: ${familyId}):`, error);
      }
    }

    console.log(`  [SUCCESS] 成功添加 ${familiesAdded} 个词族`);

    return {
      message: `'${name}' 添加成功`,
      count: words.length,
      familiesAdded,
    };
  }

  // 获取所有可用的预设词库信息
  getAvailablePresets(): Promise<Array<{ key: string; name: string; description: string }>> {
    return new Promise((resolve, reject) => {
      try {
        // 尝试多个可能的路径找到data目录
        const possibleDataDirs = [
          path.join(__dirname, 'data'),
          path.join(__dirname, '..', 'data'),
          path.join(process.cwd(), 'apps', 'server', 'src', 'data'),
          path.join(process.cwd(), 'src', 'data'),
        ];

        let dataDir: string | null = null;
        for (const testDir of possibleDataDirs) {
          if (fs.existsSync(testDir)) {
            dataDir = testDir;
            break;
          }
        }

        if (!dataDir) {
          reject(new Error(`Data directory not found. Searched: ${possibleDataDirs.join(', ')}`));
          return;
        }

        const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json'));

        const presets = files.map((file) => {
          const fileContent = fs.readFileSync(path.join(dataDir!, file), 'utf-8');
          const data = JSON.parse(fileContent) as {
            key: string;
            name: string;
            description: string;
          };
          return {
            key: data.key,
            name: data.name,
            description: data.description,
          };
        });
        resolve(presets);
      } catch (error) {
        reject(error);
      }
    });
  }

  // 获取所有词汇来源
  async getVocabularySources(userId: number): Promise<string[]> {
    // UserVocabulary 是旧表，userId 字段是 string 类型
    const userIdString = String(userId);
    const sources = await this.prisma.userVocabulary.findMany({
      where: { userId: userIdString, importSource: { not: null } },
      distinct: ['importSource'],
      select: { importSource: true },
    });
    return sources
      .map((s) => s.importSource!)
      .filter((source): source is string => Boolean(source));
  }

  // 导出词汇为JSON
  async exportVocabularyToJson(userId: number): Promise<string> {
    const allFamilies = await this.prisma.userFamilyStatus.findMany({
      where: { userId },
      include: {
        family: {
          include: {
            words: {
              select: {
                text: true,
              },
            },
          },
        },
      },
      orderBy: { family: { rootWord: 'asc' } },
    });

    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      userId,
      families: allFamilies.map((f) => ({
        familyRoot: f.family.rootWord,
        status: this.mapPrismaStatusToStatus(f.status),
        familiarityLevel: f.familiarityLevel,
        lookupCount: f.lookupCount,
        lastSeenAt: f.lastSeenAt ? f.lastSeenAt.toISOString() : null,
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
        words: f.family.words.map((w) => w.text),
      })),
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * 导出词汇为纯文本格式（只包含familyRoot）
   * @param userId 用户ID
   * @param status 可选的状态筛选
   * @returns 纯文本字符串，每行一个单词
   */
  async exportVocabularyToTxt(userId: number, status?: WordFamiliarityStatus): Promise<string> {
    const where: any = { userId };
    if (status) {
      where.status = this.mapStatusToPrismaStatus(status);
    }

    const families = await this.prisma.userFamilyStatus.findMany({
      where,
      include: {
        family: {
          select: {
            rootWord: true,
          },
        },
      },
      orderBy: { family: { rootWord: 'asc' } },
    });

    // 只返回familyRoot，每行一个
    return families.map((f) => f.family.rootWord).join('\n');
  }

  /**
   * 导出词汇为简单JSON数组格式（只包含familyRoot）
   * @param userId 用户ID
   * @param status 可选的状态筛选
   * @returns JSON数组字符串
   */
  async exportVocabularyToJsonArray(
    userId: number,
    status?: WordFamiliarityStatus,
  ): Promise<string> {
    const where: any = { userId };
    if (status) {
      where.status = this.mapStatusToPrismaStatus(status);
    }

    const families = await this.prisma.userFamilyStatus.findMany({
      where,
      include: {
        family: {
          select: {
            rootWord: true,
          },
        },
      },
      orderBy: { family: { rootWord: 'asc' } },
    });

    // 只返回familyRoot数组
    const rootWords = families.map((f) => f.family.rootWord);
    return JSON.stringify(rootWords, null, 2);
  }

  // 从JSON导入词汇
  async importVocabularyFromJson(
    jsonContent: string,
    userId: number,
  ): Promise<{ message: string; imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    try {
      const data = JSON.parse(jsonContent);

      // 验证数据格式
      if (!data.families || !Array.isArray(data.families)) {
        throw new Error('无效的JSON格式：缺少families数组');
      }

      for (const familyData of data.families) {
        const { familyRoot, status, familiarityLevel, lookupCount } = familyData;

        if (!familyRoot) {
          skipped++;
          continue;
        }

        try {
          // 查找词族
          const family = await this.prisma.wordFamily.findFirst({
            where: { rootWord: familyRoot },
          });

          if (!family) {
            console.warn(`词族 "${familyRoot}" 不存在，跳过`);
            skipped++;
            continue;
          }

          // 如果状态是unknown，则删除记录
          if (status === 'unknown') {
            await this.prisma.userFamilyStatus.deleteMany({
              where: {
                userId,
                familyId: family.id,
              },
            });
            imported++;
            continue;
          }

          // 创建或更新词族状态
          await this.prisma.userFamilyStatus.upsert({
            where: {
              userId_familyId: {
                userId,
                familyId: family.id,
              },
            },
            update: {
              status: this.mapStatusToPrismaStatus(status as WordFamiliarityStatus),
              familiarityLevel: familiarityLevel || 0,
              lookupCount: lookupCount || 0,
              updatedAt: new Date(),
            },
            create: {
              userId,
              familyId: family.id,
              status: this.mapStatusToPrismaStatus(status as WordFamiliarityStatus),
              familiarityLevel: familiarityLevel || 0,
              lookupCount: lookupCount || 0,
              lastSeenAt: new Date(),
            },
          });
          imported++;
        } catch (error) {
          console.error(`导入词族 "${familyRoot}" 失败:`, error);
          skipped++;
        }
      }

      return { message: '导入完成', imported, skipped };
    } catch (error) {
      throw new Error(`JSON解析失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  // 添加一些示例数据的方法
  async seedSampleData(userId: number): Promise<void> {
    // UserVocabulary 是旧表，userId 字段是 string 类型
    const userIdString = String(userId);
    const sampleWords = [
      { word: 'hello', status: PrismaWordStatus.KNOWN, familiarityLevel: 7 },
      { word: 'world', status: PrismaWordStatus.KNOWN, familiarityLevel: 7 },
      {
        word: 'javascript',
        status: PrismaWordStatus.LEARNING,
        familiarityLevel: 3,
      },
      {
        word: 'algorithm',
        status: PrismaWordStatus.LEARNING,
        familiarityLevel: 2,
      },
      {
        word: 'sophisticated',
        status: PrismaWordStatus.UNKNOWN,
        familiarityLevel: 0,
      },
    ];

    for (const word of sampleWords) {
      await this.prisma.userVocabulary.upsert({
        where: {
          userId_word: {
            userId: userIdString,
            word: word.word,
          },
        },
        update: {},
        create: {
          userId: userIdString,
          word: word.word,
          status: word.status,
          familiarityLevel: word.familiarityLevel,
          lookupCount: 0,
        },
      });
    }
  }

  /**
   * 从词族中移除单词
   * @param wordText 要移除的单词
   * @param userId 用户ID（用于权限检查）
   */
  async removeWordFromFamily(
    wordText: string,
    userId: number,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // 查找单词
      const word = await this.prisma.word.findUnique({
        where: { text: wordText },
        include: {
          family: {
            include: {
              words: true,
            },
          },
        },
      });

      if (!word) {
        return { success: false, message: `单词 "${wordText}" 不存在` };
      }

      const familyRoot = word.family.rootWord;

      // 如果词族中只有一个单词，则不允许删除
      if (word.family.words.length === 1) {
        return {
          success: false,
          message: `无法删除，词族 "${familyRoot}" 中只有一个单词`,
        };
      }

      // 删除单词
      await this.prisma.word.delete({
        where: { text: wordText },
      });

      return {
        success: true,
        message: `已将 "${wordText}" 从词族 "${familyRoot}" 中移除`,
      };
    } catch (error) {
      console.error('Error removing word from family:', error);
      return {
        success: false,
        message: `移除失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }

  /**
   * 将单词移动到另一个词族
   * @param wordText 要移动的单词
   * @param newFamilyRoot 目标词族的根词
   * @param userId 用户ID（用于权限检查）
   */
  async moveWordToFamily(
    wordText: string,
    newFamilyRoot: string,
    userId: number,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // 查找单词
      const word = await this.prisma.word.findUnique({
        where: { text: wordText },
        include: {
          family: true,
        },
      });

      if (!word) {
        return { success: false, message: `单词 "${wordText}" 不存在` };
      }

      // 查找目标词族
      const targetFamily = await this.prisma.wordFamily.findUnique({
        where: { rootWord: newFamilyRoot },
      });

      if (!targetFamily) {
        return { success: false, message: `目标词族 "${newFamilyRoot}" 不存在` };
      }

      // 更新单词的词族
      await this.prisma.word.update({
        where: { text: wordText },
        data: {
          familyId: targetFamily.id,
        },
      });

      return {
        success: true,
        message: `已将 "${wordText}" 从词族 "${word.family.rootWord}" 移动到 "${newFamilyRoot}"`,
      };
    } catch (error) {
      console.error('Error moving word to family:', error);
      return {
        success: false,
        message: `移动失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }

  /**
   * 创建新词族（从单个单词创建）
   * @param wordText 单词
   * @param userId 用户ID
   */
  async createFamilyFromWord(
    wordText: string,
    userId: number,
  ): Promise<{ success: boolean; message: string; familyRoot?: string }> {
    try {
      // 检查单词是否已存在
      const existingWord = await this.prisma.word.findUnique({
        where: { text: wordText },
      });

      if (existingWord) {
        return { success: false, message: `单词 "${wordText}" 已经属于某个词族` };
      }

      // 创建新词族
      const newFamily = await this.prisma.wordFamily.create({
        data: {
          rootWord: wordText,
          words: {
            create: {
              text: wordText,
            },
          },
        },
      });

      return {
        success: true,
        message: `已为单词 "${wordText}" 创建新词族`,
        familyRoot: newFamily.rootWord,
      };
    } catch (error) {
      console.error('Error creating family from word:', error);
      return {
        success: false,
        message: `创建失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }

  // 旧的方法已被通用方法替代
  // private readonly juniorSchoolWords = [ ... ]; // 已删除
  // private readonly cetWords = [ ... ]; // 已删除
  // async addHighSchoolVocabulary(...) // 已删除，替换为 addPresetVocabulary('junior_high')
  // async addCETVocabulary(...) // 已删除，替换为 addPresetVocabulary('cet_4_6')
}
