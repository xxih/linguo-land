/**
 * 词族重建脚本（ADR 0018，v2 算法）
 *
 * v1 用 expander 反向生成 + 全量白名单声明，结果 3648 真实词被误吞
 * （bed 进 be、seed 进 see、drawer 进 draw、need 进 nee……），噪声 96%。
 *
 * v2 思路：family 构建只信任 wink 不规则映射（这是金标），规则形态仅当
 * 形态本身不在白名单时才补——如果一个生成形态已经是白名单里的独立词
 * （bed / drawer / need），就让它形成自己的 family，不被另一个短词吞掉。
 *
 * 算法：
 *   1. 把 wink verb/noun/adj 三表合并：inflectionToBase[form] = base
 *   2. 对白名单每个词 w：
 *      - 若 w 在 inflectionToBase 里：跳过，由对应 base 收
 *      - 否则 w 是自己的 base
 *   3. 每个 base 的 family.words[] =
 *        {base} ∪
 *        wink 反向映射给的所有 form ∪
 *        规则形态生成器输出且**不在白名单**的形态
 *   4. wink 里出现但 base 不在白名单的（比如 've → 'have'），也要建 family
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'src/data');
const WHITELIST_PATH = path.join(DATA_DIR, 'dictionary-whitelist.json');
const OUT_PATH = path.join(DATA_DIR, 'word-families.json');
const FIXTURE_PATH = path.resolve(ROOT, '../extension/src/content/utils/lemmaFixtures.json');

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

// === 1. 合并 wink 三表 ===
const inflectionToBase = new Map<string, string>();
for (const [form, base] of Object.entries({ ...verbMap, ...nounMap, ...adjMap })) {
  inflectionToBase.set(form, base);
}
const baseToWinkForms = new Map<string, Set<string>>();
for (const [form, base] of inflectionToBase) {
  if (!baseToWinkForms.has(base)) baseToWinkForms.set(base, new Set());
  baseToWinkForms.get(base)!.add(form);
}

console.log(`[v2] wink 不规则覆盖: ${inflectionToBase.size} forms → ${baseToWinkForms.size} bases`);

// === 2. 规则形态生成器（小写版，仅生成核心 inflection，不再做 derivation） ===
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
const isVowel = (c: string) => VOWELS.has(c);
const isCvc = (w: string): boolean => {
  if (w.length < 3) return false;
  const a = w[w.length - 3];
  const b = w[w.length - 2];
  const c = w[w.length - 1];
  if (!a || isVowel(a)) return false;
  if (!isVowel(b)) return false;
  if (isVowel(c)) return false;
  if ('wxy'.includes(c)) return false;
  return true;
};
const endsWithSibilant = (w: string) =>
  ['s', 'x', 'z', 'sh', 'ch'].some((s) => w.endsWith(s));

interface RegularInflections {
  /** 屈折性强：-s / -es / -ies / -ing。always 加入 family，不管在不在白名单 */
  inflectional: Set<string>;
  /** 过去式：-ed / -ied / -d。若 base 已有 wink 不规则过去式则跳过整组（避免 bed 进 be、seed 进 see、knowed 进 know） */
  pastTense: Set<string>;
  /** 形容词比较级 / 最高级：-er / -est。在白名单里的跳过（避免 runner 进 run、drawer 进 draw）；不在白名单的安全收 */
  comparatives: Set<string>;
}

