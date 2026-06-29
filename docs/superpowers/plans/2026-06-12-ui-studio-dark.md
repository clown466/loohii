# 制片厂深黑 UI + 按钮重组 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将鹿绘AI的视觉风格从紫色暗色主题切换为制片厂深黑+桔黄唯一强调色，同时重组流程中心按钮体系（一个「全流程推理」主按钮 + 高级下拉）。

**Architecture:** 色板全走 CSS 变量（`src/styles/theme.css`），改一个文件全站换肤。按钮/Badge 组件已通过 `bg-primary` 等 token 引用变量。86 处 `indigo`/`#6366f1` 内联样式需逐文件替换。按钮重组集中在 `WorkflowCenterOverlay.tsx`、`StageWorkPanel.tsx`、`ClipVideoPromptList.tsx`，新增全流程推理 handler 在 `ProjectCanvasPage.tsx`。

**Tech Stack:** React 18, Tailwind CSS v4（@theme inline + CSS 变量），shadcn/ui (cva)

**仓库铁律：**
- **禁止 git add / git commit**——工作区有多项未提交改动。
- 前端文件有他人在途重构改动：只做最小、目标明确的修改。
- 改完跑 `npm run build` 确认通过。

---

## 文件结构

| 文件 | 职责 | 改动 |
|------|------|------|
| `src/styles/theme.css` | 全站色板 CSS 变量 | 修改（换色） |
| `src/app/App.tsx` | 根组件硬编码色 | 修改（去硬编码） |
| `src/app/components/ui/button.tsx` | 按钮变体 | 不动（已走 token） |
| `src/app/components/ui/badge.tsx` | Badge 变体 | 不动（已走 token） |
| `src/app/features/canvas/nodes/*.tsx` | 画布节点 indigo 内联色 | 修改（6 个文件，替换 indigo→primary token） |
| `src/app/features/canvas/components/WorkflowCenterOverlay.tsx` | 流程中心浮层 | 修改（按钮重组） |
| `src/app/features/canvas/components/StageWorkPanel.tsx` | 阶段面板 | 修改（按钮移入下拉） |
| `src/app/features/canvas/components/ClipVideoPromptList.tsx` | 单 Clip 视频提示词卡 | 修改（按钮改名） |
| `src/app/features/canvas/components/ClipStoryboardList.tsx` | 单 Clip 故事板卡 | 修改（按钮改名） |
| `src/app/pages/ProjectCanvasPage.tsx` | 画布主页 | 修改（新增全流程推理 handler） |
| `src/app/layouts/MainLayout.tsx` | 侧边栏 | 修改（选中态换桔黄左边框） |

---

### Task 1: 色板换肤（theme.css）

**Files:**
- Modify: `src/styles/theme.css`

- [ ] **Step 1: 替换 CSS 变量**

将 `:root` 中以下变量的值更新：

```css
:root {
  --background: #0D0D0F;
  --foreground: #E8E8EC;
  --card: #1A1A1E;
  --card-foreground: #E8E8EC;
  --popover: #1A1A1E;
  --popover-foreground: #E8E8EC;
  --primary: #F5A623;
  --primary-foreground: #0D0D0F;
  --secondary: #1A1A1E;
  --secondary-foreground: #E8E8EC;
  --muted: #1A1A1E;
  --muted-foreground: #8A8A8E;
  --accent: #2A2A2E;
  --accent-foreground: #E8E8EC;
  --border: #2A2A2E;
  --input: #1A1A1E;
  --ring: #F5A623;
  --radius: 0.25rem;

  --sidebar: #0D0D0F;
  --sidebar-foreground: #E8E8EC;
  --sidebar-primary: #F5A623;
  --sidebar-primary-foreground: #0D0D0F;
  --sidebar-accent: #1A1A1E;
  --sidebar-accent-foreground: #E8E8EC;
  --sidebar-border: #1A1A1E;
  --sidebar-ring: #F5A623;

  --color-layer-0: #0D0D0F;
  --color-layer-1: #111114;
  --color-layer-2: #151518;
  --color-layer-3: #1A1A1E;
  --color-layer-4: #1F1F23;
  --color-layer-hover: #2A2A2E;

  --color-border-weak: #1F1F23;
  --color-border-card: #2A2A2E;
  --color-border-focus: #F5A623;

  --color-brand-from: #F5A623;
  --color-brand-to: #D4890A;

  --color-status-success: #22C55E;
  --color-status-warning: #EAB308;
  --color-status-error: #EF4444;
  --color-status-waiting: #71717A;
}
```

