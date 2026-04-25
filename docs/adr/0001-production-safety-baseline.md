# ADR 0001 — 后端基础安全加固（CORS + JWT secrets）

**状态：** 已接受 — 2026-04-25

## 背景

`apps/server` 上线时带着两个生产级红灯：

1. **CORS 全开** —— `app.enableCors({ origin: true })` 接受任意来源。任何网站都可以拿着窃取到的 Bearer token 调我们的 API。
2. **JWT secret 有兜底字符串** —— `process.env.JWT_SECRET || 'your-secret-key'`（refresh secret 同理）出现在 `auth.module.ts`、`auth.service.ts`、`jwt.strategy.ts`。一旦生产环境忘了设 env，token 就会被一个公开已知的字符串签名，伪造毫无门槛。

代码注释里写着"production 应该限制"但从来没真的去做。

## 决策

1. **CORS**：把通配替换成回调验证器（`src/cors.ts: buildCorsOriginValidator`）
   - 任意 `chrome-extension://*` 来源放行（扩展是主要客户端，dev/prod 构建出的 ID 不一致）
   - 环境变量 `CORS_ORIGINS` 中列出的来源（逗号分隔）放行
   - 仅当 `NODE_ENV !== 'production'` 时放行 `localhost`
   - 其余一律拒绝

2. **JWT secrets**：彻底删掉兜底字符串
   - `JwtModule` 从 `register` 改为 `registerAsync`，让 secret 在 `ConfigModule` 加载完 `.env` 之后才解析
   - `JWT_SECRET` 和 `JWT_REFRESH_SECRET` 通过 `ConfigService` 读取，缺失时在 module / service 初始化阶段直接抛错（`src/env.util.ts: requireConfig`）
   - `AuthService` 和 `JwtStrategy` 改成注入 `ConfigService`，不再直接读 `process.env`

## 影响

- 不会再用公开已知的 secret 签名；CORS 不再放行任意来源。
- 一个统一的 `requireConfig` 工具规范了未来"必填 env"的写法 —— 不再有 `process.env.X || 'fallback'` 这种隐患模式。
- 开发环境如果没建 `.env` 现在会启动时崩溃，而不是带着默认 secret 偷偷跑起来。这是**故意的** —— 沉默的兜底就是 bug 本身。
- 生产部署如果以后接入非扩展客户端（比如未来要做的 web admin），需要在 `CORS_ORIGINS` 显式登记。在那之前 `chrome-extension://*` 已经够用。

## 测试

`apps/server/src/cors.spec.ts` 覆盖了验证器里所有有安全含义的分支：扩展协议无条件放行、`CORS_ORIGINS` 中的来源放行、localhost 仅 dev 放行、生产环境拒绝未知来源。
