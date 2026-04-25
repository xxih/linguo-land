// 一次性生成 lemmaFixtures.json：从 UniMorph English (CC-BY-SA) 抽样高频词的
// 形态变化 ground truth，作为 textProcessor.lemmaFixtures.test.ts 的回归集。
//
// 数据源：
//   - https://raw.githubusercontent.com/unimorph/eng/master/eng        ~18M
//   - https://norvig.com/ngrams/count_1w.txt                            ~5M
//
// 缓存到 /tmp/lemma-eval/，重复运行不重复下载。
//
// 抽样策略：
//   1. UniMorph 每行 = (lemma, form, tags)。按形态范畴分桶。
//   2. 噪声过滤：UniMorph 收录大量多词短语（"door to door"）、方言/冷门词
//      （"foind→found"）、错误标注（"daytrade→day"）。我们要的是真实网页常见
//      词的还原，所以双重过滤：
//        - lemma 必须是单 ASCII 词（剔多词短语）
//        - lemma 必须在 Norvig 频率表 top-30K（剔冷门方言）
//        - 名词复数额外校验 len(form) >= len(lemma)
//   3. 同一 surface form 在多 lemma 下出现是常态（"saw" → {see, saw}）。
//      把通过过滤的 lemma 全部留作"接受候选"，测试时 hit 任一即过。
//   4. 每桶按 form 频率取 top N。

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CACHE_DIR = '/tmp/lemma-eval';
const ENG_TSV = path.join(CACHE_DIR, 'eng.tsv');
const FREQ_TXT = path.join(CACHE_DIR, 'count_1w.txt');
const OUT_PATH = path.resolve('src/content/utils/lemmaFixtures.json');

if (!fs.existsSync(ENG_TSV) || !fs.existsSync(FREQ_TXT)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log('Downloading UniMorph eng + Norvig 1-grams...');
  execSync(`curl -sL -o ${ENG_TSV} https://raw.githubusercontent.com/unimorph/eng/master/eng`);
  execSync(`curl -sL -o ${FREQ_TXT} https://norvig.com/ngrams/count_1w.txt`);
}

const formRank = new Map();
{
  let r = 0;
  for (const line of fs.readFileSync(FREQ_TXT, 'utf8').split('\n')) {
    const w = line.split('\t')[0];
    if (!w) continue;
    formRank.set(w.toLowerCase(), r++);
  }
}

const SINGLE_WORD = /^[a-z]+$/;
// 收紧 lemma 频率上限到 10K：剔掉 hav/ave/doe/rin/git 这种冷门拼写变体
const LEMMA_RANK_MAX = 10_000;
const FORM_RANK_MAX = 80_000;
// 单 form 候选 lemma 超过 5 个的视为标注噪声（典型如 "countable" → 几百个词）
const MAX_LEMMAS_PER_FORM = 5;
// UniMorph 标注出的反向/反常条目，全 form 直接剔
const FORM_BLOCKLIST = new Set(['feed', 'een']);

const allRows = fs
  .readFileSync(ENG_TSV, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    const [lemma, form, tag] = l.split('\t');
    return { lemma: lemma?.toLowerCase(), form: form?.toLowerCase(), tag };
  })
  .filter((r) => r.lemma && r.form && r.tag);

// 已知 lemma 集合：UniMorph 任一行的 lemma 列。要在 form !== lemma 过滤之前算，
// 否则像 "further" 这种只以自反行（further → further）出现的 base form 会丢。
const knownLemmas = new Set();
for (const r of allRows) {
  if (SINGLE_WORD.test(r.lemma)) knownLemmas.add(r.lemma);
}

const rows = allRows.filter((r) => {
  if (r.form === r.lemma) return false;
  if (!SINGLE_WORD.test(r.lemma) || !SINGLE_WORD.test(r.form)) return false;
  const lr = formRank.get(r.lemma);
  const fr = formRank.get(r.form);
  if (lr === undefined || lr > LEMMA_RANK_MAX) return false;
  if (fr === undefined || fr > FORM_RANK_MAX) return false;
  return true;
});

const isRegularEd = (lemma, form) =>
  form === lemma + 'ed' ||
  form === lemma + 'd' ||
  (lemma.endsWith('y') && form === lemma.slice(0, -1) + 'ied');

const isRegularIng = (lemma, form) =>
  form === lemma + 'ing' || (lemma.endsWith('e') && form === lemma.slice(0, -1) + 'ing');

const isRegularPlural = (lemma, form) =>
  form === lemma + 's' ||
  form === lemma + 'es' ||
  (lemma.endsWith('y') && form === lemma.slice(0, -1) + 'ies');

