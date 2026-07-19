# Overseas Remake SaaS (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Loohii 底座上交付 Phase 0 垂直闭环：TikTok 链接或本地上传 → 可编辑拆解 → 本地化改编 → 按镜仿拍 → 竖屏成片，含 Gate A/B/C。

**Architecture:** 新增独立 `remake` 域（Prisma + routes + queues + lib），不把状态塞进 `Project.metadata.workflowCenter`。用 BullMQ `remake` 队列编排六阶段；复用 `requireAuth`、R2/本地上传、`callConfiguredTextModel` / vision、`callDreaminaWebVideoModel`、`chargeOnce`、Socket 进度广播。FFmpeg Composer 新建（现有 ffmpeg 仅做 mp4→webm 转码）。

**Tech Stack:** Express 5、Prisma/PostgreSQL、BullMQ/Redis、Socket.io、FFmpeg、React 18 + Vite、Zustand、平台积分（aijiekou）

**Spec:** `docs/superpowers/specs/2026-07-19-overseas-remake-saas-design.md`

## Global Constraints

- 产品文案：中文（zh-CN）
- 再创作：结构级仿拍，不复用原曲原片商用
- MVP 平台：TikTok 链接 + 上传兜底；Facebook 不做
- 成片：竖屏优先 `1080x1920`；时长/镜数可配置上限（默认 ≤45s 或 ≤12 镜）
- 默认开启 Gate A/B/C；全自动为后续开关
- 命名导出（`export function X`），路径别名前端 `@/`
- 计费：复用 `BillingAction`（`loohii_text` / `loohii_image` / `loohii_video`），幂等键 `remake:{jobId}:{stage}[:shot:{n}]`
- 测试：`node --test` + `node:assert/strict`（与现有 `server/src/**/*.test.ts` 一致）
- 提交信息：`type: description`（feat/fix/test/chore）
- 验证：`npm run server:check`；相关单测 `node --test <file>`

## File Structure (create / modify)

| Path | Responsibility |
|------|----------------|
| `prisma/schema.prisma` | Remake enums + models |
| `server/src/remake/types.ts` | 共享类型与 JSON payload shapes |
| `server/src/remake/stateMachine.ts` | 阶段迁移与 Gate 规则 |
| `server/src/remake/ingest.ts` | 链接解析 provider + 上传落库 |
| `server/src/remake/analyze.ts` | ASR/切镜/视觉描述 → Breakdown |
| `server/src/remake/adapt.ts` | Localizer → RemakeScript |
| `server/src/remake/generateShots.ts` | 按镜调用视频模型 |
| `server/src/remake/compose.ts` | FFmpeg 接片/字幕/导出 |
| `server/src/remake/orchestrator.ts` | 阶段 runner + 限流钩子 |
| `server/src/remake/billing.ts` | remake 专用扣点封装 |
| `server/src/remake/events.ts` | Socket 事件名与 payload |
| `server/src/queues/remakeQueue.ts` | BullMQ queue/worker |
| `server/src/routes/remake.ts` | HTTP API |
| `server/src/routes/index.ts` | 挂载 `/remake` |
| `server/src/index.ts` | 启动 remake worker |
| `src/app/lib/api/remakeApi.ts` | 前端 API |
| `src/app/stores/useRemakeStore.ts` | Job 列表/详情状态 |
| `src/app/pages/RemakeListPage.tsx` | 任务列表 |
| `src/app/pages/RemakeJobPage.tsx` | 详情 + 三卡点 |
| `src/app/pages/RemakeNewPage.tsx` | 新建（链接/上传） |
| `src/app/routes.tsx` | `/app/remake/*` |
| `src/app/layouts/MainLayout.tsx` | 导航入口（若有侧栏） |

---

### Task 1: Prisma Remake 模型

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `server/src/remake/types.ts`
- Test: `server/src/remake/types.test.ts`

**Interfaces:**
- Produces: `RemakeJobStatus`, `RemakeStage`, Prisma models `RemakeJob` / `RemakeSourceAsset`

- [ ] **Step 1: Write failing type guard test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { isRemakeStage, REMAKE_STAGES } from "./types";

test("REMAKE_STAGES order matches pipeline", () => {
  assert.deepEqual([...REMAKE_STAGES], [
    "ingest", "analyze", "adapt", "generate", "assemble", "deliver",
  ]);
});

