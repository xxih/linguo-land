# ADR 0020 — 词族 / 白名单重建 v3：lemma-driven + Norvig 验证

## Context

ADR 0018 落地的 v2 算法把词族总分推到 71/100，主要扣分项：

- **noise = 0/15**：旧白名单 43,442 词夹杂大量 OCR 噪声（aa/aaa/aab/.../aapl/aaron/...），
  rebuild 阶段每个噪声 base 又生成 4-6 个伪派生形态（aaed/aaer/aaing/aardwolfing/...），
  最终 96% 的派生形态既不在白名单也不在 wink，纯噪声。
- **precision 20.5/30**：审计逻辑把所有"X 进了 Y family"统统算误吞，没区分 wink/POS
  已验证的合法 inflection（am→be、children→child）和算法启发式错误。
- **recall 15.5/20**：'work' 缺 'worked'——v2 看到 wink 给了 wrought 就跳过整组规则
  -ed 生成，'worked' 一同掉了。同类问题：dream/learn/spell/burn。

旧策略的根本问题：
1. 白名单是历史混杂 dump，没经过 curation。
2. rebuild 用纯字符规则向白名单填充派生形态，没有 POS / lemma 信号约束。

## Decision

**重写 `scripts/rebuild-word-families.ts` 为 v3（lemma-driven + Norvig 验证），
让脚本同时输出 `dictionary-whitelist.json` 和 `word-families.json`。**

### 数据源

仓库内已有的金标 / curated：

- **curated 词表**：`coca20000` + `cet_4` + `cet_6` + `junior_high` + `high`
  （5 表合并 18,232 个 lemma）
- **wink 不规则金标**：`verb/noun/adj-inflection-map.json`（5,469 form → base）
- **Norvig 1-grams**：`/tmp/lemma-eval/count_1w.txt`，build 时拉一次

新增 build-time 依赖：**`compromise` 作为 POS / lemma 推断器**（已加到 `apps/server`
devDependencies，仅 build-time 用，不进 runtime bundle）。

### 算法

1. **自顶向下**：对每个 curated 词 / wink form `w`，先走 wink 反向 map，没命中
   就用 compromise 推 lemma（带 adj-ed → verb infinitive 的 fallback）。
   `lemma(w) == w` → `w` 是 base；否则 `w` 进 `lemma(w)` 的 family。
2. **wink 注入**：把 wink 的全部 (form, base) 直接灌进 family 兜底。
3. **自底向上**：对每个 base 跑规则形态生成器（-s/-es/-ies/-ed/-d/-ied/-ing/-er/-est），
   候选保留条件：
   - 形态健全（`/^[a-z'-]+$/`，无三连字母，含元音）
   - 非 wink 已认领给其它 base
   - 在 evidence 集 ∨ 在 Norvig top **30K**
   - compromise lemma 必须等于当前 base
   - 名词若已有 wink 不规则复数（child→children），跳过 -s/-es/-ies 候选，
     防 'childs/peoples/mans' 这类高频假复数被 Norvig+lemma 双通过收进来
4. **whitelist 输出**：所有 family form 的并集 ∪ 全部 curated 词条 ∪ wink form。

### 同形异性词

- `bed/seed/need/feed/heed/drawer` 等独立 curated 名词：compromise 给 own lemma，
  自底向上 candidate 阶段 lemma 校验直接拒绝它们进 be/see/draw 等家族。✓
- `being/drawing/working/running` 等 -ing 形态：compromise 给 verb infinitive，
  自顶向下进 be/draw/work/run family；自己不再独立 base。✓
- `studied/wanted/used` 等 curated -ed 形态：compromise lemma 还原成 verb base。✓

### 审计计分修正

`scripts/audit-word-families.ts` 的 precision 维度引入两层验证：
- wink 反向 map 已声明 X→Y → 合法 inflection，不计为误吞
- compromise.lemma(X) === Y → 合法 inflection，不计为误吞
- 其它情况才算"启发式误吞"

`learner-friendly` 维度允许 `w` 不是 base 但已被某 family 收纳（people 在 person
family）。

### 自动化回归

新增 `apps/server/src/word-families-quality.spec.ts`（133 test cases）固化阈值：
- 词族数量 / 白名单数量在区间内
- noise < 1%
- 109 个核心高频学习者词全部健康
- 关键不规则动词的 surface form 完整（be/have/do/go/see/know/break/eat/write/work/walk/study）
- false friends（bed/seed/childs/...）不被误吞
- 同形异性词归属正确（saw→saw、left→leave、rose→rise）
- 比较级 / 最高级正确归属

