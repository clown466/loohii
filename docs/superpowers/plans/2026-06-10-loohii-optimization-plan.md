# 鹿绘AI (Loohii) 全面优化方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对鹿绘AI项目进行系统性优化——拆分巨型文件、提升前端性能、完善开发基础设施、修正项目信息。

**Architecture:** 项目为 React 18 + Vite 全栈应用（Express 5 后端 + Prisma + PostgreSQL + Redis + Socket.io）。前端以 @xyflow/react 画布为核心，使用 Zustand 状态管理和 shadcn/ui 组件库。当前最大痛点是 `ProjectCanvasPage.tsx` 达 18,034 行，以及多个后端文件超 1,000 行。优化策略为：先修正项目元信息，再做前端巨型文件拆分，然后性能优化（路由懒加载、code splitting），最后完善开发基础设施。

**Tech Stack:** React 18, Vite 6, Tailwind CSS 4, @xyflow/react, Zustand, shadcn/ui, Express 5, Prisma, PostgreSQL, BullMQ, Redis, Socket.io, Cloudflare R2

---

## 现状分析

### 巨型文件清单（按严重程度排序）

| 文件 | 行数 | 层级 | 严重度 |
|------|------|------|--------|
| `src/app/pages/ProjectCanvasPage.tsx` | 18,034 | 前端 | **极严重** |
| `server/src/routes/workflows.ts` | 8,194 | 后端 | **严重** |
| `server/src/ai/dreaminaWebBridge.ts` | 3,356 | 后端 | 高 |
| `server/src/routes/agent.ts` | 3,304 | 后端 | 高 |
| `src/app/lib/apiClient.ts` | 1,768 | 前端 | 高 |
| `src/app/pages/SettingsPage.tsx` | 1,716 | 前端 | 高 |
| `server/src/lib/episodeCanvasSync.ts` | 1,498 | 后端 | 中 |
| `server/src/lib/canvasStoryboardReferences.ts` | 1,263 | 后端 | 中 |
| `server/src/routes/characters.ts` | 1,106 | 后端 | 中 |
| `server/src/ai/imageModel.ts` | 1,048 | 后端 | 中 |
| `server/src/routes/models.ts` | 952 | 后端 | 中 |

### 其他问题

- **无路由懒加载** — `routes.tsx` 同步 import 全部页面，首屏加载包含所有页面代码
- **README.md 是 Figma 生成的占位内容** — 没有项目文档
- **CODEX_HANDOFF.md 信息过时** — 仓库路径指向 `/tmp/Manjuui`
- **无 CLAUDE.md** — 缺少开发规范
- **前端零测试** — 仅后端有 7 个测试文件
- **无 CI/CD** — 无自动化构建/测试管线

---

## Phase 1: 项目元信息修正

### Task 1: 更新项目文档与元信息

**Files:**
- Modify: `README.md`
- Modify: `CODEX_HANDOFF.md`
- Modify: `package.json` (确认 name 字段)
- Modify: `index.html` (确认 title)

- [ ] **Step 1: 更新 README.md**

替换当前 Figma 占位内容为正式项目文档：

```markdown
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

# 启动前端
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
```

- [ ] **Step 2: 更新 CODEX_HANDOFF.md**

修正 Runtime 部分：

