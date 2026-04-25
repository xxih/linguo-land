import { PrismaClient } from '../generated/prisma';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const prisma = new PrismaClient();

/**
 * 把 scripts/build-dictionary.ts 产出的 dictionary-structured.jsonl 灌入 Postgres。
 *
 * 幂等：每个 word 先 deleteMany 再 create（schema cascade 会带走 DefinitionEntry / Sense），
 * 重复跑不会撞 unique 约束。
 */
async function main() {
  console.log('[START] 开始导入结构化词典数据...');

  const dataPath = path.join(__dirname, 'data', 'dictionary-structured.jsonl');
  if (!fs.existsSync(dataPath)) {
    console.error(`[ERROR] 找不到数据文件: ${dataPath}`);
    console.error(`        先跑：pnpm exec ts-node scripts/build-dictionary.ts`);
    process.exit(1);
  }

  const fileStream = fs.createReadStream(dataPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let processedCount = 0;
  let errorCount = 0;
  const batchSize = 100; // 每 100 个单词一个事务批次
  let batch: Array<Promise<unknown> | any> = [];

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const data = JSON.parse(line);

      const entryData = {
        word: data.word,
        phonetics: data.phonetics || [],
        audio: data.audio || [],
        forms: data.forms || [],
        chineseEntriesShort: data.chinese_entries_short || undefined,
        entries: {
          create: (data.entries || []).map((entry: any) => ({
            pos: entry.pos,
            senses: {
              create: (entry.senses || []).map((sense: any) => ({
                glosses: sense.glosses || [],
                examples: sense.examples || [],
              })),
            },
          })),
        },
      };

      // 幂等：删旧 → 建新（cascade 会清 DefinitionEntry / Sense）
      batch.push(prisma.dictionaryEntry.deleteMany({ where: { word: data.word } }));
      batch.push(prisma.dictionaryEntry.create({ data: entryData }));

      if (batch.length >= batchSize * 2) {
        await prisma.$transaction(batch);
        processedCount += batch.length / 2;
        console.log(`已处理 ${processedCount} 个单词...`);
        batch = [];
      }
    } catch (error) {
      errorCount++;
      console.error(
        `处理行数据时出错 (第 ${processedCount + errorCount} 行): ${line.substring(0, 50)}...`,
        error,
      );
    }
  }

  if (batch.length > 0) {
    await prisma.$transaction(batch);
    processedCount += batch.length / 2;
  }

  console.log(`[SUCCESS] 数据导入完成！`);
  console.log(`          - 成功导入: ${processedCount} 个单词`);
  console.log(`          - 失败数量: ${errorCount} 个`);
}

main()
  .catch((e) => {
    console.error('导入失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
