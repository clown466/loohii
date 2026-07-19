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

## 桌面版（Electron 薄壳）

薄壳架构：壳内只做原生窗口/菜单/单实例/自动更新，页面加载线上 https://loohii.com/app（本地不内嵌服务端和数据库）。

```bash
# 开发：一条命令起 vite + 编译主进程 + 起壳（壳加载 localhost:5173）
npm run dev:electron

# 仅编译主进程/preload（electron/*.mts|cts → dist-electron/）
npm run electron:compile

# 出 Windows NSIS 安装包（vite build + 主进程编译 + electron-builder + 产物校验）
npm run dist:win
# 产物：release/loohii Setup <version>.exe + latest.yml
```

要点：

- **数据目录**：userData 固定 `%LocalAppData%\loohii`（非 Roaming，更新/重装不丢登录态与窗口状态）
- **登录态**：Web 端 token 存 localStorage，Electron 持久分区（`persist:loohii`）天然持久，重启壳保持登录
- **导航白名单**：壳内只允许 loohii.com / api.aijiekou.online（dev 加 localhost），外链一律弹系统浏览器
- **自动更新**：electron-updater generic provider，manifest 默认 https://api.aijiekou.online/loohii/latest.yml（env `LOOHII_UPDATE_URL` 可覆盖）；未配置/检查失败安静降级，菜单「帮助 → 检查更新…」可手动触发
- **冒烟**：`LOOHII_SMOKE_TEST=1` 运行壳可自验"加载成功 + 外链拦截"并自动退出

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
