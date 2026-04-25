/**
 * 词族数据多维质量审计（不是 cherry-picked spot check）
 *
 * 维度：
 *   1. 误吞 (precision)：真实独立词被错误归入其他 base 家族
 *   2. 漏收 (recall)：常见 inflection 没出现在该 base 家族里
 *   3. 噪声 (noise)：family 里包含伪英语形态（womaned 等）
 *   4. 高频覆盖：NGSL / COCA top 词的 family 是否健全
 *   5. 同形异性词分配
 *   6. 体积 / 形态分布
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'src/data');

const families: Record<string, string[]> = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'word-families.json'), 'utf-8'),
);
const whitelist: string[] = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'dictionary-whitelist.json'), 'utf-8'),
);
const wset = new Set(whitelist.map((w) => w.toLowerCase()));

const verbMap: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'verb-inflection-map.json'), 'utf-8'),
);
const nounMapBase: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'noun-inflection-map.json'), 'utf-8'),
);
const adjMapBase: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'adj-inflection-map.json'), 'utf-8'),
);
const pluralOverrides: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'irregular-plural-overrides.json'), 'utf-8'),
);
const adjOverrides: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'irregular-adj-overrides.json'), 'utf-8'),
);
const nounMap: Record<string, string> = { ...nounMapBase, ...pluralOverrides };
const adjMap: Record<string, string> = { ...adjMapBase, ...adjOverrides };

// === 反向索引：surface form → 它属于哪个 family ===
const wordToFamily = new Map<string, string>();
for (const [base, words] of Object.entries(families)) {
  for (const w of words) wordToFamily.set(w, base);
}

// === compromise lemma 推断（仅 audit 时按需 lazy 调用，给 precision 维度
// 区分"算法启发式误吞" vs "wink/POS 已验证的正确归属"用） ===
import nlpFactory from 'compromise';
const nlp = (nlpFactory as any).default ?? (nlpFactory as any);
const lemmaCache = new Map<string, string>();

// adj 比较级 / 最高级 fallback（compromise 不会自动还原 brighter→bright）
function ruleStemForCompAdj(w: string, evidenceSet: Set<string>): string | null {
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
    if (!evidenceSet.has(stem)) continue;
    const tags: string[] = nlp(stem).terms().json()[0]?.terms[0]?.tags ?? [];
    if (tags.includes('Adjective')) return stem;
  }
  return null;
}

const wsetForLemma = new Set(whitelist.map((w) => w.toLowerCase()));
function lemmaOf(w: string): string {
  if (lemmaCache.has(w)) return lemmaCache.get(w)!;
  if (verbMap[w]) {
    lemmaCache.set(w, verbMap[w]);
    return verbMap[w];
  }
  if (nounMap[w]) {
    lemmaCache.set(w, nounMap[w]);
    return nounMap[w];
  }
  if (adjMap[w]) {
    lemmaCache.set(w, adjMap[w]);
    return adjMap[w];
  }
  const doc = nlp(w);
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
  const tagsRaw: string[] = doc.terms().json()[0]?.terms[0]?.tags ?? [];
  if (tagsRaw.includes('Adjective') && (w.endsWith('ed') || w.endsWith('d') || w.endsWith('ing'))) {
    const d = nlp(w);
    d.tag('Verb');
    const i2: string = d.verbs().toInfinitive().out('text');
    if (i2 && i2 !== w) {
      lemmaCache.set(w, i2);
      return i2;
    }
  }
  const compStem = ruleStemForCompAdj(w, wsetForLemma);
  if (compStem && compStem !== w) {
    lemmaCache.set(w, compStem);
    return compStem;
  }
  lemmaCache.set(w, w);
  return w;
}

console.log(`数据规模:`);
console.log(`  families: ${Object.keys(families).length}`);
console.log(`  surface forms (含重复，含 base): ${[...wordToFamily.keys()].length}`);
console.log(`  white-list 词数: ${whitelist.length}`);
console.log('');

// ========== 维度 1：误吞 (precision) ==========
// "误吞" = 一个白名单词 X 被归入了 family Y (Y ≠ X)，且 X 自己没 family，
//          且 X→Y 不是 wink/lemma 已验证的合法 inflection 关系。
// 排除：wink 反向 map 给出 X → Y（金标），或 compromise.lemma(X) === Y。
//      这两种情况下 X 进 Y family 是正确的（am→be、worked→work、children→child）。
console.log('━━━ 1. 误吞统计 ━━━');
const swallowed: Array<{ word: string; family: string }> = [];
const validatedSwallows: Array<{ word: string; family: string; via: string }> = [];
for (const word of whitelist) {
  const w = word.toLowerCase();
  if (families[w]) continue;
  const f = wordToFamily.get(w);
  if (!f || f === w) continue;
  // wink validation
  if (verbMap[w] === f || nounMap[w] === f || adjMap[w] === f) {
    validatedSwallows.push({ word: w, family: f, via: 'wink' });
    continue;
  }
  // compromise lemma validation
  if (lemmaOf(w) === f) {
    validatedSwallows.push({ word: w, family: f, via: 'lemma' });
    continue;
  }
  swallowed.push({ word: w, family: f });
}
console.log(
  `白名单词被归入其它 family: ${swallowed.length + validatedSwallows.length}`,
);
console.log(
  `  ✓ wink/lemma 已验证（合法 inflection）: ${validatedSwallows.length}`,
);
console.log(
  `  ✗ 真正误吞（启发式错误）: ${swallowed.length} (${((swallowed.length / whitelist.length) * 100).toFixed(2)}%)`,
);

// 按吞它的 base 分组，看哪些 family 吞最多
const byFamily = new Map<string, string[]>();
for (const { word, family } of swallowed) {
  if (!byFamily.has(family)) byFamily.set(family, []);
  byFamily.get(family)!.push(word);
}
const topSwallowers = [...byFamily.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10);
console.log(`吞最多的 10 个 family:`);
for (const [base, words] of topSwallowers) {
  console.log(`  ${base.padEnd(15)} 吞 ${words.length} 个: ${words.slice(0, 6).join(', ')}${words.length > 6 ? '...' : ''}`);
}

// 按后缀分类：哪种 -er/-ed/-ing/-ies/-s 误吞最多
const suffixBuckets = new Map<string, number>();
for (const { word, family } of swallowed) {
  let bucket = 'other';
  if (word === family + 'er') bucket = '-er (agent: runner/boxer)';
  else if (word === family + 'or') bucket = '-or';
  else if (word === family + 'ed') bucket = '-ed';
  else if (word === family + 'd') bucket = '-d';
  else if (word === family + 'ing') bucket = '-ing';
  else if (word === family + 's') bucket = '-s';
  else if (word === family + 'es') bucket = '-es';
  else if (word === family + 'ies') bucket = '-ies';
  suffixBuckets.set(bucket, (suffixBuckets.get(bucket) || 0) + 1);
}
console.log(`按后缀分布 (Top 8):`);
for (const [k, v] of [...suffixBuckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${k.padEnd(30)} ${v}`);
}
console.log('');

// ========== 维度 2：漏收 (recall) ==========
// 对于已知应该在某 family 的形态，检查是否真的在
console.log('━━━ 2. 漏收检查 (recall) ━━━');

// 2a. wink 不规则映射的 form 是否都在对应 family
let winkMissing = 0;
let winkChecked = 0;
const winkSamples: string[] = [];
for (const [form, base] of Object.entries({ ...verbMap, ...nounMap, ...adjMap })) {
  if (!families[base]) continue; // base 不是 family root，跳过
  winkChecked++;
  if (!families[base].includes(form)) {
    winkMissing++;
    if (winkSamples.length < 6) winkSamples.push(`${form} 应在 ${base} 但没在`);
  }
}
console.log(`wink 不规则覆盖: ${winkChecked - winkMissing}/${winkChecked} (miss ${winkMissing})`);
if (winkMissing > 0) console.log(`  miss 示例:`, winkSamples.join(' | '));

// 2b. 对常见动词的标准 inflection 检查
const VERB_CHECKS: Array<{ base: string; needs: string[] }> = [
  { base: 'walk', needs: ['walks', 'walked', 'walking'] },
  { base: 'play', needs: ['plays', 'played', 'playing'] },
  { base: 'study', needs: ['studies', 'studied', 'studying'] },
  { base: 'stop', needs: ['stops', 'stopped', 'stopping'] },
  { base: 'plan', needs: ['plans', 'planned', 'planning'] },
  { base: 'work', needs: ['works', 'worked', 'working'] },
  { base: 'try', needs: ['tries', 'tried', 'trying'] },
  { base: 'eat', needs: ['eats', 'ate', 'eaten', 'eating'] },
  { base: 'write', needs: ['writes', 'wrote', 'written', 'writing'] },
  { base: 'speak', needs: ['speaks', 'spoke', 'spoken', 'speaking'] },
  // dual-form past tense（v3 关键修复）
  { base: 'dream', needs: ['dreams', 'dreamed', 'dreaming'] },
  { base: 'learn', needs: ['learns', 'learned', 'learning'] },
  { base: 'spell', needs: ['spells', 'spelled', 'spelling'] },
  { base: 'burn', needs: ['burns', 'burned', 'burning'] },
  // 双辅音
  { base: 'run', needs: ['runs', 'ran', 'running'] },
  { base: 'sit', needs: ['sits', 'sat', 'sitting'] },
  { base: 'begin', needs: ['begins', 'began', 'begun', 'beginning'] },
  // -e 结尾
  { base: 'make', needs: ['makes', 'made', 'making'] },
  { base: 'take', needs: ['takes', 'took', 'taken', 'taking'] },
  { base: 'give', needs: ['gives', 'gave', 'given', 'giving'] },
];
let verbMiss = 0;
const verbDetails: string[] = [];
for (const { base, needs } of VERB_CHECKS) {
  if (!families[base]) {
    verbDetails.push(`✗ ${base} 没 family`);
    verbMiss += needs.length;
    continue;
  }
  const missing = needs.filter((n) => !families[base].includes(n));
  if (missing.length > 0) {
    verbDetails.push(`✗ ${base} 缺 ${missing.join(',')}`);
    verbMiss += missing.length;
  }
}
console.log(`常见动词 inflection 漏收: ${verbMiss}`);
verbDetails.slice(0, 10).forEach((d) => console.log(`  ${d}`));

// 2c. 名词复数 / 形容词比较级
const NOUN_CHECKS = [
  // 规则复数
  { base: 'dog', needs: ['dogs'] },
  { base: 'cat', needs: ['cats'] },
  { base: 'box', needs: ['boxes'] },
  { base: 'baby', needs: ['babies'] },
  { base: 'wolf', needs: ['wolves'] },
  { base: 'leaf', needs: ['leaves'] },
  { base: 'knife', needs: ['knives'] },
  { base: 'wife', needs: ['wives'] },
  // 学术 -is/-um/-on/-us/-ix
  { base: 'analysis', needs: ['analyses'] },
  { base: 'crisis', needs: ['crises'] },
  { base: 'thesis', needs: ['theses'] },
  { base: 'datum', needs: ['data'] },
  { base: 'medium', needs: ['media'] },
  { base: 'phenomenon', needs: ['phenomena'] },
  { base: 'criterion', needs: ['criteria'] },
  { base: 'cactus', needs: ['cacti'] },
  { base: 'matrix', needs: ['matrices'] },
  // 古英语 -man/-men 复合（wink 漏，由 overrides 补）
  { base: 'fireman', needs: ['firemen'] },
  { base: 'policeman', needs: ['policemen'] },
  { base: 'chairman', needs: ['chairmen'] },
  { base: 'spokesman', needs: ['spokesmen'] },
  { base: 'businessman', needs: ['businessmen'] },
  { base: 'gentleman', needs: ['gentlemen'] },
  { base: 'fisherman', needs: ['fishermen'] },
  { base: 'congressman', needs: ['congressmen'] },
  // -woman → -women
  { base: 'spokeswoman', needs: ['spokeswomen'] },
  // 全不规则
  { base: 'foot', needs: ['feet'] },
  { base: 'tooth', needs: ['teeth'] },
  { base: 'goose', needs: ['geese'] },
];
let nounMiss = 0;
const nounDetails: string[] = [];
for (const { base, needs } of NOUN_CHECKS) {
  if (!families[base]) {
    nounMiss += needs.length;
    nounDetails.push(`✗ ${base} 没 family`);
    continue;
  }
  const missing = needs.filter((n) => !families[base].includes(n));
  if (missing.length > 0) {
    nounDetails.push(`✗ ${base} 缺 ${missing.join(',')}`);
    nounMiss += missing.length;
  }
}
console.log(`常见名词复数漏收: ${nounMiss}`);
nounDetails.slice(0, 10).forEach((d) => console.log(`  ${d}`));

const ADJ_CHECKS = [
  { base: 'fast', needs: ['faster', 'fastest'] },
  { base: 'small', needs: ['smaller', 'smallest'] },
  { base: 'happy', needs: ['happier', 'happiest'] },
  { base: 'easy', needs: ['easier', 'easiest'] },
  { base: 'big', needs: ['bigger', 'biggest'] },
  { base: 'large', needs: ['larger', 'largest'] },
  { base: 'busy', needs: ['busier', 'busiest'] },
  { base: 'good', needs: ['better', 'best'] },
  { base: 'bad', needs: ['worse', 'worst'] },
  { base: 'far', needs: ['farther', 'farthest'] },
];
let adjMiss = 0;
const adjDetails: string[] = [];
for (const { base, needs } of ADJ_CHECKS) {
  if (!families[base]) {
    adjMiss += needs.length;
    adjDetails.push(`✗ ${base} 没 family`);
    continue;
  }
  const missing = needs.filter((n) => !families[base].includes(n));
  if (missing.length > 0) {
    adjDetails.push(`✗ ${base} 缺 ${missing.join(',')}`);
    adjMiss += missing.length;
  }
}
console.log(`常见形容词比较级漏收: ${adjMiss}`);
adjDetails.slice(0, 10).forEach((d) => console.log(`  ${d}`));
console.log('');

// ========== 维度 3：噪声 (伪生成形态) ==========
console.log('━━━ 3. 噪声 (伪生成形态) ━━━');
// 不在白名单 + 不在任何 wink map 里 = 几乎肯定是伪生成
let totalForms = 0;
let pseudoForms = 0;
const pseudoSamples: string[] = [];
for (const [base, words] of Object.entries(families)) {
  for (const w of words) {
    if (w === base) continue;
    totalForms++;
    const knownByWink = !!(verbMap[w] || nounMap[w] || adjMap[w]);
    if (!wset.has(w) && !knownByWink) {
      pseudoForms++;
      if (pseudoSamples.length < 12) pseudoSamples.push(`${w} (in ${base})`);
    }
  }
}
console.log(`非 base 形态总数: ${totalForms}`);
console.log(`既不在白名单又不在 wink 的 (伪): ${pseudoForms} (${((pseudoForms / totalForms) * 100).toFixed(1)}%)`);
console.log(`样本: ${pseudoSamples.slice(0, 8).join(', ')}`);
console.log('');

// ========== 维度 4：高频学习者词覆盖 ==========
console.log('━━━ 4. 高频学习者词族健康 ━━━');
const LEARNER_CRITICAL = [
  'be','have','do','say','go','can','get','make','know','will','think','take',
  'see','come','want','look','use','find','give','tell','work','call','try',
  'ask','need','feel','become','leave','put','mean','keep','let','begin','seem',
  'help','show','hear','play','run','move','live','believe','bring','happen',
  'write','sit','stand','lose','pay','meet','include','continue','set','learn',
  'change','lead','understand','watch','follow','stop','create','speak','read',
  'good','great','small','large','big','high','low','new','old','young',
  'long','short','easy','hard','fast','slow','happy','sad','strong','weak',
  'man','woman','child','people','time','year','day','week','month',
  'house','school','home','world','country','city','place','room',
  'water','food','book','car','road','river','tree','mountain','sea',
];
let critFamiliesMissing = 0;
let critOneWord = 0;
let critOk = 0;
const critIssues: string[] = [];
for (const w of LEARNER_CRITICAL) {
  // 若 w 自己不是 base，但已被归入某 family（典型：people 在 person family，
  // children 在 child family），按健康对待——客户端 lemma 路径会处理这层。
  const fam = families[w] ?? families[wordToFamily.get(w) ?? ''];
  if (!fam) {
    critFamiliesMissing++;
    critIssues.push(`✗ ${w}: 无 family`);
    continue;
  }
  if (fam.length <= 1) {
    critOneWord++;
    critIssues.push(`⚠ ${w}: 仅 ${fam.length} 形态`);
    continue;
  }
  critOk++;
}
console.log(`核心学习者词 (${LEARNER_CRITICAL.length} 个):`);
console.log(`  ✓ 健康: ${critOk}`);
console.log(`  ⚠ 单形态: ${critOneWord}`);
console.log(`  ✗ 无 family: ${critFamiliesMissing}`);
if (critIssues.length > 0) {
  console.log(`  问题:`);
  critIssues.slice(0, 12).forEach((s) => console.log(`    ${s}`));
}
console.log('');

// ========== 维度 5：同形异性词处理 ==========
console.log('━━━ 5. 同形异性词分配 ━━━');
const HOMOGRAPHS = ['saw', 'left', 'lay', 'rose', 'found', 'fell', 'lie', 'lead', 'bear'];
for (const h of HOMOGRAPHS) {
  const family = wordToFamily.get(h);
  console.log(`  ${h.padEnd(8)} → family ${family ?? '(none)'}`);
}
console.log('');

// ========== 维度 6：体积分布 ==========
console.log('━━━ 6. Family 体积分布 ━━━');
const sizes = Object.values(families).map((w) => w.length);
sizes.sort((a, b) => a - b);
const median = sizes[Math.floor(sizes.length / 2)];
const p25 = sizes[Math.floor(sizes.length * 0.25)];
const p75 = sizes[Math.floor(sizes.length * 0.75)];
const p99 = sizes[Math.floor(sizes.length * 0.99)];
const max = sizes[sizes.length - 1];
console.log(`  size: min=${sizes[0]}, p25=${p25}, median=${median}, p75=${p75}, p99=${p99}, max=${max}`);
console.log(`  size==1 family: ${sizes.filter((s) => s === 1).length}`);
console.log(`  size==2 family: ${sizes.filter((s) => s === 2).length}`);
console.log(`  size>=10 family: ${sizes.filter((s) => s >= 10).length}`);
console.log('');

// ========== 综合评分 ==========
console.log('━━━ 综合评分 (满分 100) ━━━');
// precision：仅算"启发式误吞"（不计 wink/lemma 已验证的合法 inflection）
const precisionScore = Math.max(0, 30 - (swallowed.length / whitelist.length) * 1000);
const recallScore = Math.max(
  0,
  20 - winkMissing / 5 - verbMiss * 1.5 - nounMiss * 1.5 - adjMiss * 1.5,
);
const noiseScore = Math.max(0, 15 - (pseudoForms / totalForms) * 100);
const learnerScore = Math.max(0, 35 - critFamiliesMissing * 2 - critOneWord * 0.5);
const total = precisionScore + recallScore + noiseScore + learnerScore;
console.log(`  precision (误吞少): ${precisionScore.toFixed(1)} / 30`);
console.log(`  recall (漏收少):    ${recallScore.toFixed(1)} / 20`);
console.log(`  noise (伪生成少):    ${noiseScore.toFixed(1)} / 15`);
console.log(`  learner-friendly:   ${learnerScore.toFixed(1)} / 35`);
console.log(`  ───────────────`);
console.log(`  TOTAL:              ${total.toFixed(1)} / 100`);
