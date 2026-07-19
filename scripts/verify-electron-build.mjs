/**
 * electron-builder 产物完整性校验（dist:win 构建后自动执行）：
 * - NSIS 安装包 exe 存在且大小合理（> 50MB，含 Electron 运行时）
 * - latest.yml（自动更新 manifest）已生成且版本与 package.json 一致
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const RELEASE_DIR = 'release';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

const failures = [];
const entries = existsSync(RELEASE_DIR) ? readdirSync(RELEASE_DIR) : [];

const setupExe = entries.find((name) => name.endsWith('.exe') && /setup/i.test(name));
if (!setupExe) {
  failures.push(`未找到 NSIS 安装包（${RELEASE_DIR}/*Setup*.exe）`);
} else {
  const sizeMB = statSync(join(RELEASE_DIR, setupExe)).size / 1048576;
  if (sizeMB < 50) failures.push(`安装包体积异常（${sizeMB.toFixed(1)}MB < 50MB），可能不完整`);
  console.log(`[verify] 安装包: ${join(RELEASE_DIR, setupExe)} (${sizeMB.toFixed(1)}MB)`);
}

const latestYml = join(RELEASE_DIR, 'latest.yml');
if (!existsSync(latestYml)) {
  failures.push('未生成 latest.yml（自动更新 manifest 缺失）');
} else {
  const content = readFileSync(latestYml, 'utf8');
  if (!content.includes(`version: ${pkg.version}`)) {
    failures.push(`latest.yml 版本与 package.json(${pkg.version}) 不一致`);
  }
  console.log(`[verify] latest.yml: version ${pkg.version} OK`);
}

if (failures.length > 0) {
  console.error('[verify] 产物校验失败:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('[verify] 产物完整性校验通过');
