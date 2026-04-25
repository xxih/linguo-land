/**
 * 不引入 jest 配置（移动端默认没装），但保留这份用例作为参考与本地手测脚本：
 *   pnpm tsx src/reader/tokenize.spec.ts
 *
 * Expo SDK 默认 jest-expo 也能跑，但 v1 不引入测试基建。
 */
import { tokenize, splitParagraphs } from './tokenize';

const cases: Array<[string, number, string[]]> = [
  ['Hello, world!', 5, ['Hello', ',', ' ', 'world', '!']],
  ["it's a state-of-the-art reader", 7,
    ["it's", ' ', 'a', ' ', 'state-of-the-art', ' ', 'reader']],
  ['Para one.\n\nPara two.', 7, ['Para', ' ', 'one', '.', '\n\n', 'Para', ' ', 'two', '.']],
];

for (const [input, expectedCount, expectedTexts] of cases) {
  const t = tokenize(input);
  const ok = t.length === expectedCount && t.map((x) => x.text).join('|') === expectedTexts.join('|');
  console.log(ok ? 'PASS' : 'FAIL', JSON.stringify(input), '→', t.map((x) => x.text));
}

console.log('paragraphs:', splitParagraphs('a\n\nb\n\n\nc'));
