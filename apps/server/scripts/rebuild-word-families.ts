/**
 * 词族 + 白名单统一重建脚本（v3 算法，覆盖 ADR 0019）
 *
 * 输入（数据全部在仓库内）：
 *   - curated 词表：coca20000 + cet_4 + cet_6 + junior_high + high
 *   - wink 不规则金标：verb/noun/adj-inflection-map.json（form→base）
 *   - Norvig 1-grams：/tmp/lemma-eval/count_1w.txt（候选形态合法性验证）
 *   - compromise（package: compromise）作为 build-time POS / lemma 推断器
 *
 * 输出：
 *   - dictionary-whitelist.json（≈ 所有 family form 的并集 ∪ curated 词条 ∪ wink 全形态）
 *   - word-families.json
 *
 * 算法（v3）：
 *   1. 自顶向下：对每个 curated 词 w，用 compromise + 规则兜底算 lemma(w)。
 *      - lemma(w) == w → w 是 base
 *      - lemma(w) != w → w 是 inflection，进 lemma(w) 的 family
 *   2. 注入 wink-irregular：每条 (form, base) → form ∈ family[base]
 *   3. 自底向上：对每个 base 跑规则形态生成器，候选保留条件 = 形态健全 ∧
 *      (在 evidence 集 ∨ 在 Norvig top 30K) ∧ compromise lemma 匹配 / 无歧义。
 *      Norvig top 30K 过滤掉 'aardwolfing/rivering/breakest/seest/havest' 这类
 *      不存在的派生；compromise lemma 检查避免 'bed' 进 be、'seed' 进 see、
 *      'drawer' 进 draw（三者 compromise 都判 own lemma）。
 *   4. 同形异性词：'lay/saw/found' 等优先按 wink 反向映射归属（wink 给 base
 *      则归 base）；wink 没给则归 own family（lay→lay，saw→saw 已在 ADR 0018）。
 *
 * 同形异性词例外：
 *   - 'bed' 是独立 curated 名词 lemma，compromise.lemma 返 'bed' → 留独立 base
 *     'be' 的规则 -d 候选 'bed' 因 compromise 不认它是 'be' 的形态被拒绝
 *   - 'being'/'drawing'/'working'/'running' 等 -ing 形态：compromise 知道它们
 *     是 verb 的 gerund → 进 base family，不再独立 base
 *   - 'studied'/'wanted'/'used' 等 curated 列表里的 inflection：compromise 给
 *     verb infinitive → 进 base family
 *
 * 不依赖：dictionary-whitelist.json 旧文件作为输入（脚本一并重新生成）
 */

import fs from 'node:fs';
import path from 'node:path';
import nlpFactory from 'compromise';

const nlp = (nlpFactory as any).default ?? (nlpFactory as any);

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'src/data');
const WHITELIST_OUT = path.join(DATA_DIR, 'dictionary-whitelist.json');
const FAMILIES_OUT = path.join(DATA_DIR, 'word-families.json');
const NORVIG_PATH = '/tmp/lemma-eval/count_1w.txt';
const FIXTURE_PATH = path.resolve(ROOT, '../extension/src/content/utils/lemmaFixtures.json');

const NORVIG_CUTOFF = 30000;

// ════════════════════════════════════════════════════════════════════
// 1. 加载源数据
// ════════════════════════════════════════════════════════════════════
interface CuratedList {
  words: string[];
}

