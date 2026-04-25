import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards';
import { ReadingProgressService } from './reading-progress.service';
import type {
  ReadingProgressDto,
  UpsertReadingProgressRequest,
} from 'shared-types';

@Controller('api/v1/reading-progress')
@UseGuards(JwtAuthGuard)
export class ReadingProgressController {
  constructor(private readonly service: ReadingProgressService) {}

  /** 单个文档进度（进入 reader 时拉一次） */
  @Get('by-document/:documentId')
  async getByDocument(
    @Request() req: any,
    @Param('documentId', ParseIntPipe) documentId: number,
  ): Promise<{ progress: ReadingProgressDto | null }> {
    const userId: number = req.user.id;
    const progress = await this.service.getForDocument(userId, documentId);
    return { progress };
  }

  /** 全部进度（书架进度条用） */
  @Get()
  async list(
    @Request() req: any,
  ): Promise<{ progress: ReadingProgressDto[] }> {
    const userId: number = req.user.id;
    const progress = await this.service.listForUser(userId);
    return { progress };
  }

  /** 阅读中节流上报 */
  @Post()
  async upsert(
    @Request() req: any,
    @Body() body: UpsertReadingProgressRequest,
  ): Promise<{ progress: ReadingProgressDto }> {
    const userId: number = req.user.id;
    const progress = await this.service.upsert(userId, {
      documentId: body.documentId,
      locator: body.locator,
      percent: body.percent,
    });
    return { progress };
  }
}
