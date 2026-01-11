import { PrismaClient } from '../generated/prisma';
import * as fs from 'fs';
import * as path from 'path';

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

      // 2. 为该词族中的每个单词创建 Word 记录
      for (const wordText of wordsInFamily as string[]) {
        if (typeof wordText !== 'string' || !wordText.trim()) {
          continue;
        }

        await prisma.word.upsert({
          where: { text: wordText.toLowerCase() },
          update: { familyId: family.id },
          create: {
            text: wordText.toLowerCase(),
            familyId: family.id,
          },
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
