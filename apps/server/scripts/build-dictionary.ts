/**
 * 把 ECDICT 原始 CSV 映射成我们 DictionaryEntry schema 的 JSONL。
 *
 * 输入：apps/server/data-build/raw/ecdict.csv（gitignore，需先 curl 下来）
 * 白名单：apps/server/src/data/dictionary-whitelist.json（~41K 词）
 * 输出：apps/server/src/data/dictionary-structured.jsonl
 *
 * ECDICT 列：word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio
 * 详见 https://github.com/skywind3000/ECDICT
 *
 * Mapping：
 *   - phonetic → phonetics: [phonetic]（单条 IPA，外面塞数组）
 *   - exchange → forms: 解析 s/d/p/i/3/r/t 拿到所有 surface form
 *   - translation → chinese_entries_short: 按 POS 行切分（"n. 书, 书籍" → {pos:"n.", definitions:["书","书籍"]}）
 *   - definition → entries: 同样按 POS 行切分，做英文 fallback 释义
 *
 * 用法：pnpm exec ts-node scripts/build-dictionary.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const ROOT = path.resolve(__dirname, '..');
const RAW_CSV = path.join(ROOT, 'data-build/raw/ecdict.csv');
const WHITELIST_JSON = path.join(ROOT, 'src/data/dictionary-whitelist.json');
const OUT_JSONL = path.join(ROOT, 'src/data/dictionary-structured.jsonl');
const STATS_JSON = path.join(ROOT, 'data-build/build-dictionary-stats.json');

// ---------- CSV ----------
// ECDICT 的 CSV：双引号包含逗号字段，"\n" 是字面 \n 不是真换行，所以可以按行读。
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQ = false;
      } else {
        cur += c;
      }
    } else {
      if (c === ',') {
        out.push(cur);
        cur = '';
      } else if (c === '"' && cur === '') {
        inQ = true;
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out;
}

// ---------- POS ----------
// ECDICT translation/definition 每行起手是缩写词性，用这套正则识别。
// 中文释义里几乎都带句点（'n.', 'v.', 'vt.' …），英文 definition 列里有时句点缺失（'n a tablet…'），
// 所以同时接受 'n.' 和 'n ' 两种形态。'r' 是 WordNet adverb satellite。
// 已支持：n / v / vt / vi / a / adj / ad / adv / prep / pron / conj / interj / int /
//        art / num / aux / pl / abbr / s / suf / pref / comb / r
const POS_HEAD_RE =
  /^(n|v|vt|vi|a|adj|ad|adv|prep|pron|conj|interj|int|art|num|aux|pl|abbr|s|suf|pref|comb|r)(\.|\s)\s*/i;
// 英文 POS 缩写 → 中式短缩写（chinese_entries_short / entries 都用中式风格保持一致）
const POS_NORMALIZE: Record<string, string> = {
  n: 'n.',
  v: 'v.',
  vt: 'vt.',
  vi: 'vi.',
  a: 'a.',
  adj: 'a.',
  ad: 'adv.',
  adv: 'adv.',
  prep: 'prep.',
  pron: 'pron.',
  conj: 'conj.',
  interj: 'interj.',
  int: 'interj.',
  art: 'art.',
  num: 'num.',
  aux: 'aux.',
  pl: 'pl.',
  abbr: 'abbr.',
  s: 'a.', // WordNet satellite adjective → adjective
  suf: 'suf.',
  pref: 'pref.',
  comb: 'comb.',
  r: 'adv.', // WordNet adverb
};

interface PosBlock {
  pos: string;
  definitions: string[];
}

/**
 * 把 ECDICT 多行（用字面 \n 分隔）的 translation/definition 切成 POS → defs 列表。
 * fallbackPos 用于行首没 POS 也没上文兜底的情况（典型是 "[计] 因特网, ..." 这种 internet/online
 * 的中文释义只有 [域名] 没 POS 的行；从对应英文释义的首个 POS 拿默认值）。
 */
function splitByPos(raw: string, fallbackPos = ''): PosBlock[] {
  if (!raw) return [];
  const lines = raw
    .split(/\\n|\n/g)
    .map((l) => l.replace(/\\r|\r/g, '').trim())
    .filter(Boolean);

  const blocks: PosBlock[] = [];
  for (const line of lines) {
    const m = line.match(POS_HEAD_RE);
    if (m) {
      const rawPos = m[1].toLowerCase();
      const pos = POS_NORMALIZE[rawPos] || `${rawPos}.`;
      const rest = line.slice(m[0].length).trim();
      const defs = splitDefs(rest);
      blocks.push({ pos, definitions: defs });
    } else if (blocks.length > 0) {
      // 没有 POS 头但前面已有 POS：挂到上一条做续行
      const defs = splitDefs(line);
      blocks[blocks.length - 1].definitions.push(...defs);
    } else {
      // 整段都没 POS（典型："[计] 因特网, 国际互连网, ..."）。用 fallback POS 兜底，
      // 不再像之前那样直接 drop —— 这导致 internet/online/funding 等高频词彻底丢中文。
      const defs = splitDefs(line);
      if (defs.length) blocks.push({ pos: fallbackPos || 'n.', definitions: defs });
    }
  }
  return blocks;
}

