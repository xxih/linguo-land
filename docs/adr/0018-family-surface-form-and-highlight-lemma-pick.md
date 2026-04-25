# ADR 0018：词族 surface-form 完整化 + highlight 代表 lemma 选择

## Context

[ADR 0017](0017-lemma-rule-based-with-server-exceptions.md) 把客户端词形还原换成 rule-based，UniMorph 抽样回归集 75% → 100%。但用一个真实场景跑下来发现高亮路径仍然挂——核心 case 复现：

> 用户在词库里把 `woman` 标为已知，文章里有 `women`。

trace 出来三层问题：

1. **客户端 lemma 没问题（ADR 0017）**：`getLemmasForWord('women')` 返回 `['women', 'woman']`，白名单验证（`'woman'` 在 dict）放行。
2. **`vocabularyMirror.byLemma['women']` 漏掉**：用户标 `woman` 后，本地镜像里 `woman` 家族的 `lemmas` 数组只有 `['woman', 'womanhood', 'womanly']`——这是 seed 来源 [`word_groups_final_refined—25.json`](https://github.com/.../old) 里的人工分组。`women` 不在数组里 → 镜像查 `women` 返 `unknown`。
3. **`highlightManager` 选错代表 lemma**：拿到 `lemmaDataMap = { women:unknown, woman:known }`，直接用 `lemmas[0]` 当 representative——刚好是 `women`，按 unknown 高亮，把用户的 `woman` 标记完全 leak 掉。

进一步 audit 发现 seed JSON 里**3 个层面的数据质量问题**：

- 35,462 个词族里 31,023 个（87%）是单词孤岛（`words.length === 1`），inflection 覆盖几乎为零。
- `be` 家族**根本不存在**——`is/are/was/were/been/being/am` 这些最高频形态全都漏了。
- 包含纯字面包含的伪派生：`go ← antigone`、`get ← ingot`、`come ← income/incoming`。

## Decision

按"以终为始"重做整条链路，不留兼容包袱。

### 1) 服务端：lemma-expander + 词族重建

新增 `apps/server/src/lemma-expander.ts`：给一个 base form 反向生成所有 surface form。两路：

- **不规则**：反查 vendor 自 wink-lexicon 的动 / 名 / 形 inflection map（同 ADR 0017 的数据）
- **规则**：按英语正字法生成 `-s` / `-es` / `-ed` / `-ing` / `-er` / `-est`，处理 `-y → -ies`、`-e` 删除、CVC 双辅音等

新增 `apps/server/scripts/rebuild-word-families.ts`：从 `dictionary-whitelist.json`（43K curated baseline）出发，用 expander 反向识别 base form——一个词若出现在另一个词的 expansion 里就当 inflected form。每个 base → 一个 family，`words[] = expander(base) ∪ 它认领的白名单 inflection`，最后过滤 wink 冲突（`best` 属 `good`，`be` 不能抢）。

输出 `apps/server/src/data/word-families.json`（2.9 MB compact），替代旧的 extension/public 路径下那份。`seed.ts` 改为读这份直接 upsert，不再做运行时 expansion——规则迭代就重跑 rebuild 脚本，seed 是 dumb importer。

### 2) 客户端：highlightManager 选 lemma 改成"按状态优先级"

`apps/extension/src/content/utils/highlightManager.ts` 旧实现两处 `representativeLemma = lemmas[0]`，改成 `pickRepresentativeLemma(lemmas, lemmaDataMap)`：按 known > learning > unknown 挑——任何"被用户标过"的 family 都比 fallback 的 unknown 强。全 unknown 时退回 `lemmas[0]`，保持原行为兼容。

这是 (1) 的安全网：即使 family 数据不完整，多 lemma 候选里至少一个能命中，highlight 也会正确显示用户的标记。

## Consequences

### 实测对比（rebuild 脚本输出）

| 指标 | 旧 | 新 |
| --- | --- | --- |
| 词族数 | 35,462 | 39,665 |
| 1-词孤立 family | 31,023 | 26 |
| `be` 家族存在？ | ❌ | ✓（`am, are, be, been, being, is, was, were, ...`） |
| `woman` 家族包含 `women`？ | ❌ | ✓ |
| `go` 家族包含 `went/gone/goes/going`？ | ❌（只有 antigone, go, goer, going） | ✓ |
| `big` 家族包含 `bigger/biggest`？ | ❌（只有 big） | ✓ |
| 噪声（antigone 在 go 家族） | 是 | 否（独立 family） |
| lemmaFixtures.json 208 条命中 family | — | 208/208 |

### 双重保险

数据层（family 完整）+ 表现层（pickRepresentativeLemma）独立但互相兜底：

- **family 完整**：`byLemma['women']` 直接命中 `woman` 家族，不依赖 highlightManager 选谁。
- **pickRepresentativeLemma**：即使 family 漏收某个边缘形态，多 lemma 候选里只要有一个命中，就能正确高亮。

理论上任一就够用，两个都做是保护未来：lemma 规则可能漏边角，wink 数据可能更新滞后；任一层兜底都让另一层的 bug 不会直接 leak 到用户。

### 取舍

- **family 体积**：39,665 family × 平均 ~6 surface form ≈ 240K Word 行；旧 ~40K 行。DB 表 ~14 MB（Postgres 无压力）；客户端 mirror snapshot 从 chrome.storage.local 反序列化的 JSON ~10 MB（在 unlimitedStorage 配额内）。
- **生成噪声**：expander 对每个 base 生成所有规则形态，产生少量伪英语形态（`womaned` / `gooded` / `bes`）。这些不会在真实文章里出现，不影响识别准确性，只是 family `words[]` 多几行。后续可以做基于词频的二轮清理。
- **同形异性词归一**：`lay → lie` 由 wink 强制（lay 不再独立成 family，被吸入 lie），用户在 "She lay down" 和 "Lay the book" 两种语境下都被识别为 lie 家族。绝大多数用户场景下这是可接受的——learner 主要是要识别"这个词我认识/不认识"，POS 区分不是核心。需要 strict POS 时再上路 C（dictionary 预展开 surface form + 上下文 disambiguation）。

### 迁移

- **dev**：直接重跑 `pnpm --filter server prisma:seed`（seed.ts 已更新读新路径，upsert 是 additive 安全）
- **production**：同样跑 seed。新 family 通过 `where: { rootWord }` upsert 落地；新 Word 通过 `where: { text }` 不抢已属其他 family 的词，保留用户标记的 UserFamilyStatus 不动。