test("isRemakeStage rejects unknown", () => {
  assert.equal(isRemakeStage("ingest"), true);
  assert.equal(isRemakeStage("nope"), false);
});
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

```bash
node --import tsx --test server/src/remake/types.test.ts
```

Expected: `Cannot find module` / fail

- [ ] **Step 3: Add `types.ts` + Prisma models**

在 `prisma/schema.prisma` 追加（User 上加 relation）：

```prisma
enum RemakeJobStatus {
  PENDING
  RUNNING
  WAITING_GATE
  SUCCEEDED
  FAILED
  CANCELED
}

enum RemakeStage {
  INGEST
  ANALYZE
  ADAPT
  GENERATE
  ASSEMBLE
  DELIVER
}

model RemakeJob {
  id              String          @id @default(cuid())
  userId          String
  workspaceId     String?
  status          RemakeJobStatus @default(PENDING)
  stage           RemakeStage     @default(INGEST)
  sourceUrl       String?
  title           String?
  gatesEnabled    Json            // { a: true, b: true, c: true }
  breakdown       Json?
  remakeScript    Json?
  progress        Json?           // { percent, message, shotIndex, shotTotal }
  errorMessage    String?
  budgetPoints    Int?
  spentPoints     Int             @default(0)
  maxDurationMs   Int             @default(45000)
  maxShots        Int             @default(12)
  finalVideoKey   String?
  finalVideoUrl   String?
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  user   User               @relation(fields: [userId], references: [id])
  source RemakeSourceAsset?
  shots  RemakeShotClip[]

  @@index([userId, createdAt])
  @@index([status, stage])
}

model RemakeSourceAsset {
  id           String   @id @default(cuid())
  jobId        String   @unique
  platform     String   // tiktok | upload
  externalId   String?
  sourceUrl    String?
  videoKey     String
  coverKey     String?
  durationMs   Int?
  width        Int?
  height       Int?
  rawMeta      Json?
  ingestError  String?
  createdAt    DateTime @default(now())

  job RemakeJob @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@index([platform, externalId])
}

model RemakeShotClip {
  id           String   @id @default(cuid())
  jobId        String
  shotIndex    Int
  status       String   // pending | running | succeeded | failed
  prompt       String?
  durationMs   Int?
  resultKey    String?
  resultUrl    String?
  modelParams  Json?
  retryCount   Int      @default(0)
  errorMessage String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  job RemakeJob @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@unique([jobId, shotIndex])
}
```

`server/src/remake/types.ts`：

```ts
export const REMAKE_STAGES = [
  "ingest", "analyze", "adapt", "generate", "assemble", "deliver",
] as const;

export type RemakeStageSlug = (typeof REMAKE_STAGES)[number];

export function isRemakeStage(value: string): value is RemakeStageSlug {
  return (REMAKE_STAGES as readonly string[]).includes(value);
}

export interface RemakeGates {
  a: boolean;
  b: boolean;
  c: boolean;
}

export interface RemakeShotBreakdown {
  index: number;
  startMs: number;
  endMs: number;
  transcript: string;
  visualSummary: string;
  shotType: string;
  subjects: string[];
  hookRole: "hook" | "build" | "payoff" | "cta" | "other";
  keyframeUrls: string[];
}

export interface RemakeBreakdown {
  language: string;
  fullTranscript: string;
  shots: RemakeShotBreakdown[];
  charactersDraft: string[];
  scenesDraft: string[];
  analysisConfidence: number;
}
```

- [ ] **Step 4: Re-run test — expect PASS**

```bash
node --import tsx --test server/src/remake/types.test.ts
```

- [ ] **Step 5: Migrate**

