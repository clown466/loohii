# Loohii Backend Schema

This backend draft uses PostgreSQL through Prisma. Redis is reserved for job queues, generation polling, rate limits, and short-lived agent state.

## Core Tenancy

- `User` stores profile, auth-facing identity data, credit balance, and soft deletion.
- `Account` links users to login providers such as email, Google, GitHub, and WeChat.
- `Team` owns collaborative workspaces. `TeamMember` assigns each user a role in a team.
- `Project` belongs to a team and owner, tracks status, aspect ratio, project settings, optional style preset, and optional cover asset.

## Creation Graph

- `Character` and `Scene` are project-scoped nodes with prompt, metadata, canvas position, and soft deletion.
- `SceneCharacter` records character appearances in scenes.
- `CanvasEdge` stores React Flow-style links between canvas nodes. Source and target IDs are intentionally polymorphic because the canvas can connect scenes, characters, generated assets, and generation nodes.

## AI And Assets

- `StylePreset` stores reusable prompt presets. System presets are seeded globally; team/user-specific presets can be added later.
- `AiModel` stores provider/model catalog rows, capabilities, default parameters, active state, and default credit cost.
- `Generation` records each AI job, including prompt, parameters, status, provider job ID, cost, timing, and optional links to scene, character, style preset, and AI model.
- `Asset` stores generated or uploaded media metadata and links it back to project, generation, scene, or character.

## Credits, Payments, And Agent

- `PaymentOrder` tracks external payment intent/order state and purchased credit quantity.
- `Transaction` is the append-only credit ledger for purchases, spends, refunds, and admin adjustments.
- `AgentMessage` stores project-scoped assistant chat history with optional generation linkage and threaded parent/reply relationships.

## Model Provider Settings

- `ProviderConfig` stores global AI provider connection settings. API keys are AES-256-GCM encrypted and only masked metadata is returned to the browser.
- `AiModel.providerConfigId` links selectable models to provider settings, while `Generation.input.modelSnapshot` records the selected model at task creation time.
- Set `MODEL_CONFIG_ENCRYPTION_KEY` in production before saving provider keys.
- Set `MODEL_CONFIG_ADMIN_EMAILS` to a comma-separated email allowlist when multiple users can log in. When it is empty, model configuration remains open to authenticated users for single-user development.

## Local Services

`docker-compose.yml` starts Postgres 16 and Redis 7:

```sh
docker compose up -d postgres redis
```

If local ports are already taken, override them:

```sh
POSTGRES_PORT=15432 REDIS_PORT=16379 docker compose up -d postgres redis
```

After Prisma is installed and package scripts are wired, expected setup commands are:

```sh
npx prisma migrate dev
npm run prisma:seed
```

## Current API Surface

The first backend pass is an Express service started with:

```sh
npm run server:dev
```

Implemented route groups:

- `GET /health`
- `POST /api/auth/sign-up`
- `POST /api/auth/sign-in`
- `GET /api/auth/me`
- `PATCH /api/auth/me`
- `GET/POST /api/projects`
- `GET/PATCH/DELETE /api/projects/:projectId`
- `GET/PUT /api/canvas/scenes/:projectId/:sceneId`
- `POST /api/agent/messages`
- `GET/POST /api/generations`
- `POST /api/generations/:generationId/retry`
- `DELETE /api/generations/:generationId`
- `GET/POST /api/models`
- `PATCH /api/models/:modelId`
- `GET /api/billing/balance`
- `GET /api/billing/transactions`
- `POST /api/uploads/presign`

Socket.io is mounted on the same HTTP server for generation progress events. The BullMQ queue, OpenAI-compatible image adapter, mock adapter, and R2 presign service are present as backend modules; the next integration step is to connect `POST /api/generations` to the queue worker and persist completed assets.
