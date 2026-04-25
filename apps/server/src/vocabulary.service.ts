import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import type {
  VocabularySyncFamily,
  VocabularySyncResponse,
  WordFamiliarityStatus,
} from 'shared-types';
import { Prisma, WordFamiliarityStatus as PrismaWordStatus } from '../generated/prisma';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 写入操作的结果——告知扩展端如何更新本地 mirror。
 *  - updated: family upsert
 *  - removed: family 已从用户词库移除（按 root 删镜像）
 *  - noop: 词不在系统词表 / 状态无变化
 */
export type MutationOutcome =
  | { kind: 'updated'; family: VocabularySyncFamily }
  | { kind: 'removed'; familyRoot: string }
  | { kind: 'noop' };

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

  /**
   * 更新词族状态（基于词元）。
   * 返回 MutationOutcome——告知扩展端如何更新本地 mirror。
   */
  async updateWordStatus(
    lemma: string,
    status: WordFamiliarityStatus | null,
    userId: number,
    familiarityLevel?: number,
  ): Promise<MutationOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const wordInfo = await tx.word.findUnique({
        where: { text: lemma },
        select: { familyId: true, family: { select: { rootWord: true } } },
      });

      if (!wordInfo) {
        console.warn(`无法更新单词 "${lemma}" 的状态，因为它不属于任何词族。`);
        return { kind: 'noop' };
      }

      const { familyId } = wordInfo;
      const { rootWord } = wordInfo.family;

      // "unknown" 表示从词库中移除该词族——告知客户端按 root 删除镜像
      if (status === 'unknown') {
        await tx.userFamilyStatus.deleteMany({ where: { userId, familyId } });
        console.log(`[UPDATE] 词族 "${rootWord}" (词元: "${lemma}") 已从词库移除`);
        return { kind: 'removed', familyRoot: rootWord };
      }

      // 仅更新熟练度（保持状态）
      if (status === null && familiarityLevel !== undefined) {
        await tx.userFamilyStatus.updateMany({
          where: { userId, familyId },
          data: { familiarityLevel, updatedAt: new Date() },
        });
        console.log(`[UPDATE] 已更新词族 "${rootWord}" 熟练度为 ${familiarityLevel}`);
        const family = await this.readFamilyState(tx, userId, familyId);
        return family ? { kind: 'updated', family } : { kind: 'noop' };
      }

      const prismaStatus = status ? this.mapStatusToPrismaStatus(status) : undefined;
      if (!prismaStatus) return { kind: 'noop' };

      let finalFamiliarityLevel = familiarityLevel;
      if (finalFamiliarityLevel === undefined) {
        finalFamiliarityLevel = status === 'learning' ? 1 : status === 'known' ? 7 : 0;
      }

      await tx.userFamilyStatus.upsert({
        where: { userId_familyId: { userId, familyId } },
        update: {
          status: prismaStatus,
          familiarityLevel: finalFamiliarityLevel,
          updatedAt: new Date(),
        },
        create: {
          userId,
          familyId,
          status: prismaStatus,
          familiarityLevel: finalFamiliarityLevel,
          lastSeenAt: new Date(),
        },
      });

      console.log(`[UPDATE] 已更新词族 "${rootWord}" (词元: "${lemma}") 状态为 "${status}"`);
      const family = await this.readFamilyState(tx, userId, familyId);
      return family ? { kind: 'updated', family } : { kind: 'noop' };
    });
  }

  /**
   * 自动提升熟练度（最高到 7）并增加查词次数。
   */
  async autoIncreaseFamiliarity(lemma: string, userId: number): Promise<MutationOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const wordInfo = await tx.word.findUnique({
        where: { text: lemma },
        select: { familyId: true, family: { select: { rootWord: true } } },
      });

      if (!wordInfo) return { kind: 'noop' };

      const { familyId } = wordInfo;
      const existing = await tx.userFamilyStatus.findUnique({
        where: { userId_familyId: { userId, familyId } },
      });

      // 不在学习列表里的词（含从未加入 + 已标记 unknown）不记录 lookup
      if (!existing || existing.status === PrismaWordStatus.UNKNOWN) {
        return { kind: 'noop' };
      }

      const shouldRaise =
        existing.status === PrismaWordStatus.LEARNING && existing.familiarityLevel < 7;

      const updated = await tx.userFamilyStatus.update({
        where: { userId_familyId: { userId, familyId } },
        data: {
          ...(shouldRaise && { familiarityLevel: existing.familiarityLevel + 1 }),
          lookupCount: { increment: 1 },
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      });

      if (shouldRaise) {
        console.log(
          `[AUTO] 词族 "${wordInfo.family.rootWord}" 熟练度 ${existing.familiarityLevel} -> ${updated.familiarityLevel}，查词次数 ${updated.lookupCount}`,
        );
      } else {
        console.log(
          `[AUTO] 词族 "${wordInfo.family.rootWord}" 仅增加查词次数: ${updated.lookupCount}`,
        );
      }

      const family = await this.readFamilyState(tx, userId, familyId);
      return family ? { kind: 'updated', family } : { kind: 'noop' };
    });
  }

  /**
   * 读取 (userId, familyId) 的最新完整状态——含 familyRoot、所有词形、status、familiarityLevel。
   * 在写事务内复用，避免事务外二次查询。
   */
  private async readFamilyState(
    tx: Prisma.TransactionClient,
    userId: number,
    familyId: number,
  ): Promise<VocabularySyncFamily | null> {
    const status = await tx.userFamilyStatus.findUnique({
      where: { userId_familyId: { userId, familyId } },
      select: {
        status: true,
        familiarityLevel: true,
        family: {
          select: {
            rootWord: true,
            words: { select: { text: true } },
          },
        },
      },
    });

    if (!status) return null;

    return {
      familyRoot: status.family.rootWord,
      lemmas: status.family.words.map((w) => w.text),
      status: this.mapPrismaStatusToStatus(status.status),
      familiarityLevel: status.familiarityLevel,
    };
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
   * 全量同步：一次性返回当前用户拥有的所有词族及其所有词形。
   * 扩展端用此构建本地镜像，所有 QUERY_WORDS_STATUS 读路径走本地。
   */
  async syncVocabulary(userId: number): Promise<VocabularySyncResponse> {
    const rows = await this.prisma.userFamilyStatus.findMany({
      where: { userId },
      select: {
        status: true,
        familiarityLevel: true,
        family: {
          select: {
            rootWord: true,
            words: { select: { text: true } },
          },
        },
      },
    });

    const families = rows.map((row) => ({
      familyRoot: row.family.rootWord,
      lemmas: row.family.words.map((w) => w.text),
      status: this.mapPrismaStatusToStatus(row.status),
      familiarityLevel: row.familiarityLevel,
    }));

    return {
      syncedAt: new Date().toISOString(),
      families,
    };
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
    const sources = await this.prisma.userFamilyStatus.findMany({
      where: { userId, importSource: { not: null } },
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

}
