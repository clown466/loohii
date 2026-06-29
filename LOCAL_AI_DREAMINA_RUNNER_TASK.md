# Local AI Task: Implement Dreamina Local Runner

Repo: `/projects/loohii`
Date: 2026-06-14
Context commit: `407f2fe Fix Dreamina web runtime bridge`

## Goal

Make Loohii use the user's local Chrome/Dreamina browser for Dreamina video generation.

The server-side Docker Dreamina browser can submit the correct payload, but Dreamina rejects that environment with:

```text
statusCode: -6
recordStatus: 3
errorMsg: shark not pass reject
failStarlingMessage: Couldn't generate due to unusual activity in your account. Try again later.
```

The same Dreamina account can generate normally in the user's local Chrome. Therefore the desired architecture is:

```text
Loohii server -> local runner HTTP endpoint -> local Chrome CDP -> Dreamina Web
```

Loohii should still own project state, generation records, prompt assembly, reference URLs, video persistence, and UI. The local runner only executes Dreamina Web tasks through the user's local Chrome.

## Existing Working Server-Side Dreamina Bridge

File:

```text
server/src/ai/dreaminaWebBridge.ts
```

Important facts:

- Correct Dreamina runtime model key is `dreamina_seedance_40_vision`.
- Label is `Dreamina Seedance 2.0 Fast`.
- Video generation currently uses runtime bridge, not the Dreamina UI input box.
- Reference images are passed in `unifiedEditInput.materialList`.
- Prompt is passed unchanged.
- Current upload service modules are:

```text
service getter: 673395.cQ
upload service id: 389946.H
older fallback: 98253
```

Do not change back to `dreamina_seedance_40`.
Do not remove `unifiedEditInput`.
Do not add prompt rewriting/sanitizing.

## Required Feature

Add a configurable local runner mode.

When this env var is set on `loohii-app`:

```text
DREAMINA_LOCAL_RUNNER_URL=http://host:4317
```

then Dreamina Web operations should call the local runner instead of using the Docker `dreamina-browser` CDP.

When it is not set, the current Docker browser path should keep working exactly as before.

## Server Integration Points

Update `server/src/ai/dreaminaWebBridge.ts`.

These exported functions should support local runner forwarding:

```ts
getDreaminaWebStatus()
callDreaminaWebVideoModel(input)
preflightDreaminaWebVideoUpload(input)
queryDreaminaWebVideoModel(submitId, options)
```

Suggested behavior:

```text
GET  {DREAMINA_LOCAL_RUNNER_URL}/status
POST {DREAMINA_LOCAL_RUNNER_URL}/generate-video
POST {DREAMINA_LOCAL_RUNNER_URL}/preflight-video
POST {DREAMINA_LOCAL_RUNNER_URL}/query-video
```

Recommended response wrapper:

```json
{
  "ok": true,
  "data": {}
}
```

Error response:

```json
{
  "ok": false,
  "error": "message"
}
```

The server should unwrap `data`. If HTTP status is not 2xx or `ok === false`, throw an error that Loohii can show in the generation failure message.

Recommended timeout env var:

```text
DREAMINA_LOCAL_RUNNER_TIMEOUT_MS=600000
```

Default: 10 minutes.

## Local Runner Script

Create a local runner script, suggested path:

```text
scripts/dreamina-local-runner.ts
```

The runner should:

- listen on `DREAMINA_LOCAL_RUNNER_PORT`, default `4317`
- connect to local Chrome CDP via `DREAMINA_LOCAL_CDP_URL`, default `http://127.0.0.1:9222`
- set `process.env.DREAMINA_BROWSER_CDP_URL = DREAMINA_LOCAL_CDP_URL`
- make sure `DREAMINA_LOCAL_RUNNER_URL` is not set inside the runner process, to avoid recursive forwarding
- import and reuse existing bridge functions from `server/src/ai/dreaminaWebBridge.ts`

Runner endpoints:

```text
GET  /status
POST /generate-video
POST /preflight-video
POST /query-video
```

`/generate-video` body:

```json
{
  "prompt": "string",
  "referenceImageUrls": ["https://..."],
  "referenceAudioUrls": [],
  "durationSeconds": 4,
  "ratio": "9:16",
  "resolution": "720p"
}
```

`/query-video` body:

```json
{
  "submitId": "string",
  "existingVideoUrls": []
}
```

## How User Starts Local Chrome

