import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Lemma → surface forms 展开器
 *
 * 给定一个 base form（如 "woman" / "go" / "big"），返回它的所有合理 surface form：
 * - 不规则变形（女→女们、go→went/gone）：反查 wink-lexicon 的 exception 表
 * - 规则变形（cat→cats, run→running, big→bigger）：按英语正字法规则生成
 *   -s/-es、-ed、-ing、-er/-est、-y→-ies、CVC 双辅音、-e 删除等
 *
 * 用途：seed/backfill 词族数据时，确保 WordFamily.words[] 不漏任何 surface
 * form，让 vocabularyMirror.byLemma 在客户端把 women → woman family 这种
 * 查询直接命中（ADR 0018）。
 *
 * 数据源同 ADR 0017：apps/server/src/data/{verb,noun,adj}-inflection-map.json
 * （vendor 自 wink-lexicon，BSD/WordNet 派生）。
 */

type InflectionMap = Record<string, string>;

interface InvertedMaps {
  verb: Map<string, string[]>;
  noun: Map<string, string[]>;
  adj: Map<string, string[]>;
}

let cached: InvertedMaps | null = null;

function loadInverted(dataDir: string): InvertedMaps {
  if (cached) return cached;
  const verbMap = JSON.parse(
    readFileSync(join(dataDir, 'verb-inflection-map.json'), 'utf-8'),
  ) as InflectionMap;
  const nounMap = JSON.parse(
    readFileSync(join(dataDir, 'noun-inflection-map.json'), 'utf-8'),
  ) as InflectionMap;
  const adjMap = JSON.parse(
    readFileSync(join(dataDir, 'adj-inflection-map.json'), 'utf-8'),
  ) as InflectionMap;

  const invert = (m: InflectionMap): Map<string, string[]> => {
    const out = new Map<string, string[]>();
    for (const [form, base] of Object.entries(m)) {
      if (!out.has(base)) out.set(base, []);
      out.get(base)!.push(form);
    }
    return out;
  };

  cached = { verb: invert(verbMap), noun: invert(nounMap), adj: invert(adjMap) };
  return cached;
}

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);
const SIBILANT_ENDINGS = ['s', 'x', 'z', 'sh', 'ch'];

const isVowel = (c: string) => VOWELS.has(c);
const isCvcDoubling = (w: string): boolean => {
  // C-V-C 末尾，且最后一个不是 w/x/y（这些不双写：fix→fixed, play→played, bow→bowed）
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

const endsWithSibilant = (w: string) => SIBILANT_ENDINGS.some((s) => w.endsWith(s));

/**
 * 给一个 base form 生成所有规则形态。不区分 POS——多生成的形态由后续白名单
 * 验证或下游使用方过滤。词族里的 noise（如把名词错误生成动词形态）成本极低
 * （只是多写几行 Word 表），收益是确保覆盖。
 */
function generateRegularForms(base: string): Set<string> {
  const out = new Set<string>();
  if (base.length < 2) return out;

  // ---- -s / -es 复数 + 三单 ----
  if (base.endsWith('y') && base.length >= 2 && !isVowel(base[base.length - 2])) {
    // city → cities, study → studies
    out.add(base.slice(0, -1) + 'ies');
  } else if (endsWithSibilant(base)) {
    // box → boxes, watch → watches
    out.add(base + 'es');
  } else if (base.endsWith('o') && base.length >= 2 && !isVowel(base[base.length - 2])) {
    // potato → potatoes（部分例外，但不影响白名单覆盖）
    out.add(base + 'es');
    out.add(base + 's');
  } else {
    out.add(base + 's');
  }

  // -es 退化：lay → lays（已在 -s 分支覆盖）
  // 但 lemma 本身以 -e 结尾时仅 +s（rate → rates，已在 else 分支覆盖）

  // ---- -ed 过去式 ----
  if (base.endsWith('e')) {
    // rate → rated
    out.add(base + 'd');
  } else if (base.endsWith('y') && base.length >= 2 && !isVowel(base[base.length - 2])) {
    // study → studied, cry → cried
    out.add(base.slice(0, -1) + 'ied');
  } else if (isCvcDoubling(base)) {
    // stop → stopped, plan → planned
    out.add(base + base[base.length - 1] + 'ed');
    out.add(base + 'ed'); // 兜底，部分词不双写（offer → offered）
  } else {
    out.add(base + 'ed');
  }

  // ---- -ing 进行时 ----
  if (base.endsWith('e') && base.length > 2 && base[base.length - 2] !== 'e') {
    // rate → rating（drop e），但 see → seeing 不 drop
    out.add(base.slice(0, -1) + 'ing');
    out.add(base + 'ing'); // 兜底（agree → agreeing）
  } else if (base.endsWith('ie')) {
    // die → dying, lie → lying
    out.add(base.slice(0, -2) + 'ying');
    out.add(base + 'ing'); // 兜底
  } else if (isCvcDoubling(base)) {
    out.add(base + base[base.length - 1] + 'ing');
    out.add(base + 'ing');
  } else {
    out.add(base + 'ing');
  }

  // ---- -er / -est 比较级最高级（短形容词）----
  // 只对短词生成（>=2 音节的词典型靠 more/most，不变形）
  if (base.length <= 6) {
    if (base.endsWith('e')) {
      out.add(base + 'r');
      out.add(base + 'st');
    } else if (base.endsWith('y') && base.length >= 2 && !isVowel(base[base.length - 2])) {
      out.add(base.slice(0, -1) + 'ier');
      out.add(base.slice(0, -1) + 'iest');
    } else if (isCvcDoubling(base)) {
      out.add(base + base[base.length - 1] + 'er');
      out.add(base + base[base.length - 1] + 'est');
    } else {
      out.add(base + 'er');
      out.add(base + 'est');
    }
  }

  return out;
}

/**
 * 主入口：给 base form 返回所有 surface form（含 base 自身）。
 *
 * @param base 词族里的某个词（rootWord 或已存在的 family.words 里的某条）
 * @param dataDir wink 数据所在目录，默认 apps/server/src/data
 */
export function expandLemmaToSurfaceForms(
  base: string,
  dataDir: string = join(__dirname, 'data'),
): Set<string> {
  const baseLower = base.toLowerCase().trim();
  if (!baseLower) return new Set();

  const inv = loadInverted(dataDir);
  const out = new Set<string>([baseLower]);

  // 1. 不规则形态查反向表
  for (const f of inv.verb.get(baseLower) ?? []) out.add(f);
  for (const f of inv.noun.get(baseLower) ?? []) out.add(f);
  for (const f of inv.adj.get(baseLower) ?? []) out.add(f);

  // 2. 规则形态生成
  for (const f of generateRegularForms(baseLower)) out.add(f);

  return out;
}
