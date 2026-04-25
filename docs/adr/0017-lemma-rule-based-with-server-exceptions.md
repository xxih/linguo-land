# ADR 0017：词形还原换成 rule-based + 后端不规则映射

## Context

扩展靠 `TextProcessor.getLemmasForWord` 把网页上的形变词还原成 base form，再去白名单字典里查。原先这一层完全靠 [`compromise`](https://github.com/spencermountain/compromise)，问题是：

- **不规则比较级/最高级整片不还原**：`bigger/biggest/better/best/worse/worst/farther/farthest` 全部停在原词。compromise 的 `.adjectives()` 方法不主动剥 `-er/-est`，对不规则形（better→good 等）也没有 exception 表。
- **双辅音 -ed 过去式不还原**：`controlled/planned/preferred/permitted/committed/dropped/stopped` 这种博客 / 新闻文章里满地都是的形态，compromise 全部停在原词。
- **部分不规则过去分词漏覆盖**：如 `broken → break`、`understood → understand`。
- **同形异性词无上下文**：`saw/found/left/rose/lay` 这种动词义、名词义都有的词，compromise 单跑给的结果取决于内部默认 POS 优先级，约一半概率给错。

为了量化问题严重程度，从 [UniMorph English](https://github.com/unimorph/eng) 按词频抽样 208 条 ground truth fixture（脚本：`apps/extension/scripts/build-lemma-fixtures.mjs`）+ 7 条副词路径用例，跑出来的基线是 **162/215 = 75.3%** 通过。失败成片集中在比较级/最高级（1/30）、双辅音规则 -ed（13/25）。

调研业界方案：

- **wink-lemmatizer**（npm，[github](https://github.com/winkjs/wink-lemmatizer)）≈ Princeton WordNet [Morphy 算法](https://wordnet.princeton.edu/documentation/morphy7wn) 的 JS 移植。机制：先查不规则 exception 表，再走 `-er/-est/-ed/-ing/-s` 后缀剥除 + 词典验证。本地实测在我们的 12 条原始失败 fixture 上修复 11/12。
- 替代方案（natural / hunspell-asm / lemmatizer-js / morungos-wordnet）要么覆盖度低，要么 WASM 体积大，要么不再维护。

wink-lemmatizer 数据脚印 ~3MB（含 `wn-words.js` 1.8MB + `wn-word-senses.js` 828KB 用于 morphy 内部的 isAdjective/isVerb/isNoun 验证）。但**最值钱的是前 ~290KB 的 exception 表**：动 / 名 / 形三张 `Record<string, string>`。剩下的 2.7MB 字典验证完全可以用我们后端本来就有的白名单（ADR 0011）替代——它就是我们扩展认可的"合法英语词"集合。

## Decision

按 ADR 0011 / 0016 已经建立的"形态学数据下沉后端"模式，把 wink 的三张 exception 表 vendor 进后端，由 `GET /api/v1/dictionary-whitelist` 一并下发；前端把 `getLemmasForWord` 重写成纯 rule-based。

**后端**

- `apps/server/scripts/build-inflection-maps.mjs`：一次性脚本，从 `wink-lexicon`（wink-lemmatizer 的数据依赖，BSD 兼容许可，派生自 WordNet）读取动 / 名 / 形 exception 表，过滤掉 form === lemma 的 identity 映射，写入 `apps/server/src/data/{verb,noun,adj}-inflection-map.json`。
- `DictionaryWhitelistService` 启动加载，与现有 `dictionary-whitelist.json` / `adverb-map.json` 一同算 sha1 指纹作为 `version`。
- 三张表通过 `DictionaryWhitelistResponse` 的新字段 `verbInflectionMap` / `nounInflectionMap` / `adjInflectionMap` 一并返回，整体增加 ~116KB raw / ~30KB gzipped，并入既有 dictionary mirror 同步流程。

**前端**

`getLemmasForWord` 从"compromise 黑盒推断 → 取一个 lemma"改成"rule-based 多候选生成 → 字典验证"，输出仍是 `string[]`，下游 `dictionaryLoader.isValidWord(lemma)` 的 `.some()` 调用方式不变：

1. 原词本身——很多 form 自身就是 base form。
2. 不规则映射 O(1) 查表（动 / 名 / 形 + 副词四张表）。
3. 副词 -ly 启发式（保留旧行为）。
4. 后缀剥除规则 + 字典验证（参 wink Morphy）：
   - 比较级/最高级 `-er` / `-est`
   - 进行时 `-ing`，过去式 `-ed`，三单 `-es` / `-s`
   - 每个剥除尝试三种解码：直接剥、剥后加 `e`（rated→rate）、双辅音还原（stopped→stop, bigger→big, controlled→control）
   - `-ies` / `-ied` → `-y`（cities→city, studied→study）
   - `-es` ↔ `-is`（axes→axis, analyses→analysis）
   - `-men` ↔ `-man`（chairmen→chairman, firemen→fireman）

`compromise` 仍保留在 `collectWordsFromNodes` 的 `nlp(fullText).terms()` 用作分词，但 `getLemmasForWord` 内部不再调它。

为了让后缀剥除规则有候选验证依据，`DictionaryLoader.getWhitelistSet()` 暴露内部白名单 Set，content.ts 通过新加的 `TextProcessor.setInflectionMaps({ ..., dictionarySet })` 注入。

## Consequences

**预期收益（已验证）**

UniMorph 抽样回归集（208 条 + 7 条副词）通过率从 **75.3% → 100%（215/215）**：

| 类别 | 改造前 | 改造后 |
| --- | --- | --- |
| adj-comparative | 1/15 | 15/15 |
| adj-superlative | 0/15 | 15/15 |
| verb-past-regular（含双辅音） | 13/25 | 25/25 |
| verb-pp-regular | 5/8 | 8/8 |
| verb-pp-irregular | 23/25 | 25/25 |
| noun-plural-irregular | 7/7 | 7/7 |
| 其他 | 全过 | 全过 |

**架构对齐**

- 沿用 ADR 0011 / 0016 的"形态学数据集中后端、客户端只查表"模式，避免在 content script 包里塞 ~3MB 的 wink-lemmatizer 数据。
- 单一权威：词典 + 不规则形态全在 `apps/server/src/data/`，新增条目热更生效，不需要发扩展新版。
- `getLemmasForWord` 从依赖第三方 NLP 黑盒变成可读、可测、可调试的规则集；后续要改某条规则（比如调整 -ies/-ied 优先级）直接改 `textProcessor.ts`，跑 `lemmaFixtures.test.ts` 即可。

**取舍**

- 回归集是固定锚点：未来引入新规则要先在 fixture 上保持 100%，再合入。fixture 可继续用 `apps/extension/scripts/build-lemma-fixtures.mjs` 重抽样扩展（目前 208 条已覆盖所有形态范畴）。
- compromise 仍占 ~250KB 的 content script 体积。后续如果把 `nlp(fullText).terms()` 这唯一剩余调用换成简单 regex/Intl.Segmenter，可以彻底移除 compromise。Backlog 候补。
- 同形异性词靠 wink 的 exception 表覆盖了高频 case（`left/rose/lay/saw/found/fell` 等单跑都给了正解，因为它们都在 verbExceptions 里）。真正需要 POS 上下文的边角情况（如 "lead" 名词义 vs 动词义）目前还是返回原词作候选，下游字典 .some() 兜住。

**未来工作**

- 远期"短语 / 多词词条"（backlog P0）落地后，可以考虑把"逐词查白名单"再升级成"surface form 直接展开预计算 → 客户端纯 Set 查"，届时 lemma 还原可能整个被替代掉。这是路 C，不在本 ADR 范围。
