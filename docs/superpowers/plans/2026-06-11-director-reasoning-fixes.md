# 导演推理逻辑修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复导演板推理链路中的 6 个已知问题：fallback prompt 缺失资产权威、画板比例硬编码 16:9、并发写入竞态、团队检测中文覆盖不足、对白去重索引错位、无资产角色静默丢弃。

**Architecture:** 所有修改集中在两个文件：`server/src/routes/workflows.ts`（核心推理逻辑）和 `server/src/lib/storyboardPrompt.ts`（prompt 模板）。**执行顺序有依赖：Task 1 必须先于 Task 2（两者都修改 `normalizeClipStoryboardPlan` 和 `buildFallbackClipStoryboardPrompt` 签名）。** Task 3-6 相互独立，可在 Task 2 之后并行。测试使用 Node.js 内置 `node:test` + `assert/strict`，运行命令 `npx tsx --test <file>`。

**重要提示：**
- `server/src/routes/workflows.test.ts` **已存在**，包含 Dreamina 相关测试，使用 `workflowsTestInternals` 模式。**不要覆盖**，只追加测试。
- `Prisma` type 已在 workflows.ts 顶部通过 `import type { Prisma } from "@prisma/client"` 导入（line 7）。
- `workflowsTestInternals` 对象在 workflows.ts line 8186 导出内部函数供测试使用。

**Tech Stack:** TypeScript, Express 5, Prisma ORM, PostgreSQL, node:test

---

## 文件结构

| 文件 | 职责 | 改动类型 |
|------|------|----------|
| `server/src/routes/workflows.ts` | 导演推理路由、fallback prompt、并发锁、团队检测、对白去重 | 修改 |
| `server/src/lib/storyboardPrompt.ts` | 导演板 prompt 模板、比例参数化 | 修改 |
| `server/src/lib/storyboardPrompt.test.ts` | 已有测试文件，新增比例参数化测试 | 修改 |
| `server/src/routes/workflows.test.ts` | **已存在**（Dreamina 测试），追加团队检测、对白去重测试 | 修改 |
| `server/src/routes/workflowPatterns.ts` | 新建：提取的团队场景正则常量 | 新建 |

---

## Task 1: 画板比例参数化（P0 — 停止硬编码 16:9）

当前导演板 prompt 始终写 "one 16:9 compact multi-panel comic page"，不管项目实际比例是什么。9:16 竖屏项目的导演板构图方向完全错误。

**Files:**
- Modify: `server/src/lib/storyboardPrompt.ts:11-23` — `clipStoryboardBoardLayoutStrategy()` 加 `aspectRatio` 参数
- Modify: `server/src/lib/storyboardPrompt.ts:25-33` — `ensureClipStoryboardBoardLayoutPrompt()` 传递比例
- Modify: `server/src/lib/storyboardPrompt.ts:35-58` — `finalizeClipStoryboardImagePrompt()` 传递比例
- Modify: `server/src/lib/storyboardPrompt.ts:60-65` — `stripComicStoryboardLayoutPrompt()` regex 兼容新比例
- Modify: `server/src/lib/storyboardPrompt.ts:67-71` — `hasCompleteClipStoryboardBoardLayoutPrompt()` regex 兼容新比例
- Modify: `server/src/lib/storyboardPrompt.test.ts` — 新增比例参数化测试
- Modify: `server/src/routes/workflows.ts:3484` — `buildClipStoryboardPlanPrompt()` 使用项目比例
- Modify: `server/src/routes/workflows.ts:4293-4294` — `buildFallbackClipStoryboardPrompt()` 使用项目比例

- [ ] **Step 1: 写失败测试**

在 `server/src/lib/storyboardPrompt.test.ts` 末尾追加：