```bash
npx prisma migrate dev --name remake_job_models
npx prisma generate
```

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations server/src/remake/types.ts server/src/remake/types.test.ts
git commit -m "feat: add RemakeJob Prisma models and stage types"
```

---

### Task 2: 状态机（Gate + 阶段迁移）

**Files:**
- Create: `server/src/remake/stateMachine.ts`
- Test: `server/src/remake/stateMachine.test.ts`

**Interfaces:**
- Consumes: `RemakeStageSlug`, `RemakeGates` from `types.ts`
- Produces: `nextStageAfterSuccess`, `gateForStage`, `canAdvance`

- [ ] **Step 1: Failing tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { gateForStage, nextStageAfterSuccess, shouldPauseForGate } from "./stateMachine";

test("analyze success pauses at gate A when enabled", () => {
  assert.equal(gateForStage("analyze"), "a");
  assert.equal(shouldPauseForGate("analyze", { a: true, b: true, c: true }), true);
  assert.equal(shouldPauseForGate("analyze", { a: false, b: true, c: true }), false);
});

test("pipeline order after gate approve", () => {
  assert.equal(nextStageAfterSuccess("ingest"), "analyze");
  assert.equal(nextStageAfterSuccess("analyze"), "adapt");
  assert.equal(nextStageAfterSuccess("adapt"), "generate");
  assert.equal(nextStageAfterSuccess("generate"), "assemble");
  assert.equal(nextStageAfterSuccess("assemble"), "deliver");
  assert.equal(nextStageAfterSuccess("deliver"), null);
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
node --import tsx --test server/src/remake/stateMachine.test.ts
```

- [ ] **Step 3: Implement**

```ts
import type { RemakeGates, RemakeStageSlug } from "./types";

const NEXT: Record<RemakeStageSlug, RemakeStageSlug | null> = {
  ingest: "analyze",
  analyze: "adapt",
  adapt: "generate",
  generate: "assemble",
  assemble: "deliver",
  deliver: null,
};

const GATE: Partial<Record<RemakeStageSlug, keyof RemakeGates>> = {
  analyze: "a",
  adapt: "b",
  assemble: "c",
};

export function nextStageAfterSuccess(stage: RemakeStageSlug): RemakeStageSlug | null {
  return NEXT[stage];
}

export function gateForStage(stage: RemakeStageSlug): keyof RemakeGates | null {
  return GATE[stage] ?? null;
}

export function shouldPauseForGate(stage: RemakeStageSlug, gates: RemakeGates): boolean {
  const g = gateForStage(stage);
  return g ? gates[g] === true : false;
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add server/src/remake/stateMachine.ts server/src/remake/stateMachine.test.ts
git commit -m "feat: add remake stage state machine and gates"
```

---

### Task 3: Ingest（上传必做 + 链接 provider 可插拔）

**Files:**
- Create: `server/src/remake/ingest.ts`
- Test: `server/src/remake/ingest.test.ts`

**Interfaces:**
- Produces: `IngestProvider`, `normalizeTikTokUrl`, `ingestFromUpload`, `ingestFromUrl`

- [ ] **Step 1: Failing tests for URL normalize + provider contract**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTikTokUrl, createMockIngestProvider } from "./ingest";

test("normalizeTikTokUrl extracts id-ish path", () => {
  const n = normalizeTikTokUrl("https://www.tiktok.com/@u/video/7123456789012345678?lang=en");
  assert.equal(n.externalId, "7123456789012345678");
  assert.ok(n.canonicalUrl.includes("7123456789012345678"));
});

test("mock provider returns video bytes meta", async () => {
  const p = createMockIngestProvider();
  const r = await p.fetch("https://www.tiktok.com/@u/video/7123456789012345678");
  assert.equal(r.platform, "tiktok");
  assert.ok(r.videoBuffer.byteLength > 0);
  assert.ok(r.durationMs > 0);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement ingest module**

```ts
export interface IngestFetchResult {
  platform: "tiktok";
  externalId: string;
  sourceUrl: string;
  videoBuffer: Buffer;
  coverBuffer?: Buffer;
  durationMs: number;
  width?: number;
  height?: number;
  rawMeta?: Record<string, unknown>;
}

export interface IngestProvider {
  fetch(url: string): Promise<IngestFetchResult>;
}

export function normalizeTikTokUrl(input: string): { canonicalUrl: string; externalId: string } {
  const u = new URL(input);
  const m = u.pathname.match(/\/video\/(\d+)/);
  if (!m) throw new Error("无法解析 TikTok 视频 ID，请检查链接或改用上传");
  return {
    externalId: m[1],
    canonicalUrl: `https://www.tiktok.com${u.pathname.split("?")[0]}`,
  };
}