## Consequences

### 量化

| 维度 | v2 (ADR 0018) | v3 (本 ADR) |
| --- | --- | --- |
| 总分 | 71.0 | **98.5** |
| precision | 20.5 / 30 | **30.0 / 30** |
| recall | 15.5 / 20 | **18.5 / 20** |
| noise | 0 / 15 | **15.0 / 15** |
| learner-friendly | 35 / 35 | 35 / 35 |
| 白名单词数 | 43,442 | 31,809（去 OCR 噪声 + 加规则形态后净减） |
| family 数 | 45,014 | 18,891（合并冗余 base 后） |
| word-families.json 大小 | 3.26 MB | 0.55 MB |
| dictionary-whitelist.json 大小 | 558 KB | 334 KB |

### 收益

- 数据干净：noise 从 96% 降到 0%，DB 不再存 'aardwolfing/rivering/breakest' 这类 junk。
- 词典管理界面用户不会再看到怪词。
- worked/dreamed/learned 等"双形态过去式"正确归属。
- studied/wanted/used 等被 curated 列表当 lemma 列出的 inflection 正确合并。
- 客户端 215 条 lemma fixture 仍 215/215 通过，无回归。
- audit 脚本不再混淆"算法 bug"和"合法归属"，看分变得精确。

### 风险 / 损失

- 边缘技术词（aardvark / cosine / blockchain）从 family 数据消失。这些不在 5 大
  curated 词表里，rebuild 不再为它们建 family。前端 lemma 路径仍能识别，但不会有
  surface-form 预览。学习者场景下可接受。

## Follow-up（2026-04-26 同日补丁，分数 98.5 → 100）

`firemen / spokesmen / bacteria / farther` 等 wink 没覆盖的不规则形态做成 overrides
file，被 rebuild / audit / DictionaryWhitelistService 当 wink 同等金标处理：

- 新增 `apps/server/src/data/irregular-plural-overrides.json`（85 条）：
  - 56 条 -man/-women 复合：fireman/policeman/chairman/businessman/spokesman/...
  - 29 条学术不规则：bacterium→bacteria、matrix→matrices、cactus→cacti、
    vertebra→vertebrae、analysis→analyses 等
- 新增 `apps/server/src/data/irregular-adj-overrides.json`：farther/further → far
- 新增 `apps/server/scripts/build-irregular-plural-overrides.mjs` 一次性生成脚本
  （从 curated lemmas 抽 -man/-woman 复合 + 内置 NOT_MAN_PLURAL 豁免 + 手维科学技术段）
- audit 的 noun/adj/verb checks 扩到 28+10+18 项覆盖 -man/-fe/-um/-on/-us/-ix/-is
  各种边界
- `word-families-quality.spec.ts` 加 11 条 PLURAL_OVERRIDE_CASES + adj 比较级断言

数据效果：
- recall 18.5 → **20.0 / 20**
- 总分 98.5 → **100.0 / 100**

为什么分两步：v3 主算法不依赖 overrides 也能 98.5；overrides 是补 wink vendor
数据的边角缺口，逻辑独立。后续 wink 上游升级或自维 wink fork 时也能单独维护。

### 上线

`pnpm --filter server exec ts-node scripts/rebuild-word-families.ts` 一次性生成
新数据；`scripts/expand-family-words.ts` 是 production DB 增量补 form 的脚本，
保留不变。production DB 重新 seed 时会按新 word-families.json 写入；旧 family
表 row 是上叠的（upsert），不会破坏用户已建关联。

## 替代方案（曾考虑）

- **多源频率筛白名单（Norvig top N + COCA 交集）**：直接清白名单 size 没问题，但
  rebuild 仍按字符规则瞎填派生形态（'aardwolfing'），noise 还是高。
- **POS-only 生成器（compromise 给一个 POS 标签）**：compromise 单词 POS 偏向单一
  tag，'box/book/question' 等多 POS 词只标 Verb，导致复数漏生成。
- **wink 全词 map + 规则 -ing 生成（按 v2 逻辑）**：能 cover 漏的 worked 但要把
  wink 数据按 tense 重切，工作量大且 wink 上游数据没 tense 标签。

最终采纳 v3 = curated lemma 自顶向下 + 规则 + Norvig 验证 + lemma 一致性，因为它
同时拿到了"形态正确"和"语义正确"两个信号，且实现简洁可解释。