```typescript
test("clipStoryboardBoardLayoutStrategy uses provided aspect ratio", () => {
  const landscape = clipStoryboardBoardLayoutStrategy(6, "16:9");
  assert.match(landscape, /one 16:9 compact multi-panel comic page/i);

  const portrait = clipStoryboardBoardLayoutStrategy(6, "9:16");
  assert.match(portrait, /one 9:16 compact multi-panel comic page/i);

  const square = clipStoryboardBoardLayoutStrategy(6, "1:1");
  assert.match(square, /one 1:1 compact multi-panel comic page/i);
});

test("clipStoryboardBoardLayoutStrategy defaults to 16:9 without aspect ratio", () => {
  const result = clipStoryboardBoardLayoutStrategy(6);
  assert.match(result, /one 16:9 compact multi-panel comic page/i);
});

test("ensureClipStoryboardBoardLayoutPrompt passes aspect ratio through", () => {
  const prompt = "Panel 1: show action; Panel 2: reaction.";
  const result = ensureClipStoryboardBoardLayoutPrompt(prompt, 6, "9:16");
  assert.match(result, /one 9:16 compact multi-panel comic page/i);
});

test("finalizeClipStoryboardImagePrompt passes aspect ratio through", () => {
  const prompt = "Panel 1: show action; Panel 2: reaction.";
  const result = finalizeClipStoryboardImagePrompt(prompt, 6, "9:16");
  assert.match(result, /one 9:16 compact multi-panel comic page/i);
});
```

需要在测试文件顶部 import 中补充 `clipStoryboardBoardLayoutStrategy`（当前未 import）。

- [ ] **Step 2: 运行测试确认失败**

```bash
npx tsx --test server/src/lib/storyboardPrompt.test.ts
```

Expected: 4 个新测试 FAIL，因为 `clipStoryboardBoardLayoutStrategy` 签名不接受 `aspectRatio` 参数。

- [ ] **Step 3: 修改 `storyboardPrompt.ts` — 参数化比例**

修改 `clipStoryboardBoardLayoutStrategy`（line 11）：

```typescript
export function clipStoryboardBoardLayoutStrategy(panelCount?: number, aspectRatio = "16:9"): string {
  const panelText = panelCount ? `${panelCount} sequential panels` : "the selected number of sequential panels";
  const isPortrait = /^(\d+):(\d+)$/.test(aspectRatio) && (() => {
    const [w, h] = aspectRatio.split(":").map(Number);
    return h > w;
  })();
  const frameGuidance = isPortrait
    ? "Use a full-page comic grid with thin black gutters. Since the target is portrait/vertical video, frames should feel natural for tall aspect ratios."
    : "Use a full-page comic grid with thin black gutters and vertical-video-friendly frames: most panels should be tighter and taller-feeling rather than very wide.";
  return [
    `Storyboard layout: one ${aspectRatio} compact multi-panel comic page using ${panelText} in left-to-right, top-to-bottom reading order.`,
    frameGuidance,
    "Favor medium close-ups, close-ups, reaction close-ups, over-shoulders, hand/prop inserts, and expression inserts; use wide/group panels sparingly for orientation only.",
    "Each panel should contain only the characters needed for that panel beat; do not duplicate the same character multiple times inside one panel.",
    "Place a small readable panel number label such as P1, P2, P3 in a corner of each panel.",
    "Show spoken dialogue as clean white comic speech bubbles inside the relevant panels.",
    "Place each exact dialogue line in one speech bubble on the most relevant panel only; continuation and reaction panels for that same beat use no speech bubble unless they contain a different exact dialogue line.",
    "Visible text stays to panel labels and speech bubbles.",
  ].join(" ");
}
```

修改 `ensureClipStoryboardBoardLayoutPrompt`（line 25）：

```typescript
export function ensureClipStoryboardBoardLayoutPrompt(prompt: unknown, panelCount?: number, aspectRatio?: string): string {
  const text = stripLegacyClipStoryboardImageLayoutPrompt(stringValue(prompt));
  if (!text) return text;
  if (hasCompleteClipStoryboardBoardLayoutPrompt(text)) return text;
  return normalizeStoryboardPromptSpacing([
    clipStoryboardBoardLayoutStrategy(panelCount ?? detectStoryboardPanelCount(text), aspectRatio),
    text,
  ].filter(Boolean).join("\n\n"));
}
```

修改 `finalizeClipStoryboardImagePrompt`（line 35）：

```typescript
export function finalizeClipStoryboardImagePrompt(prompt: unknown, panelCount?: number, aspectRatio?: string): string {
  const text = ensureClipStoryboardBoardLayoutPrompt(stripComicStoryboardLayoutPrompt(prompt), panelCount, aspectRatio);
  // ... rest unchanged ...
}
```