const curatedFiles = ['coca20000', 'cet_4', 'cet_6', 'junior_high', 'high'];
const curatedSources: Record<string, string[]> = {};
for (const f of curatedFiles) {
  const j: CuratedList = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${f}.json`), 'utf-8'));
  curatedSources[f] = j.words;
}

const verbMap: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'verb-inflection-map.json'), 'utf-8'),
);
const nounMap: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'noun-inflection-map.json'), 'utf-8'),
);
const adjMap: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'adj-inflection-map.json'), 'utf-8'),
);
// 手维的 overrides，wink 同等金标处理。
//   - irregular-plural-overrides.json：wink 漏的 -man/-women 复合 + 学术不规则复数
//   - irregular-adj-overrides.json：wink 漏的形容词比较级（far → farther/further 等）
// 不持久化进 noun/adj-inflection-map.json，避免污染 wink vendor。
const pluralOverrides: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'irregular-plural-overrides.json'), 'utf-8'),
);
const adjOverrides: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'irregular-adj-overrides.json'), 'utf-8'),
);
for (const [form, base] of Object.entries(pluralOverrides)) nounMap[form] = base;
for (const [form, base] of Object.entries(adjOverrides)) adjMap[form] = base;

const inflectionToBase = new Map<string, string>();
for (const [f, b] of Object.entries({ ...verbMap, ...nounMap, ...adjMap })) {
  inflectionToBase.set(f, b);
}
const baseToWinkForms = new Map<string, Set<string>>();
for (const [f, b] of inflectionToBase) {
  if (!baseToWinkForms.has(b)) baseToWinkForms.set(b, new Set());
  baseToWinkForms.get(b)!.add(f);
}

// === Norvig rank ===
const norvigRank = new Map<string, number>();
{
  const text = fs.readFileSync(NORVIG_PATH, 'utf-8');
  let i = 0;
  for (const line of text.split(/\n/)) {
    const word = line.split(/\s+/)[0];
    if (!word) continue;
    if (!norvigRank.has(word)) norvigRank.set(word, ++i);
  }
}
const inNorvigTop = (w: string) => (norvigRank.get(w) ?? Infinity) <= NORVIG_CUTOFF;

// === evidence: 已知"是真单词"的全集 ===
function shapeOk(w: string): boolean {
  if (!/^[a-z'-]+$/.test(w)) return false;
  if (w.length === 1 && w !== 'a' && w !== 'i') return false;
  if (/(.)\1\1/.test(w)) return false;
  if (!/[aeiouy]/.test(w)) return false;
  if (w.startsWith('-') || w.endsWith('-')) return false;
  if (w.startsWith("'") || w.endsWith("'")) return false;
  return true;
}

const evidence = new Set<string>();
for (const arr of Object.values(curatedSources)) {
  for (const w of arr) {
    const l = w.toLowerCase();
    if (shapeOk(l)) evidence.add(l);
  }
}
for (const f of inflectionToBase.keys()) if (shapeOk(f)) evidence.add(f);
for (const b of baseToWinkForms.keys()) if (shapeOk(b)) evidence.add(b);

console.log(
  `[v3] 数据源: ${Object.values(curatedSources).reduce((s, a) => s + a.length, 0)} curated 条 (5 表) | ` +
    `wink ${inflectionToBase.size} forms / ${baseToWinkForms.size} bases | ` +
    `Norvig ${norvigRank.size} 词，cutoff top ${NORVIG_CUTOFF} | ` +
    `evidence ${evidence.size}`,
);

// ════════════════════════════════════════════════════════════════════
// 2. compromise 驱动的 lemma 推断
// ════════════════════════════════════════════════════════════════════
const lemmaCache = new Map<string, string>();

function ruleStemForCompAdj(w: string): string | null {
  // 形容词比较级 / 最高级 fallback（compromise 不会自动还原）
  // 拿到候选 stem 后用 evidence 验证它是真词 + compromise tag adjective
  const candidates: string[] = [];
  if (w.endsWith('iest') && w.length >= 6) candidates.push(w.slice(0, -4) + 'y');
  else if (w.endsWith('ier') && w.length >= 5) candidates.push(w.slice(0, -3) + 'y');
  else if (w.endsWith('est') && w.length >= 5) {
    candidates.push(w.slice(0, -3));
    candidates.push(w.slice(0, -2));
    if (w.length >= 6 && w[w.length - 4] === w[w.length - 5]) candidates.push(w.slice(0, -4));
  } else if (w.endsWith('er') && w.length >= 4) {
    candidates.push(w.slice(0, -2));
    candidates.push(w.slice(0, -1));
    if (w.length >= 5 && w[w.length - 3] === w[w.length - 4]) candidates.push(w.slice(0, -3));
  }
  for (const stem of candidates) {
    if (stem.length < 2) continue;
    if (!evidence.has(stem)) continue;
    // compromise 是否认 stem 是 Adjective
    const tags: string[] = nlp(stem).terms().json()[0]?.terms[0]?.tags ?? [];
    if (tags.includes('Adjective')) return stem;
  }
  return null;
}

function lemmaOf(w: string): string {
  if (lemmaCache.has(w)) return lemmaCache.get(w)!;
  // 第一道：wink 反向映射（金标）
  if (inflectionToBase.has(w)) {
    const b = inflectionToBase.get(w)!;
    lemmaCache.set(w, b);
    return b;
  }
  // 第二道：compromise
  const doc = nlp(w);
  const tagsRaw: string[] = doc.terms().json()[0]?.terms[0]?.tags ?? [];
  const tags = new Set(tagsRaw);
  const sing: string = doc.nouns().toSingular().out('text');
  if (sing && sing !== w) {
    lemmaCache.set(w, sing);
    return sing;
  }
  const inf: string = doc.verbs().toInfinitive().out('text');
  if (inf && inf !== w) {
    lemmaCache.set(w, inf);
    return inf;
  }
  // 第三道：adjective-tagged past participle / gerund fallback (forced verb tag)
  if (tags.has('Adjective') && (w.endsWith('ed') || w.endsWith('d') || w.endsWith('ing'))) {
    const d = nlp(w);
    d.tag('Verb');
    const i2: string = d.verbs().toInfinitive().out('text');
    if (i2 && i2 !== w) {
      lemmaCache.set(w, i2);
      return i2;
    }
  }
  // 第四道：comparative / superlative -er/-est/-ier/-iest
  const compStem = ruleStemForCompAdj(w);
  if (compStem && compStem !== w) {
    lemmaCache.set(w, compStem);
    return compStem;
  }
  lemmaCache.set(w, w);
  return w;
}

// ════════════════════════════════════════════════════════════════════
// 3. 规则形态生成器（用于自底向上候选）
// ════════════════════════════════════════════════════════════════════
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

function generateRegular(base: string): Set<string> {
  const out = new Set<string>();
  if (base.length < 2) return out;
  // -s / -es / -ies
  if (base.endsWith('y') && !isVowel(base[base.length - 2])) out.add(base.slice(0, -1) + 'ies');
  else if (endsWithSibilant(base)) out.add(base + 'es');
  else if (base.endsWith('o') && !isVowel(base[base.length - 2])) {
    out.add(base + 'es');
    out.add(base + 's');
  } else out.add(base + 's');
  // -ing
  if (base.endsWith('e') && base.length > 2 && base[base.length - 2] !== 'e')
    out.add(base.slice(0, -1) + 'ing');
  else if (base.endsWith('ie')) out.add(base.slice(0, -2) + 'ying');
  else if (isCvc(base)) out.add(base + base[base.length - 1] + 'ing');
  else out.add(base + 'ing');
  // -ed / -d / -ied
  if (base.endsWith('e')) out.add(base + 'd');
  else if (base.endsWith('y') && !isVowel(base[base.length - 2])) out.add(base.slice(0, -1) + 'ied');
  else if (isCvc(base)) out.add(base + base[base.length - 1] + 'ed');
  else out.add(base + 'ed');
  // -er / -est（仅短词候选）
  if (base.length >= 3 && base.length <= 7) {
    if (base.endsWith('e')) {
      out.add(base + 'r');
      out.add(base + 'st');
    } else if (base.endsWith('y') && !isVowel(base[base.length - 2])) {
      out.add(base.slice(0, -1) + 'ier');
      out.add(base.slice(0, -1) + 'iest');
    } else if (isCvc(base)) {
      out.add(base + base[base.length - 1] + 'er');
      out.add(base + base[base.length - 1] + 'est');
    } else {
      out.add(base + 'er');
      out.add(base + 'est');
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════
// 4. 自顶向下：把每个 curated 词 / wink form 归到对应 lemma
// ════════════════════════════════════════════════════════════════════
const families: Record<string, Set<string>> = {};
function addToFamily(base: string, form: string) {
  if (!shapeOk(base) || !shapeOk(form)) return;
  if (!families[base]) families[base] = new Set([base]);
  families[base].add(form);
}

let lemmaResolved = 0;
for (const w of evidence) {
  const lemma = lemmaOf(w);
  if (lemma === w) {
    addToFamily(w, w);
  } else {
    addToFamily(lemma, w);
    addToFamily(lemma, lemma); // 确保 base 自己也在
    lemmaResolved++;
  }
}
// 注入所有 wink 反向映射（双保险）
for (const [form, base] of inflectionToBase) {
  addToFamily(base, form);
  addToFamily(base, base);
}
console.log(
  `[v3] 自顶向下分组: ${Object.keys(families).length} bases，${lemmaResolved} 个词被归到非 self lemma`,
);

// ════════════════════════════════════════════════════════════════════
// 5. 自底向上：每个 base 跑规则候选 + Norvig 验证 + lemma 校验
// ════════════════════════════════════════════════════════════════════
// 名词若已有 wink 不规则复数（child→children, man→men, mouse→mice...），
// 跳过规则 -s/-es/-ies 生成，避免 'childs/mans/peoples/mouses' 这类
// 在 Norvig 出现频率不低（OCR / 泛词 / 缩写歧义）但实际不是合法复数的形态。
const nounsWithIrregularPlural = new Set(Object.values(nounMap));
const PLURAL_SUFFIXES = new Set<string>();
function isPluralCandidate(base: string, candidate: string): boolean {
  // 当 candidate 是 base + s/es/ies 时认为是复数候选
  if (candidate === base + 's') return true;
  if (candidate === base + 'es') return true;
  if (base.endsWith('y') && candidate === base.slice(0, -1) + 'ies') return true;
  return false;
}

let augmented = 0;
for (const base of [...Object.keys(families)]) {
  const reg = generateRegular(base);
  const skipPlural = nounsWithIrregularPlural.has(base);
  for (const f of reg) {
    if (f === base) continue;
    if (!shapeOk(f)) continue;
    if (families[base].has(f)) continue;
    if (skipPlural && isPluralCandidate(base, f)) continue;
    const winkBase = inflectionToBase.get(f);
    if (winkBase && winkBase !== base) continue;
    if (!evidence.has(f) && !inNorvigTop(f)) continue;
    const candLemma = lemmaOf(f);
    if (candLemma !== base) continue;
    families[base].add(f);
    augmented++;
  }
}
console.log(`[v3] 自底向上补 ${augmented} 个规则形态`);

// ════════════════════════════════════════════════════════════════════
// 6. 关键 case 验证
// ════════════════════════════════════════════════════════════════════
const KEY_CHECKS: Array<{ root: string; mustInclude: string[]; mustNotInclude?: string[] }> = [
  { root: 'woman', mustInclude: ['woman', 'women'], mustNotInclude: ['womaned'] },
  { root: 'go', mustInclude: ['go', 'goes', 'going', 'gone', 'went'] },
  { root: 'break', mustInclude: ['break', 'breaks', 'broke', 'broken', 'breaking'] },
  { root: 'big', mustInclude: ['big', 'bigger', 'biggest'] },
  { root: 'good', mustInclude: ['good', 'better', 'best'] },
  {
    root: 'be',
    mustInclude: ['be', 'is', 'are', 'was', 'were', 'been', 'being'],
    mustNotInclude: ['bed', 'beed', 'bes'],
  },
  { root: 'have', mustInclude: ['have', 'has', 'had', 'having'], mustNotInclude: ['haveing'] },
  { root: 'do', mustInclude: ['do', 'does', 'did', 'doing', 'done'] },
  { root: 'child', mustInclude: ['child', 'children'], mustNotInclude: ['childer', 'childest'] },
  { root: 'mouse', mustInclude: ['mouse', 'mice'], mustNotInclude: ['mouseing', 'mousest'] },
  {
    root: 'see',
    mustInclude: ['see', 'sees', 'saw', 'seen', 'seeing'],
    mustNotInclude: ['seed', 'seest'],
  },
  {
    root: 'draw',
    mustInclude: ['draw', 'draws', 'drew', 'drawn', 'drawing'],
    mustNotInclude: ['drawest'],
  },
  { root: 'need', mustInclude: ['need', 'needs', 'needed', 'needing'] },
  { root: 'bring', mustInclude: ['bring', 'brings', 'brought', 'bringing'], mustNotInclude: ['bringest'] },
  { root: 'river', mustInclude: ['river', 'rivers'], mustNotInclude: ['rivering', 'rivered'] },
  { root: 'work', mustInclude: ['work', 'works', 'worked', 'working'] },
  { root: 'walk', mustInclude: ['walk', 'walks', 'walked', 'walking'] },
  { root: 'play', mustInclude: ['play', 'plays', 'played', 'playing'] },
  { root: 'study', mustInclude: ['study', 'studies', 'studied', 'studying'] },
  { root: 'dream', mustInclude: ['dream', 'dreams', 'dreamed', 'dreaming'] },
  { root: 'learn', mustInclude: ['learn', 'learns', 'learned', 'learning'] },
  { root: 'fast', mustInclude: ['fast', 'faster', 'fastest'] },
  { root: 'happy', mustInclude: ['happy', 'happier', 'happiest'] },
];

let keyOk = true;
console.log('\n[v3] 关键 case 验证:');
for (const { root, mustInclude, mustNotInclude } of KEY_CHECKS) {
  const fam = families[root];
  if (!fam) {
    console.log(`  ✗ ${root}: family 不存在`);
    keyOk = false;
    continue;
  }
  const list = [...fam].sort();
  const missing = mustInclude.filter((f) => !fam.has(f));
  const stolen = (mustNotInclude ?? []).filter((f) => fam.has(f));
  if (missing.length > 0 || stolen.length > 0) {
    console.log(`  ✗ ${root}: 缺[${missing.join(',')}] 误吞[${stolen.join(',')}] (${fam.size} 形态)`);
    console.log(`      [${list.join(', ')}]`);
    keyOk = false;
  } else {
    console.log(`  ✓ ${root}: ${fam.size} 形态 [${list.join(', ')}]`);
  }
}

// ════════════════════════════════════════════════════════════════════
// 7. fixture 交叉验证
// ════════════════════════════════════════════════════════════════════
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
    else if (fxMissExamples.length < 6) fxMissExamples.push(`${word} → ${expectedLemmas.join(',')}`);
  }
  console.log(`\n[v3] fixture 交叉: ${fxOk}/${fixture.length}`);
  if (fxMissExamples.length > 0) console.log(`  miss 示例: ${fxMissExamples.join(' | ')}`);
}

// ════════════════════════════════════════════════════════════════════
// 8. 体积统计
// ════════════════════════════════════════════════════════════════════
const sizes = Object.values(families).map((s) => s.size).sort((a, b) => a - b);
console.log(
  `\n[v3] 体积: median=${sizes[Math.floor(sizes.length / 2)]}, ` +
    `p75=${sizes[Math.floor(sizes.length * 0.75)]}, ` +
    `p99=${sizes[Math.floor(sizes.length * 0.99)]}, max=${sizes[sizes.length - 1]}`,
);
console.log(`  size==1 family: ${sizes.filter((s) => s === 1).length}`);

if (!keyOk) {
  console.error('\n[v3] 关键 case 未全过！');
  process.exit(1);
}

// ════════════════════════════════════════════════════════════════════
// 9. 写文件
// ════════════════════════════════════════════════════════════════════
const familiesOut: Record<string, string[]> = {};
for (const [k, v] of Object.entries(families)) familiesOut[k] = [...v].sort();
fs.writeFileSync(FAMILIES_OUT, JSON.stringify(familiesOut) + '\n');

const whitelist = new Set<string>();
for (const fs2 of Object.values(familiesOut)) for (const w of fs2) whitelist.add(w);
for (const arr of Object.values(curatedSources))
  for (const w of arr) {
    const l = w.toLowerCase();
    if (shapeOk(l)) whitelist.add(l);
  }
for (const f of inflectionToBase.keys()) if (shapeOk(f)) whitelist.add(f);
const sortedWhitelist = [...whitelist].sort();
fs.writeFileSync(WHITELIST_OUT, JSON.stringify(sortedWhitelist) + '\n');

const wlSize = fs.statSync(WHITELIST_OUT).size;
const fmSize = fs.statSync(FAMILIES_OUT).size;
console.log(
  `\n[v3] ✓ 写入 word-families.json (${(fmSize / 1024 / 1024).toFixed(2)} MB, ` +
    `${Object.keys(familiesOut).length} families) + dictionary-whitelist.json ` +
    `(${(wlSize / 1024).toFixed(0)} KB, ${sortedWhitelist.length} 词)`,
);
