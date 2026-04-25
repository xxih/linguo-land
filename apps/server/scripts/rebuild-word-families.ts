/**
 * 词族重建脚本（ADR 0018）
 *
 * 旧数据问题：apps/extension/public/word_groups_final_refined—25.json
 * 35K 词族里 31K 是孤立单词（words.length === 1）；inflection 覆盖几乎
 * 没有；包含明显噪声（go ← antigone、get ← ingot、come ← income/incoming
 * 这种纯字面包含的"compound"），并且 be 家族根本不存在。
 *
 * 重建策略：
 *   - 源 = apps/server/src/data/dictionary-whitelist.json（43K 词，已有
 *     curated baseline）。
 *   - 用 lemma-expander 反向识别 base form：如果一个词出现在另一个词的
 *     expandLemmaToSurfaceForms 输出里，它就是 inflected form，不当 base。
 *   - 每个 base form → 一个 family，words[] = expander(base)（含 base 自身）。
 *   - 仅做"inflectional grouping"，不做 derivational（即不把 breakable/
 *     breakage 跟 break 强行捏到一起）—— 各派生词自有家族，更可预测。
 *
 * 输出：apps/server/src/data/word-families.json
 *   形态：{ rootWord: [forms...] }，与旧 seed JSON 兼容，便于 seed.ts 复用。
 *
 * 验证：脚本末尾打印 stats + 关键 fixture（woman/go/break/big 等）的展开
 * 结果。还会和 ../../extension/src/content/utils/lemmaFixtures.json 交叉
 * 验证—— fixture 里每个 expectedLemma 应该都能找到对应 family root。
 */

import fs from 'node:fs';
import path from 'node:path';
import { expandLemmaToSurfaceForms } from '../src/lemma-expander';

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'src/data');
const WHITELIST_PATH = path.join(DATA_DIR, 'dictionary-whitelist.json');
const OUT_PATH = path.join(DATA_DIR, 'word-families.json');
const FIXTURE_PATH = path.resolve(
  ROOT,
  '../extension/src/content/utils/lemmaFixtures.json',
);

const whitelist: string[] = JSON.parse(fs.readFileSync(WHITELIST_PATH, 'utf-8'));
const whitelistSet = new Set(whitelist.map((w) => w.toLowerCase()));

const verbMap: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'verb-inflection-map.json'), 'utf-8'),
);
const nounMap: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'noun-inflection-map.json'), 'utf-8'),
);
const adjMap: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'adj-inflection-map.json'), 'utf-8'),
);

const winkBaseOf = (form: string): string | undefined =>
  verbMap[form] ?? nounMap[form] ?? adjMap[form];

/**
 * 过滤 expander 的输出，只做"wink 冲突消除"——规则形态几乎都常见，宁多
 * 勿少（用户文章里出现的复数 / 三单 / 进行时几乎都用规则形态）。
 *
 * 跳过条件：wink 不规则映射明确把这个形态指给了另一个 base（典型如 best
 * 在 adjMap 是 best → good，那 be 家族不能抢）。
 *
 * 不再用白名单卡——白名单基本只收 base form，breaks / having / cars 这种
 * 最常见的规则变形不在里面，过滤掉损失太大。规则形态里偶尔有 'womaned'
 * 这种冷门生成，但不会出现在用户文章里，不影响识别准确性。
 */
function filterFamilyForms(base: string, raw: Set<string>): string[] {
  const out = new Set<string>([base]);
  for (const f of raw) {
    if (f === base) continue;
    const otherBase = winkBaseOf(f);
    if (otherBase && otherBase !== base) continue;
    out.add(f);
  }
  return [...out].sort();
}

console.log(`[rebuild] 读到 ${whitelist.length} 词白名单`);

// 1. 反向构建：对每个白名单词跑 expander，记下哪些 form 由哪些 base 派生
//    formToBases[form] = Set<base>，base 是 expansion 包含 form 的某个白名单词
const formToBases = new Map<string, Set<string>>();
for (const candidate of whitelist) {
  const c = candidate.toLowerCase();
  const forms = expandLemmaToSurfaceForms(c);
  for (const f of forms) {
    if (f === c) continue;
    if (!formToBases.has(f)) formToBases.set(f, new Set());
    formToBases.get(f)!.add(c);
  }
}

// 2. 识别 base form：白名单词中没有任何其他白名单词把它当 inflected form
const baseForms: string[] = [];
const inflectionToBase = new Map<string, string>(); // form → 选定的 base