function firstPos(blocks: PosBlock[]): string {
  for (const b of blocks) if (b.pos) return b.pos;
  return '';
}

const CJK_RE = /[一-鿿]/;

function splitDefs(s: string): string[] {
  // 清掉 \r（含字面 "\r"，ECDICT 单元格里的 Windows 行尾残留）和 [计] [网络] 等域名 inline 标注。
  const cleaned = s
    .replace(/\\r|\r/g, '')
    .replace(/^\[[^\]]+\]\s*/g, '')
    .trim();
  if (!cleaned) return [];

  // 中文一行通常 "突然, 船顶风地, 朝后" → 按所有逗号/分号切；
  // 英文 WordNet 定义是完整句子，自带逗号（"a written work, etc."），只能按分号切。
  const isChinese = CJK_RE.test(cleaned);
  const splitRe = isChinese ? /[;；,，、]/g : /[;；]/g;

  return cleaned
    .split(splitRe)
    .map((x) =>
      x
        .trim()
        // 单条释义里的 inline [商业] [解] [医] [口] [国名] 等域名/语体标注：剥掉
        .replace(/\[[^\]]{1,8}\]/g, '')
        .trim(),
    )
    .filter(Boolean);
}

// ---------- exchange → forms ----------
function parseExchange(raw: string): string[] {
  if (!raw) return [];
  const forms = new Set<string>();
  for (const seg of raw.split('/')) {
    const m = seg.match(/^([a-z0-9]+):(.+)$/i);
    if (!m) continue;
    const [, key, val] = m;
    // 0/1 是指针（lemma / 类型），不进 forms；其它都是 surface form
    if (key === '0' || key === '1') continue;
    forms.add(val.trim());
  }
  return Array.from(forms).filter(Boolean);
}

