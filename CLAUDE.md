# 鹿绘AI (Loohii) — Development Guidelines

## Project

AI-driven animation creation SaaS — https://www.loohii.com
Repo: https://github.com/clown466/loohii

## Tech Stack

- **Frontend**: React 18, Vite 6, Tailwind CSS 4, shadcn/ui, @xyflow/react, Zustand 5
- **Backend**: Express 5, TypeScript, Prisma ORM, PostgreSQL
- **Queue/Realtime**: BullMQ, Redis, Socket.io
- **Storage**: Cloudflare R2 (S3-compatible presigned uploads)
- **Auth**: JWT + bcryptjs (mock fallback via VITE_AUTH_MOCK_MODE)
- **Deployment**: Docker (docker-compose with postgres + redis)

## Commands

```bash
npm run dev          # Start frontend dev server
npm run server:dev   # Start backend dev server
npm run build        # Frontend production build
npm run server:check # Backend type check
npx tsc --noEmit     # Full type check
```

## Project Structure

```
src/app/
  pages/              Page components (thin shells)
  features/
    canvas/           Canvas domain
      canvasUtils.tsx  Types, constants, utility functions
      nodes/          ReactFlow custom node components
      components/     Canvas sub-components (StoryboardSceneList, etc.)
    settings/         Settings tab components
  stores/             Zustand stores
  components/         Shared UI components
  lib/
    api/              Domain-specific API modules
    apiClient.ts      Re-export shim for backward compatibility
  layouts/            Layout components
server/src/
  routes/             API route handlers
  ai/                 AI model adapters
  lib/                Shared server utilities
  queues/             BullMQ job definitions
  realtime/           Socket.io handlers
  storage/            R2/S3 storage helpers
prisma/               Database schema & migrations
```

## Architecture Rules

- ReactFlow canvas MUST stay uncontrolled (`defaultNodes`/`defaultEdges`). Never use controlled `nodes={...}`/`edges={...}` — causes Maximum update depth exceeded crashes.
- Never add a dynamic `key` to `<ReactFlow>` based on node/edge count or revision.
- Sync external changes via `useReactFlow().setNodes/setEdges` with stable signature comparison.
- Workflow state lives in `Project.metadata.workflowCenter` JSON blob.
- Frontend AI features use API keys configured in the settings UI (not mock).

## Code Conventions

- File size limit: keep files under 1,000 lines. Split by domain when approaching.
- Use named exports (`export function X`), not default exports.
- Import paths use `@/` alias mapped to `src/`.
- Chinese UI text throughout (zh-CN locale).
- Commit messages: `type: description` (e.g., `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).

## Before Committing

```bash
npm run build && npm run server:check
```

For backend changes, restart `loohii-backend.service` and verify health:
```bash
curl -fsS https://www.loohii.com/api/health
```
