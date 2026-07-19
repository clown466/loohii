# Overseas Remake SaaS — Phase 0 Acceptance Checklist

**Branch/worktree:** `feat-overseas-remake-saas`  
**Verified at:** 2026-07-19  
**HEAD:** `68b45317f23d8b64e797c1e32b59963019f0093b`

## Automated verification

| Check | Command | Result |
|-------|---------|--------|
| Remake unit tests | `node --import tsx --test` (10 files under `server/src/remake/` + `server/src/routes/remake.test.ts`) | **PASS** — 42/42 tests, ~1.8s |
| Backend typecheck | `npm run server:check` | **PASS** |
| Frontend build | `npm run build` | **PASS** (vite 6.3.5, 1951 modules) |

## Manual smoke (local E2E)

> **Environment note:** Manual steps were **not executed** in this session — no local Postgres/Redis/Docker stack running. Mark each step when validated in a full dev environment.

| # | Step | Expected | Status |
|---|------|----------|--------|
| 1 | 登录 → `/app/remake/new` 上传 15s 竖屏样片 | 任务创建成功，进入 job 详情 | ⏳ Pending (no DB/Docker) |
| 2 | Analyze 完成 → 编辑镜列表 | Gate A 可编辑 breakdown，approve 后进入 Adapt | ⏳ Pending |
| 3 | Adapt 产出中文脚本 | Gate B 可审阅/编辑 script，approve 后进入 Generate | ⏳ Pending |
| 4 | Generate → Assemble | 各镜生成（可用 mock 视频模型若 Dreamina 不可用），进入 Assemble | ⏳ Pending |
| 5 | Gate C → 下载 MP4 | Gate C approve 后 deliver 完成，可下载成片 | ⏳ Pending |
| 6 | 故意失败一镜 → `retry-failed-shots` | 仅重跑 failed 镜，succeeded 镜跳过 | ⏳ Pending |

## Coverage notes (from automated tests)

- State machine: gate A/B/C pause, pipeline order, failure handling
- Orchestrator: stage advancement, gate stops, deliver completion
- Routes: auth 401, create body validation, gate approve/reject
- Generate: retry-failed-shots skips succeeded shots, billing retry rotation
- Compose: mock assemble stub, ffmpeg concat when available
- Billing: idempotent job keys per stage/shot/attempt

## Sign-off

- [x] Automated checks green at HEAD above
- [ ] Manual E2E smoke completed in Docker dev stack (postgres + redis + server:dev + dev)