for (const word of whitelist) {
  const w = word.toLowerCase();
  const claimers = formToBases.get(w);
  if (!claimers || claimers.size === 0) {
    baseForms.push(w);
    continue;
  }
  // 被其他词声明为 inflected form。挑最短的当 base（启发式：base 通常更短）；
  // 长度相同时按字典序——保证可复现
  const sorted = [...claimers].sort((a, b) => a.length - b.length || a.localeCompare(b));
  inflectionToBase.set(w, sorted[0]);
}

console.log(`[rebuild] base forms: ${baseForms.length}, inflected forms claimed: ${inflectionToBase.size}`);

// 3. 给每个 base form 构建 family。先用 expander 生成候选，再用 filterFamilyForms
// 过滤掉伪生成形态（womaned 等）。最后并入白名单里被它认领的 inflection。
const families: Record<string, string[]> = {};
for (const base of baseForms) {
  const raw = expandLemmaToSurfaceForms(base);
  for (const [form, b] of inflectionToBase.entries()) {
    if (b === base) raw.add(form);
  }
  families[base] = filterFamilyForms(base, raw);
}

console.log(`[rebuild] 生成 ${Object.keys(families).length} 个 family`);

// 4. 关键 case 验证
const KEY_CHECKS: Array<{ root: string; mustInclude: string[] }> = [
  { root: 'woman', mustInclude: ['woman', 'women'] },
  { root: 'go', mustInclude: ['go', 'goes', 'going', 'gone', 'went'] },
  { root: 'break', mustInclude: ['break', 'breaks', 'broke', 'broken', 'breaking'] },
  { root: 'big', mustInclude: ['big', 'bigger', 'biggest'] },
  { root: 'good', mustInclude: ['good', 'better', 'best'] },
  { root: 'be', mustInclude: ['be', 'is', 'are', 'was', 'were', 'been', 'being'] },
  { root: 'have', mustInclude: ['have', 'has', 'had', 'having'] },
  { root: 'do', mustInclude: ['do', 'does', 'did', 'doing', 'done'] },
  { root: 'child', mustInclude: ['child', 'children'] },
  { root: 'mouse', mustInclude: ['mouse', 'mice'] },
];

let keyOk = true;
console.log('\n[rebuild] 关键 case 验证:');
for (const { root, mustInclude } of KEY_CHECKS) {
  const fam = families[root];
  if (!fam) {
    console.log(`  ✗ ${root}: family 不存在`);
    keyOk = false;
    continue;
  }
  const missing = mustInclude.filter((f) => !fam.includes(f));
  if (missing.length > 0) {
    console.log(`  ✗ ${root}: 缺 ${missing.join(', ')} (有 ${fam.join(', ')})`);
    keyOk = false;
  } else {
    console.log(`  ✓ ${root}: ${fam.length} 形态`);
  }
}

// 5. 与 lemma fixture 交叉验证：fixture 每个 expectedLemma 应该是某个 family root
if (fs.existsSync(FIXTURE_PATH)) {
  const fixture: Array<{ word: string; expectedLemmas: string[] }> = JSON.parse(
    fs.readFileSync(FIXTURE_PATH, 'utf-8'),
  );
  let fxOk = 0;
  let fxMiss = 0;
  const missExamples: string[] = [];
  for (const { word, expectedLemmas } of fixture) {
    // 任一 expectedLemma 是 family root，或 word 在某 family 里
    const inFamily = [...expectedLemmas, word].some((l) => {
      if (families[l]) return true;
      return inflectionToBase.has(l) && families[inflectionToBase.get(l)!];
    });
    if (inFamily) fxOk++;
    else {
      fxMiss++;
      if (missExamples.length < 10) missExamples.push(`${word} → ${expectedLemmas.join(',')}`);
    }
  }
  console.log(`\n[rebuild] fixture 交叉: ${fxOk}/${fxOk + fxMiss} 命中 family`);
  if (fxMiss > 0) {
    console.log('  miss 示例:', missExamples.slice(0, 10).join(' | '));
  }
}

// 6. family 体积分布
const sizeBuckets = new Map<number, number>();
for (const arr of Object.values(families)) {
  const sz = arr.length;
  sizeBuckets.set(sz, (sizeBuckets.get(sz) || 0) + 1);
}
const sortedSizes = [...sizeBuckets.entries()].sort((a, b) => a[0] - b[0]);
console.log('\n[rebuild] family 体积分布 (top 10):');
console.table(sortedSizes.slice(0, 10).map(([sz, n]) => ({ words: sz, families: n })));

// 7. 写文件（紧凑 JSON，减小仓库体积）
if (!keyOk) {
  console.error('\n[rebuild] 关键 case 验证未全过，请人工 review 后再决定是否落盘');
}
fs.writeFileSync(OUT_PATH, JSON.stringify(families) + '\n');
const fileSize = fs.statSync(OUT_PATH).size;
console.log(`\n[rebuild] 已写入 ${OUT_PATH} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