修改 `stripComicStoryboardLayoutPrompt`（line 60）— 将 regex 中硬编码的 `16:9` 改为通配：

```typescript
function stripComicStoryboardLayoutPrompt(prompt: unknown): string {
  return stringValue(prompt)
    .replace(/Storyboard layout:\s*one \d+:\d+ (?:compact\s*)?multi-panel comic page[\s\S]*?(?:Visible text stays to panel labels and speech bubbles\.|Use only panel numbers and intentional speech bubbles as visible text; camera, lens, movement, and shot metadata belong to the video prompt, not the image\.)\s*/gi, "")
    .replace(/Storyboard layout:\s*one \d+:\d+ multi-panel comic page[\s\S]*?Place a small readable panel number label such as P1, P2, P3 in a corner of\s*(?=(?:Required continuity characters|Use linked|Create|Comic panels in reading order|Panel\s+\d+:|Character reference|Dialogue lock|$))/gi, "")
    .replace(/\b(?:each|the selected number of large sequential panels in left-to-right, top-to-bottom reading order\. Use a full-page comic grid with thin black gutters and large cinematic 3D American comic frames\. Place a small readable panel number label such as P1, P2, P3 in a corner of each)\s+panel\. Show spoken dialogue as clean white comic speech bubbles inside the relevant panels\. Visible text stays to panel labels and speech bubbles\./gi, " ");
}
```

修改 `hasCompleteClipStoryboardBoardLayoutPrompt`（line 67）：

```typescript
function hasCompleteClipStoryboardBoardLayoutPrompt(prompt: string): boolean {
  return /Storyboard layout:\s*one \d+:\d+ compact multi-panel comic page/i.test(prompt) &&
    /vertical-video-friendly frames|frames should feel natural for tall aspect ratios/i.test(prompt) &&
    /Show spoken dialogue as clean white comic speech bubbles/i.test(prompt);
}
```

**注意**：这里不能用 `/frames/i` — 太宽松，"key frames"、"animation frames" 等无关文本会误匹配，导致跳过布局块注入。必须精确匹配 landscape 和 portrait 两种变体。

- [ ] **Step 4: 运行测试确认通过**

```bash
npx tsx --test server/src/lib/storyboardPrompt.test.ts
```

Expected: 全部 PASS，包括旧测试（旧测试不传 aspectRatio，走默认 "16:9"）。

- [ ] **Step 5: 修改 `workflows.ts` — 传入项目比例**

在 `buildClipStoryboardPlanPrompt()`（line 3484-3486）中，有两处需要修改：

```typescript
// line 3484: 改 "- Ask for one 16:9 multi-panel comic storyboard image." 为：
`- Ask for one ${project.aspectRatio || "16:9"} multi-panel comic storyboard image.`,
```

```typescript
// line 3486: clipStoryboardBoardLayoutStrategy() 也需要传入比例，否则仍生成 "16:9" 布局规则：
`- ${clipStoryboardBoardLayoutStrategy(undefined, project.aspectRatio || "16:9")}`,
```

**注意**：line 3486 是 Codex 审查发现的遗漏——原计划只改了 line 3484 的文字，但 line 3486 的 `clipStoryboardBoardLayoutStrategy()` 调用也会生成包含比例的布局指令，不改的话 9:16 项目会同时出现两个矛盾的比例描述。

在 `buildFallbackClipStoryboardPrompt()`（line 4293-4294）中：

签名加 `aspectRatio` 参数：

```typescript
function buildFallbackClipStoryboardPrompt(clip: NormalizedWorkflowClip, shots: NormalizedStoryboardShot[], panelCount: number, aspectRatio = "16:9"): string {
```

line 4294：
```typescript
    `Create one ${aspectRatio} multi-panel 3D American comic storyboard image with ${panelCount} large panels.`,
```

line 4296：
```typescript
    clipStoryboardBoardLayoutStrategy(panelCount, aspectRatio),
```

line 4318 的 `finalizeClipStoryboardImagePrompt` 调用加第三个参数：
```typescript
    .join("\n"), panelCount, aspectRatio);
```

