import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 词族数据质量回归测试（ADR 0019）
 *
 * 把 audit-word-families.ts 的关键阈值固化成 jest 断言，
 * 防止未来动 wink 数据 / rebuild 算法时静默回退。
 *
 * 数据来自 build-time 生成的两份 JSON：
 *   - dictionary-whitelist.json
 *   - word-families.json
 * （手动跑 scripts/rebuild-word-families.ts 后才会刷新）
 *
 * 阈值取自 2026-04-26 重建后实测：noise 0%、误吞 0%、recall 99%+、
 * learner-friendly 100%。这些数字宽出 5%-10% 的容差，留改进余地。
 */

const DATA_DIR = join(__dirname, 'data');

const families: Record<string, string[]> = JSON.parse(
  readFileSync(join(DATA_DIR, 'word-families.json'), 'utf-8'),
);
const whitelist: string[] = JSON.parse(
  readFileSync(join(DATA_DIR, 'dictionary-whitelist.json'), 'utf-8'),
);
const verbMap: Record<string, string> = JSON.parse(
  readFileSync(join(DATA_DIR, 'verb-inflection-map.json'), 'utf-8'),
);
const nounMap: Record<string, string> = JSON.parse(
  readFileSync(join(DATA_DIR, 'noun-inflection-map.json'), 'utf-8'),
);
const adjMap: Record<string, string> = JSON.parse(
  readFileSync(join(DATA_DIR, 'adj-inflection-map.json'), 'utf-8'),
);

const wset = new Set(whitelist.map((w) => w.toLowerCase()));
const wordToFamily = new Map<string, string>();
for (const [b, ws] of Object.entries(families)) for (const w of ws) wordToFamily.set(w, b);

