/**
 * 词典 JSONL 质量审计。
 *
 * 输入：apps/server/src/data/dictionary-structured.jsonl
 * 检查项：
 *   1. 覆盖率 — 白名单 / family root 命中率
 *   2. 字段完整度 — phonetics / chinese / english / forms / examples 缺失率
 *   3. 释义结构合理性 — POS 分布、平均义项数、单条释义平均长度、过短/过长异常
 *   4. 词形一致性 — JSONL 的 forms 是不是 word-families.json 的子集（或反过来）
 *   5. CET-4 / 高频词专项抽样 — 在 cet_4 / coca20000 前 5000 里随机抽 50 个，
 *      列出 word + chinese_entries_short，由人工 spot check
 *   6. P0 报警 — 关键高频词如果中文释义为空，必须报错
 *
 * 输出：apps/server/data-build/audit-dictionary.json + 控制台摘要
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const ROOT = path.resolve(__dirname, '..');
const JSONL = path.join(ROOT, 'src/data/dictionary-structured.jsonl');
const WHITELIST = path.join(ROOT, 'src/data/dictionary-whitelist.json');
const FAMILIES = path.join(ROOT, 'src/data/word-families.json');
const CET4 = path.join(ROOT, 'src/data/cet_4.json');
const COCA = path.join(ROOT, 'src/data/coca20000.json');
const OUT = path.join(ROOT, 'data-build/audit-dictionary.json');

interface DictRecord {
  word: string;
  phonetics: string[];
  audio: string[];
  forms: string[];
  chinese_entries_short: { pos: string; definitions: string[] }[];
  entries: { pos: string; senses: { glosses: string[]; examples: string[] }[] }[];
}

function pick<T>(arr: T[], n: number): T[] {
  // 简单随机抽样（可重现性靠 deterministic seed 也行，但 audit 要的就是真随机）
  const a = arr.slice();
  const out: T[] = [];
  while (out.length < n && a.length) {
    const i = Math.floor(Math.random() * a.length);
    out.push(a.splice(i, 1)[0]);
  }
  return out;
}

async function main() {
  // 加载 reference 数据
  const whitelist = new Set(
    (JSON.parse(fs.readFileSync(WHITELIST, 'utf8')) as string[]).map((w) => w.toLowerCase()),
  );
  const families = JSON.parse(fs.readFileSync(FAMILIES, 'utf8')) as Record<string, string[]>;
  const familyRoots = new Set(Object.keys(families).map((r) => r.toLowerCase()));
  const familyForms = new Map<string, string[]>();
  for (const [root, forms] of Object.entries(families)) {
    familyForms.set(root.toLowerCase(), forms.map((f) => f.toLowerCase()));
  }

  // CET-4 / COCA 都是 { key, name, description, words: string[] }
  const cet4Raw = JSON.parse(fs.readFileSync(CET4, 'utf8')) as { words: string[] };
  const cet4 = new Set(cet4Raw.words.map((w) => w.toLowerCase()));

  const cocaRaw = JSON.parse(fs.readFileSync(COCA, 'utf8')) as { words: string[] };
  const cocaTop5k = new Set(cocaRaw.words.slice(0, 5000).map((w) => w.toLowerCase()));

  // 流式读 JSONL
  const records: DictRecord[] = [];
  const stream = fs.createReadStream(JSONL);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    records.push(JSON.parse(line));
  }
  console.log(`[INFO] 读入 ${records.length} 条 dictionary entry`);

  // ---------- 统计 ----------
  const seenWords = new Set(records.map((r) => r.word));
  const stats = {
    total: records.length,
    coverage: {
      whitelistTotal: whitelist.size,
      whitelistHit: 0,
      whitelistHitRate: 0,
      familyRootTotal: familyRoots.size,
      familyRootHit: 0,
      familyRootHitRate: 0,
      cet4Total: cet4.size,
      cet4Hit: 0,
      cet4HitRate: 0,
      cocaTop5kTotal: cocaTop5k.size,
      cocaTop5kHit: 0,
      cocaTop5kHitRate: 0,
    },
    fieldCompleteness: {
      hasPhonetic: 0,
      hasForms: 0,
      hasChineseShort: 0,
      hasEnglishEntries: 0,
      hasAudio: 0,
      hasExamples: 0,
      bothChineseAndEnglish: 0,
      onlyChinese: 0,
      onlyEnglish: 0,
      neither: 0,
    },
    posDistribution: {} as Record<string, number>,
    glossLength: {
      chineseAvg: 0,
      chineseMax: 0,
      englishAvg: 0,
      englishMax: 0,
    },
    sensesPerEntry: {
      chineseAvgPos: 0,
      chineseAvgDefsPerPos: 0,
      englishAvgPos: 0,
      englishAvgSensesPerPos: 0,
    },
    formsConsistency: {
      checkedAgainstFamily: 0,
      formsSubsetOfFamily: 0,
      formsSupersetOfFamily: 0,
      formsDisjoint: 0,
      mismatchSample: [] as Array<{ word: string; jsonlForms: string[]; familyForms: string[] }>,
    },
    p0Issues: [] as string[],
  };

  let chineseTotalLen = 0;
  let chineseLenCount = 0;
  let englishTotalLen = 0;
  let englishLenCount = 0;
  let chinesePosTotal = 0;
  let chineseDefsTotal = 0;
  let englishPosTotal = 0;
  let englishSensesTotal = 0;

  for (const r of records) {
    // coverage
    if (whitelist.has(r.word)) stats.coverage.whitelistHit++;
    if (familyRoots.has(r.word)) stats.coverage.familyRootHit++;
    if (cet4.has(r.word)) stats.coverage.cet4Hit++;
    if (cocaTop5k.has(r.word)) stats.coverage.cocaTop5kHit++;

    // field completeness
    const hasPhon = r.phonetics && r.phonetics.length > 0;
    const hasForms = r.forms && r.forms.length > 0;
    const hasZh = r.chinese_entries_short && r.chinese_entries_short.length > 0;
    const hasEn = r.entries && r.entries.length > 0 && r.entries[0].senses?.[0]?.glosses?.[0];
    const hasAudio = r.audio && r.audio.length > 0;
    let hasExamples = false;
    for (const e of r.entries || []) {
      for (const s of e.senses || []) {
        if (s.examples && s.examples.length > 0) hasExamples = true;
      }
    }

    if (hasPhon) stats.fieldCompleteness.hasPhonetic++;
    if (hasForms) stats.fieldCompleteness.hasForms++;
    if (hasZh) stats.fieldCompleteness.hasChineseShort++;
    if (hasEn) stats.fieldCompleteness.hasEnglishEntries++;
    if (hasAudio) stats.fieldCompleteness.hasAudio++;
    if (hasExamples) stats.fieldCompleteness.hasExamples++;
    if (hasZh && hasEn) stats.fieldCompleteness.bothChineseAndEnglish++;
    else if (hasZh) stats.fieldCompleteness.onlyChinese++;
    else if (hasEn) stats.fieldCompleteness.onlyEnglish++;
    else stats.fieldCompleteness.neither++;

    // POS 分布（中文优先，作为词典展示主体）
    for (const block of r.chinese_entries_short || []) {
      stats.posDistribution[block.pos] = (stats.posDistribution[block.pos] || 0) + 1;
      chinesePosTotal++;
      chineseDefsTotal += block.definitions.length;
      for (const d of block.definitions) {
        chineseTotalLen += d.length;
        chineseLenCount++;
        if (d.length > stats.glossLength.chineseMax) stats.glossLength.chineseMax = d.length;
      }
    }
    for (const e of r.entries || []) {
      englishPosTotal++;
      for (const s of e.senses || []) {
        englishSensesTotal++;
        for (const g of s.glosses || []) {
          englishTotalLen += g.length;
          englishLenCount++;
          if (g.length > stats.glossLength.englishMax) stats.glossLength.englishMax = g.length;
        }
      }
    }

    // forms vs family
    const fam = familyForms.get(r.word);
    if (fam && fam.length > 0 && r.forms && r.forms.length > 0) {
      stats.formsConsistency.checkedAgainstFamily++;
      const famSet = new Set(fam);
      const jsonlSet = new Set(r.forms.map((f) => f.toLowerCase()));
      let allInFam = true;
      let allInJsonl = true;
      let anyOverlap = false;
      for (const f of jsonlSet) {
        if (famSet.has(f)) anyOverlap = true;
        else allInFam = false;
      }
      for (const f of famSet) {
        if (!jsonlSet.has(f) && f !== r.word) allInJsonl = false;
      }
      if (allInFam) stats.formsConsistency.formsSubsetOfFamily++;
      if (allInJsonl) stats.formsConsistency.formsSupersetOfFamily++;
      if (!anyOverlap) {
        stats.formsConsistency.formsDisjoint++;
        if (stats.formsConsistency.mismatchSample.length < 20) {
          stats.formsConsistency.mismatchSample.push({
            word: r.word,
            jsonlForms: r.forms,
            familyForms: fam,
          });
        }
      }
    }
  }

  stats.coverage.whitelistHitRate = +(
    (stats.coverage.whitelistHit / Math.max(1, stats.coverage.whitelistTotal)) *
    100
  ).toFixed(2);
  stats.coverage.familyRootHitRate = +(
    (stats.coverage.familyRootHit / Math.max(1, stats.coverage.familyRootTotal)) *
    100
  ).toFixed(2);
  stats.coverage.cet4HitRate = +(
    (stats.coverage.cet4Hit / Math.max(1, stats.coverage.cet4Total)) *
    100
  ).toFixed(2);
  stats.coverage.cocaTop5kHitRate = +(
    (stats.coverage.cocaTop5kHit / Math.max(1, stats.coverage.cocaTop5kTotal)) *
    100
  ).toFixed(2);

  stats.glossLength.chineseAvg = +(chineseTotalLen / Math.max(1, chineseLenCount)).toFixed(2);
  stats.glossLength.englishAvg = +(englishTotalLen / Math.max(1, englishLenCount)).toFixed(2);
  stats.sensesPerEntry.chineseAvgPos = +(chinesePosTotal / Math.max(1, records.length)).toFixed(2);
  stats.sensesPerEntry.chineseAvgDefsPerPos = +(
    chineseDefsTotal / Math.max(1, chinesePosTotal)
  ).toFixed(2);
  stats.sensesPerEntry.englishAvgPos = +(englishPosTotal / Math.max(1, records.length)).toFixed(2);
  stats.sensesPerEntry.englishAvgSensesPerPos = +(
    englishSensesTotal / Math.max(1, englishPosTotal)
  ).toFixed(2);

  // ---------- P0 高频词必须有中文释义 ----------
  // 取 COCA top 5k + CET-4 列表，必须 100% 命中且必须有中文释义
  const p0Words = new Set<string>([...cocaTop5k, ...cet4]);
  const missingZh: string[] = [];
  const notInDict: string[] = [];
  for (const w of p0Words) {
    const rec = records.find((r) => r.word === w);
    if (!rec) {
      notInDict.push(w);
    } else if (!rec.chinese_entries_short || rec.chinese_entries_short.length === 0) {
      missingZh.push(w);
    }
  }
  stats.p0Issues = [];
  if (notInDict.length > 0) {
    stats.p0Issues.push(
      `高频词不在词典: ${notInDict.length} 个 (示例: ${notInDict.slice(0, 10).join(', ')})`,
    );
  }
  if (missingZh.length > 0) {
    stats.p0Issues.push(
      `高频词无中文释义: ${missingZh.length} 个 (示例: ${missingZh.slice(0, 10).join(', ')})`,
    );
  }

  // ---------- 抽样人工 spot check ----------
  // 在 CET-4 + COCA top 5k 里随机抽 50 个，列 chinese_entries_short
  const samplePool = records.filter((r) => cet4.has(r.word) || cocaTop5k.has(r.word));
  const sample = pick(samplePool, 50).map((r) => ({
    word: r.word,
    phonetics: r.phonetics,
    forms: r.forms,
    zh: r.chinese_entries_short,
    en: r.entries.map((e) => ({
      pos: e.pos,
      gloss0: e.senses[0]?.glosses[0]?.slice(0, 80),
    })),
  }));

  // ---------- 异常释义抽样 ----------
  // 中文释义里出现 [xxx] 域名标注（应该已被剥离）、'\\r'、'\\n' 残留 ——
  const dirty: Array<{ word: string; field: string; val: string }> = [];
  for (const r of records) {
    for (const block of r.chinese_entries_short || []) {
      for (const d of block.definitions) {
        if (/\\r|\\n|\r|\n/.test(d) || /^\[[^\]]+\]/.test(d)) {
          if (dirty.length < 30) dirty.push({ word: r.word, field: 'zh', val: d });
        }
      }
    }
  }

  // ---------- 输出 ----------
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ...stats, sample, dirty }, null, 2));

  // 控制台报表
  console.log('\n========== 词典质量审计 ==========');
  console.log(`总条数: ${stats.total}`);
  console.log('\n[覆盖率]');
  console.log(
    `  白名单: ${stats.coverage.whitelistHit}/${stats.coverage.whitelistTotal} = ${stats.coverage.whitelistHitRate}%`,
  );
  console.log(
    `  family root: ${stats.coverage.familyRootHit}/${stats.coverage.familyRootTotal} = ${stats.coverage.familyRootHitRate}%`,
  );
  console.log(
    `  CET-4: ${stats.coverage.cet4Hit}/${stats.coverage.cet4Total} = ${stats.coverage.cet4HitRate}%`,
  );
  console.log(
    `  COCA top 5k: ${stats.coverage.cocaTop5kHit}/${stats.coverage.cocaTop5kTotal} = ${stats.coverage.cocaTop5kHitRate}%`,
  );

  console.log('\n[字段完整度（占总条数 %）]');
  const T = stats.total;
  console.log(`  音标 phonetics: ${stats.fieldCompleteness.hasPhonetic} (${pct(stats.fieldCompleteness.hasPhonetic, T)}%)`);
  console.log(`  词形 forms:     ${stats.fieldCompleteness.hasForms} (${pct(stats.fieldCompleteness.hasForms, T)}%)`);
  console.log(`  中文短释义:     ${stats.fieldCompleteness.hasChineseShort} (${pct(stats.fieldCompleteness.hasChineseShort, T)}%)`);
  console.log(`  英文释义:       ${stats.fieldCompleteness.hasEnglishEntries} (${pct(stats.fieldCompleteness.hasEnglishEntries, T)}%)`);
  console.log(`  音频 audio:     ${stats.fieldCompleteness.hasAudio} (${pct(stats.fieldCompleteness.hasAudio, T)}%)`);
  console.log(`  例句 examples:  ${stats.fieldCompleteness.hasExamples} (${pct(stats.fieldCompleteness.hasExamples, T)}%)`);
  console.log(`  中英都有:       ${stats.fieldCompleteness.bothChineseAndEnglish} (${pct(stats.fieldCompleteness.bothChineseAndEnglish, T)}%)`);
  console.log(`  仅中文:         ${stats.fieldCompleteness.onlyChinese} (${pct(stats.fieldCompleteness.onlyChinese, T)}%)`);
  console.log(`  仅英文:         ${stats.fieldCompleteness.onlyEnglish} (${pct(stats.fieldCompleteness.onlyEnglish, T)}%)`);
  console.log(`  都没有:         ${stats.fieldCompleteness.neither} (${pct(stats.fieldCompleteness.neither, T)}%)`);

  console.log('\n[POS 分布（中文 chinese_entries_short）]');
  const posSorted = Object.entries(stats.posDistribution).sort((a, b) => b[1] - a[1]);
  for (const [pos, n] of posSorted.slice(0, 12)) {
    console.log(`  ${pos.padEnd(8)} ${n}`);
  }

  console.log('\n[释义结构]');
  console.log(`  中文：每词平均 POS=${stats.sensesPerEntry.chineseAvgPos}，每 POS 平均简释 ${stats.sensesPerEntry.chineseAvgDefsPerPos} 条`);
  console.log(`  英文：每词平均 POS=${stats.sensesPerEntry.englishAvgPos}，每 POS 平均义项 ${stats.sensesPerEntry.englishAvgSensesPerPos} 条`);
  console.log(`  中文释义平均长度 ${stats.glossLength.chineseAvg} 字（max ${stats.glossLength.chineseMax}）`);
  console.log(`  英文释义平均长度 ${stats.glossLength.englishAvg} 字（max ${stats.glossLength.englishMax}）`);

  console.log('\n[forms vs word-families 一致性]');
  const c = stats.formsConsistency;
  console.log(`  双方都有 forms 的词数: ${c.checkedAgainstFamily}`);
  console.log(`  forms ⊆ family: ${c.formsSubsetOfFamily}（jsonl 不超出 family 范围 = 安全）`);
  console.log(`  forms ⊇ family: ${c.formsSupersetOfFamily}（jsonl 覆盖 family）`);
  console.log(`  完全脱节 disjoint: ${c.formsDisjoint}`);

  console.log('\n[P0 报警]');
  if (stats.p0Issues.length === 0) console.log('  ✅ 高频词覆盖 + 中文释义完整');
  else for (const i of stats.p0Issues) console.log(`  ⚠️  ${i}`);

  console.log('\n[残留脏数据 sample]');
  for (const d of dirty.slice(0, 10)) console.log(`  ${d.word} [${d.field}]: ${JSON.stringify(d.val)}`);
  if (dirty.length === 0) console.log('  ✅ 无可见脏数据');

  console.log('\n[抽样 50 条已写入]');
  console.log(`  ${OUT} → 字段 sample[]，可直接 jq 查看`);
  console.log('\n========================================');
}

function pct(a: number, b: number) {
  return ((a / Math.max(1, b)) * 100).toFixed(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