注意 `--radius` 从 `0.5rem` 改为 `0.25rem`（border-radius 4px，制片厂风格收紧）。

- [ ] **Step 2: 验证构建**

Run: `cd /projects/loohii && npm run build`
Expected: 构建成功。全站颜色已切换（按钮/Badge/侧边栏/输入框等已经走 `bg-primary`/`text-primary-foreground`/`ring` 等 token，无需逐个改）。

---

### Task 2: 根组件与侧边栏去硬编码

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/layouts/MainLayout.tsx`

- [ ] **Step 1: App.tsx 根 div**

当前 `App.tsx:7` 有 `bg-[#09090b] text-[#fafafa] selection:bg-[#6366f1]/30`，替换为：

```tsx
<div className="h-full w-full bg-background text-foreground selection:bg-primary/30">
```

- [ ] **Step 2: MainLayout.tsx 侧边栏选中态**

读 `src/app/layouts/MainLayout.tsx`，找到侧边栏菜单项的选中态样式。当前应该是 `data-[active=true]` 或类似激活 class。把选中态改为「左边框桔黄 2px + 文字白色」：

找到菜单项循环渲染的位置（grep `NavLink` 或 `SidebarMenuButton` 或 `isActive`），给选中项加 `border-l-2 border-primary` 样式，移除旧的背景高亮。如果选中态完全由 `sidebar.tsx` 组件的 `data-[active=true]` 控制，则在 MainLayout 层用 `className` override：

```tsx
className={({ isActive }) =>
  cn('border-l-2 border-transparent', isActive && 'border-primary text-foreground')
}
```

具体写法以实际代码为准——先通读文件再改。

- [ ] **Step 3: 验证**

Run: `npm run build`
Expected: 构建通过。

---

### Task 3: 画布节点 indigo 内联色替换

**Files:**
- Modify: `src/app/features/canvas/nodes/CharacterNode.tsx`
- Modify: `src/app/features/canvas/nodes/VideoNode.tsx`
- Modify: `src/app/features/canvas/nodes/GenerationNode.tsx`
- Modify: `src/app/features/canvas/nodes/ImageInputNode.tsx`
- Modify: `src/app/features/canvas/nodes/PromptOptimizerNode.tsx`
- Modify: `src/app/features/canvas/nodes/PromptInspectorNode.tsx`
- Modify: `src/app/features/canvas/nodes/TranslationNode.tsx`

- [ ] **Step 1: 批量替换 indigo 内联样式**

对上述 7 个节点组件文件做以下替换（每个文件都查找并替换全部出现）：

| 旧 | 新 | 说明 |
|---|---|---|
| `bg-indigo-600` | `bg-primary` | 按钮背景 |
| `bg-indigo-500` | `bg-primary/90` | 按钮 hover |
| `hover:bg-indigo-500` | `hover:bg-primary/90` | hover 态 |
| `bg-indigo-500/20` | `bg-primary/20` | 半透明背景 |
| `border-indigo-500` | `border-primary` | 边框 |
| `focus:border-indigo-500` | `focus:border-primary` | 焦点边框 |
| `text-indigo-400` | `text-primary` | 文字色 |
| `text-indigo-300` | `text-primary` | 文字色 |
| `ring-indigo-500` | `ring-primary` | 焦点环 |

同时在每个文件里搜索 `#6366f1`、`#818cf8`、`#4f46e5` 等 indigo 系硬编码 hex，替换为：
- 背景用途 → `bg-primary`
- 文字用途 → `text-primary`
- 边框用途 → `border-primary`

如果某处写的是 `style={{ ... }}` 内联对象里的颜色（如 `background: '#6366f1'`），改为 `background: 'var(--primary)'`。

- [ ] **Step 2: 扫描遗漏**

Run: `grep -rn "indigo\|#6366f1\|#818cf8\|#4f46e5" src/app/features/canvas/nodes/ --include="*.tsx"`
Expected: 零命中。

- [ ] **Step 3: 验证**

Run: `npm run build`
Expected: 构建通过。

---

### Task 4: 其余组件 indigo/purple 清扫

**Files:**
- Modify: 散布在 `src/app/` 下约 20-30 个文件

- [ ] **Step 1: 全量扫描并替换**

先跑 `grep -rn "indigo\|#6366f1\|#818cf8\|#4f46e5\|violet\|purple" src/app --include="*.tsx" --include="*.ts"` 拿到完整清单，然后逐文件按 Task 3 相同的映射规则替换。同时把 `bg-[#09090b]` → `bg-background`、`text-[#fafafa]` → `text-foreground`、`bg-[#18181b]` → `bg-card`、`bg-[#27272a]` → `bg-accent`、`border-[#27272a]` → `border-border` 等常见硬编码色替换为 token。

不需要 100% 替换所有 641 处——优先替换：
1. 所有 `indigo`/`violet`/`purple`（紫色必须清零）
2. `#6366f1` / `#818cf8`（旧 primary/brand，必须清零）
3. 常见的 `#09090b`/`#fafafa`/`#18181b`/`#27272a`（能替换多少替换多少，不影响功能的前提下）

- [ ] **Step 2: 验证紫色清零**

Run: `grep -rn "indigo\|violet\|purple\|#6366f1\|#818cf8" src/app --include="*.tsx" --include="*.ts" | grep -v node_modules | wc -l`
Expected: 0（或极少数在注释/字符串常量里的例外）。

Run: `npm run build`
Expected: 构建通过。

---

### Task 5: 全流程推理 Handler + 按钮重组

**Files:**
- Modify: `src/app/pages/ProjectCanvasPage.tsx` — 新增 `handleFullPipelineInfer`
- Modify: `src/app/features/canvas/components/WorkflowCenterOverlay.tsx` — 按钮重组
- Modify: `src/app/features/canvas/components/StageWorkPanel.tsx` — 按钮移入下拉
- Modify: `src/app/features/canvas/components/ClipVideoPromptList.tsx` — 按钮改名
- Modify: `src/app/features/canvas/components/ClipStoryboardList.tsx` — 按钮改名

这是最核心也最敏感的任务。**先通读以下函数理解现有流程，再改：**
- `ProjectCanvasPage.tsx` 的 `handleInferBoardsAndVideoToCanvas`（~2632 行）——这是现有的「一键推理并放入画布」handler，循环调用 storyboard-plan → seedance-prompt → save。
- `ProjectCanvasPage.tsx` 的 `handleSyncEpisodeBoardsToCanvas`——「同步本集到画布」handler。
- `WorkflowCenterOverlay.tsx` 的按钮布局。
- `StageWorkPanel.tsx` 的阶段面板按钮。

- [ ] **Step 1: 新增全流程推理 handler（ProjectCanvasPage.tsx）**

在 `handleInferBoardsAndVideoToCanvas` 附近新增 `handleFullPipelineInfer`。逻辑与 `handleInferBoardsAndVideoToCanvas` 基本相同，但 **Step 1 替换为分镜重拆解**（调用 `apiClient.runProjectWorkflowBreakdown` 或等价的分镜重跑 API——先 grep `重新拆解` 在 StageWorkPanel.tsx 里绑定的 handler 和调用的 API 方法，找到它的名字和参数签名，然后在新 handler 里先调这个 API、拿到新的 breakdownScenes 和 clips，再逐 Clip 走 storyboard-plan → seedance-prompt → save）。

关键：
- 分镜拆解 API 是全集级的（不是逐 Clip），调一次就够；
- 拆完后用返回的新 clips 列表逐个跑 storyboard-plan + seedance-prompt；
- 逐 Clip try/catch，某个失败不中断；
- 全部完成后调 `handleSyncEpisodeBoardsToCanvas` 同步画布；
- 运行时 disable 所有其他推理按钮（用现有的 `workflowInferAllRunning` flag）；
- 进度文字：`'分镜重拆解中...' → 'Clip 3/5 · 故事板推理中...' → 'Clip 3/5 · 视频提示词推理中...' → '同步到画布...'`。

同时把 `handleFullPipelineInfer` 通过 props 传到 `WorkflowCenterOverlay` 和 `StageWorkPanel`（找到现有 props 传递模式，加一个 `onFullPipelineInfer`）。

- [ ] **Step 2: WorkflowCenterOverlay 按钮重组**

读 `WorkflowCenterOverlay.tsx`（~600 行），找到主按钮区域。改为：

**主按钮区（醒目位置）：**
```tsx
<Button onClick={onFullPipelineInfer} disabled={workflowBusy} className="...">
  {workflowBusy ? progressText : '全流程推理'}
</Button>
<Button variant="ghost" onClick={onSyncToCanvas} disabled={workflowBusy}>
  同步到画布
</Button>
```

**高级下拉（用 shadcn DropdownMenu）：**
```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="outline" size="sm" disabled={workflowBusy}>更多操作 ▾</Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem onClick={onRerunBreakdown}>重跑分镜脚本</DropdownMenuItem>
    <DropdownMenuItem onClick={onInferBoardsAndVideo}>只推理故事板+视频</DropdownMenuItem>
    <DropdownMenuItem onClick={onBatchRefinePrompts}>批量润色提示词</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

删掉原来的「一键推理并放入画布」和「推理故事板+视频并放入画布」按钮（它们已被「全流程推理」和「更多操作」里的选项替代）。

注意：如果 `DropdownMenu` 组件未在此文件使用过，需从 `@/components/ui/dropdown-menu` 导入。先检查该组件是否存在：`ls src/app/components/ui/dropdown-menu.tsx`。如果不存在，用 `<select>` 或 shadcn 的 `Popover` 替代。

- [ ] **Step 3: StageWorkPanel 按钮移入下拉**

分镜视频阶段面板里的「重新拆解」按钮改为在 WorkflowCenterOverlay 的高级下拉里已覆盖，但阶段面板本身保留一个入口供高级用户快速访问。如果面板里按钮过多（>3 个），把低频操作（如批量操作）折叠到下拉。

- [ ] **Step 4: ClipVideoPromptList 和 ClipStoryboardList 改名**

- `ClipVideoPromptList.tsx`：「重新推理视频提示词」改名「润色」（或「润色提示词」，短一些）。
- `ClipStoryboardList.tsx`：确认按钮文案无混淆项。

- [ ] **Step 5: 验证**

Run: `npm run build`
Expected: 构建通过。

手动检查清单（在浏览器里）：
1. 流程中心只剩一个醒目的「全流程推理」主按钮 + 「同步到画布」次要按钮 + 「更多操作」下拉
2. 点「全流程推理」后进度文字实时更新，其余按钮 disabled
3. 单 Clip 卡片上「推理」和「润色」按钮清晰可分
4. 高级下拉里的三个单步操作可正常触发

---

### Task 6: 全量验证 + 部署

- [ ] **Step 1: 全量构建与测试**

```bash
npm run build                                               # 前端构建
npm run server:check                                        # 后端类型检查
npx tsx --test server/src/routes/workflows.test.ts          # 不回归
npx tsx --test server/src/lib/clipDialogueAllocator.test.ts # 不回归
npx tsx --test server/src/lib/canvasAssetImageSync.test.ts  # 不回归
```

- [ ] **Step 2: 紫色残留终审**

```bash
grep -rn "indigo\|violet\|purple\|#6366f1\|#818cf8" src/ --include="*.tsx" --include="*.ts" --include="*.css" | grep -v node_modules | grep -v '.test.' | wc -l
```

Expected: 0（注释/字符串里的不算）。

- [ ] **Step 3: 重建镜像换容器**

```bash
docker tag loohii-app:latest loohii-app:rollback-$(date +%Y%m%d-%H%M)
docker build -f Dockerfile.loohii -t loohii-app:latest .
docker inspect loohii-app --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -vE '^(PATH|NODE_VERSION|YARN_VERSION|NODE_ENV|PORT)=' > /tmp/loohii-runtime.env
docker stop loohii-app && docker rm loohii-app
docker run -d --name loohii-app --network loohii_default --network-alias app -p 3001:3001 --env-file /tmp/loohii-runtime.env --restart unless-stopped loohii-app:latest
rm -f /tmp/loohii-runtime.env
docker exec loohii-app sh -c "wget -qO- http://localhost:3001/api/health"
curl -fsS -m 10 https://www.loohii.com/api/health
```

- [ ] **Step 4: 浏览器逐页验收**

强刷浏览器（Ctrl+Shift+R），检查：
1. 全站桔黄强调色，无紫色残留
2. 侧边栏选中项为桔黄左边框
3. 按钮分两层：主按钮「全流程推理」+ 高级下拉
4. 画布节点颜色一致（无 indigo 蓝紫色按钮）
5. 无明显对比度/可读性回归

---

## Self-Review

- §1 色板→Task 1；§2 按钮→Task 5；§3 实施→Task 1-6；§4 验收→Task 6 Step 4
- 无 TBD/TODO
- 类型一致性：`onFullPipelineInfer` 在 Task 5 Step 1 定义、Step 2 使用
- 色值一致：theme.css 改的 `#F5A623`/`#0D0D0F` 等与设计文档一致
- Task 5 依赖 Task 1-4（色先换好再改按钮，避免按钮 UI 在旧紫色下开发）
