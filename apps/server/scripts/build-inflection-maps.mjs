// 一次性脚本：从 wink-lexicon (BSD 3-clause + WordNet 许可，可商用) 抽出动词/
// 名词/形容词的不规则形态 → lemma 映射，写入 apps/server/src/data/。
//
// 数据来源：apps/extension 的 devDep wink-lemmatizer，依赖 wink-lexicon。脚本
// 运行前请确保已 `pnpm install`，wink-lexicon 在 monorepo node_modules 里能找到。
//
// 输出：apps/server/src/data/{verb,noun,adj}-inflection-map.json
// 只保留 form !== lemma 的条目（identity 映射没用）。

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// pnpm 把 wink-lexicon 放在 .pnpm/wink-lexicon@x.y.z/...，无法直接 require。
// 用 pnpm 的 list --json 拿到 wink-lemmatizer 实际路径，再回溯到 wink-lexicon。
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const lexiconRoot = execSync(
  `find ${ROOT}/node_modules -name "wn-adjective-exceptions.js" -path "*/wink-lexicon/*" | head -1`,
  { encoding: 'utf-8' },
)
  .trim()
  .replace(/\/wn-adjective-exceptions\.js$/, '');
if (!lexiconRoot) throw new Error('wink-lexicon 未找到，先 pnpm install');
const require = createRequire(import.meta.url);
const adj = require(path.join(lexiconRoot, 'wn-adjective-exceptions.js'));
const noun = require(path.join(lexiconRoot, 'wn-noun-exceptions.js'));
const verb = require(path.join(lexiconRoot, 'wn-verb-exceptions.js'));

const OUT_DIR = path.resolve(fileURLToPath(import.meta.url), '../../src/data');

function clean(map) {
  const out = {};
  for (const [form, lemma] of Object.entries(map)) {
    if (typeof lemma !== 'string' || form === lemma) continue;
    out[form] = lemma;
  }
  return out;
}

const datasets = {
  'verb-inflection-map.json': clean(verb),
  'noun-inflection-map.json': clean(noun),
  'adj-inflection-map.json': clean(adj),
};

for (const [name, data] of Object.entries(datasets)) {
  const file = path.join(OUT_DIR, name);
  // 紧凑 JSON：每个键值对一行可读，文件小一些。生产里 readFileSync 后立即 parse。
  fs.writeFileSync(file, JSON.stringify(data, null, 0) + '\n');
  console.log(`${name}: ${Object.keys(data).length} entries → ${file}`);
}
