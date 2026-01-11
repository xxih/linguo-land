// apps/server/src/seed-tags.ts
import { PrismaClient } from '../generated/prisma';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('[START] 开始为词族打标签...');

  const dataPath = path.join(__dirname, 'data');
  const tagFiles = fs.readdirSync(dataPath).filter(f => f.startsWith('cet') && f.endsWith('.json'));

  for (const file of tagFiles) {
    console.log(`\n📄 正在处理词表: ${file}`);
    const content = fs.readFileSync(path.join(dataPath, file), 'utf-8');
    const data = JSON.parse(content);
    const { key, name, description, words } = data;

    // 1. 创建或更新 Tag
    const tag = await prisma.tag.upsert({
      where: { key },
      update: { name, description },
      create: { key, name, description },
    });
    console.log(`  [TAG] Tag "${tag.name}" 已确认.`);

    // 2. 找出这些单词所属的所有词族ID
    const wordFamilies = await prisma.word.findMany({
      where: {
        text: { in: words.map((w: string) => w.toLowerCase()) },
      },
      select: {
        familyId: true,
      },
    });

    const familyIds = [...new Set(wordFamilies.map(wf => wf.familyId))];
    console.log(`  [INFO] 找到 ${words.length} 个单词，关联到 ${familyIds.length} 个唯一词族.`);

    // 3. 为所有找到的词族关联上这个 Tag
    let updatedCount = 0;
    for (const familyId of familyIds) {
      try {
        await prisma.wordFamily.update({
          where: { id: familyId },
          data: {
            tags: {
              connect: { id: tag.id },
            },
          },
        });
        updatedCount++;
      } catch (e) {
        console.error(`  [ERROR] 关联词族 ID ${familyId} 到 Tag "${tag.name}" 失败`, e);
      }
    }
    console.log(`  [SUCCESS] 成功为 ${updatedCount} 个词族打上 "${tag.name}" 标签.`);
  }

  console.log('\n[COMPLETE] 所有词表处理完成！');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

