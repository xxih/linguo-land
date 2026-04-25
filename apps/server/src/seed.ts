import { PrismaClient } from '../generated/prisma';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('开始导入词族数据...');

  // 词族数据由 scripts/rebuild-word-families.ts 从 dictionary-whitelist.json 出发，
  // 用 lemma-expander 反向生成（ADR 0018）。每次词典/规则变化跑一次 rebuild
  // 即可，seed 只是把 JSON 写入 DB。
  const dataPath = path.join(__dirname, 'data/word-families.json');

  if (!fs.existsSync(dataPath)) {
    console.error(`找不到数据文件: ${dataPath}`);
    console.error('先跑：pnpm --filter server ts-node scripts/rebuild-word-families.ts');
    process.exit(1);
  }

  const wordFamilyData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  console.log(`读取到 ${Object.keys(wordFamilyData).length} 个词族`);

  let processedFamilies = 0;
  let processedWords = 0;

  // 遍历每个词族
  for (const [rootWord, wordsInFamily] of Object.entries(wordFamilyData)) {
    if (!Array.isArray(wordsInFamily) || wordsInFamily.length === 0) {
      console.warn(`跳过无效词族: ${rootWord}`);
      continue;
    }

    try {
      // 1. 创建或更新 WordFamily
      const family = await prisma.wordFamily.upsert({
        where: { rootWord },
        update: {},
        create: { rootWord },
      });

      // 2. 写入词族下所有 surface form。Word.text @unique，多 family 同时
      // 声明同一词时（如 lay 属 lay 也属 lie），先到先得（rebuild 脚本里
      // 按 base 长度优先级已经做过 disambiguation）。这里用 upsert 让
      // 后到的不抢已属其他 family 的词。
      for (const wordText of wordsInFamily as string[]) {
        if (typeof wordText !== 'string' || !wordText.trim()) {
          continue;
        }
        const text = wordText.toLowerCase();
        await prisma.word.upsert({
          where: { text },
          update: {}, // 不抢——已属其他 family 的词保留原归属
          create: { text, familyId: family.id },
        });
        processedWords++;
      }

      processedFamilies++;

      // 每100个词族输出一次进度
      if (processedFamilies % 100 === 0) {
        console.log(`已处理 ${processedFamilies} 个词族，${processedWords} 个单词`);
      }
    } catch (error) {
      console.error(`处理词族 "${rootWord}" 时出错:`, error);
    }
  }

  console.log(`[SUCCESS] 数据导入完成！`);
  console.log(`          - 词族总数: ${processedFamilies}`);
  console.log(`   - 单词总数: ${processedWords}`);
}

main()
  .catch((e) => {
    console.error('导入失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
