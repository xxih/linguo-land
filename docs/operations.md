# LinguoLand 线上运维手册

后端运行时的一切「谁在哪、怎么改、怎么救」。CI/CD 标准模板的通用部分见 `~/Documents/life/09 Guides/云服务器/`，这里只记录项目专属的事实。

## 服务器

- IP: `120.55.184.180`（阿里云 ECS / Alibaba Cloud Linux 8）
- SSH: `ssh linguoland`（`~/.ssh/config` 已配好 `linguoland_ecs_ed25519` key）
- 宝塔面板: http://120.55.184.180:58888
- 运行时: Node v22.20.0 + PM2 + Docker Postgres + Nginx（宝塔托管）

## 域名与端口映射

| 域名 | nginx 反代 | upstream |
|---|---|---|
| `api.linguoland.com` | `/www/server/panel/vhost/nginx/api.linguoland.com.conf` | `127.0.0.1:3001`（后端） |
| `www.linguoland.com` | — | 前端静态 |
| `www.xxih.cc` | `html_www.xxih.cc.conf` | 静态 + `/sensa/api/` → `127.0.0.1:3002` |

历史遗留：`www.xxih.cc/api/ → 127.0.0.1:3000`（旧 `lang-land-api`）已于 2026-04-20 随服务下线一起清理。

## 发布布局

```
/var/www/linguo-land-server/
├── current                → releases/<id>        # 软链，原子切换
├── releases/
│   ├── <YYYYMMDD-HHMMSS-<sha>>/
│   └── ...（保留最近 5 份）
└── shared/
    ├── .env               # 生产环境变量（**唯一来源**，不入仓库）
    └── bin/
        ├── activate.sh    # CI 调用，切换发布
        └── rollback.sh    # 手动回滚
```

PM2 app 名: `linguo-land-server`，脚本路径: `/var/www/linguo-land-server/current/dist/main.js`。

## 部署流程

触发：`git push origin main`（`apps/server/**`、`packages/**`、`pnpm-lock.yaml` 或 workflow 改动时自动跑），或 `gh workflow run deploy-server.yml` 手动。

workflow: `.github/workflows/deploy-server.yml`

时长约 1.5 分钟。构建产物通过 rsync 推到服务器，activate.sh 完成软链切换 + `prisma migrate deploy` + `pm2 reload`。

## 常用命令

```bash
# 看当前运行哪个 release
ssh linguoland 'readlink /var/www/linguo-land-server/current'

# 列出所有 release（带 * 标当前）
ssh linguoland '/var/www/linguo-land-server/shared/bin/rollback.sh --list'

# 回滚上一版
ssh linguoland '/var/www/linguo-land-server/shared/bin/rollback.sh'

# 回指定版本
ssh linguoland '/var/www/linguo-land-server/shared/bin/rollback.sh <RELEASE_ID>'

# 看 PM2 状态
ssh linguoland 'pm2 list; pm2 describe linguo-land-server | head -30'

# 实时看日志
ssh linguoland 'pm2 logs linguo-land-server --lines 100'

# 看 nginx 访问日志
ssh linguoland 'tail -f /www/wwwlogs/api.linguoland.com.log'
```

## 数据库

Docker 容器 `lang-lang-land-db`（Postgres 15），宿主机端口 `5433`。

```bash
# 快速进 psql
ssh linguoland 'docker exec -it lang-lang-land-db psql -U postgres -d lang_lang_land'

# 备份
ssh linguoland 'docker exec lang-lang-land-db pg_dump -U postgres -Fc lang_lang_land' > backup_$(date +%Y%m%d).dump
```

Prisma schema: `apps/server/prisma/schema.prisma`。迁移脚本: `apps/server/prisma/migrations/`。

**`schema.prisma` 里必须保留 `binaryTargets = ["native", "rhel-openssl-1.1.x", "debian-openssl-3.0.x"]`**：CI 在 Ubuntu 上生成 client，服务器是 Alibaba Linux 8（rhel-openssl-1.1.x）。少了服务器启动会找不到 Query Engine 而崩。

## GitHub Secrets（CI 依赖）

repo Settings → Secrets：

- `SSH_HOST` = `120.55.184.180`
- `SSH_USER` = `root`
- `SSH_PRIVATE_KEY` = `~/.ssh/linguoland_ci_deploy_ed25519` 的私钥
- `SSH_KNOWN_HOSTS` = `ssh-keyscan -t ed25519,ecdsa,rsa 120.55.184.180`

更新 known_hosts（重装系统后）：

```bash
ssh-keyscan -t ed25519,ecdsa,rsa 120.55.184.180 | gh secret set SSH_KNOWN_HOSTS
```

## 环境变量

生产 `.env` 唯一真源: `/var/www/linguo-land-server/shared/.env`。activate.sh 软链进每个 release。

**不要** commit `.env` 到仓库；也 **不要** 直接改 release 里的 `.env`（那是软链，下次 deploy 会覆盖）。改就改 `shared/.env`。

改完要 `pm2 reload linguo-land-server --update-env` 才生效。

## SSL 证书

`api.linguoland.com` 证书路径：`/www/server/panel/vhost/cert/api.linguoland.com/{fullchain,privkey}.pem`。

用宝塔的 Let's Encrypt 集成管理，自动续签。如果到期没自动续：宝塔 → 反向代理 → `api.linguoland.com` → 设置 → SSL → Let's Encrypt → 重新申请。

阿里云 DigiCert DV 免费证书已弃用（90 天不能续期太折腾）。

## 相关

- [`DEPLOYMENT_GUIDE.md`](../DEPLOYMENT_GUIDE.md) — 2025-11 数据库 schema 升级迁移指南
- 通用 CI/CD 模板: `~/Documents/life/09 Guides/云服务器/Node 后端 CI-CD（release 目录 + PM2）.md`
- 排查套路: `~/Documents/life/09 Guides/云服务器/后端线上排查套路.md`
