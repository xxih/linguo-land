import { PrismaClient } from '../generated/prisma';
import * as fs from 'fs';
import * as path from 'path';
import { expandLemmaToSurfaceForms } from './lemma-expander';

const prisma = new PrismaClient();

async function main() {
  console.log('开始导入词族数据...');

  // 读取词族数据文件
  const dataPath = path.join(__dirname, '../../extension/public/word_groups_final_refined—25.json');

  if (!fs.existsSync(dataPath)) {
    console.error(`找不到数据文件: ${dataPath}`);
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

      // 2. 种子 JSON 里的人工词族（含 break/breakable/breakage 等派生词）
      // —— 用 upsert 抢占归属，权威性最高
      const seededWords = new Set<string>();
      for (const wordText of wordsInFamily as string[]) {
        if (typeof wordText !== 'string' || !wordText.trim()) {
          continue;
        }
        const text = wordText.toLowerCase();
        await prisma.word.upsert({
          where: { text },
          update: { familyId: family.id },
          create: { text, familyId: family.id },
        });
        seededWords.add(text);
        processedWords++;
      }

      // 3. 形态学展开 rootWord 的所有 surface form（women/went/bigger 等）。
      // ADR 0018：人工 seed 缺哪个 inflection 都会让 highlight 失效，靠
      // expander 兜底确保完整。createMany skipDuplicates 不会抢已属其他
      // family 的词（如 lay 已属 lay family，再 expand lie 时不会被改写）。
      const expanded = expandLemmaToSurfaceForms(rootWord);
      const toAdd = [...expanded].filter((w) => !seededWords.has(w));
      if (toAdd.length > 0) {
        const result = await prisma.word.createMany({
          data: toAdd.map((text) => ({ text, familyId: family.id })),
          skipDuplicates: true,
        });
        processedWords += result.count;
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