/** Phase 0：默认可切换的 mock；真实供应商实现同接口后注入 env。 */
export function createMockIngestProvider(): IngestProvider {
  return {
    async fetch(url: string) {
      const { canonicalUrl, externalId } = normalizeTikTokUrl(url);
      // 最小合法 mp4 由测试用 fixture 替换；生产接第三方 API
      const videoBuffer = Buffer.from("mock-mp4");
      return {
        platform: "tiktok",
        externalId,
        sourceUrl: canonicalUrl,
        videoBuffer,
        durationMs: 15000,
        width: 1080,
        height: 1920,
        rawMeta: { mock: true },
      };
    },
  };
}

export function createHttpIngestProvider(opts: {
  endpoint: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): IngestProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    async fetch(url: string) {
      const { canonicalUrl, externalId } = normalizeTikTokUrl(url);
      const res = await fetchImpl(opts.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
        },
        body: JSON.stringify({ url: canonicalUrl }),
      });
      if (!res.ok) throw new Error(`解析服务失败: HTTP ${res.status}`);
      const data = (await res.json()) as {
        downloadUrl: string;
        coverUrl?: string;
        durationMs?: number;
        width?: number;
        height?: number;
      };
      const videoRes = await fetchImpl(data.downloadUrl);
      if (!videoRes.ok) throw new Error("下载解析后的视频失败");
      const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
      return {
        platform: "tiktok",
        externalId,
        sourceUrl: canonicalUrl,
        videoBuffer,
        durationMs: data.durationMs ?? 0,
        width: data.width,
        height: data.height,
        rawMeta: data as unknown as Record<string, unknown>,
      };
    },
  };
}
```

上传路径在 Task 5 的 route 里：客户端先走现有 `uploads` presign，再 `POST /api/remake/jobs` 带 `videoKey`。

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add remake ingest providers (mock + HTTP)"
```

---

### Task 4: Analyze / Adapt / Compose 纯逻辑骨架

**Files:**
- Create: `server/src/remake/analyze.ts`, `adapt.ts`, `compose.ts` (+ tests)
- Note: ASR/多模态真实调用在 orchestrator 注入；本任务先可测的切镜与 prompt 组装、FFmpeg 命令构建

**Interfaces:**
- Produces: `splitShotsByDuration`, `buildAdaptPromptInput`, `buildConcatFilterComplex`

- [ ] **Step 1: Analyze test — fixed window split**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { splitShotsByDuration } from "./analyze";

test("splitShotsByDuration caps shot count", () => {
  const shots = splitShotsByDuration({
    durationMs: 30000,
    windowMs: 3000,
    maxShots: 8,
    transcriptSegments: [{ startMs: 0, endMs: 30000, text: "你好世界" }],
  });
  assert.ok(shots.length <= 8);
  assert.equal(shots[0].hookRole, "hook");
  assert.equal(shots[0].index, 0);
});
```

- [ ] **Step 2: Implement `splitShotsByDuration`**（无 scene-detect 时的 MVP 切镜）

```ts
import type { RemakeShotBreakdown } from "./types";

export function splitShotsByDuration(input: {
  durationMs: number;
  windowMs: number;
  maxShots: number;
  transcriptSegments: Array<{ startMs: number; endMs: number; text: string }>;
}): RemakeShotBreakdown[] {
  const windowMs = Math.max(1000, input.windowMs);
  const rawCount = Math.ceil(input.durationMs / windowMs);
  const count = Math.min(Math.max(rawCount, 1), input.maxShots);
  const slice = Math.ceil(input.durationMs / count);
  const shots: RemakeShotBreakdown[] = [];
  for (let i = 0; i < count; i++) {
    const startMs = i * slice;
    const endMs = Math.min(input.durationMs, (i + 1) * slice);
    const transcript = input.transcriptSegments
      .filter((s) => s.startMs < endMs && s.endMs > startMs)
      .map((s) => s.text)
      .join(" ")
      .trim();
    shots.push({
      index: i,
      startMs,
      endMs,
      transcript,
      visualSummary: "",
      shotType: "medium",
      subjects: [],
      hookRole: i === 0 ? "hook" : i === count - 1 ? "cta" : "build",
      keyframeUrls: [],
    });
  }
  return shots;
}
```

- [ ] **Step 3: Compose command builder test + impl**

```ts
// compose.ts
export function buildConcatDemuxerList(paths: string[]): string {
  return paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
}