The user should start Chrome locally with CDP enabled and log in to Dreamina.

macOS:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/loohii-dreamina-chrome \
  --no-first-run \
  --no-default-browser-check \
  "https://dreamina.capcut.com/ai-tool/generate"
```

Linux:

```bash
google-chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/loohii-dreamina-chrome \
  --no-first-run \
  --no-default-browser-check \
  "https://dreamina.capcut.com/ai-tool/generate"
```

Then start runner:

```bash
DREAMINA_LOCAL_CDP_URL=http://127.0.0.1:9222 \
DREAMINA_LOCAL_RUNNER_PORT=4317 \
npx tsx scripts/dreamina-local-runner.ts
```

Check local runner:

```bash
curl http://127.0.0.1:4317/status
```

## Exposing Local Runner To Server

The production server must reach the local runner.

Use any private tunnel/VPN/reverse proxy the user controls. Then set on `loohii-app`:

```text
DREAMINA_LOCAL_RUNNER_URL=https://your-runner-url
```

Restart `loohii-app`.

Do not hardcode tunnel URLs in source code.

## Test Project Data

Use this for end-to-end testing.

User:

```text
id: cmq8cvumo0000l00tqtcjsi0i
email: 2175772771@qq.com
```

Project:

```text
id: cmq8dw07r0003l00tewomnzwd
name: 美式漫剧
```

Dreamina Web video model:

```text
id: cmq1kgktm00073kjetmawvqmu
```

Reference test image:

```text
https://www.loohii.com/api/uploads/public/dreamina-test/reference.png
```

## End-To-End Test Command

Generate JWT inside `loohii-app`:

```bash
TOKEN=$(docker exec -i loohii-app npx tsx - <<'TS' | tail -n 1
const { signToken } = require('./server/src/middleware/auth.ts');
console.log(signToken({ id: 'cmq8cvumo0000l00tqtcjsi0i', email: '2175772771@qq.com' }));
TS
)
```

Call project API from Docker network:

```bash
docker run --rm -i --network loohii_default -e TEST_TOKEN="$TOKEN" node:22-alpine node - <<'JS'
const token = process.env.TEST_TOKEN;
const body = {
  aiModelId: 'cmq1kgktm00073kjetmawvqmu',
  prompt: 'Generate one continuous 4s cinematic video, 9:16. Use the reference image as the main visual reference. Keep the subject, composition, colors, and style consistent with the uploaded image. Slow camera push in, subtle natural motion, calm atmosphere. No subtitles, speech bubbles, UI, panel borders, panel numbers, watermarks, or explanatory text.',
  referenceImageUrls: ['https://www.loohii.com/api/uploads/public/dreamina-test/reference.png'],
  referenceAudioUrls: [],
  durationSeconds: 4,
  ratio: '9:16',
  resolution: '720p'
};

(async()=>{
  const res = await fetch('http://loohii-app:3001/api/workflows/projects/cmq8dw07r0003l00tewomnzwd/workflow/canvas/generate-video', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000)
  });
  const text = await res.text();
  console.log('STATUS', res.status);
  console.log(text.slice(0, 70000));
})().catch(e=>{ console.error('ERR', e && (e.stack || e.message || e)); process.exit(1); });
JS
```

## Acceptance Criteria

Server-side:

- `npm run server:check` passes.
- `node --import tsx --test server/src/ai/dreaminaWebBridge.test.ts` passes.
- With no `DREAMINA_LOCAL_RUNNER_URL`, existing Docker browser behavior is unchanged.
- With `DREAMINA_LOCAL_RUNNER_URL`, Dreamina Web status/generation/query go through the runner.

Runner-side:

- `/status` reports local Chrome Dreamina login state.
- `/generate-video` returns the same shape as `callDreaminaWebVideoModel`.
- generated raw payload contains:

```text
submissionMode = runtime-bridge
modelReqKey = dreamina_seedance_40_vision
durationMs = 4000
unifiedEditInput.materialList.length >= 1
```

End-to-end:

- Project API creates/updates a generation record.
- If Dreamina succeeds, video is persisted as a project asset.
- If Dreamina fails, failure is shown with raw status and does not hang.

## Worktree Warning

This repo has many unrelated uncommitted changes. Do not run destructive git commands.

Before committing:

```bash
git status --short
git diff --stat
git diff --cached --stat
```

Only stage files relevant to local runner work.