// 不规则比较级/最高级允许的少数形态——其余必须 -er/-est 结尾
const IRREGULAR_CMPR = new Set(['better', 'worse', 'further', 'farther', 'less', 'more']);
const IRREGULAR_SPRL = new Set(['best', 'worst', 'furthest', 'farthest', 'least', 'most']);

function bucketKey(row) {
  switch (row.tag) {
    case 'V;PST':
      return isRegularEd(row.lemma, row.form) ? 'verb-past-regular' : 'verb-past-irregular';
    case 'V;V.PTCP;PST':
      return isRegularEd(row.lemma, row.form) ? 'verb-pp-regular' : 'verb-pp-irregular';
    case 'V;V.PTCP;PRS':
      return isRegularIng(row.lemma, row.form) ? 'verb-ing-regular' : 'verb-ing-irregular';
    case 'V;PRS;3;SG':
      // 3sg 必须是 lemma + s/es/ies，否则是 UniMorph 噪声（如 as→ave、its→it）
      if (
        row.form !== row.lemma + 's' &&
        row.form !== row.lemma + 'es' &&
        !(row.lemma.endsWith('y') && row.form === row.lemma.slice(0, -1) + 'ies') &&
        row.form !== 'has' &&
        row.form !== 'does' &&
        row.form !== 'is'
      ) {
        return null;
      }
      return 'verb-3sg';
    case 'N;PL':
      if (row.form.length < row.lemma.length) return null;
      return isRegularPlural(row.lemma, row.form)
        ? 'noun-plural-regular'
        : 'noun-plural-irregular';
    case 'ADJ;CMPR':
      // 必须是 -er 结尾或公认不规则比较级，剔 lighting/flying 这种误标注
      if (!row.form.endsWith('er') && !IRREGULAR_CMPR.has(row.form)) return null;
      return 'adj-comparative';
    case 'ADJ;SPRL':
      if (!row.form.endsWith('est') && !IRREGULAR_SPRL.has(row.form)) return null;
      return 'adj-superlative';
    default:
      return null;
  }
}

const QUOTAS = {
  'verb-past-irregular': 50,
  'verb-past-regular': 25,
  'verb-pp-irregular': 25,
  'verb-pp-regular': 8,
  'verb-ing-irregular': 8,
  'verb-ing-regular': 15,
  'verb-3sg': 20,
  'noun-plural-irregular': 25,
  'noun-plural-regular': 20,
  'adj-comparative': 15,
  'adj-superlative': 15,
};

// bucket → form → Set<lemma>
// 同时按 lemma 频率相对 form 频率过滤——lemma 比 form 还冷门基本是噪声标注
// （如 ad→ave：UniMorph 标记可能是技术正确，但实际用法颠倒）
const buckets = new Map();
for (const row of rows) {
  if (FORM_BLOCKLIST.has(row.form)) continue;
  const key = bucketKey(row);
  if (!key) continue;
  const fr = formRank.get(row.form) ?? Infinity;
  const lr = formRank.get(row.lemma) ?? Infinity;
  if (lr > fr * 2) continue;
  if (!buckets.has(key)) buckets.set(key, new Map());
  const byForm = buckets.get(key);
  if (!byForm.has(row.form)) byForm.set(row.form, new Set());
  byForm.get(row.form).add(row.lemma);
}

// 把 form 自身（若也是合法 lemma）补进每个 fixture 的候选集
for (const byForm of buckets.values()) {
  for (const [form, lemmaSet] of byForm) {
    if (knownLemmas.has(form)) lemmaSet.add(form);
  }
}

const fixtures = [];
const stats = {};
for (const [key, n] of Object.entries(QUOTAS)) {
  const byForm = buckets.get(key) ?? new Map();
  const sorted = [...byForm.entries()]
    .filter(([, lemmaSet]) => lemmaSet.size <= MAX_LEMMAS_PER_FORM)
    .map(([form, lemmaSet]) => ({
      form,
      formRank: formRank.get(form) ?? Infinity,
      expectedLemmas: [...lemmaSet].sort(
        (a, b) => (formRank.get(a) ?? Infinity) - (formRank.get(b) ?? Infinity),
      ),
    }))
    .sort((a, b) => a.formRank - b.formRank)
    .slice(0, n);
  stats[key] = `${sorted.length}/${n} (pool ${byForm.size})`;
  for (const r of sorted) {
    fixtures.push({ category: key, word: r.form, expectedLemmas: r.expectedLemmas });
  }
}

console.log('per-bucket samples taken:');
console.table(stats);
console.log(`\nTotal fixtures: ${fixtures.length}`);

fs.writeFileSync(OUT_PATH, JSON.stringify(fixtures, null, 2) + '\n');
console.log(`Written → ${OUT_PATH}`);