export function buildSubtitleBurnFilter(srtPath: string): string {
  const escaped = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  return `subtitles='${escaped}'`;
}
```

实际 `execFile("ffmpeg", ...)` 在 `composeFinalVideo(...)` 中实现：写 concat list → 可选烧字幕 → 输出 `1080x1920` mp4。无 ffmpeg 环境时单测只覆盖字符串构建。

- [ ] **Step 4: Adapt — `buildRemakeScriptFromBreakdown` 用确定性模板（LLM 在 orchestrator 包装）**

```ts
export function buildRemakeScriptFromBreakdown(
  breakdown: RemakeBreakdown,
  localizedLines: string[],
): {
  styleLock: string;
  shots: Array<{ index: number; prompt: string; durationMs: number; dialogue: string; refShotId: number }>;
} {
  return {
    styleLock: "cinematic vertical short drama, consistent characters, soft key light",
    shots: breakdown.shots.map((s, i) => ({
      index: s.index,
      durationMs: s.endMs - s.startMs,
      dialogue: localizedLines[i] ?? s.transcript,
      refShotId: s.index,
      prompt: [
        `Shot ${s.index + 1}, ${s.shotType}`,
        s.visualSummary || "follow source blocking",
        `Action and emotion matching: ${localizedLines[i] ?? s.transcript}`,
      ].join(". "),
    })),
  };
}
```

- [ ] **Step 5: Tests PASS + Commit**

```bash
git commit -m "feat: add remake analyze/adapt/compose pure helpers"
```

---

### Task 5: HTTP API — 创建 Job、列表、详情、Gate

**Files:**
- Create: `server/src/routes/remake.ts`, `server/src/routes/remake.test.ts`
- Modify: `server/src/routes/index.ts`

**Interfaces:**
- Produces:
  - `POST /api/remake/jobs` body `{ sourceUrl?: string; videoKey?: string; coverKey?: string; gates?: RemakeGates }`
  - `GET /api/remake/jobs` / `GET /api/remake/jobs/:id`
  - `POST /api/remake/jobs/:id/gates/:gate/approve|reject`
  - `PATCH /api/remake/jobs/:id/breakdown` / `.../script`
  - `POST /api/remake/jobs/:id/retry-failed-shots`

- [ ] **Step 1: Mount router skeleton test（鉴权 401）**

参考 `server/src/routes/generations.test.ts` 风格：用最小 express app + `createApiRouter`，无 token 请求 `POST /api/remake/jobs` 期望 401。

- [ ] **Step 2: Implement `remake.ts`**

```ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { asyncRoute } from "../lib/asyncRoute";
import { ok, created } from "../lib/response";
import { prisma } from "../lib/prisma";
import { HttpError } from "../lib/httpErrors";
import { enqueueRemakeJob } from "../queues/remakeQueue";

export const remakeRouter = Router();
remakeRouter.use(requireAuth);

remakeRouter.post(
  "/jobs",
  asyncRoute(async (req, res) => {
    const userId = req.user!.id;
    const { sourceUrl, videoKey, gates } = req.body ?? {};
    if (!sourceUrl && !videoKey) {
      throw new HttpError(400, "请提供 TikTok 链接或已上传的 videoKey");
    }
    const job = await prisma.remakeJob.create({
      data: {
        userId,
        sourceUrl: sourceUrl ?? null,
        status: "PENDING",
        stage: "INGEST",
        gatesEnabled: gates ?? { a: true, b: true, c: true },
        ...(videoKey
          ? {
              source: {
                create: {
                  platform: "upload",
                  videoKey,
                  sourceUrl: null,
                },
              },
            }
          : {}),
      },
      include: { source: true },
    });
    await enqueueRemakeJob({ jobId: job.id });
    return created(res, job);
  }),
);

