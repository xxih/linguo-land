import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  createReadStream,
  mkdirSync,
  existsSync,
  type ReadStream,
} from 'fs';
import { unlink, writeFile } from 'fs/promises';
import { join, extname, basename, resolve } from 'path';
import { randomUUID } from 'crypto';
import { parseEpubMeta } from './epub-parser';
import type {
  DocumentMeta,
  DocumentFormat,
  DocumentTocEntry,
} from 'shared-types';

/**
 * 文件落盘锚点：永远指向 apps/server/uploads/documents，无论 dev (ts-node 跑 src/) 还是
 * prod (跑 dist/) ——均为 __dirname 上溯两级。
 */
const STORAGE_ROOT = resolve(__dirname, '..', '..', 'uploads', 'documents');
const STORAGE_DIR_REL = 'uploads/documents';

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB

@Injectable()
export class DocumentsService implements OnModuleInit {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (!existsSync(STORAGE_ROOT)) {
      mkdirSync(STORAGE_ROOT, { recursive: true });
      this.logger.log(`mkdir 上传目录：${STORAGE_ROOT}`);
    }
  }

  /**
   * 上传一份文档。流程：
   * 1. 校验扩展名 / 大小
   * 2. 落盘到 STORAGE_ROOT/<uuid>.<ext>
   * 3. EPUB → 抽 title/author/toc；TXT → 用文件名当 title
   * 4. 入库
   */
  async upload(
    userId: number,
    file: Express.Multer.File,
  ): Promise<DocumentMeta> {
    if (!file) {
      throw new BadRequestException('未上传文件');
    }
    if (file.size > MAX_FILE_BYTES) {
      throw new BadRequestException(`文件超过上限 ${MAX_FILE_BYTES} 字节`);
    }
    const ext = extname(file.originalname).toLowerCase();
    let fileFormat: DocumentFormat;
    if (ext === '.epub') fileFormat = 'EPUB';
    else if (ext === '.txt') fileFormat = 'TXT';
    else throw new BadRequestException('仅支持 .txt / .epub');

    const fileName = `${randomUUID()}${ext}`;
    const fullPath = join(STORAGE_ROOT, fileName);
    await writeFile(fullPath, file.buffer);

    let title = basename(file.originalname, ext) || 'Untitled';
    let author: string | null = null;
    let toc: DocumentTocEntry[] | null = null;

    if (fileFormat === 'EPUB') {
      try {
        const meta = await parseEpubMeta(fullPath);
        if (meta.title) title = meta.title;
        if (meta.author) author = meta.author;
        if (meta.toc?.length) toc = meta.toc;
      } catch (err) {
        await unlink(fullPath).catch(() => {});
        const reason = err instanceof Error ? err.message : String(err);
        throw new BadRequestException(`EPUB 解析失败：${reason}`);
      }
    }

    const doc = await this.prisma.document.create({
      data: {
        ownerId: userId,
        title,
        author,
        fileFormat,
        filePath: `${STORAGE_DIR_REL}/${fileName}`,
        sizeBytes: file.size,
        toc: toc as any,
      },
    });

    this.logger.log(
      `[upload] user=${userId} ${fileFormat} "${title}" → doc#${doc.id}`,
    );

    return this.toMeta(doc);
  }

  /** 用户自有文档 + 系统预置（ownerId IS NULL） */
  async listForUser(userId: number): Promise<DocumentMeta[]> {
    const docs = await this.prisma.document.findMany({
      where: { OR: [{ ownerId: userId }, { ownerId: null }] },
      orderBy: [
        // 系统预置先（ownerId NULL 在 ASC 排序里在最后；用 desc 让 NULL 排前其实要看 DB）
        // 简单做法：按 createdAt desc，前端按 isPreset 自行分组
        { createdAt: 'desc' },
      ],
    });
    return docs.map((d) => this.toMeta(d));
  }

  /** 取详情，含 owner 校验：自有 / 系统预置可读，他人私有禁读 */
  async findReadable(userId: number, id: number) {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('文档不存在');
    if (doc.ownerId !== null && doc.ownerId !== userId) {
      throw new ForbiddenException('无权访问该文档');
    }
    return doc;
  }

  async getMeta(userId: number, id: number): Promise<DocumentMeta> {
    const doc = await this.findReadable(userId, id);
    return this.toMeta(doc);
  }

  /** 流回原文件，供移动端 download → 本地缓存 → epub.js 渲染 */
  async openFileStream(
    userId: number,
    id: number,
  ): Promise<{
    stream: ReadStream;
    fileFormat: DocumentFormat;
    sizeBytes: number;
    fileName: string;
  }> {
    const doc = await this.findReadable(userId, id);
    const fullPath = resolve(STORAGE_ROOT, '..', '..', doc.filePath);
    if (!existsSync(fullPath)) {
      throw new NotFoundException('文件已丢失');
    }
    return {
      stream: createReadStream(fullPath),
      fileFormat: doc.fileFormat as DocumentFormat,
      sizeBytes: doc.sizeBytes,
      fileName: basename(doc.filePath),
    };
  }

  /** 仅文档主可删；预置/他人文档不允许 */
  async deleteOwn(userId: number, id: number): Promise<void> {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('文档不存在');
    if (doc.ownerId !== userId) {
      throw new ForbiddenException('无权删除该文档');
    }

    await this.prisma.document.delete({ where: { id } });
    const fullPath = resolve(STORAGE_ROOT, '..', '..', doc.filePath);
    await unlink(fullPath).catch((err) => {
      this.logger.warn(`删除文件失败（DB 已删）：${fullPath} ${err}`);
    });
  }

  private toMeta(doc: {
    id: number;
    ownerId: number | null;
    title: string;
    author: string | null;
    fileFormat: string;
    sizeBytes: number;
    sourceLang: string;
    toc: any;
    createdAt: Date;
    updatedAt: Date;
  }): DocumentMeta {
    return {
      id: doc.id,
      title: doc.title,
      author: doc.author,
      fileFormat: doc.fileFormat as DocumentFormat,
      sizeBytes: doc.sizeBytes,
      sourceLang: doc.sourceLang,
      toc: (doc.toc as DocumentTocEntry[] | null) ?? null,
      isPreset: doc.ownerId === null,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}
