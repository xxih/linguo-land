/**
 * 一次性 backfill 脚本（ADR 0018）：把现有 WordFamily 的 words[] 用形态学
 * 展开补全。production 已经跑过 seed，所以 seed.ts 的更新只对未来生效；
 * 这个脚本负责 backfill 现有数据。
 *
 * 行为：对每个 family.rootWord 调 expandLemmaToSurfaceForms，把缺的 surface
 * form 通过 createMany skipDuplicates 加入 family。已属其他 family 的词不会被
 * 抢走（uniqueness 跳过），保留原 seed 的归属决定。
 *
 * 用法：
 *   pnpm --filter server tsx scripts/expand-family-words.ts          # 真跑
 *   pnpm --filter server tsx scripts/expand-family-words.ts --dry    # 干跑统计
 */

import { PrismaClient } from '../generated/prisma';
import { expandLemmaToSurfaceForms } from '../src/lemma-expander';

const prisma = new PrismaClient();

async function main() {
  const dryRun = process.argv.includes('--dry');

  console.log(`[expand-family-words] ${dryRun ? '🔍 dry-run' : '✏️  写库'} 开始`);

  const families = await prisma.wordFamily.findMany({
    include: { words: { select: { text: true } } },
  });

  console.log(`[expand-family-words] 拉到 ${families.length} 个 family`);

  let touchedFamilies = 0;
  let totalAdded = 0;

  for (const family of families) {
    const existing = new Set(family.words.map((w) => w.text.toLowerCase()));
    const expanded = expandLemmaToSurfaceForms(family.rootWord);
    const toAdd = [...expanded].filter((w) => !existing.has(w));

    if (toAdd.length === 0) continue;

    if (dryRun) {
      // 估算实际能写入的（dry-run 也走一次 prisma 看冲突）
      const conflicts = await prisma.word.findMany({
        where: { text: { in: toAdd } },
        select: { text: true, familyId: true },
      });
      const conflictTexts = new Set(conflicts.filter((c) => c.familyId !== family.id).map((c) => c.text));
      const willInsert = toAdd.filter((t) => !conflictTexts.has(t));
      if (willInsert.length > 0) {
        touchedFamilies++;
        totalAdded += willInsert.length;
        if (touchedFamilies <= 20) {
          console.log(
            `  [+${willInsert.length}] ${family.rootWord} → ${willInsert.slice(0, 6).join(', ')}${
              willInsert.length > 6 ? '...' : ''
            }`,
          );
        }
      }
    } else {
      const result = await prisma.word.createMany({
        data: toAdd.map((text) => ({ text, familyId: family.id })),
        skipDuplicates: true,
      });
      if (result.count > 0) {
        touchedFamilies++;
        totalAdded += result.count;
        if (touchedFamilies <= 20) {
          console.log(`  [+${result.count}] ${family.rootWord}`);
        }
      }
    }
  }

  console.log(
    `[expand-family-words] ${dryRun ? '若执行会' : '已'}给 ${touchedFamilies} 个 family 补 ${totalAdded} 个 surface form`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
