# 交接：词族数据质量持续优化

**目标**：把词族数据从当前 71/100 推到学习者真正可用的高质量水准（90+）。
本文档为 fresh 上下文会话提供完整背景，目标是一直优化到非常高质量。

## 当前进度（已 commit 在 main 分支）

最近 6 次 commit：

```
82a67c4 refactor(server): 词族重建 v2 算法 + 多维质量审计脚本
38257a5 docs(adr): 0018 词族 surface-form 完整化 + highlight 代表 lemma 选择
f21785e refactor(server): 重建词族数据，从 dictionary-whitelist 反向展开
368f5f9 feat(extension/server): 词族 surface-form 展开 + highlight lemma 选择修复
8e385d2 docs(adr): 0017 词形还原换成 rule-based + 后端不规则映射
eb720de refactor(extension): 词形还原换成 rule-based + 后端不规则映射
```

主要 ADR：

- [ADR 0017](../adr/0017-lemma-rule-based-with-server-exceptions.md) — 客户端 lemma 路径换成 rule-based
- [ADR 0018](../adr/0018-family-surface-form-and-highlight-lemma-pick.md) — 词族 surface-form 完整化 + highlight 代表 lemma

## 当前评分：71 / 100

跑 `pnpm --filter server ts-node scripts/audit-word-families.ts` 拿最新分数。

| 维度 | 分数 | 关键数据 |
| --- | --- | --- |
| precision (误吞少) | 20.5 / 30 | 411 词被吞进非自身 family。其中大部分是 wink 验证过的正确归属（am→be、ate→eat、shrunken→shrink 等），审计逻辑没区分。 |
| recall (漏收少) | 15.5 / 20 | wink 5469/5469、常见动词 ✓、形容词 ✓。`work` 缺 `worked`：wink 给了 wrought 但 worked 也合法，被规则跳过。 |
| **noise (伪生成少) ★** | **0 / 15** | **177,405 个伪生成形态（占 96%）**。源头：白名单含大量 OCR 噪声 'aa/aaa/aaaa/aab/...'，每个都被当 base 后生成 'aaed/aaer/aaing'。 |
| learner-friendly | 35 / 35 | 109 个核心高频词全部健康。 |

★ = 最大的扣分项，下面详述。

## 还能怎么优化（按性价比排序）

### A. 清理白名单 OCR 噪声（最大杠杆，预计直接拉到 85+）

**问题**：`apps/server/src/data/dictionary-whitelist.json` 43,442 词里夹杂大量噪声：

```bash
node -e "const w=JSON.parse(require('fs').readFileSync('apps/server/src/data/dictionary-whitelist.json','utf-8')); console.log(w.slice(0,40))"
# 前 40 个就有 a, aa, aaa, aaaa, aaaah, aaah, aac, aachen, aadhaar, aadmi, aaf, aah, aaliyah, aam, aamir, aan, aang, aap, aapl, aar...
```

噪声类型：

1. **重复字母 OCR**：`aa, aaa, aaaa, aaaah, aaah, ab, aaab, ...`
2. **缩写/型号**：`aac, aapl, abc, abs`
3. **专有名词**：`aachen, aadhaar, aaliyah, aamir, aang`
4. **印地/外语外来词**：`aadmi, aam, aap`
5. **音译/拟声**：`aah, aaargh`

每个噪声 base 都生成 4-6 个伪形态 → 噪声 ≈ 30K base × 6 ≈ 200K 伪 form。

**清理思路**：