function generateRegularInflections(base: string): RegularInflections {
  const inflectional = new Set<string>();
  const pastTense = new Set<string>();
  const comparatives = new Set<string>();
  if (base.length < 2) return { inflectional, pastTense, comparatives };

  // 复数 / 三单 -s / -es / -ies
  if (base.endsWith('y') && base.length >= 2 && !isVowel(base[base.length - 2])) {
    inflectional.add(base.slice(0, -1) + 'ies');
  } else if (endsWithSibilant(base)) {
    inflectional.add(base + 'es');
  } else if (base.endsWith('o') && base.length >= 2 && !isVowel(base[base.length - 2])) {
    inflectional.add(base + 'es');
    inflectional.add(base + 's');
  } else {
    inflectional.add(base + 's');
  }

  // -ing 进行时
  if (base.endsWith('e') && base.length > 2 && base[base.length - 2] !== 'e') {
    inflectional.add(base.slice(0, -1) + 'ing');
    inflectional.add(base + 'ing');
  } else if (base.endsWith('ie')) {
    inflectional.add(base.slice(0, -2) + 'ying');
    inflectional.add(base + 'ing');
  } else if (isCvc(base)) {
    inflectional.add(base + base[base.length - 1] + 'ing');
    inflectional.add(base + 'ing');
  } else {
    inflectional.add(base + 'ing');
  }

  // -ed / -ied / -d 过去式（受 wink 是否覆盖控制）
  if (base.endsWith('e')) {
    pastTense.add(base + 'd');
  } else if (base.endsWith('y') && base.length >= 2 && !isVowel(base[base.length - 2])) {
    pastTense.add(base.slice(0, -1) + 'ied');
  } else if (isCvc(base)) {
    pastTense.add(base + base[base.length - 1] + 'ed');
    pastTense.add(base + 'ed');
  } else {
    pastTense.add(base + 'ed');
  }

  // -er / -est 比较级最高级（仅短词候选）
  if (base.length <= 6 && base.length >= 3) {
    if (base.endsWith('e')) {
      comparatives.add(base + 'r');
      comparatives.add(base + 'st');
    } else if (base.endsWith('y') && base.length >= 2 && !isVowel(base[base.length - 2])) {
      comparatives.add(base.slice(0, -1) + 'ier');
      comparatives.add(base.slice(0, -1) + 'iest');
    } else if (isCvc(base)) {
      comparatives.add(base + base[base.length - 1] + 'er');
      comparatives.add(base + base[base.length - 1] + 'est');
    } else {
      comparatives.add(base + 'er');
      comparatives.add(base + 'est');
    }
  }

  return { inflectional, pastTense, comparatives };
}

// === 3. 构建 family ===
const families: Record<string, string[]> = {};

function buildFamily(base: string): void {
  const forms = new Set<string>([base]);
  // wink 反向映射给的不规则形态（金标）
  for (const f of baseToWinkForms.get(base) ?? []) forms.add(f);

  const reg = generateRegularInflections(base);
  // 屈折性强（-s/-es/-ies/-ing）：总是加入
  for (const f of reg.inflectional) forms.add(f);
  // 过去式（-ed/-d/-ied）：仅当 wink 没给本 base 提供任何不规则形态时才生成
  // （避免 bed 进 be、seed 进 see、knowed 进 know 等"规则化错误"）
  if (!baseToWinkForms.has(base)) {
    for (const f of reg.pastTense) forms.add(f);
  }
  // 比较级（-er/-est）：仅当形态不在白名单时（在白名单的让 runner/drawer 自成 family）
  for (const f of reg.comparatives) {
    if (!whitelistSet.has(f)) forms.add(f);
  }

  families[base] = [...forms].sort();
}

// 3a. 白名单里非 wink-form 的词都是自己的 base
let baseCount = 0;
for (const word of whitelist) {
  const w = word.toLowerCase();
  if (inflectionToBase.has(w)) continue; // 这是某 base 的 form，不当 base
  baseCount++;
  buildFamily(w);
}

// 3b. wink 里 base 不在白名单的（如 'have' 不在白名单的极端 case），也要建 family
let synthBaseCount = 0;
for (const base of baseToWinkForms.keys()) {
  if (families[base]) continue;
  synthBaseCount++;
  buildFamily(base);
}

console.log(
  `[v2] 生成 ${Object.keys(families).length} family（白名单 base ${baseCount}，wink 补 ${synthBaseCount}）`,
);

