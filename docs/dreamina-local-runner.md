# Dreamina Local Runner

Use this when Dreamina works in a local Chrome browser but the server-side Docker browser is rejected.

The Loohii server still owns project state, generation records, and video persistence. The local runner only submits Dreamina Web tasks through a Chrome instance running on the user's machine.

## 1. Start Local Chrome With CDP

On the local machine where Dreamina works, close extra Chrome instances for the dedicated profile, then start Chrome with remote debugging.

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

Log in to Dreamina in that Chrome window.

## 2. Start The Runner

From the Loohii repo on the same local machine:

```bash
DREAMINA_LOCAL_CDP_URL=http://127.0.0.1:9222 \
DREAMINA_LOCAL_RUNNER_PORT=4317 \
npx tsx scripts/dreamina-local-runner.ts
```

Check:

```bash
curl http://127.0.0.1:4317/status
```

## 3. Expose Runner To The Server

The production server must be able to reach the runner URL.

Use a secure tunnel or private network. Example with a tunnel URL:

```text
https://your-runner-tunnel.example.com
```

Then set on the Loohii server:

```bash
DREAMINA_LOCAL_RUNNER_URL=https://your-runner-tunnel.example.com
```

Restart `loohii-app`.

## 4. Behavior

With `DREAMINA_LOCAL_RUNNER_URL` set:

- `getDreaminaWebStatus()` calls the local runner `/status`
- Dreamina Web video generation calls `/generate-video`
- Dreamina Web video preflight calls `/preflight-video`
- Dreamina Web query calls `/query-video`

Without `DREAMINA_LOCAL_RUNNER_URL`, Loohii keeps using the existing Docker `dreamina-browser` path.

## Notes

- The runner must stay open while generation is running.
- The runner uses the same Dreamina runtime bridge as the server.
- The project prompt, reference images, duration, ratio, and resolution are still created by Loohii.
- Do not set `DREAMINA_LOCAL_RUNNER_URL` inside the runner process itself.
