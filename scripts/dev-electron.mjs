/**
 * 一条命令起桌面壳开发环境：
 *   node scripts/dev-electron.mjs
 * ① 编译 electron/ → dist-electron/  ② 起 vite dev server  ③ 等 5173 就绪后起 Electron 壳（加载本地 dev server）
 * Ctrl+C 时三个进程一起退出。
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);
const electronBin = require('electron'); // node_modules/electron 导出的可执行路径

const VITE_PORT = process.env.LOOHII_DEV_PORT || '5173';
const VITE_URL = `http://localhost:${VITE_PORT}`;

const children = [];
function run(name, command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'inherit', shell: false, ...options });
  child.on('error', (error) => {
    console.error(`[dev:electron] ${name} 启动失败:`, error.message);
    shutdown(1);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const child of children.splice(0)) {
    try { child.kill('SIGTERM'); } catch { /* already dead */ }
  }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function waitForServer(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok) return;
    } catch { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`等待 ${url} 就绪超时`);
}

// ① 编译主进程/preload（Windows 上 .cmd 必须 shell:true）
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const SHELL = process.platform === 'win32';
await new Promise((resolve, reject) => {
  const compile = spawn(npxCmd, ['tsc', '-p', 'electron/tsconfig.json'], { stdio: 'inherit', shell: SHELL });
  compile.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`electron 编译失败（tsc exit ${code}）`))));
  compile.on('error', reject);
});

// ② vite dev server
run('vite', npxCmd, ['vite', '--port', VITE_PORT, '--strictPort'], { shell: SHELL });

// ③ 等就绪后起壳；壳退出时联动退出 vite
await waitForServer(VITE_URL);
const shellProcess = run('electron', electronBin, ['.'], {
  env: { ...process.env, LOOHII_DEV_SERVER_URL: VITE_URL },
});
shellProcess.on('exit', (code) => shutdown(code ?? 0));

console.log(`[dev:electron] Electron 壳已加载 ${VITE_URL}（Ctrl+C 全部退出）`);