// GET list/detail、PATCH breakdown/script、gate approve/reject 同文件实现
// approve：status RUNNING，enqueue 下一阶段
// reject：回退 stage，清空下游字段按规则
```

- [ ] **Step 3: Wire in `routes/index.ts`**

```ts
import { remakeRouter } from "./remake";
// ...
router.use("/remake", remakeRouter);
```

- [ ] **Step 4: `server:check` + test PASS**

```bash
npm run server:check
node --import tsx --test server/src/routes/remake.test.ts
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: add remake HTTP API and gate endpoints"
```

---

### Task 6: Remake 队列 + Orchestrator + Worker 启动

**Files:**
- Create: `server/src/queues/remakeQueue.ts`, `server/src/remake/orchestrator.ts`, `server/src/remake/events.ts`
- Modify: `server/src/index.ts`
- Test: `server/src/remake/orchestrator.test.ts`（mock 各 stage runner）

**Interfaces:**
- Produces: `enqueueRemakeJob`, `createRemakeWorker`, `runRemakeStage(jobId)`
- Events: `remake:updated`（payload: jobId, userId, status, stage, progress）

- [ ] **Step 1: Orchestrator unit test with injected runners**

```ts
test("stops at gate after analyze when gates.a true", async () => {
  const result = await runRemakeStage("job1", {
    loadJob: async () => ({
      id: "job1",
      stage: "analyze",
      status: "RUNNING",
      gatesEnabled: { a: true, b: true, c: true },
    }),
    runners: {
      analyze: async () => ({ ok: true }),
    },
    saveJob: async () => {},
  });
  assert.equal(result.status, "WAITING_GATE");
  assert.equal(result.stage, "analyze");
});
```

- [ ] **Step 2: Implement queue（镜像 `generationQueue.ts` 动态 import bullmq）**

```ts
export const remakeQueueName = "remake";

export async function enqueueRemakeJob(data: { jobId: string; stage?: string }) {
  const queue = await getRemakeQueue(); // singleton from Redis URL in config
  return queue.add("remake-stage", data, { jobId: `${data.jobId}:${data.stage ?? "auto"}-${Date.now()}` });
}
```

注意：BullMQ `jobId` 必须唯一；不要用固定 id 卡死重试。

- [ ] **Step 3: `orchestrator.ts` 按 stage 调用 ingest→analyze→adapt→generate→assemble→deliver；每步更新 Prisma + emit event；`shouldPauseForGate` 则 `WAITING_GATE` 并 return**

- [ ] **Step 4: 在 `server/src/index.ts` 于 Redis 可用时 `createRemakeWorker`；`onEvent` 广播到 user room（扩展 `socketServer` 或复用现有 notify 模式新建 `notifyRemakeUpdated`）**

- [ ] **Step 5: Tests + `server:check` + Commit**

```bash
git commit -m "feat: wire remake BullMQ worker and stage orchestrator"
```

---

### Task 7: 真实 Analyze（ASR 接口 + Vision 填 visualSummary）

**Files:**
- Modify: `server/src/remake/analyze.ts`, `orchestrator.ts`
- Create: `server/src/remake/asr.ts`（可先 stub：整段空 transcript + 固定窗切镜）
- Test: confidence 闸门

**Interfaces:**
- `transcribeAudio(videoPath) -> segments[]`
- `enrichShotsWithVision(shots, keyframeBuffers) -> shots` 调用 `callConfiguredVisionTextModel`

- [ ] **Step 1: Test `analysisConfidence` 在无 transcript 时 < 0.5**

- [ ] **Step 2: Implement stub ASR + vision enrich；confidence 低时 orchestrator 强制 `WAITING_GATE`（即使 gates.a=false 也建议强制，或写死 Phase 0 强制 Gate A）**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: remake analyze with ASR stub and vision enrichment"
```

---

### Task 8: Adapt LLM + Generate shots（Dreamina）+ Billing

**Files:**
- Create: `server/src/remake/billing.ts`, `server/src/remake/generateShots.ts`
- Modify: `adapt.ts`, `orchestrator.ts`
- Test: `billing.ts` 幂等键格式；generate 失败镜重试计数

**Interfaces:**
- `chargeRemakeStage(platform, jobId, stage, action, units)` → `chargeOnce`
- `generateShotClip({ prompt, refImages, durationMs })` → 复用 `callDreaminaWebVideoModel` / query 轮询模式（参考 `workflows.ts` 视频生成段，抽薄封装，禁止把逻辑继续堆进 workflows.ts）

- [ ] **Step 1: Billing key test**

```ts
assert.equal(remakeBillingJobId("abc", "generate", 3), "remake:abc:generate:shot:3");
```

- [ ] **Step 2: Implement charge helpers + refund on stage failure**

