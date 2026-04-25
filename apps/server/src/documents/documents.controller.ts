import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  ParseIntPipe,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  StreamableFile,
  Header,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards';
import { DocumentsService } from './documents.service';
import type {
  DocumentListResponse,
  DocumentMeta,
} from 'shared-types';

@Controller('api/v1/documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  /** 书架：自有 + 系统预置 */
  @Get()
  async list(@Request() req: any): Promise<DocumentListResponse> {
    const userId: number = req.user.id;
    const documents = await this.documentsService.listForUser(userId);
    return { documents };
  }

  /** 详情（含 toc） */
  @Get(':id')
  async getOne(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<DocumentMeta> {
    const userId: number = req.user.id;
    return this.documentsService.getMeta(userId, id);
  }

  /** 上传 .txt 或 .epub */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async upload(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<DocumentMeta> {
    const userId: number = req.user.id;
    return this.documentsService.upload(userId, file);
  }

  /** 拉文件原始字节（移动端缓存到本地交给 epub.js / 直接当 TXT 渲染） */
  @Get(':id/file')
  async download(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const userId: number = req.user.id;
    const { stream, fileFormat, sizeBytes, fileName } =
      await this.documentsService.openFileStream(userId, id);
    res.setHeader(
      'Content-Type',
      fileFormat === 'EPUB' ? 'application/epub+zip' : 'text/plain; charset=utf-8',
    );
    res.setHeader('Content-Length', String(sizeBytes));
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(fileName)}"`,
    );
    return new StreamableFile(stream);
  }

  /** 仅删自有文档；预置不允许删 */
  @Delete(':id')
  async deleteOne(
    @Request() req: any,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ ok: true }> {
    const userId: number = req.user.id;
    await this.documentsService.deleteOwn(userId, id);
    return { ok: true };
  }

  @Get('health/check')
  @Header('Cache-Control', 'no-store')
  health(): { status: string } {
    return { status: 'OK' };
  }
}