- **频率过滤**：用 [Norvig 1-grams](https://norvig.com/ngrams/count_1w.txt) （已下载到 `/tmp/lemma-eval/count_1w.txt`，rebuild 时也用过）按 rank ≤ N 筛。N=20K~30K 是常见英语母语阅读语料的覆盖上限。
- **形态学健全**：drop 不能通过英语正字法 generator 反向验证的字符串（连续重复字母、无元音、纯辅音串）。
- **黑名单白名单组合**：人工 review top swallowers，加 deny list。
- **多源对照**：用 SCOWL / NGSL / COCA 5K-10K 等已知 curated 词表做交集。

预计清理后白名单 25-30K 词、伪形态降到 < 5%、总分上 85+。

### B. 修 work / dream / learn 这类"双形态过去式"

**问题**：wink 给了 wrought（古英语）作为 work 的不规则过去式，我的 rebuild 看到 wink 有任意形态就跳过 -ed 生成 → `worked` 没进 work family。同类问题词：dream→dreamt vs dreamed、learn→learnt vs learned、spell→spelt vs spelled、burn→burnt vs burned。

**修法**：post-process 阶段——若 `${base}+ed/d/ied` 在白名单 + base 在 baseToWinkForms，**仍**加入 base family（`worked` 在白名单 → 加入 work）。需要小心不要把 `bed`/`seed` 加回来。识别 collision 的判据：

- `bed` 不该加：bed 有自己实质 family（bed/beds/bedded/bedding）→ 它是独立 base
- `worked` 该加：worked 没有实质独立 family（worked、workeds、workeding 全是 junk）

**算法**：post-process 时 for each base family A 中规则 -ed 候选 X，若 X 在白名单且 families[X] 存在且 |families[X]| >= 3（独立 base 的标志），不加；否则加。

### C. 词族交叉验证：合并疏漏

**问题**：当前算法对每个 base 独立构建 family。漏了"X 是 Y 的规则屈折但 X 也在白名单"的 merge 逻辑。比如 `players` 在白名单 → 自己一个 family，但应该并入 `player` family。

**修法**：post-process 阶段，扫白名单每个词 X，检查是否存在另一个 base Y 满足 X = Y + 标准后缀（且 Y 也在白名单 + Y.length 足够长避免 be→bed 类 collision）。若有，把 X 移入 Y family，删除 X 的独立 family。

### D. POS 信号（可选，工程量大）

**问题**：当前没法区分 -er 是形容词比较级（bigger）还是名词派生（runner）。当前用"是否在白名单"启发式兜底，但仍有边角错误。

**思路**：从 WordNet 拉 POS 标签。`wordnet-db` npm package 或类似，但数据 ~30 MB。或者用 `compromise` 在 build-time 跑一遍每个 base 的 POS 推断（compromise 已经在 extension devDeps，移到 server 也可）。

仅在前面 A/B/C 都做完且分数仍上不去时才考虑。

### E. 同形异性词处理 / homographs

**当前**：`saw → saw family`（不再被 see 吞）、`lay → lay family`（不再被 lie 吞）、`bear → bear family`（不被 born 吞）。这个版本下 wink 对于本身也是 base 的 form 没强制覆盖。

**评估**：可能对某些用户场景仍有问题——用户标 see 后期望 saw 也被识别。当前靠客户端 lemma 路径补救（saw → ['saw', 'see'] 两个候选），highlightManager.pickRepresentativeLemma 选 status 强的那个（ADR 0018）。**理论上 OK 但需要 e2e 验证**。

### F. 自动化质量回归

**当前**：审计是手跑 `audit-word-families.ts`，没进 CI。

**改造**：把关键指标做成 vitest/jest 断言，加进测试套件。比如：

- 误吞率 < 1%
- recall ≥ 99%
- 100 个核心学习者词 family 全健康
- noise < 10%（清理白名单后）

这样未来动 wink 数据 / rebuild 算法时不会回退。

## 文件 / 命令地图

### 数据文件

- `apps/server/src/data/dictionary-whitelist.json` — 43,442 词白名单（待清理）
- `apps/server/src/data/word-families.json` — 45,014 family（rebuild 输出，3.26 MB）
- `apps/server/src/data/{verb,noun,adj}-inflection-map.json` — wink 不规则映射（vendor 自 wink-lexicon，金标）
- `apps/server/src/data/adverb-map.json` — 副词→形容词映射（ADR 0016）

### 代码

- `apps/server/src/lemma-expander.ts` — base form → surface forms 展开器（13 条 jest 通过）
- `apps/server/scripts/rebuild-word-families.ts` — 词族重建脚本（v2 算法）
- `apps/server/scripts/audit-word-families.ts` — 多维质量审计脚本
- `apps/server/scripts/expand-family-words.ts` — 一次性 backfill 脚本（production 用）
- `apps/server/scripts/build-inflection-maps.mjs` — 从 wink-lexicon vendor 数据
- `apps/server/src/seed.ts` — 读 word-families.json 写 DB

### 客户端（已就位，无需改动）

- `apps/extension/src/content/utils/textProcessor.ts` — `getLemmasForWord`（rule-based，ADR 0017）
- `apps/extension/src/content/utils/highlightManager.ts` — `pickRepresentativeLemma`（ADR 0018）
- `apps/extension/src/content/utils/lemmaFixtures.json` — UniMorph 抽样 215 条回归集
- `apps/extension/scripts/build-lemma-fixtures.mjs` — fixture 生成脚本

### 常用命令

```bash
# 重新生成词族
cd apps/server && pnpm exec ts-node scripts/rebuild-word-families.ts

# 跑质量审计
cd apps/server && pnpm exec ts-node scripts/audit-word-families.ts

# 后端测试（含 lemma-expander 的 13 条）
cd apps/server && pnpm exec jest

# 前端测试（含 215 条 lemma fixture）
cd apps/extension && pnpm exec vitest run

# 全栈 typecheck
cd apps/extension && pnpm exec tsc --noEmit
cd apps/server && pnpm exec tsc --noEmit  # 注意：有个 e2e test 的 pre-existing TS 错误，与本次无关
```

## 数据样本（v2 当前状态）

```
woman   → [woman, womaning, womanner, womannest, womanning, womans, women]   ← 噪声多但功能 OK
go      → [go, goes, going, gone, gos, went]                                  ← 干净
break   → [break, breakest, breaking, breaks, broke, broken]                  ← 'breakest' 噪声
big     → [big, bigger, biggest, bigging, biging, bigs]                       ← 'bigging/biging' 噪声
good    → [best, better, good, gooder, goodest, gooding, goods]               ← 'gooder/gooding' 噪声
be      → [am, are, be, been, being, bes, is, was, were]                      ← 'bes' 噪声但其他完美
have    → [had, has, have, haveing, haver, haves, havest, having]             ← 'haveing/haver/havest' 噪声
do      → [did, do, does, doing, done, dos]                                   ← 'dos' 边缘
child   → [child, childer, childest, childing, children, childs]              ← 'childer/childest' 噪声
mouse   → [mice, mouse, mouseing, mouser, mouses, mousest, mousing]           ← 'mouseing/mousest' 噪声
see     → [saw, see, seeing, seen, sees, seest]                               ← 'seest' 噪声
draw    → [draw, drawest, drawing, drawn, draws, drew]                        ← 'drawest' 噪声
need    → [need, needed, needer, needest, needing, needs]                     ← 'needer/needest' 噪声
bring   → [bring, bringest, bringing, brings, brought]                        ← 'bringest' 噪声
river   → [river, rivered, rivering, riverred, riverrer, riverrest, riverring, rivers]   ← 噪声大（river 不是动词）
```

噪声形态都是不真实的英语，**不会出现在用户文章里**，所以**不影响识别准确性**——但拉低数据质量分、占 DB 体积、潜在让用户在词典管理界面看到怪东西。

## 推荐 next session 行动顺序

1. **先做 A（清理白名单）**：用 Norvig 频率 + COCA/NGSL 交集筛白名单，预计能直接把 noise 从 96% 降到 < 10%，总分跳到 85+。
2. **再做 B/C（双形态过去式 + 跨家族 merge）**：把 worked、dreamed、learners 等修好，recall 拉到 19+/20。
3. **F（自动化回归）**：分数稳定在 85+ 之后把指标固化成测试。
4. **D（POS 信号）和 E（homograph 验证）按需**。

## 不要做的事

- **不要**改 ADR 0017 的客户端 lemma 路径，已经 215/215 锁住，别破回归。
- **不要**改 wink-lexicon vendor 数据（那是金标）。改要在 expand-side。
- **不要**用 prisma migrate / 直接改生产 DB。先改 word-families.json + 跑 seed.ts。
- **不要**碰 `apps/extension/public/` 下的东西（旧 word_groups JSON 已删，extension/public 现在只有 logo.png）。

## 一些已知边角不重要的事

- 同形异性词全归 wink 优先级（lay→lie、saw→see 都接受了，已在 ADR 0018 doc 过）。改的话要重做 wink 数据，工程大不划算。
- compromise 还在 `collectWordsFromNodes` 用作分词，没移除。可选优化但与本任务无关。
- backlog 里 P0 还剩"短语 / 多词词条"——和词族质量正交，不必合并。

---

**评分目标**：90 / 100。当前 71，主战场是 noise（清理白名单 → 直接 +20）+ recall（修 work/dream/learn 这类 → +3-4）+ precision（修审计逻辑别把 wink 验证过的正确归属算误吞 → +5）。