// === 4. 关键 case 验证 ===
const KEY_CHECKS: Array<{ root: string; mustInclude: string[]; mustNotInclude?: string[] }> = [
  { root: 'woman', mustInclude: ['woman', 'women'], mustNotInclude: ['womaned'] },
  { root: 'go', mustInclude: ['go', 'goes', 'going', 'gone', 'went'] },
  { root: 'break', mustInclude: ['break', 'breaks', 'broke', 'broken', 'breaking'] },
  { root: 'big', mustInclude: ['big', 'bigger', 'biggest'] },
  { root: 'good', mustInclude: ['good', 'better', 'best'] },
  {
    root: 'be',
    mustInclude: ['be', 'is', 'are', 'was', 'were', 'been', 'being'],
    mustNotInclude: ['bed'],
  },
  { root: 'have', mustInclude: ['have', 'has', 'had', 'having'] },
  { root: 'do', mustInclude: ['do', 'does', 'did', 'doing', 'done'] },
  { root: 'child', mustInclude: ['child', 'children'] },
  { root: 'mouse', mustInclude: ['mouse', 'mice'] },
  { root: 'see', mustInclude: ['see', 'sees', 'saw', 'seen', 'seeing'], mustNotInclude: ['seed'] },
  { root: 'draw', mustInclude: ['draw', 'draws', 'drew', 'drawn', 'drawing'], mustNotInclude: ['drawer'] },
  { root: 'need', mustInclude: ['need', 'needs', 'needed', 'needing'] },
  { root: 'bring', mustInclude: ['bring', 'brings', 'brought', 'bringing'] },
  { root: 'river', mustInclude: ['river', 'rivers'] },
];

let keyOk = true;
console.log('\n[v2] 关键 case 验证:');
for (const { root, mustInclude, mustNotInclude } of KEY_CHECKS) {
  const fam = families[root];
  if (!fam) {
    console.log(`  ✗ ${root}: family 不存在`);
    keyOk = false;
    continue;
  }
  const missing = mustInclude.filter((f) => !fam.includes(f));
  const stolen = (mustNotInclude ?? []).filter((f) => fam.includes(f));
  if (missing.length > 0 || stolen.length > 0) {
    console.log(
      `  ✗ ${root}: 缺[${missing.join(',')}] 误吞[${stolen.join(',')}] (${fam.length} 形态)`,
    );
    keyOk = false;
  } else {
    console.log(`  ✓ ${root}: ${fam.length} 形态 [${fam.join(', ')}]`);
  }
}

// === 5. fixture 交叉验证 ===
if (fs.existsSync(FIXTURE_PATH)) {
  const fixture: Array<{ word: string; expectedLemmas: string[] }> = JSON.parse(
    fs.readFileSync(FIXTURE_PATH, 'utf-8'),
  );
  let fxOk = 0;
  const fxMissExamples: string[] = [];
  const wordToFamily = new Map<string, string>();
  for (const [b, ws] of Object.entries(families)) for (const w of ws) wordToFamily.set(w, b);
  for (const { word, expectedLemmas } of fixture) {
    const candidates = [word, ...expectedLemmas];
    const hit = candidates.some((c) => wordToFamily.has(c) || families[c]);
    if (hit) fxOk++;
    else if (fxMissExamples.length < 6)
      fxMissExamples.push(`${word} → ${expectedLemmas.join(',')}`);
  }
  console.log(`\n[v2] fixture 交叉: ${fxOk}/${fixture.length}`);
  if (fxMissExamples.length > 0) console.log(`  miss 示例: ${fxMissExamples.join(' | ')}`);
}

// === 6. 体积 ===
const sizes = Object.values(families).map((w) => w.length);
sizes.sort((a, b) => a - b);
console.log(
  `\n[v2] 体积: median=${sizes[Math.floor(sizes.length / 2)]}, p75=${sizes[Math.floor(sizes.length * 0.75)]}, p99=${sizes[Math.floor(sizes.length * 0.99)]}, max=${sizes[sizes.length - 1]}`,
);
console.log(`  size==1 family: ${sizes.filter((s) => s === 1).length}`);

// === 7. 写文件 ===
if (!keyOk) {
  console.error('\n[v2] 关键 case 未全过！');
  process.exit(1);
}
fs.writeFileSync(OUT_PATH, JSON.stringify(families) + '\n');
const sz = fs.statSync(OUT_PATH).size;
console.log(`\n[v2] ✓ 已写入 ${OUT_PATH} (${(sz / 1024 / 1024).toFixed(2)} MB)`);