- [ ] **Step 3: Generate：为 script.shots 创建 `RemakeShotClip` 行；并行池（concurrency 2）；失败 `retryCount`；全部结束后若有失败 → job `FAILED` 或 `WAITING_GATE` 并允许 `retry-failed-shots`**

- [ ] **Step 4: Adapt 调用 `callConfiguredTextModel` 产出中文台词数组，再 `buildRemakeScriptFromBreakdown`**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: remake adapt/generate with platform billing keys"
```

---

### Task 9: Assemble 成片（FFmpeg）

**Files:**
- Modify: `server/src/remake/compose.ts`
- Test: demuxer list + 输出路径约定
- Integration：本地装有 ffmpeg 时跑一次 fixture concat（无 ffmpeg 则 skip）

- [ ] **Step 1: `composeFinalVideo({ clipPaths, srtPath?, outputPath })` 使用 `execFile("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, ...])`**

- [ ] **Step 2: 成功后上传 R2/本地存储，写 `finalVideoKey` / `finalVideoUrl`，stage→deliver，Gate C 时 `WAITING_GATE`**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: remake ffmpeg assemble to vertical mp4"
```

---

### Task 10: 前端 Remake 工作台

**Files:**
- Create: `src/app/lib/api/remakeApi.ts`, `useRemakeStore.ts`, pages above
- Modify: `src/app/lib/api/index.ts`, `src/app/routes.tsx`, MainLayout 导航

**Interfaces:**
- 页面中文：新建任务 / 任务列表 / 任务详情（阶段进度、Breakdown 编辑、Script 编辑、通过/驳回、下载成片）

- [ ] **Step 1: `remakeApi.ts` 封装 CRUD（走 `httpClient`）**

- [ ] **Step 2: 路由**

```tsx
path: "remake",
children: [
  { index: true, element: <RemakeListPage /> },
  { path: "new", element: <RemakeNewPage /> },
  { path: ":jobId", element: <RemakeJobPage /> },
],
```

- [ ] **Step 3: RemakeNewPage：链接输入 + 上传（复用 `uploadApi`）→ create job → navigate 详情**

- [ ] **Step 4: RemakeJobPage：轮询或 socket 订阅进度；三卡点按钮；失败镜重跑**

- [ ] **Step 5: `npm run build` 通过**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: add remake workspace UI pages"
```

---

### Task 11: Phase 0 验收清单（手工 + 自动化）

**Files:**
- Create: `docs/superpowers/plans/2026-07-19-overseas-remake-saas-acceptance.md`（短清单即可）

- [ ] **Step 1: 自动化**

```bash
node --import tsx --test server/src/remake/**/*.test.ts server/src/routes/remake.test.ts
npm run server:check
npm run build
```

- [ ] **Step 2: 手工（本地）**

1. 登录 → `/app/remake/new` 上传 15s 竖屏样片  
2. 确认 Analyze 出镜列表可编辑 → Gate A 通过  
3. Adapt 出中文脚本 → Gate B 通过  
4. Generate（可用 mock 视频模型开关若 Dreamina 不可用）→ Assemble  
5. Gate C 通过 → 下载 MP4  
6. 故意失败一镜 → `retry-failed-shots` 只重跑失败镜  

- [ ] **Step 3: Commit acceptance doc（若有）+ 最终 chore**

```bash
git commit -m "docs: add remake phase0 acceptance checklist"
```

---

## Out of Scope (later plans)

- Facebook 采集、热门榜爬取
- 多平台发布、矩阵账号
- 独立计费套餐页支付闭环（可用现有平台积分）
- 画布一键回写（可开 follow-up plan）
- 官方 TK API

## Self-Review

1. **Spec coverage:** Ingest/Analyze/Adapt/Generate/Assemble/Gates/Billing/UI/Queue 均有 Task；FB/热门池明确 Out of Scope。  
2. **Placeholders:** 无 TBD；mock ingest / stub ASR 为明确 Phase 0 实现，可替换真实供应商。  
3. **Type consistency:** `RemakeStageSlug` 小写用于状态机；Prisma enum 大写；API 层做映射。  
4. **Risk:** Dreamina 桥与 ffmpeg 依赖环境——Task 8/9 允许 mock/skip，但 API 与状态机必须可测。
