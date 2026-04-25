# ADR 0021：词典数据以 ECDICT 为底座，离线构建 + 入库

## Context

之前的状态：

- Prisma schema 早就建好了 `DictionaryEntry / DefinitionEntry / Sense`（[schema.prisma:109-148](../../apps/server/prisma/schema.prisma)），但**没有数据**——`apps/server/src/seed-dictionary.ts` 期待的 `dictionary-structured-60000.jsonl` 在仓库里不存在。
- 结果：`DictionaryService.findWord` 在 DB 里查不到任何词 → 一律走 `dictionary.controller.ts:29-45` 的 AI fallback（DashScope Qwen Flash 现造）。
- 体验问题：每次查词都打模型 → 慢、贵、波动大；离线/限流即停摆。

我们已经有：

- 39,665 个 word-families（[ADR 0020](0020-word-family-rebuild-v3-quality.md)）
- 31,836 词的 dictionary-whitelist（[ADR 0011](0011-dictionary-whitelist-server-source.md)）

只缺**释义内容本身**。

## Decision

用 [skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)（MIT 协议，340 万英汉条目）作为词典数据底座，build 期一次性映射成我们的 schema，灌入 Postgres。

### 数据流水线

```
                ┌─────────────────────────────────────┐
                │ apps/server/data-build/raw/         │   gitignore（63 MB）
                │   ecdict.csv                        │
                └────────────────┬────────────────────┘
                                 │ scripts/build-dictionary.ts
                                 ▼
   ┌────────────────────────────────────────────────────────┐
   │ apps/server/src/data/dictionary-structured.jsonl       │   gitignore？暂入仓库
   │   30,258 行，每行一个完整 DictionaryEntry              │   （30K 行，~10 MB）
   └────────────────┬───────────────────────────────────────┘
                    │ src/seed-dictionary.ts (幂等)
                    ▼
            ┌───────────────────┐
            │ Postgres          │
            │   dictionary_entries / definition_entries / senses
            └───────────────────┘
```

### 字段映射

| ECDICT 列 | 我们的 schema | 处理 |
|-----------|---------------|------|
| `word` | `word` | 转小写 |
| `phonetic` | `phonetics: string[]` | 单 IPA → 单元素数组 |
| `translation` | `chineseEntriesShort: { pos, definitions }[]` | 按 POS 行切（"n. 书, 书籍"），同时按 ; ；, ， 切分单条释义；剥 `[计] [网络] [医]` 等域名标注 |
| `definition` | `entries: { pos, senses[{glosses, examples}] }[]` | WordNet 风格英文，用作中文释义的 fallback；首个 POS 还做"中文释义没 POS 时的兜底" |
| `exchange` | `forms: string[]` | 解 `s:books/d:booked/p:booked/i:booking/3:books`，跳 `0:`（lemma 指针）和 `1:`（类型标记） |
| `audio` | `audio: string[]` | ECDICT 这列基本空，先留空数组 |
| `collins / oxford / tag / bnc / frq` | —— | 暂不导入（够 build 一个 ranking 信号但当前不用） |

### 过滤范围

只导入「白名单 ∪ word-families root」的词（31,836 词），ECDICT 多 token 短语（"book in"/"hot dog"）暂不收（schema 是 1-token 粒度；多词条在 [backlog P0](../backlog.md) 里另列）。

### 幂等 seed

`seed-dictionary.ts` 改成 `deleteMany(word) → create` 两段事务，依赖 schema 的 `onDelete: Cascade` 自动清 DefinitionEntry / Sense。重复跑不会撞 unique 约束。

### 运行时行为变更

`dictionary.controller.ts` 暂不改：DB 命中走 DB；DB miss 仍调 AI 现造。差别是 99%+ 的查询会落进 DB，AI 只接住 ECDICT 没收的长尾。后续可考虑把 AI miss 沉淀回 DB 形成增量补全（[backlog](../backlog.md)）。

## Consequences

### 质量验证（`scripts/audit-dictionary.ts` 输出）

| 指标 | 数值 |
|------|------|
| 总条数 | **30,258** |
| 白名单覆盖率 | 30,257 / 31,836 = **94.72%** |
| family root 覆盖率 | 18,484 / 18,888 = **97.86%** |
| **CET-4 覆盖率** | 6,242 / 6,252 = **99.84%** |
| **COCA top 5k 覆盖率** | 4,340 / 4,350 = **99.77%** |
| 中文释义有 | **100.0%** |
| 英文释义有 | 100.0% |
| 中英双语都有 | **100.0%** |
| 音标有 | 83.3% |
| 词形 forms 有 | 52.4%（剩余 ~50% 本身就是 inflection / 无形态） |
| 例句 examples 有 | 0%（ECDICT 不带例句，下版本补） |
| P0 高频词缺中文 | **0** |

### 已知限制

1. **0 例句**——ECDICT 不带例句。如要例句，下一步可叠 [Wiktextract](https://kaikki.org/) 或 AI 生成。  
   位置：[backlog P2](../backlog.md)。
2. **18 个高频词不在 ECDICT**：`n't / mr / tv / pm / mrs / ms / vs / mm-hmm / pc / and/or` 等缩写 / 标点形式。需要单独编一份 supplement.json。
3. **释义风格"传统"**：ECDICT 中文偏短（平均 4.3 字 / 条），英文是 WordNet 风格。如要"贴语境的口语化解释"，仍需 runtime AI，但**作用域应是「上下文化"精选"」而非「重新生成」**——基础义项盘子靠 DB。
4. **`forms` vs `word-families` disjoint=6217**：ECDICT exchange 比 word-families.json 收得更全（如 "abandonment → abandonments" 这类规则复数 ECDICT 有，family 没收）。这其实是个**利好信号**：未来可以反向用 ECDICT 改良 word-families 的 inflection 覆盖。位置：[backlog P2](../backlog.md)。

### 许可与依赖

- ECDICT：MIT，可商用、可二次分发。`docs/` 与产品关于页面应注明 "Powered by [ECDICT](https://github.com/skywind3000/ECDICT)"。
- 不引入新 npm 依赖（CSV 解析手写，足够 ECDICT 这种简单格式；POS 解析正则）。

### 操作步骤

```bash
# 1. 下原始 csv（gitignore，~63MB）
mkdir -p apps/server/data-build/raw
curl -L -o apps/server/data-build/raw/ecdict.csv \
  https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv

# 2. 构建（filter + map → JSONL）
cd apps/server && npx ts-node --transpile-only scripts/build-dictionary.ts

# 3. 审计（可选，看质量）
npx ts-node --transpile-only scripts/audit-dictionary.ts

# 4. 灌库（幂等，可重复跑）
pnpm seed:dictionary
```