```markdown
## Runtime

- Repo: `https://github.com/clown466/loohii`
- Live site: `https://www.loohii.com`
- Health check: `https://www.loohii.com/api/health`
```

删除 `/tmp/Manjuui` 引用。

- [ ] **Step 3: 确认 package.json 和 index.html**

确认 `package.json` 中 `"name": "loohii"` ✅
确认 `index.html` 中 `<title>鹿绘AI - AI驱动的动画创作平台</title>` ✅

- [ ] **Step 4: Commit**

```bash
git add README.md CODEX_HANDOFF.md
git commit -m "docs: update project documentation and fix stale references"
```

---

## Phase 2: 前端巨型文件拆分（核心优化）

### Task 2: 拆分 ProjectCanvasPage.tsx（18,034 行）

这是整个优化的重中之重。当前这个文件包含了：画布核心、工作流中心、资产面板、分镜编辑、视频生成、剪贴板、节点类型定义等所有功能。

**拆分策略：按功能域拆分为独立组件模块**

**Files:**
- Modify: `src/app/pages/ProjectCanvasPage.tsx` — 拆分为壳组件（~300行）
- Create: `src/app/features/canvas/` — 画布核心目录
- Create: `src/app/features/canvas/CanvasShell.tsx` — ReactFlow 画布容器
- Create: `src/app/features/canvas/CanvasToolbar.tsx` — 画布工具栏
- Create: `src/app/features/canvas/nodes/` — 所有自定义节点类型
- Create: `src/app/features/workflow/` — 工作流中心
- Create: `src/app/features/workflow/WorkflowCenter.tsx` — 工作流主面板
- Create: `src/app/features/workflow/WorkflowStepList.tsx` — 工作流步骤
- Create: `src/app/features/workflow/EpisodeSelector.tsx` — 集数选择
- Create: `src/app/features/assets/` — 资产管理
- Create: `src/app/features/assets/AssetPanel.tsx` — 资产侧边面板
- Create: `src/app/features/assets/AssetCard.tsx` — 资产卡片
- Create: `src/app/features/assets/AssetImageHistory.tsx` — 资产图片历史
- Create: `src/app/features/assets/AssetUpload.tsx` — 上传组件
- Create: `src/app/features/storyboard/` — 分镜功能
- Create: `src/app/features/storyboard/StoryboardEditor.tsx` — 分镜编辑器
- Create: `src/app/features/storyboard/ClipList.tsx` — 分镜片段列表
- Create: `src/app/features/video/` — 视频生成
- Create: `src/app/features/video/VideoGenerationPanel.tsx` — 视频生成面板
- Create: `src/app/hooks/useCanvasAutoSave.ts` — 画布自动保存 hook
- Create: `src/app/hooks/useWorkflowState.ts` — 工作流状态 hook
- Create: `src/app/hooks/useAssetPanel.ts` — 资产面板状态 hook

**实施方式：** 这个 Task 太大，需要分阶段执行。每个子步骤专注拆出一个功能域。

- [ ] **Step 1: 阅读 ProjectCanvasPage.tsx 并识别功能边界**

通读全文件，标记每个功能域的起止行号。预期功能域：
1. 节点类型定义（自定义 ReactFlow 节点组件）
2. 画布核心逻辑（ReactFlow 配置、事件处理）
3. 工作流中心（步骤管理、生成触发）
4. 资产面板（角色/道具/场景资产管理）
5. 分镜编辑（storyboard 展示与编辑）
6. 视频生成（视频生成参数与触发）
7. 状态与 hooks（自动保存、远程同步）
8. 辅助 UI（模态框、工具提示等）

- [ ] **Step 2: 提取自定义节点类型到 `src/app/features/canvas/nodes/`**

在 ProjectCanvasPage.tsx 中所有 `function XxxNode(...)` 形式的自定义节点组件提取到独立文件。每种节点一个文件，并创建 `index.ts` 统一导出 `nodeTypes` 对象。

- [ ] **Step 3: 提取画布工具栏到 `CanvasToolbar.tsx`**

画布顶部/侧边的工具按钮（添加节点、撤销/重做、保存、导出等）提取为独立组件。

- [ ] **Step 4: 提取工作流中心到 `src/app/features/workflow/`**

工作流步骤列表、集数选择器、生成触发逻辑提取为独立模块。创建 `useWorkflowState.ts` hook 管理工作流状态。

- [ ] **Step 5: 提取资产面板到 `src/app/features/assets/`**

资产侧边栏（角色/道具/场景列表、上传、生成、历史）提取为独立模块。创建 `useAssetPanel.ts` hook。

- [ ] **Step 6: 提取分镜编辑到 `src/app/features/storyboard/`**

分镜片段列表、分镜详情编辑、clip 管理提取为独立模块。

- [ ] **Step 7: 提取视频生成到 `src/app/features/video/`**

视频生成参数面板、生成触发逻辑提取为独立模块。

- [ ] **Step 8: 重构 ProjectCanvasPage.tsx 为壳组件**

最终的 ProjectCanvasPage.tsx 只做：布局编排、面板切换状态、顶层 providers。预期 ~300 行。

- [ ] **Step 9: 验证**

```bash
npx tsc --noEmit
npm run build
```

确认无类型错误，构建通过。手动测试画布核心交互（拖拽、连线、添加节点）。

- [ ] **Step 10: Commit**

```bash
git add src/app/pages/ProjectCanvasPage.tsx src/app/features/ src/app/hooks/
git commit -m "refactor: split ProjectCanvasPage into feature modules (18K→~300 lines)"
```

### Task 3: 拆分 SettingsPage.tsx（1,716 行）

**Files:**
- Modify: `src/app/pages/SettingsPage.tsx` — 拆分为壳组件
- Create: `src/app/features/settings/ProfileTab.tsx`
- Create: `src/app/features/settings/TeamTab.tsx`
- Create: `src/app/features/settings/ModelConfigTab.tsx`
- Create: `src/app/features/settings/BillingTab.tsx`
- Create: `src/app/features/settings/PresetTab.tsx`

- [ ] **Step 1: 按 tab 拆分**

当前 SettingsPage 包含多个 tab（profile/team/presets/models/billing）。每个 tab 提取为独立组件。

- [ ] **Step 2: SettingsPage 变为 tab 路由壳**

SettingsPage 只做 tab 切换和布局，每个 tab 内容由独立组件渲染。

- [ ] **Step 3: 验证并提交**

```bash
npx tsc --noEmit && npm run build
git add src/app/pages/SettingsPage.tsx src/app/features/settings/
git commit -m "refactor: split SettingsPage into tab components"
```

### Task 4: 拆分 apiClient.ts（1,768 行）

**Files:**
- Modify: `src/app/lib/apiClient.ts` — 拆分为模块化 API 客户端
- Create: `src/app/lib/api/httpClient.ts` — 基础 HTTP 客户端（fetch 封装、token 管理）
- Create: `src/app/lib/api/authApi.ts` — 认证相关 API
- Create: `src/app/lib/api/projectApi.ts` — 项目 CRUD API
- Create: `src/app/lib/api/canvasApi.ts` — 画布相关 API
- Create: `src/app/lib/api/workflowApi.ts` — 工作流 API
- Create: `src/app/lib/api/generationApi.ts` — 生成记录 API
- Create: `src/app/lib/api/modelApi.ts` — 模型配置 API
- Create: `src/app/lib/api/uploadApi.ts` — 上传 API
- Create: `src/app/lib/api/index.ts` — 统一导出

- [ ] **Step 1: 提取 HTTP 基础设施**

`httpClient.ts` 包含：base URL 配置、token 管理、fetch 封装、错误处理、认证过期事件。

- [ ] **Step 2: 按业务域拆分 API 方法**

每个文件对应一个后端路由域，导出该域的所有 API 调用函数。

- [ ] **Step 3: 创建统一导出 index.ts**

保持向后兼容：`export { apiClient } from './index'`，apiClient 对象聚合所有域方法。

- [ ] **Step 4: 更新所有 import**

全局替换 `from '../lib/apiClient'` → 保持原有 import 路径可用（通过 index.ts re-export）。

- [ ] **Step 5: 验证并提交**

```bash
npx tsc --noEmit && npm run build
git add src/app/lib/
git commit -m "refactor: split apiClient into domain-specific modules"
```

---

## Phase 3: 前端性能优化

### Task 5: 路由懒加载 + Code Splitting

**Files:**
- Modify: `src/app/routes.tsx`

- [ ] **Step 1: 将页面改为 React.lazy 导入**

```tsx
import React, { Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { MainLayout } from "./layouts/MainLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LandingPage } from "./pages/LandingPage";

const AuthPage = React.lazy(() => import("./pages/AuthPage").then(m => ({ default: m.AuthPage })));
const DashboardPage = React.lazy(() => import("./pages/DashboardPage").then(m => ({ default: m.DashboardPage })));
const ProjectSetupPage = React.lazy(() => import("./pages/ProjectSetupPage").then(m => ({ default: m.ProjectSetupPage })));
const ProjectCanvasPage = React.lazy(() => import("./pages/ProjectCanvasPage").then(m => ({ default: m.ProjectCanvasPage })));
const ProjectRecordsPage = React.lazy(() => import("./pages/ProjectRecordsPage").then(m => ({ default: m.ProjectRecordsPage })));
const SettingsPage = React.lazy(() => import("./pages/SettingsPage").then(m => ({ default: m.SettingsPage })));
```

注意：如果页面使用 `export default`，则直接 `React.lazy(() => import("./pages/AuthPage"))`。
如果使用命名导出，需要上面的 `.then(m => ...)` 包装。

- [ ] **Step 2: 在 MainLayout 或路由层添加 Suspense 边界**

在 `MainLayout.tsx` 的 `<Outlet />` 外层包裹 `<Suspense fallback={<LoadingSkeleton />}>`。

- [ ] **Step 3: 验证 chunk 拆分效果**

```bash
npm run build
```

检查 `dist/assets/` 中的 chunk 文件，确认 ProjectCanvasPage 被拆为独立 chunk。

- [ ] **Step 4: Commit**

```bash
git add src/app/routes.tsx src/app/layouts/MainLayout.tsx
git commit -m "perf: add route-level code splitting with React.lazy"
```

### Task 6: 检查并移除未使用的 shadcn/ui 组件

**Files:**
- Audit: `src/app/components/ui/*.tsx`

- [ ] **Step 1: 检查每个 UI 组件的实际使用情况**

```bash
for f in src/app/components/ui/*.tsx; do
  name=$(basename "$f" .tsx)
  count=$(grep -rl "$name" src/app/ --include="*.tsx" --include="*.ts" | grep -v "components/ui/" | wc -l)
  echo "$count $name"
done | sort -n
```

- [ ] **Step 2: 删除未被引用的组件文件**

未被任何页面/组件引用的 shadcn/ui 组件直接删除。这些组件随时可以通过 `npx shadcn@latest add <component>` 重新添加。

- [ ] **Step 3: 验证并提交**

```bash
npx tsc --noEmit && npm run build
git add -A src/app/components/ui/
git commit -m "chore: remove unused shadcn/ui components"
```

---

## Phase 4: 后端巨型文件拆分

### Task 7: 拆分 workflows.ts（8,194 行）

**Files:**
- Modify: `server/src/routes/workflows.ts`
- Create: `server/src/routes/workflows/index.ts` — 路由注册
- Create: `server/src/routes/workflows/episodeWorkflow.ts` — 集数工作流
- Create: `server/src/routes/workflows/assetRoutes.ts` — 资产相关路由
- Create: `server/src/routes/workflows/storyboardRoutes.ts` — 分镜相关路由
- Create: `server/src/routes/workflows/clipRoutes.ts` — 片段相关路由
- Create: `server/src/lib/workflows/assetExtraction.ts` — 资产提取逻辑
- Create: `server/src/lib/workflows/storyboardGeneration.ts` — 分镜生成逻辑
- Create: `server/src/lib/workflows/workflowPersistence.ts` — 工作流持久化

- [ ] **Step 1: 识别功能边界**

阅读 workflows.ts，标记路由处理器和业务逻辑函数的边界。

- [ ] **Step 2: 提取业务逻辑到 lib/workflows/**

`buildAssetExtractionPrompt`、`persistWorkflowAssetsProgress`、`generateStoryboardJson`、`buildStoryboardOnlyPrompt`、`persistWorkflowRun` 等函数移到 lib 层。

- [ ] **Step 3: 将路由处理器按子域拆分**

资产路由、分镜路由、片段路由分别拆到独立文件。

- [ ] **Step 4: 创建 index.ts 聚合子路由**

```typescript
import { Router } from "express";
import { episodeWorkflowRouter } from "./episodeWorkflow";
import { assetRoutes } from "./assetRoutes";
import { storyboardRoutes } from "./storyboardRoutes";
import { clipRoutes } from "./clipRoutes";

export function createWorkflowsRouter() {
  const router = Router();
  router.use("/", episodeWorkflowRouter);
  router.use("/", assetRoutes);
  router.use("/", storyboardRoutes);
  router.use("/", clipRoutes);
  return router;
}
```

- [ ] **Step 5: 验证并提交**

```bash
npm run server:check
npx tsc --noEmit
git add server/src/routes/workflows/ server/src/lib/workflows/
git commit -m "refactor: split workflows route into sub-modules (8K→~500 lines each)"
```

### Task 8: 拆分 agent.ts（3,304 行）和 dreaminaWebBridge.ts（3,356 行）

**Files:**
- Modify: `server/src/routes/agent.ts` — 拆分路由与业务逻辑
- Modify: `server/src/ai/dreaminaWebBridge.ts` — 拆分为更小的模块
- Create: 视具体代码结构决定

- [ ] **Step 1: 分析 agent.ts 结构**

识别路由处理器 vs Hermes agent 通信逻辑 vs 消息处理逻辑。

- [ ] **Step 2: 分析 dreaminaWebBridge.ts 结构**

识别 web bridge 协议、会话管理、请求/响应映射的边界。

- [ ] **Step 3: 按职责拆分**

agent.ts: 路由 → lib/agentService.ts（业务逻辑）
dreaminaWebBridge.ts: 协议层 → 会话管理 → 请求适配

- [ ] **Step 4: 验证并提交**

```bash
npm run server:check
git add server/src/routes/agent.ts server/src/ai/
git commit -m "refactor: split agent route and dreamina bridge into focused modules"
```

---

## Phase 5: 开发基础设施

### Task 9: 创建 CLAUDE.md

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: 编写 CLAUDE.md**

基于已有的 CODEX_HANDOFF.md 和项目分析，编写开发规范文档，包含：
- 项目目标与技术栈
- 目录结构说明
- 开发命令
- 代码规范（文件大小限制、命名约定）
- 架构约束（层间依赖规则）
- 提交规范

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md development guidelines"
```

### Task 10: 添加前端错误边界

**Files:**
- Create: `src/app/components/ErrorBoundary.tsx`
- Modify: `src/app/App.tsx` 或 `src/app/layouts/MainLayout.tsx`

- [ ] **Step 1: 创建 ErrorBoundary 组件**

```tsx
import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center space-y-4">
            <h2 className="text-xl font-semibold">出了点问题</h2>
            <p className="text-muted-foreground">{this.state.error?.message}</p>
            <button
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              重试
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 2: 包裹 MainLayout 的 Outlet**

在 `MainLayout.tsx` 中用 `<ErrorBoundary>` 包裹 `<Outlet />`。

- [ ] **Step 3: 验证并提交**

```bash
npx tsc --noEmit && npm run build
git add src/app/components/ErrorBoundary.tsx src/app/layouts/MainLayout.tsx
git commit -m "feat: add ErrorBoundary for graceful error handling"
```

---

## 执行优先级

```
Phase 1（立即）: Task 1 — 修正文档
Phase 2（核心）: Task 2 → Task 3 → Task 4 — 前端巨型文件拆分
Phase 3（性能）: Task 5 → Task 6 — 路由懒加载 + 清理未用组件
Phase 4（后端）: Task 7 → Task 8 — 后端文件拆分
Phase 5（基础设施）: Task 9 → Task 10 — CLAUDE.md + 错误边界
```

Task 2（拆分 ProjectCanvasPage.tsx）是整个计划最大最重要的一步，预计需要多个子任务分步完成。建议先通读该文件全貌、标记功能边界后再动手拆分。

---

## 不在本次范围

以下内容重要但建议作为后续独立项目：

- **CI/CD 管线搭建**（GitHub Actions）
- **前端单元测试**（Vitest + React Testing Library）
- **E2E 测试**（Playwright）
- **工作流状态从 JSON blob 迁移到关系表**
- **国际化（i18n）**
- **支付系统集成**
- **性能监控（Web Vitals）**
