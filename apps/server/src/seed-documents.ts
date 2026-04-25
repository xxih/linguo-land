/**
 * 阅读器预置内容 seed。
 *
 * 系统预置文档（ownerId === null）所有用户可见但不可删，作为新用户首登能立刻读到的样本。
 * 当前只有一份英文 welcome 短文，目的是让用户在三分钟内学会"单击查词→加生词本→进度同步"。
 *
 * 跑法：
 *   pnpm --filter server seed:documents
 *
 * 重复跑安全：按"标题+ownerId NULL"做幂等检查，不重复插入。
 */
import { PrismaClient } from '../generated/prisma';
import { mkdirSync, copyFileSync, statSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

const STORAGE_ROOT = resolve(__dirname, '..', 'uploads', 'documents');
const STORAGE_DIR_REL = 'uploads/documents';
const SEED_DIR = resolve(__dirname, '..', 'seed-data');

interface PresetSpec {
  title: string;
  author: string | null;
  fileFormat: 'TXT' | 'EPUB';
  /** 相对 SEED_DIR */
  sourceFile: string;
  sourceLang?: string;
}

const PRESETS: PresetSpec[] = [
  {
    title: 'Welcome to LinguoLand Reader',
    author: 'LinguoLand',
    fileFormat: 'TXT',
    sourceFile: 'welcome.txt',
    sourceLang: 'en',
  },
];

async function main(): Promise<void> {
  if (!existsSync(STORAGE_ROOT)) {
    mkdirSync(STORAGE_ROOT, { recursive: true });
  }

  for (const preset of PRESETS) {
    const existing = await prisma.document.findFirst({
      where: { ownerId: null, title: preset.title },
    });
    if (existing) {
      console.log(`[skip] 已存在预置文档 "${preset.title}" (id=${existing.id})`);
      continue;
    }

    const srcPath = join(SEED_DIR, preset.sourceFile);
    if (!existsSync(srcPath)) {
      throw new Error(`seed 源文件不存在：${srcPath}`);
    }
    const ext = preset.fileFormat === 'EPUB' ? '.epub' : '.txt';
    const fileName = `${randomUUID()}${ext}`;
    const dstPath = join(STORAGE_ROOT, fileName);
    copyFileSync(srcPath, dstPath);
    const { size } = statSync(dstPath);

    const created = await prisma.document.create({
      data: {
        ownerId: null,
        title: preset.title,
        author: preset.author,
        fileFormat: preset.fileFormat,
        filePath: `${STORAGE_DIR_REL}/${fileName}`,
        sizeBytes: size,
        sourceLang: preset.sourceLang ?? 'en',
        // toc 字段对 TXT 留空；Prisma JSON 默认 null
      },
    });
    console.log(
      `[create] 预置文档 "${preset.title}" → doc#${created.id} (${size} bytes)`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
