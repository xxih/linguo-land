import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { ReadingProgressDto } from 'shared-types';

@Injectable()
export class ReadingProgressService {
  constructor(private readonly prisma: PrismaService) {}

  /** 进入文档时拉远端进度（不存在返回 null） */
  async getForDocument(
    userId: number,
    documentId: number,
  ): Promise<ReadingProgressDto | null> {
    await this.assertReadable(userId, documentId);
    const row = await this.prisma.readingProgress.findUnique({
      where: { userId_documentId: { userId, documentId } },
    });
    if (!row) return null;
    return this.toDto(row);
  }

  /** 阅读中节流上报 */
  async upsert(
    userId: number,
    input: { documentId: number; locator: string; percent?: number },
  ): Promise<ReadingProgressDto> {
    if (!input.locator || typeof input.locator !== 'string') {
      throw new BadRequestException('locator 必填');
    }
    if (input.percent !== undefined) {
      if (input.percent < 0 || input.percent > 1 || Number.isNaN(input.percent)) {
        throw new BadRequestException('percent 必须 ∈ [0, 1]');
      }
    }
    await this.assertReadable(userId, input.documentId);

    const row = await this.prisma.readingProgress.upsert({
      where: {
        userId_documentId: { userId, documentId: input.documentId },
      },
      update: {
        locator: input.locator,
        percent: input.percent ?? null,
      },
      create: {
        userId,
        documentId: input.documentId,
        locator: input.locator,
        percent: input.percent ?? null,
      },
    });
    return this.toDto(row);
  }

  /** 列出该用户所有阅读过的文档进度（书架进度条用） */
  async listForUser(userId: number): Promise<ReadingProgressDto[]> {
    const rows = await this.prisma.readingProgress.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  private async assertReadable(userId: number, documentId: number): Promise<void> {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { ownerId: true },
    });
    if (!doc) throw new NotFoundException('文档不存在');
    if (doc.ownerId !== null && doc.ownerId !== userId) {
      throw new ForbiddenException('无权访问该文档');
    }
  }

  private toDto(row: {
    documentId: number;
    locator: string;
    percent: number | null;
    updatedAt: Date;
  }): ReadingProgressDto {
    return {
      documentId: row.documentId,
      locator: row.locator,
      percent: row.percent,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
