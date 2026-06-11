# 鹿绘AI (Loohii)

AI 驱动的动画创作平台 — https://www.loohii.com

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + Vite 6 + Tailwind CSS 4 + shadcn/ui + @xyflow/react |
| 状态管理 | Zustand 5 |
| 后端 | Express 5 + TypeScript |
| 数据库 | PostgreSQL + Prisma |
| 队列 | BullMQ + Redis |
| 实时通信 | Socket.io |
| 文件存储 | Cloudflare R2 |
| 部署 | Docker |

## 本地开发

```bash
# 安装依赖
npm install

# 启动数据库和 Redis
docker compose up -d

# 数据库迁移
npm run prisma:migrate

# 种子数据
npm run prisma:seed

# 启动后端
npm run server:dev

# 启动前端（另一个终端）
npm run dev
```

## 项目结构

```
src/app/          前端应用
  pages/          页面组件
  stores/         Zustand stores
  components/     共享组件
  lib/            工具库
  layouts/        布局组件
server/src/       后端服务
  routes/         API 路由
  ai/             AI 模型适配
  lib/            共享工具
  queues/         任务队列
  realtime/       Socket.io
  storage/        R2 存储
prisma/           数据库 schema 与迁移
```

## 构建与部署

```bash
# 前端构建
npm run build

# 后端类型检查
npm run server:check

# 启动生产后端
npm run server:start
```
