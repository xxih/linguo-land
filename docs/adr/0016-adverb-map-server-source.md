# 0016 副词→形容词映射下沉到后端

- 日期：2026-04-26
- 相关：[backlog.md#P2 副词映射表 400 行硬编码](../../docs/backlog.md)；[ADR 0011 — 词典白名单走后端](0011-dictionary-whitelist-server-source.md)
- `apps/server/src/data/adverb-map.json`、`apps/extension/src/content/utils/textProcessor.ts`

## Context

`textProcessor.getLemmasForWord` 里有一段 ~110 条不规则副词→形容词映射（happily→happy / well→good / publicly→public 等），原本作为 110 行 TS 字面量内嵌在函数里：

- 每次新增 / 修正条目都得发**扩展新版本**（商店审核来回）
- 跟 ADR 0011 里"白名单走后端"已经搭好的镜像基础设施完全对偶，但这块数据当时没一并迁移
- 110 行 case-by-case 数据塞在算法逻辑中间，可读性差

## Decision

复用 ADR 0011 已经搭好的 `dictionary-whitelist` 通道，把副词映射跟白名单一起下发，避免再立一个新接口。

### 后端

- 数据文件：`apps/server/src/data/adverb-map.json`
- `DictionaryWhitelistService` 同时加载 `dictionary-whitelist.json` + `adverb-map.json`，**`version` 用两个文件内容合并 sha1 12 位指纹**——任何一份变了 version 就翻
- `DictionaryWhitelistSnapshot` 增加 `adverbMap: Record<string, string>` 字段
- 接口形状（`GET /api/v1/dictionary-whitelist`）：`{ version, words, adverbMap }`

### 类型

`shared-types/index.ts`：`DictionaryWhitelistResponse` 增加 `adverbMap?: Record<string, string>`

### 扩展端

- `DictionaryMirror`（背景脚本）的 `RemoteSnapshot` / `PersistedSnapshot` / `getResult()` 都把 `adverbMap` 一并存取
- `DictionaryLoader.initialize()` 返回 `{ ok, adverbMap?, error? }`
- `content.ts` 在拿到 ok 结果后调用 `TextProcessor.setAdverbMap(loadResult.adverbMap)` 注入
- `TextProcessor` 加 static `adverbMap: Record<string, string> | null`，`setAdverbMap` 同时清空 `lemmaCache`（映射变化会改还原结果，缓存必须失效）
- `getLemmasForWord` 的 #Adverb 分支：先查 `this.adverbMap?.[wordLower]`；后端没覆盖到的词退回原 `-ly` 后缀启发式

### 删除

`getLemmasForWord` 里 110 行硬编码全部删除，函数瘦身

## Consequences

**好处**

- 副词映射热更新：加新条目只改 server 上的 JSON 文件 + restart，扩展所有用户下次同步即生效
- ADR 0011 + 0016 已经定型一个"全用户共享、客户端镜像"的模式，将来还有类似数据（短语词条 / 同义词组等）可以照搬
- `textProcessor.ts` 减少 110 行噪音，函数主体变清爽
- `setAdverbMap` 清缓存的契约挂在注入点，避免"远端更新了但缓存还是旧值"的隐性 bug

**代价**

- 首次安装且远端不可达时副词映射为空，#Adverb 分支退回 `-ly` 启发式（仍能处理 `frequently → frequent` 这种规则变形，但对 `happily / well` 这种不规则的会略有降级）。这跟白名单本身的"首次安装强依赖网络"是同一个权衡（ADR 0011）
- `TextProcessor.setAdverbMap` 是侧通道注入（static 字段），不算最优设计；为了不大改 TextProcessor 的实例化模式，先用静态 setter，将来要走 DI 再说
- `dictionary-whitelist` 接口现在塞了两类数据（whitelist + adverbMap）。将来再叠新数据需要考虑拆接口；当前规模不需要

## 没动的相邻问题

- 短语 / 多词词条支持（用户明确这次跳过）
- ADR 0008 提的 lemma → family 映射的边缘 case（与本 ADR 同形态可下沉，留待具体场景出现）
