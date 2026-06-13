#!/usr/bin/env bash
set -euo pipefail

DISPLAY="${DISPLAY:-:99}"
SCREEN_SIZE="${DREAMINA_SCREEN_SIZE:-1280x800x24}"
CHROME_BIN="${CHROME_BIN:-/ms-playwright/chromium-1169/chrome-linux/chrome}"
CHROME_PROFILE="${CHROME_PROFILE:-/home/dreamina/.config/chromium}"
CHROME_URL="${DREAMINA_START_URL:-https://dreamina.capcut.com/ai-tool/home?type=video&workspace=0}"
CDP_TARGET_HOST="${CDP_TARGET_HOST:-127.0.0.1}"
CDP_TARGET_PORT="${CDP_TARGET_PORT:-9222}"
CDP_PROXY_PORT="${CDP_PROXY_PORT:-9223}"
VNC_PORT="${VNC_PORT:-5900}"
NOVNC_PORT="${NOVNC_PORT:-7900}"

cleanup() {
  jobs -pr | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

rm -f "/tmp/.X${DISPLAY#:}-lock" "/tmp/.X11-unix/X${DISPLAY#:}"
Xvfb "${DISPLAY}" -screen 0 "${SCREEN_SIZE}" &
sleep 2

rm -f \
  "${CHROME_PROFILE}/SingletonCookie" \
  "${CHROME_PROFILE}/SingletonLock" \
  "${CHROME_PROFILE}/SingletonSocket"

"${CHROME_BIN}" \
  --no-first-run \
  --no-sandbox \
  --enable-unsafe-swiftshader \
  --remote-debugging-port="${CDP_TARGET_PORT}" \
  --remote-allow-origins="*" \
  --disable-dev-shm-usage \
  --user-data-dir="${CHROME_PROFILE}" \
  --window-size="${DREAMINA_WINDOW_SIZE:-1280,800}" \
  "${CHROME_URL}" &

sleep "${DREAMINA_CHROME_BOOT_WAIT_SECONDS:-8}"

node /opt/dreamina/cdp-host-rewrite-proxy.js &
x11vnc -display "${DISPLAY}" -nopw -forever -shared -rfbport "${VNC_PORT}" &
websockify --web /usr/share/novnc "${NOVNC_PORT}" "localhost:${VNC_PORT}"
