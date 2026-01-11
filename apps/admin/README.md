# LinguoLand Admin

这是 LinguoLand 的后台管理系统，用于管理员管理词族数据。

## 功能

- 查看所有词族
- 查看词族内的单词
- 从词族中移除单词
- 将单词移动到其他词族
- 词族统计信息

## 开发

1. 安装依赖：

```bash
pnpm install
```

2. 启动开发服务器：

```bash
pnpm dev
```

应用会在 http://localhost:3001 启动。

## 注意事项

- 确保后端服务器在 http://localhost:3000 运行
- 需要登录认证才能访问管理功能
- 当前使用的是 Next.js 15 + Tailwind CSS v4

## API 端点

- `GET /api/v1/admin/families` - 获取所有词族
- `GET /api/v1/admin/stats` - 获取统计信息
- `POST /api/v1/vocabulary/word/:wordText/remove` - 移除单词
- `POST /api/v1/vocabulary/word/:wordText/move` - 移动单词