// ---------- main ----------
async function main() {
  if (!fs.existsSync(RAW_CSV)) {
    console.error(`[ERROR] 找不到 ECDICT CSV: ${RAW_CSV}`);
    process.exit(1);
  }
  if (!fs.existsSync(WHITELIST_JSON)) {
    console.error(`[ERROR] 找不到白名单: ${WHITELIST_JSON}`);
    process.exit(1);
  }

  // 读白名单（小写 set）
  const whitelistRaw = JSON.parse(fs.readFileSync(WHITELIST_JSON, 'utf8')) as string[];
  const whitelist = new Set(whitelistRaw.map((w) => w.toLowerCase()));
  console.log(`[INFO] 白名单 ${whitelist.size} 词`);

  // 读 word-families（拿到所有 root 词；我们的 DB 是用 rootWord 当 dictionary key）
  const familiesPath = path.join(ROOT, 'src/data/word-families.json');
  const families = JSON.parse(fs.readFileSync(familiesPath, 'utf8')) as Record<string, string[]>;
  const roots = new Set(Object.keys(families).map((r) => r.toLowerCase()));
  console.log(`[INFO] word-families root ${roots.size} 个`);

  // 准备输出
  fs.mkdirSync(path.dirname(OUT_JSONL), { recursive: true });
  fs.mkdirSync(path.dirname(STATS_JSON), { recursive: true });
  const out = fs.createWriteStream(OUT_JSONL, { encoding: 'utf8' });

  const stats = {
    csvRows: 0,
    matchedWhitelist: 0,
    matchedRoot: 0,
    written: 0,
    skippedNotInTarget: 0,
    skippedDup: 0,
    emptyTranslation: 0,
    emptyDefinition: 0,
    emptyPhonetic: 0,
    emptyExchange: 0,
    multiToken: 0,
  };

  const seen = new Set<string>();
  const targetSet = new Set([...whitelist, ...roots]); // 白名单 + 词族 root 都覆盖
  console.log(`[INFO] 目标集合（whitelist ∪ family root）${targetSet.size} 个`);

  // header
  const stream = fs.createReadStream(RAW_CSV);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let isHeader = true;
  let headerCols: string[] = [];

  for await (const line of rl) {
    if (!line) continue;
    const cols = parseCsvLine(line);
    if (isHeader) {
      headerCols = cols;
      isHeader = false;
      continue;
    }
    stats.csvRows++;
    if (cols.length < headerCols.length) {
      // 行被截断 / 包含原始换行（极少数）—— 跳过
      continue;
    }

    const word = (cols[0] || '').trim();
    const phonetic = (cols[1] || '').trim();
    const definition = (cols[2] || '').trim();
    const translation = (cols[3] || '').trim();
    const exchange = (cols[10] || '').trim();

    if (!word) continue;
    const key = word.toLowerCase();

    // 跳过：纯短语/连字符 / 多 token 大写专名（DictionaryEntry 是单词级）
    // ECDICT 包含很多多 token 短语（"book in"、"hot dog"），我们暂时只要单 token
    const isMultiToken = /\s/.test(word);
    if (isMultiToken) {
      stats.multiToken++;
      continue;
    }

    const inWhitelist = whitelist.has(key);
    const inRoot = roots.has(key);
    if (inWhitelist) stats.matchedWhitelist++;
    if (inRoot) stats.matchedRoot++;
    if (!inWhitelist && !inRoot) {
      stats.skippedNotInTarget++;
      continue;
    }

    if (seen.has(key)) {
      stats.skippedDup++;
      continue;
    }
    seen.add(key);

    if (!translation) stats.emptyTranslation++;
    if (!definition) stats.emptyDefinition++;
    if (!phonetic) stats.emptyPhonetic++;
    if (!exchange) stats.emptyExchange++;

    // 先解英文，把它的首个 POS 当中文的 fallback（处理 "[计] 因特网" 这种无 POS 行）
    const englishBlocks = splitByPos(definition);
    const fallback = firstPos(englishBlocks) || 'n.';
    const chineseBlocks = splitByPos(translation, fallback);
    const forms = parseExchange(exchange);

    const chinese_entries_short = chineseBlocks
      .filter((b) => b.definitions.length > 0)
      .slice(0, 3) // 最多前 3 个 POS（n./v./a. 之类）
      .map((b) => ({
        pos: b.pos || 'n.', // 万一空，给个默认（能进 DB）
        definitions: b.definitions.slice(0, 6), // 每个 POS 最多 6 条简释
      }));

    const entries = (
      englishBlocks.length > 0 ? englishBlocks : chineseBlocks /* 兜底用中文当 entries */
    )
      .filter((b) => b.definitions.length > 0)
      .map((b) => ({
        pos: b.pos || 'n.',
        senses: b.definitions.map((d) => ({ glosses: [d], examples: [] })),
      }));

    // entries 至少要有一条，否则 seed 后端拿不到东西。如果中英文都空就跳过。
    if (chinese_entries_short.length === 0 && entries.length === 0) {
      continue;
    }

    const record = {
      word: key, // 统一小写
      phonetics: phonetic ? [phonetic] : [],
      audio: [], // ECDICT 的 audio 列基本空，先空
      forms,
      chinese_entries_short,
      entries: entries.length > 0 ? entries : [
        // 极端兜底：把中文短释义当 entries 也行
        {
          pos: chinese_entries_short[0].pos,
          senses: chinese_entries_short[0].definitions.map((d) => ({
            glosses: [d],
            examples: [],
          })),
        },
      ],
    };

    out.write(JSON.stringify(record) + '\n');
    stats.written++;

    if (stats.written % 5000 === 0) {
      console.log(`[INFO] 已写入 ${stats.written} 条`);
    }
  }

  out.end();
  await new Promise<void>((res) => out.on('close', () => res()));

  // 漏网之词：在目标集合里但 ECDICT 没收
  const missing: string[] = [];
  for (const t of targetSet) {
    if (!seen.has(t)) missing.push(t);
  }
  fs.writeFileSync(
    path.join(ROOT, 'data-build/missing-from-ecdict.txt'),
    missing.sort().join('\n'),
  );

  fs.writeFileSync(
    STATS_JSON,
    JSON.stringify(
      {
        ...stats,
        targetSize: targetSet.size,
        missingCount: missing.length,
        missingSample: missing.slice(0, 50),
      },
      null,
      2,
    ),
  );

  console.log('\n=== 构建统计 ===');
  console.log(`CSV 行数: ${stats.csvRows}`);
  console.log(`命中白名单: ${stats.matchedWhitelist}`);
  console.log(`命中 family root: ${stats.matchedRoot}`);
  console.log(`已写入: ${stats.written}`);
  console.log(`目标集合: ${targetSet.size}（whitelist ∪ family root）`);
  console.log(`漏网（在目标但 ECDICT 没收）: ${missing.length}`);
  console.log(`空中文释义: ${stats.emptyTranslation}`);
  console.log(`空英文释义: ${stats.emptyDefinition}`);
  console.log(`空音标: ${stats.emptyPhonetic}`);
  console.log(`空 exchange: ${stats.emptyExchange}`);
  console.log(`\n输出: ${OUT_JSONL}`);
  console.log(`漏网词列表: data-build/missing-from-ecdict.txt`);
  console.log(`统计: ${STATS_JSON}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
