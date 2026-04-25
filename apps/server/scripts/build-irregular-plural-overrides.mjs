// 一次性脚本：生成 irregular-plural-overrides.json
//
// wink-noun-exceptions 漏掉了大量常见 -man/-woman 复合词的复数（chairman→chairmen,
// fireman→firemen, spokesman→spokesmen 等），rebuild 时把这份 override 当 wink 同
// 等金标处理。同时手维少量 wink 漏的科学/技术名词不规则复数。
//
// 自动来源：curated 五表（COCA + CET-4/6 + junior_high + high）。脚本从词表里抽
// 所有 -man / -woman 结尾的合理复合词（排除 woman/human/roman/german/shaman/talisman
// 等不属于 -man 复数家族的词），生成 ${stem}men → ${stem}man 映射。
//
// 输出：apps/server/src/data/irregular-plural-overrides.json
// 重新生成：node apps/server/scripts/build-irregular-plural-overrides.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const DATA_DIR = path.join(ROOT, 'src/data');
const OUT = path.join(DATA_DIR, 'irregular-plural-overrides.json');

const curatedFiles = ['coca20000', 'cet_4', 'cet_6', 'junior_high', 'high'];
const lemmas = new Set();
for (const f of curatedFiles) {
  const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${f}.json`), 'utf-8'));
  for (const w of j.words) lemmas.add(w.toLowerCase());
}

// 不属于 -man → -men 复数家族的词（词根本身以 -man 结尾但复数走规则 -mans）
const NOT_MAN_PLURAL = new Set([
  'woman', // woman → women 单独处理
  'human', // humans
  'roman', // romans (proper noun pl. 也是 -s)
  'german', // germans
  'shaman', // shamans
  'talisman', // talismans
  'caiman', // caimans
  'cayman', // caymans
  'ottoman', // ottomans
]);
// shaman/talisman 等的复数是 shamans/talismans，不是 shamen/talismen

const overrides = {};

for (const w of lemmas) {
  // -man → -men 复合（必须是合成词，不是单字 'man'，且不在豁免名单）
  if (w.endsWith('man') && w.length >= 5 && w !== 'man' && !NOT_MAN_PLURAL.has(w)) {
    const plural = w.slice(0, -3) + 'men';
    overrides[plural] = w;
  }
  // -woman → -women 复合
  if (w.endsWith('woman') && w.length >= 6) {
    const plural = w.slice(0, -5) + 'women';
    overrides[plural] = w;
  }
}

// 手补：wink 漏的科学技术名词不规则复数
const MANUAL = {
  // -um → -a
  bacteria: 'bacterium',
  curricula: 'curriculum',
  millennia: 'millennium',
  symposia: 'symposium',
  errata: 'erratum',
  ova: 'ovum',
  // -on → -a (剩下两个 wink 漏的)
  // phenomenon/criterion 已在 wink
  // -ix/-ex → -ices
  matrices: 'matrix',
  vortices: 'vortex',
  appendices: 'appendix',
  indices: 'index',
  // -a → -ae
  vertebrae: 'vertebra',
  algae: 'alga',
  larvae: 'larva',
  formulae: 'formula', // formulas 也合法但 formulae 学术圈用
  antennae: 'antenna',
  // -is → -es (wink 已有 analyses/crises/theses，补几个常见)
  diagnoses: 'diagnosis',
  hypotheses: 'hypothesis',
  oases: 'oasis',
  parentheses: 'parenthesis',
  prognoses: 'prognosis',
  syntheses: 'synthesis',
  // -us → -i (wink 已有 cacti/nuclei/radii/fungi/alumni；补常见学术词)
  bacilli: 'bacillus',
  syllabi: 'syllabus',
  stimuli: 'stimulus',
  termini: 'terminus',
  // 其它常见
  dice: 'die', // wink 没有，'dice' 最常见英语
  oxen: 'ox',
  feet: 'foot', // wink 已有？保险起见
  teeth: 'tooth',
  geese: 'goose',
  lice: 'louse',
};
for (const [pl, sg] of Object.entries(MANUAL)) {
  // 只在 sg 在 curated lemmas 里时加（避免引入冷僻词）
  if (lemmas.has(sg)) overrides[pl] = sg;
  else if (sg === 'die' || sg === 'ox' || sg === 'louse' || sg === 'erratum' || sg === 'ovum' || sg === 'alga') {
    // 这几个 sg 不一定在 COCA 但 plural 形态常见，强加
    overrides[pl] = sg;
  }
}

const sorted = Object.fromEntries(Object.entries(overrides).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(OUT, JSON.stringify(sorted, null, 0) + '\n');
console.log(`✓ ${OUT}: ${Object.keys(sorted).length} entries`);
console.log('  -man/-women:', Object.entries(sorted).filter(([k]) => k.endsWith('men')).length);
console.log('  manual sci/tech:', Object.entries(sorted).filter(([k]) => !k.endsWith('men')).length);
console.log('  sample:', Object.entries(sorted).slice(0, 8));