同时更新 `normalizeClipStoryboardPlan` 内的所有相关调用：
- 3 处 `buildFallbackClipStoryboardPrompt` 调用（line 4181, 4186, 4189），传入 `aspectRatio`
- 1 处 `finalizeClipStoryboardImagePrompt` 调用（line 4189），传入 `aspectRatio` 作为第三个参数

**line 4189 必须两处都改**：
```typescript
// 原：
prompt: finalizeClipStoryboardImagePrompt(usablePrompt || buildFallbackClipStoryboardPrompt(clip, shots, panelCount), panelCount),
// 改为：
prompt: finalizeClipStoryboardImagePrompt(usablePrompt || buildFallbackClipStoryboardPrompt(clip, shots, panelCount, aspectRatio), panelCount, aspectRatio),
```

虽然路由层 line 1804 的外层 `finalizeClipStoryboardImagePrompt` 也会 strip+rebuild layout 块（所以内层漏传不会导致最终结果错误），但为了 correctness-by-construction，应该在内层也传。

`normalizeClipStoryboardPlan` 也需要加 `aspectRatio` 参数。

在 `storyboard-plan` 路由（line 1803-1807）中传入 project.aspectRatio：

```typescript
    const plan = normalizeClipStoryboardPlan(structured, clip, targetShots, input, project.aspectRatio);
    const prompt = finalizeClipStoryboardImagePrompt(enforceClipStoryboardDialoguePrompt(
      enforceClipStoryboardContinuityPrompt(plan.prompt, continuity),
      targetShots,
    ), plan.panelCount, project.aspectRatio);
```

- [ ] **Step 6: 类型检查**

