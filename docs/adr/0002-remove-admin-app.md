# ADR 0002 — 移除 admin 应用和 admin 专用 endpoint

**状态：** 已接受 — 2026-04-25

## 背景

`apps/admin` 是一个 Next.js 15 词族管理后台（列表 / 删词 / 移词 / 统计）。它处于：

- 不在任何 CI workflow 里、没有部署、`apps/extension` 里也没有任何引用（grep 验证零命中）
- 用 Tailwind v3.4，而前端其他部分已经迁到 v4 —— 越拖越分裂
- 后端配套有 `apps/server/src/admin.controller.ts` 和 `vocabulary.controller.ts` 里三个 admin 专用 endpoint（`/word/:wordText/remove`、`/move`、`/create-family`），扩展同样不调用

产品没有用户。继续维护这套没人用的工具是纯成本。

## 决策

把整套删掉：

- `apps/admin/` 整个目录
- `apps/server/src/admin.controller.ts`
- `vocabulary.controller.ts` 里那三个 admin 专用 endpoint，以及 `vocabulary.service.ts` 中对应的 `removeWordFromFamily` / `moveWordToFamily` / `createFamilyFromWord`
- `app.module.ts` 中的 `AdminController` 引用
- `CLAUDE.md` 项目概览里去掉 `apps/admin`

Prisma schema 不动 —— 词族数据本身保留，只是没有 UI 而已。

## 影响

- 代码量、版本分裂、维护负担一起减少，给后面的重构（仓储层、schema 清理等）腾出心智空间。
- 以后如果真的需要词族编辑，写一个 one-off CLI 脚本，或者重新起一个干净的小后台，都比继承一个过时的 React 应用划算。