describe('词族 / 白名单质量', () => {
  it('词族总量在合理区间（不被算法误膨胀也不被过度收敛）', () => {
    const n = Object.keys(families).length;
    expect(n).toBeGreaterThanOrEqual(15000);
    expect(n).toBeLessThanOrEqual(25000);
  });

  it('白名单总量在合理区间', () => {
    expect(whitelist.length).toBeGreaterThanOrEqual(28000);
    expect(whitelist.length).toBeLessThanOrEqual(40000);
  });

  it('噪声率 < 1%（family 里几乎不出现既不在白名单也不在 wink 的伪形态）', () => {
    let total = 0;
    let pseudo = 0;
    for (const [base, words] of Object.entries(families)) {
      for (const w of words) {
        if (w === base) continue;
        total++;
        if (!wset.has(w) && !verbMap[w] && !nounMap[w] && !adjMap[w]) pseudo++;
      }
    }
    expect(pseudo / total).toBeLessThan(0.01);
  });

  it('wink 不规则形态 100% 出现在对应 base 的 family 里', () => {
    let missing = 0;
    for (const [form, base] of Object.entries({ ...verbMap, ...nounMap, ...adjMap })) {
      if (!families[base]) continue;
      if (!families[base].includes(form)) missing++;
    }
    expect(missing).toBe(0);
  });

  // 109 个核心学习者高频词必须有 family（自己是 base 或被归入某 family）
  const LEARNER_CRITICAL = [
    'be', 'have', 'do', 'say', 'go', 'can', 'get', 'make', 'know', 'will', 'think', 'take',
    'see', 'come', 'want', 'look', 'use', 'find', 'give', 'tell', 'work', 'call', 'try',
    'ask', 'need', 'feel', 'become', 'leave', 'put', 'mean', 'keep', 'let', 'begin', 'seem',
    'help', 'show', 'hear', 'play', 'run', 'move', 'live', 'believe', 'bring', 'happen',
    'write', 'sit', 'stand', 'lose', 'pay', 'meet', 'include', 'continue', 'set', 'learn',
    'change', 'lead', 'understand', 'watch', 'follow', 'stop', 'create', 'speak', 'read',
    'good', 'great', 'small', 'large', 'big', 'high', 'low', 'new', 'old', 'young',
    'long', 'short', 'easy', 'hard', 'fast', 'slow', 'happy', 'sad', 'strong', 'weak',
    'man', 'woman', 'child', 'people', 'time', 'year', 'day', 'week', 'month',
    'house', 'school', 'home', 'world', 'country', 'city', 'place', 'room',
    'water', 'food', 'book', 'car', 'road', 'river', 'tree', 'mountain', 'sea',
  ];
  it.each(LEARNER_CRITICAL)('核心高频词 %s 有 family（直接 base 或 lemma 归属）', (w) => {
    const fam = families[w] ?? families[wordToFamily.get(w) ?? ''];
    expect(fam).toBeDefined();
    expect(fam!.length).toBeGreaterThanOrEqual(2);
  });

  // 关键不规则动词的 surface form 完整性
  const VERB_CASES: Array<{ base: string; needs: string[] }> = [
    { base: 'be', needs: ['be', 'is', 'am', 'are', 'was', 'were', 'been', 'being'] },
    { base: 'have', needs: ['have', 'has', 'had', 'having'] },
    { base: 'do', needs: ['do', 'does', 'did', 'doing', 'done'] },
    { base: 'go', needs: ['go', 'goes', 'went', 'gone', 'going'] },
    { base: 'see', needs: ['see', 'sees', 'saw', 'seen', 'seeing'] },
    { base: 'know', needs: ['know', 'knows', 'knew', 'known', 'knowing'] },
    { base: 'break', needs: ['break', 'breaks', 'broke', 'broken', 'breaking'] },
    { base: 'eat', needs: ['eat', 'eats', 'ate', 'eaten', 'eating'] },
    { base: 'write', needs: ['write', 'writes', 'wrote', 'written', 'writing'] },
    { base: 'work', needs: ['work', 'works', 'worked', 'working'] },
    { base: 'walk', needs: ['walk', 'walks', 'walked', 'walking'] },
    { base: 'study', needs: ['study', 'studies', 'studied', 'studying'] },
  ];
  it.each(VERB_CASES)('动词 $base 包含全部关键 inflection', ({ base, needs }) => {
    const fam = families[base];
    expect(fam).toBeDefined();
    for (const n of needs) expect(fam).toContain(n);
  });

  // 关键 false-friend 不被误吞
  const FALSE_FRIENDS: Array<{ base: string; mustNot: string[] }> = [
    { base: 'be', mustNot: ['bed', 'bee', 'bes', 'beed'] },
    { base: 'see', mustNot: ['seed', 'seest'] },
    { base: 'have', mustNot: ['haveing', 'havest'] },
    { base: 'mouse', mustNot: ['mouseing', 'mousest'] },
    { base: 'river', mustNot: ['rivering', 'rivered'] },
    { base: 'child', mustNot: ['childer', 'childest', 'childs'] },
  ];
  it.each(FALSE_FRIENDS)('$base family 不误吞 false friends', ({ base, mustNot }) => {
    const fam = families[base];
    expect(fam).toBeDefined();
    for (const m of mustNot) expect(fam).not.toContain(m);
  });

  // 同形异性词归属检查（ADR 0018 决策）
  it('同形异性词按 wink 反向映射归属', () => {
    expect(wordToFamily.get('saw')).toBe('saw'); // wink 没给 → 自成 base（避免被 see 吞）
    expect(wordToFamily.get('left')).toBe('leave'); // wink: left → leave
    expect(wordToFamily.get('rose')).toBe('rise'); // wink: rose → rise
    expect(wordToFamily.get('fell')).toBe('fall');
    expect(wordToFamily.get('lay')).toBe('lay');
  });

  // 形容词比较级
  it('比较级 / 最高级形态正确归属', () => {
    expect(families.fast).toContain('faster');
    expect(families.fast).toContain('fastest');
    expect(families.happy).toContain('happier');
    expect(families.happy).toContain('happiest');
    expect(families.big).toContain('bigger');
    expect(families.big).toContain('biggest');
    expect(families.good).toContain('better');
    expect(families.good).toContain('best');
    // far → farther/further (irregular-adj-overrides 兜底，wink 漏)
    expect(families.far).toContain('farther');
    expect(families.far).toContain('further');
    expect(families.far).toContain('farthest');
    expect(families.bad).toContain('worse');
    expect(families.bad).toContain('worst');
  });

  // 不规则复数 overrides（wink 漏的 -man/-women + 学术）
  const PLURAL_OVERRIDE_CASES: Array<[string, string]> = [
    ['fireman', 'firemen'],
    ['policeman', 'policemen'],
    ['chairman', 'chairmen'],
    ['spokesman', 'spokesmen'],
    ['businessman', 'businessmen'],
    ['gentleman', 'gentlemen'],
    ['fisherman', 'fishermen'],
    ['congressman', 'congressmen'],
    ['spokeswoman', 'spokeswomen'],
    ['bacterium', 'bacteria'],
    ['matrix', 'matrices'],
  ];
  it.each(PLURAL_OVERRIDE_CASES)('不规则复数 %s → %s 收齐', (sg, pl) => {
    expect(families[sg]).toContain(pl);
  });
});
