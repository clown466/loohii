# OpenCode Handoff: Dreamina Web Video Generation

Date: 2026-06-13
Repo: `/projects/loohii`
Current committed Dreamina fix: `407f2fe Fix Dreamina web runtime bridge`

## Current Goal

Continue work on Loohii's Dreamina Web video generation path.

The project-side Dreamina chain has already been fixed to:

- use Dreamina Seedance 2.0 Fast runtime key `dreamina_seedance_40_vision`
- upload reference images through Dreamina runtime services
- submit video tasks through Dreamina runtime bridge instead of page UI controls
- expose noVNC through the Loohii app path proxy
- run a managed `dreamina-browser` Docker container with CDP host rewrite proxy

The remaining problem is not that the project fails to pass model/reference/duration. The server-side Dreamina environment is currently rejected by Dreamina with an account/environment risk response:

```text
statusCode: -6
recordStatus: 3
errorMsg: shark not pass reject
failStarlingMessage: Couldn't generate due to unusual activity in your account. Try again later.
```

The user's local browser can generate normally. The VPS/Docker/noVNC browser currently cannot.

## Important Context

Do not assume the old failure was caused by prompt wording. It was previously caused by a combination of:

- wrong Dreamina model key in early attempts: `dreamina_seedance_40`
- stale UI composer state
- runtime upload service module IDs changing on Dreamina
- CDP proxy crashes on WebSocket disconnect
- finally, after fixes, Dreamina returning account/environment risk rejection

The current committed implementation proves the runtime payload is correct.

Last successful project-interface test reached Dreamina backend and returned:

```text
generationId: cmqcuv3p90001pl0tedvv5jwk
submitId: 7a460bbb-95f6-4468-99b3-a5208f6ad1b6
modelReqKey: dreamina_seedance_40_vision
durationMs: 4000
videoAspectRatio: 9:16
uploadedReferenceImageCount: 1
materialList[0].imageInfo.imageUri: tos-alisg-i-wopfjsm1ax-sg/cc466430a0c449c4a9e57efe65dd706d
failure: shark not pass reject / unusual activity
```

This means the reference image is being passed to Dreamina. Do not rework prompt logic to solve a missing-reference problem unless you have new evidence.

## Current Runtime State

Containers after latest reset:

- `loohii-app`: running `loohii-app:latest`
- `dreamina-browser`: running `dreamina-browser:latest`
- `loohii-postgres`: running
- `loohii-redis`: running

The current Dreamina browser was recreated with a clean Chrome data volume:

```text
dreamina_chrome_data10
```

noVNC URL:

```text
https://www.loohii.com/dreamina-browser/
```

CDP endpoint used by app:

```text
http://dreamina-browser:9223
```

The current browser may need the user to log in again before testing.

Check status:

```bash
docker exec -i loohii-app npx tsx - <<'TS'
const { getDreaminaWebStatus } = require('./server/src/ai/dreaminaWebBridge.ts');
(async()=>console.log(JSON.stringify(await getDreaminaWebStatus(), null, 2)))()
  .catch(e=>{ console.error(e); process.exit(1); });
TS
```

## Files Changed In Commit `407f2fe`

Dreamina runtime and browser infrastructure:

- `server/src/ai/dreaminaWebBridge.ts`
- `server/src/ai/dreaminaWebBridge.test.ts`
- `Dockerfile.dreamina-browser`
- `docker/dreamina-browser/start.sh`
- `docker/dreamina-browser/cdp-host-rewrite-proxy.js`
- `server/src/vncProxy.ts`
- `server/src/http.ts`
- `server/src/index.ts`
- `Dockerfile.loohii`
- `docker-compose.production.yml`
- `.dockerignore`

Key implementation notes:

- `DREAMINA_SEEDANCE_2_FAST_VIDEO_MODEL_KEY = "dreamina_seedance_40_vision"`
- generation now returns `submitWithRuntimeBridge()` before the old UI flow
- upload service resolution uses current Dreamina modules:

```text
service getter: 673395.cQ
upload service id: 389946.H
fallback kept for older modules: 98253
```

- runtime task uses `createAIGCVideoTask`
- reference images are represented in `unifiedEditInput.materialList`
- prompt is passed unchanged as `input.prompt`
- no prompt sanitizer / Dreamina-safe rewrite should be added without explicit user request

## Verification Already Run

Both passed before commit:

```bash
npm run server:check
node --import tsx --test server/src/ai/dreaminaWebBridge.test.ts
```

Docker images were rebuilt and containers restarted during testing:

```bash
docker build -f Dockerfile.loohii -t loohii-app:latest .
docker build -f Dockerfile.dreamina-browser -t dreamina-browser:latest .
```

## Worktree Warning

The repo has many unrelated uncommitted changes from other work. Do not reset or revert them.

At the time this handoff was written, `git status --short` included many modified frontend files, deleted UI component files, and untracked helper modules. These were intentionally not included in commit `407f2fe`.

Before making a new commit, inspect:

```bash
git status --short
git diff --stat
git diff --cached --stat
```

Only stage files relevant to your task.

## Useful Test Project Data

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
provider: dreamina-web
videoModel: seedance2.0
modelVersion: seedance2.0fast
```

Reference test image:

```text
https://www.loohii.com/api/uploads/public/dreamina-test/reference.png
```

Container local path:

```text
/var/lib/loohii/uploads/dreamina-test/reference.png
```

## Project Interface Test

Generate a JWT inside `loohii-app`:

```bash
TOKEN=$(docker exec -i loohii-app npx tsx - <<'TS' | tail -n 1
const { signToken } = require('./server/src/middleware/auth.ts');
console.log(signToken({ id: 'cmq8cvumo0000l00tqtcjsi0i', email: '2175772771@qq.com' }));
TS
)
```

Call project interface from same Docker network:

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

Expected if environment is still blocked:

```text
STATUS 200
generation.status = FAILED
raw.submissionMode = runtime-bridge
raw.result.taskInput.input.modelReqKey = dreamina_seedance_40_vision
raw.result.taskInput.input.videoGenInputs[0].durationMs = 4000
raw.result.taskInput.input.videoGenInputs[0].unifiedEditInput.materialList.length = 1
errorMessage contains shark not pass reject / unusual activity
```

Expected if the new environment/account state is accepted:

```text
genStatus = running or succeeded
submitId present
eventual video asset persisted into project records
```

## Suggested Next Work

The user's goal is to make Dreamina generation usable from the project despite VPS/Docker environment rejection.

Technically clean options:

1. Local Chrome Runner

Use the user's local Chrome, where Dreamina generation works, as an execution runner. The server sends the prompt/reference/duration to a local runner endpoint, and the runner submits through local CDP.

2. External CDP Endpoint

If the user provides a working CDP endpoint from any browser environment they control, configure the server to use it:

```text
DREAMINA_BROWSER_CDP_URL=http://host:port
```

Then run the same 4s project-interface test.

3. Wait and Retest

Since Dreamina returned account/environment risk rejection, waiting may clear it. Retest with the same project-interface command.

## Do Not Repeat These Mistakes

- Do not switch back to `dreamina_seedance_40`; it is not the right runtime key for reference video.
- Do not remove references from `unifiedEditInput`.
- Do not sanitize or rewrite the user's prompt unless explicitly requested.
- Do not assume noVNC white screen means Dreamina runtime is broken; check CDP status first.
- Do not use string-only webpack module IDs without fallback; current working upload modules are numeric `673395` and `389946`.
- Do not commit unrelated worktree changes.