```bash
npm run server:check
```

Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
git add server/src/lib/storyboardPrompt.ts server/src/lib/storyboardPrompt.test.ts server/src/routes/workflows.ts
git commit -m "fix: parameterize storyboard aspect ratio instead of hardcoding 16:9"
```

---

## Task 2: Fallback prompt 注入资产权威上下文（P0）

当 LLM 返回的推理结果无法解析（提取不到 panel beat）时，`buildFallbackClipStoryboardPrompt()` 会被调用。当前这个函数不查询资产元数据，所以上传参考图反推出的 `lockedVisualIdentity`、`referencePolicy` 等角色约束全部丢失。

**Files:**
- Modify: `server/src/routes/workflows.ts:4161-4191` — `normalizeClipStoryboardPlan()` 传入 authority
- Modify: `server/src/routes/workflows.ts:4278-4319` — `buildFallbackClipStoryboardPrompt()` 加 authority 参数

- [ ] **Step 1: 修改 `normalizeClipStoryboardPlan()` 签名**

在 `normalizeClipStoryboardPlan()`（line 4161）添加 `authority` 和 `workflow` 参数：

```typescript
function normalizeClipStoryboardPlan(
  value: unknown,
  clip: NormalizedWorkflowClip,
  shots: NormalizedStoryboardShot[],
  input: z.infer<typeof clipStoryboardPlanSchema>,
  aspectRatio = "16:9",
  workflow?: ReturnType<typeof getWorkflowState>,
  authority?: WorkflowAuthorityContext,
): { panelCount: number; prompt: string; notes: string } {
```

在函数体中，所有调用 `buildFallbackClipStoryboardPrompt` 的地方（3 处）都传入新参数：

```typescript
buildFallbackClipStoryboardPrompt(clip, shots, panelCount, aspectRatio, workflow, authority),
```

- [ ] **Step 2: 修改 `buildFallbackClipStoryboardPrompt()` — 注入资产上下文**

签名改为：

```typescript
function buildFallbackClipStoryboardPrompt(
  clip: NormalizedWorkflowClip,
  shots: NormalizedStoryboardShot[],
  panelCount: number,
  aspectRatio = "16:9",
  workflow?: ReturnType<typeof getWorkflowState>,
  authority?: WorkflowAuthorityContext,
): string {
```

在 `return finalizeClipStoryboardImagePrompt([...` 数组中，在 `"Story beats to show across the comic panels:"` 之前插入资产上下文：

```typescript
    workflow?.assets ? `Current extracted assets:\n${summarizeAssetsForStoryboardPrompt(workflow.assets)}` : "",
    authority?.existingCharacters?.length ? `Existing Character records:\n${summarizeAuthorityCharactersForStoryboard(authority.existingCharacters)}` : "",
    authority?.characterIdentityRules ? `Character identity rules: ${authority.characterIdentityRules}` : "",
    authority?.globalPrompt ? `Global prompt: ${authority.globalPrompt}` : "",
    authority?.negativePrompt ? `Negative prompt: ${authority.negativePrompt}` : "",
```

- [ ] **Step 3: 更新路由中的调用点**

在 `storyboard-plan` 路由（line 1803）中，把 `currentWorkflow` 和 `authority` 传给 `normalizeClipStoryboardPlan`：

```typescript
    const plan = normalizeClipStoryboardPlan(structured, clip, targetShots, input, project.aspectRatio, currentWorkflow, authority);
```

- [ ] **Step 4: 类型检查**

```bash
npm run server:check
```

Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/workflows.ts
git commit -m "fix: inject asset authority into fallback storyboard prompt"
```

---

## Task 3: 并发推理写入加乐观锁（P0）

当前 `storyboard-plan` 路由在推理完成后直接 `prisma.project.update()`，并发请求会互相覆盖 metadata。改用 Prisma 事务 + `SELECT ... FOR UPDATE` 行锁（已有 pattern 见 `syncWorkflowAssetReference` line 2498-2499）。

**Files:**
- Modify: `server/src/routes/workflows.ts:1833-1838` — 路由中的 metadata 写入改为事务

- [ ] **Step 1: 改写 metadata 写入为事务**

**关键注意**：`next` 对象（line 1815-1831）是基于事务外读取的 `currentWorkflow` 构建的。如果另一个并发请求已经修改了 metadata，`next` 引用的是旧 workflow 状态。解决方案：在事务内重新读取 metadata，基于 fresh metadata 重新定位 workflow 并合并 clip 更新。

将 line 1833-1838 的写入替换为：

```typescript
    const savedMetadata = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${project.id} FOR UPDATE`;
      const currentProject = await tx.project.findUnique({
        where: { id: project.id },
        select: { metadata: true },
      });
      const freshMetadata = isRecord(currentProject?.metadata) ? currentProject.metadata : {};
      const freshWorkflow = getWorkflowState(freshMetadata, requestEpisodeId);
      const freshNext = {
        ...freshWorkflow,
        clips: freshWorkflow.clips.map((item) => (item.id === clip.id ? nextClip : item)),
        stageStatuses: {
          ...freshWorkflow.stageStatuses,
          storyboard: "done",
          video: "idle",
        },
        lastRun: {
          ...(isRecord(freshWorkflow.lastRun) ? freshWorkflow.lastRun : {}),
          status: "clip-storyboard-planned",
          stage: "storyboard",
          clipId: clip.id,
          completedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      };
      const episodeId = requestEpisodeId || workflowEpisodeIdForWorkflow(freshMetadata, freshNext);
      const nextMetadata = writeWorkflowEpisode(freshMetadata, episodeId, freshNext, true);
      await tx.project.update({
        where: { id: project.id },
        data: { metadata: nextMetadata },
      });
      return { nextMetadata, freshNext, episodeId };
    });
```

然后删除原来 line 1815-1831 的 `next` 构造和 line 1833 的 `episodeId` 计算（这些逻辑已移入事务内）。

更新下方 `ok(res, {...})` 使用事务返回的值：

```typescript
    ok(res, {
      ...plan,
      prompt,
      continuityCharacters: continuity.continuityCharacters,
      model: modelResult.model,
      workflow: { ...savedMetadata.freshNext, episodeId: savedMetadata.episodeId, episodes: getWorkflowEpisodeList(savedMetadata.nextMetadata) },
      clip: nextClip,
    });
```

注：`Prisma` type 已在 workflows.ts line 7 通过 `import type { Prisma } from "@prisma/client"` 导入，无需新增。

- [ ] **Step 3: 类型检查**

```bash
npm run server:check
```

Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/workflows.ts
git commit -m "fix: use SELECT FOR UPDATE to prevent concurrent storyboard plan overwrites"
```

---

## Task 4: 扩充团队场景中文关键词（P1）

当前团队场景检测只覆盖英文和少量中文（`主角团|小队`），大部分中文团队概念未覆盖。

**Files:**
- Modify: `server/src/routes/workflows.ts:3735` — 扩充 regex
- Create: `server/src/routes/workflowPatterns.ts` — 提取正则常量
- Modify: `server/src/routes/workflows.test.ts` — **追加**测试（文件已存在，包含 Dreamina 测试）

- [ ] **Step 1: 在已有 `workflows.test.ts` 末尾追加测试**

**重要**：`server/src/routes/workflows.test.ts` **已存在**，有 Dreamina 相关测试。**不要覆盖**，在文件末尾追加以下测试：

首先在文件顶部追加一行 import（在已有的 import 后面）：
```typescript
import { TEAM_SCENE_PATTERN } from "./workflowPatterns.js";
```

然后在文件末尾追加：
```typescript
test("TEAM_SCENE_PATTERN matches Chinese team keywords", () => {
  const cases = [
    "队员集合",
    "同伴们赶到",
    "伙伴一起行动",
    "团队作战",
    "一行人走进大厅",
    "众人围坐",
    "组员到齐",
    "全员出动",
    "同伙",
    "team assembles",
    "teammates arrive",
    "guests enter",
    "主角团出发",
    "小队集合",
  ];
  for (const text of cases) {
    assert.ok(TEAM_SCENE_PATTERN.test(text), `Should match: "${text}"`);
  }
});

test("TEAM_SCENE_PATTERN does not match unrelated text", () => {
  const cases = [
    "Leo walks alone",
    "一个人静静站着",
    "空旷的房间",
  ];
  for (const text of cases) {
    assert.ok(!TEAM_SCENE_PATTERN.test(text), `Should NOT match: "${text}"`);
  }
});
```

- [ ] **Step 2: 创建 `server/src/routes/workflowPatterns.ts`**

从 `workflows.ts` line 3735 提取正则为独立常量：

```typescript
export const TEAM_SCENE_PATTERN =
  /\bteam\b|teammate|group|guests|主角团|小队|队员|同伴|伙伴|团队|一行人|众人|组员|全员|同伙/i;
```

- [ ] **Step 3: 更新 `workflows.ts` line 3735**

```typescript
import { TEAM_SCENE_PATTERN } from "./workflowPatterns.js";
```

将 line 3735：
```typescript
  const likelyTeamScene = /\bteam\b|teammate|group|guests|主角团|小队/.test(teamHints) || explicitCharacters.length >= 2;
```

改为：
```typescript
  const likelyTeamScene = TEAM_SCENE_PATTERN.test(teamHints) || explicitCharacters.length >= 2;
```

- [ ] **Step 4: 运行测试**

```bash
npx tsx --test server/src/routes/workflows.test.ts
```

Expected: PASS。

- [ ] **Step 5: 类型检查**

```bash
npm run server:check
```

Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/workflows.ts server/src/routes/workflows.test.ts server/src/routes/workflowPatterns.ts
git commit -m "fix: expand team scene detection to cover Chinese keywords"
```

---

## Task 5: 对白去重后保留原始 shot 索引（P1）

当前 `clipStoryboardDialogueLockLines()` 用 `uniqueStrings()` 去重后重新编号 D1, D2...，导致索引与 shot 不对应。改为按 shot 顺序遍历，每个有对白的 shot 获得独立 D 编号，重复台词标注 "(same as D{n})"。

**Files:**
- Modify: `server/src/routes/workflows.ts:4214-4217` — `clipStoryboardDialogueLockLines()`
- Modify: `server/src/routes/workflows.ts:8186-8194` — 将 `clipStoryboardDialogueLockLines` 添加到 `workflowsTestInternals`
- Modify: `server/src/routes/workflows.test.ts` — 追加对白去重测试

- [ ] **Step 1: 重写 `clipStoryboardDialogueLockLines()`**

将 line 4214-4217 替换为：

```typescript
function clipStoryboardDialogueLockLines(shots: NormalizedStoryboardShot[]): string[] {
  const seen = new Map<string, number>();
  const lines: string[] = [];
  for (const shot of shots) {
    const dialogue = cleanWorkflowPublicText(shot.dialogue);
    if (!dialogue) continue;
    const key = normalizeCompareText(dialogue);
    const firstIndex = seen.get(key);
    if (firstIndex !== undefined) {
      lines.push(`D${lines.length + 1}: ${dialogue} (same as D${firstIndex})`);
    } else {
      seen.set(key, lines.length + 1);
      lines.push(`D${lines.length + 1}: ${dialogue}`);
    }
  }
  return lines;
}
```

- [ ] **Step 2: 将 `clipStoryboardDialogueLockLines` 暴露到 `workflowsTestInternals`**

在 `server/src/routes/workflows.ts` line 8186-8194 的 `workflowsTestInternals` 对象中追加：

```typescript
export const workflowsTestInternals = {
  cleanOptimizedPrompt,
  canvasVideoResultFailureMessage,
  clipStoryboardDialogueLockLines,  // ← 新增
  dreaminaExistingVideoUrlsFromRaw,
  finalizeWorkflowVideoPrompt,
  formatDreaminaGenerationFailure,
  missingPreservedDialogueFragments,
  normalizeCanvasVideoRatio,
};
```

- [ ] **Step 3: 在 `workflows.test.ts` 末尾追加对白测试**

```typescript
test("clipStoryboardDialogueLockLines preserves all dialogues with cross-references", () => {
  const shots = [
    { dialogue: "你好" },
    { dialogue: "再见" },
    { dialogue: "你好" },
    { dialogue: "" },
    { dialogue: "谢谢" },
  ] as any[];
  const lines = workflowsTestInternals.clipStoryboardDialogueLockLines(shots);
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^D1: 你好$/);
  assert.match(lines[1], /^D2: 再见$/);
  assert.match(lines[2], /D3: 你好 \(same as D1\)/);
  assert.match(lines[3], /^D4: 谢谢$/);
});

test("clipStoryboardDialogueLockLines returns empty for no-dialogue shots", () => {
  const shots = [{ dialogue: "" }, { dialogue: null }, {}] as any[];
  const lines = workflowsTestInternals.clipStoryboardDialogueLockLines(shots);
  assert.equal(lines.length, 0);
});
```

- [ ] **Step 4: 运行测试**

```bash
npx tsx --test server/src/routes/workflows.test.ts
```

Expected: PASS（包括已有 Dreamina 测试和新增测试）。

- [ ] **Step 5: 类型检查**

```bash
npm run server:check
```

Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/workflows.ts server/src/routes/workflows.test.ts
git commit -m "fix: preserve shot-level dialogue indices in storyboard dialogue lock"
```

---

## Task 6: 无资产角色记录日志警告（P2）

当角色在剧本中出现但没有提取为资产时，`clipStoryboardContinuityContext()` 会静默排除它。加一条 console.warn 让开发/运维能看到这个情况。

**Files:**
- Modify: `server/src/routes/workflows.ts:3739-3741`

- [ ] **Step 1: 在过滤前加 warn**

将 line 3739-3741：

```typescript
  const continuityCharacters = uniqueStrings([...explicitCharacters, ...sameSettingCharacters, ...continuityTeam])
    .filter((name) => assetNames.size === 0 || assetNames.has(normalizeCompareText(name)))
    .slice(0, 12);
```

改为：

```typescript
  const allCandidates = uniqueStrings([...explicitCharacters, ...sameSettingCharacters, ...continuityTeam]);
  const droppedForMissingAsset = assetNames.size > 0
    ? allCandidates.filter((name) => !assetNames.has(normalizeCompareText(name)))
    : [];
  if (droppedForMissingAsset.length > 0) {
    console.warn(`[storyboard-continuity] Clip "${clip.id}": dropped characters without assets: ${droppedForMissingAsset.join(", ")}`);
  }
  const continuityCharacters = allCandidates
    .filter((name) => assetNames.size === 0 || assetNames.has(normalizeCompareText(name)))
    .slice(0, 12);
```

- [ ] **Step 2: 类型检查**

```bash
npm run server:check
```

Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/workflows.ts
git commit -m "fix: warn when continuity characters are dropped for missing assets"
```

---

## 验证

所有 Task 完成后，运行：

```bash
npm run server:check
npx tsx --test server/src/lib/storyboardPrompt.test.ts
npx tsx --test server/src/routes/workflows.test.ts
```

预期全部通过，无类型错误。
