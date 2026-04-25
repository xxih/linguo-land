# 交接：词族数据质量持续优化

> **2026-04-26 收尾**：本轮把 audit 总分从 71 推到 **100/100**。
> 详情看 [ADR 0020](../adr/0020-word-family-rebuild-v3-quality.md)。
> 本文档保留作为历史背景；现状以 ADR 0020 为准。

## 最终评分：100 / 100

跑 `cd apps/server && pnpm exec ts-node scripts/audit-word-families.ts` 即可复核。

| 维度 | 旧 (v2) | 新 (v3) |
| --- | --- | --- |
| precision (误吞少) | 20.5 / 30 | **30.0 / 30** |
| recall (漏收少) | 15.5 / 20 | **20.0 / 20** |
| noise (伪生成少) | 0 / 15 | **15.0 / 15** |
| learner-friendly | 35 / 35 | **35.0 / 35** |
| **总分** | **71.0** | **100** |

满分。recall 最后 1.5 分通过 `irregular-plural-overrides.json` + `irregular-adj-overrides.json`
补 wink 漏的 -man/-women / 学术不规则 / far→farther 等拿到（见 ADR 0020 follow-up）。

## 落地的关键 commit

```
<本轮>  refactor(server): 词族重建 v3（lemma-driven + Norvig 验证）+ 0/100 噪声
<本轮>  test(server): word-families-quality.spec.ts 133 条质量回归
<本轮>  docs(adr): 0020 词族重建 v3
82a67c4 refactor(server): 词族重建 v2 算法 + 多维质量审计脚本
38257a5 docs(adr): 0018 词族 surface-form 完整化 + highlight 代表 lemma 选择
```

## 算法（v3 简述，详细看 ADR 0020）

1. **自顶向下**：每个 curated 词 / wink form 用 compromise + 规则兜底算 lemma，
   归到对应 base 的 family。
2. **wink 注入**：5,469 条 wink 不规则金标全部灌入 family。
3. **自底向上**：规则形态生成器候选 → Norvig top 30K 验证 + lemma 一致性校验。
4. **whitelist** 输出 = 所有 family form ∪ curated ∪ wink form。

## 文件 / 命令地图

### 数据文件

- `apps/server/src/data/dictionary-whitelist.json` — 31,809 词（v3 重建，去 OCR 噪声）
- `apps/server/src/data/word-families.json` — 18,891 family（0.55 MB）
- `apps/server/src/data/{verb,noun,adj}-inflection-map.json` — wink 不规则金标
- `apps/server/src/data/adverb-map.json` — 副词→形容词映射（ADR 0016）
- `apps/server/src/data/{coca20000,cet_4,cet_6,junior_high,high}.json` — 5 表 curated 词汇
- `/tmp/lemma-eval/count_1w.txt` — Norvig 1-grams（build 时验证形态合法性）

### 代码

- `apps/server/scripts/rebuild-word-families.ts` — v3 重建脚本（一并输出白名单）
- `apps/server/scripts/audit-word-families.ts` — 多维质量审计（含 wink/lemma 验证）
- `apps/server/scripts/build-inflection-maps.mjs` — 从 wink-lexicon vendor 数据
- `apps/server/scripts/expand-family-words.ts` — production DB 增量补 form
- `apps/server/src/lemma-expander.ts` — base form → surface forms 展开器
- `apps/server/src/word-families-quality.spec.ts` — 133 条质量回归 jest
- `apps/server/src/seed.ts` — 读 word-families.json 写 DB

### 客户端（无需改动）

- `apps/extension/src/content/utils/textProcessor.ts` — `getLemmasForWord`（rule-based，ADR 0017）
- `apps/extension/src/content/utils/highlightManager.ts` — `pickRepresentativeLemma`（ADR 0018）
- `apps/extension/src/content/utils/lemmaFixtures.json` — UniMorph 抽样 215 条回归集

### 常用命令

```bash
cd apps/server

# 重建词族 + 白名单（一并输出）
pnpm exec ts-node scripts/rebuild-word-families.ts

# 质量审计（带 wink/lemma 验证的 precision 计分）
pnpm exec ts-node scripts/audit-word-families.ts

# 跑质量回归 (133 cases)
pnpm exec jest word-families-quality

# 全部测试
pnpm exec jest                                # server (156)
cd ../extension && pnpm exec vitest run       # extension (241)
```

## 后续可选优化（不再阻塞主流程）

### 1. ~~firemen 类未覆盖不规则复数~~ ✅ 同日 follow-up 落地

`apps/server/src/data/irregular-plural-overrides.json` + `irregular-adj-overrides.json`
作为 wink 同等金标处理，rebuild / audit / DictionaryWhitelistService 三处都合并。
后续要新增不规则形态，编辑这两个文件即可。

### 2. 短语 / 多词词条

backlog 里 P0 还剩"短语 / 多词词条"——和词族质量正交，单独立项。

### 3. wink 数据按 tense 重切

ADR 0020 里 v3 算法用 compromise lemma 已经替代了"按 tense skip 规则生成"的需求。
未来如果想做更精确的 POS-aware 生成（区分 verb -ed 和 adj -ed），可以把 wink 的
exception 重新打 tense 标签后再做。

## 不要做的事

- **不要**改 ADR 0017 的客户端 lemma 路径，已经 215/215 锁住，别破回归。
- **不要**改 wink-lexicon vendor 数据（那是金标）。改要在 expand-side。
- **不要**用 prisma migrate / 直接改生产 DB。先跑 rebuild + seed.ts。
- **不要**碰 `apps/extension/public/`（旧 word_groups JSON 已删，extension/public 现在只有 logo.png）。
- **不要**重新引入 v2 的"按字符规则猛吐"生成方式。v3 的 Norvig + lemma 双验证是噪声从 96%→0% 的关键。
