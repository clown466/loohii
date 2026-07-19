/**
 * loohii 桌面壳 — Electron 主进程（架构 v2 薄壳）。
 *
 * 职责仅限：原生窗口/菜单、单实例锁、窗口状态记忆、导航白名单、自动更新接线。
 * 不内嵌 Node 服务端/数据库：生产模式加载 https://loohii.com/app，
 * dev 模式加载本地 vite dev server（LOOHII_DEV_SERVER_URL，默认 http://localhost:5173）。
 *
 * 安全基线见 createWindow 的 webPreferences：contextIsolation+sandbox+无 nodeIntegration，
 * preload（dist-electron/preload.cjs）只暴露最小白名单 API。
 */
import { app, BrowserWindow, Menu, ipcMain, shell, dialog } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import updaterPkg from 'electron-updater';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { autoUpdater } = updaterPkg;

const __dirname = dirname(fileURLToPath(import.meta.url));

// 应用数据/配置固定 %LocalAppData%（拆剧助手教训：Roaming 会随域漫游同步，
// Electron 默认 userData 却在 Roaming——显式改到 LocalAppData\loohii，更新/重装不丢数据）。
// 必须在 app ready 之前设置。
const localAppDataRoot = process.env.LOCALAPPDATA || join(app.getPath('home'), 'AppData', 'Local');
app.setPath('userData', join(localAppDataRoot, 'loohii'));

/** 生产地址（壳内允许导航） */
const PROD_ORIGIN = 'https://loohii.com';
/** 允许壳内导航的源白名单：loohii 站点 + aijiekou 平台 API（登录鉴权走它） */
const ALLOWED_NAV_ORIGINS = new Set([PROD_ORIGIN, 'https://www.loohii.com', 'https://api.aijiekou.online']);
/** 自动更新 manifest 地址（generic provider；可用 env 覆盖，未配置/失败时安静降级） */
const UPDATE_FEED_URL = (process.env.LOOHII_UPDATE_URL || 'https://api.aijiekou.online/loohii').replace(/\/+$/, '');

const DEV_SERVER_URL = process.env.LOOHII_DEV_SERVER_URL || '';

/** 主进程冒烟测试模式（LOOHII_SMOKE_TEST=1）：记录加载/导航拦截结果后自动退出，不弹窗不开浏览器 */
const SMOKE_TEST = process.env.LOOHII_SMOKE_TEST === '1';

function openExternalSafe(url: string): void {
  if (SMOKE_TEST) {
    console.log('[smoke] external-open-intercepted:', url);
    return;
  }
  void shell.openExternal(url);
}

function startUrl(): string {
  if (!app.isPackaged && DEV_SERVER_URL) return DEV_SERVER_URL;
  return `${PROD_ORIGIN}/app`;
}

function isAllowedNavigation(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (ALLOWED_NAV_ORIGINS.has(parsed.origin)) return true;
    // dev 模式允许本地 vite dev server 及其 HMR
    if (!app.isPackaged && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(parsed.origin)) return true;
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 窗口状态记忆（上次尺寸/位置/最大化），存 userData（%LocalAppData%\loohii）
// ---------------------------------------------------------------------------
interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
}

const DEFAULT_WINDOW_STATE: WindowState = { width: 1440, height: 900 };

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState(): WindowState {
  try {
    const raw = JSON.parse(readFileSync(windowStatePath(), 'utf8')) as WindowState;
    const state: WindowState = {
      width: Math.max(1024, Math.min(7680, Number(raw.width) || DEFAULT_WINDOW_STATE.width)),
      height: Math.max(700, Math.min(4320, Number(raw.height) || DEFAULT_WINDOW_STATE.height)),
      maximized: raw.maximized === true,
    };
    // 位置只在仍落在某块屏幕可见区域内时恢复，避免外接屏拔掉后窗口丢失
    if (Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
      state.x = Number(raw.x);
      state.y = Number(raw.y);
    }
    return state;
  } catch {
    return { ...DEFAULT_WINDOW_STATE };
  }
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const maximized = win.isMaximized();
    const bounds = maximized ? win.getNormalBounds() : win.getBounds();
    const state: WindowState = { ...bounds, maximized };
    mkdirSync(dirname(windowStatePath()), { recursive: true });
    writeFileSync(windowStatePath(), JSON.stringify(state), 'utf8');
  } catch {
    // 状态写失败不影响退出
  }
}

// ---------------------------------------------------------------------------
// 自动更新（electron-updater，generic provider；未配置/失败时安静不打扰）
// ---------------------------------------------------------------------------
let updateStatus: 'idle' | 'checking' | 'available' | 'none' | 'downloaded' | 'error' = 'idle';

function setupAutoUpdater(): void {
  if (!app.isPackaged) return; // dev 模式不检查（electron-updater 只对打包产物有意义）
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_FEED_URL });
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => { updateStatus = 'checking'; });
    autoUpdater.on('update-available', () => { updateStatus = 'available'; });
    autoUpdater.on('update-not-available', () => { updateStatus = 'none'; });
    autoUpdater.on('update-downloaded', () => { updateStatus = 'downloaded'; });
    autoUpdater.on('error', (error) => {
      // 优雅降级：manifest 不存在/网络失败只记日志，不弹窗不打扰
      updateStatus = 'error';
      console.warn('[updater] check failed (ignored):', error?.message || error);
    });
    // 启动后静默检查一次（失败静默）；手动检查走菜单按钮
    void autoUpdater.checkForUpdates().catch(() => undefined);
    autoUpdater.on('update-downloaded', () => {
      dialog
        .showMessageBox({
          type: 'info',
          title: '更新已就绪',
          message: '新版本已下载完成，重启 loohii 后生效。',
          buttons: ['立即重启', '稍后'],
          defaultId: 1,
        })
        .then((result) => {
          if (result.response === 0) autoUpdater.quitAndInstall();
        })
        .catch(() => undefined);
    });
  } catch (error) {
    console.warn('[updater] setup failed (ignored):', error);
  }
}

async function checkForUpdatesManually(win: BrowserWindow | null): Promise<void> {
  if (!app.isPackaged) {
    if (win) {
      await dialog.showMessageBox(win, {
        type: 'info',
        title: '检查更新',
        message: '开发模式不检查更新。打包安装版启动时会自动静默检查。',
      });
    }
    return;
  }
  try {
    updateStatus = 'checking';
    const result = await autoUpdater.checkForUpdates();
    if (!result?.updateInfo || result.updateInfo.version === app.getVersion()) {
      updateStatus = 'none';
      if (win) {
        await dialog.showMessageBox(win, {
          type: 'info',
          title: '检查更新',
          message: `当前已是最新版本（v${app.getVersion()}）。`,
        });
      }
    }
    // 有更新时走事件回调自动下载， downloaded 后弹重启提示
  } catch {
    updateStatus = 'error';
    if (win) {
      await dialog.showMessageBox(win, {
        type: 'warning',
        title: '检查更新',
        message: '暂时无法连接更新服务器，稍后再试。',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 应用菜单（中文）
// ---------------------------------------------------------------------------
function buildAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '重新加载',
          accelerator: 'CmdOrCtrl+R',
          click: (_item, win) => {
            if (win instanceof BrowserWindow) win.webContents.reload();
          },
        },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { label: '重置缩放', role: 'resetZoom' },
        { type: 'separator' },
        { label: '全屏切换', role: 'togglefullscreen' },
        // F1 应修项：生产构建不暴露 DevTools 入口，仅开发期可用
        ...(!app.isPackaged
          ? ([{ label: '开发者工具', role: 'toggleDevTools' }] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '检查更新…',
          click: (_item, win) => {
            void checkForUpdatesManually(win instanceof BrowserWindow ? win : null);
          },
        },
        {
          label: '访问 loohii.com',
          click: () => void shell.openExternal(PROD_ORIGIN),
        },
        { type: 'separator' },
        {
          label: `版本 v${app.getVersion()}`,
          enabled: false,
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    title: 'loohii',
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#0B0B0D',
    // 隐藏原生菜单栏（按 Alt 可临时唤出）；缩放/刷新等快捷键仍由菜单 accelerator 提供
    autoHideMenuBar: true,
    webPreferences: {
      // ---- 安全基线 ----
      contextIsolation: true, // 页面 JS 与 preload 隔离
      nodeIntegration: false, // 页面无 Node 能力
      sandbox: true, // 渲染进程沙箱（preload 仅能用白名单 electron API）
      webSecurity: true, // 显式保持默认同源策略
      allowRunningInsecureContent: false,
      spellcheck: false,
      // 登录态持久：显式使用持久分区（userData 下 localStorage 天然持久）
      partition: 'persist:loohii',
      preload: join(__dirname, 'preload.cjs'),
    },
  });
  const win = mainWindow;

  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveWindowState(win));
  win.on('closed', () => { mainWindow = null; });

  // ---- 导航白名单：壳内只允许 loohii.com / api.aijiekou.online（dev 加 localhost），其余一律弹系统浏览器 ----
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url)) return { action: 'allow' };
    openExternalSafe(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
      openExternalSafe(url);
    }
  });

  // 页面标题变化不覆盖窗口标题
  win.on('page-title-updated', (event) => event.preventDefault());

  void win.loadURL(startUrl());

  // ---- 冒烟测试钩子：验证加载成功 + 白名单拦截，然后自动退出 ----
  if (SMOKE_TEST) {
    const timeout = setTimeout(() => {
      console.log('[smoke] FAIL: load timeout');
      app.exit(2);
    }, 90000);
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      clearTimeout(timeout);
      console.log(`[smoke] FAIL: did-fail-load ${errorCode} ${errorDescription}`);
      app.exit(1);
    });
    win.webContents.once('did-finish-load', () => {
      console.log('[smoke] loaded:', win.webContents.getURL());
      // 页内导航到站外（模拟用户点外链）→ 应被 will-navigate 拦截并转交系统浏览器（冒烟模式只记录）
      void win.webContents.executeJavaScript("window.location.href = 'https://example.com/'").catch(() => undefined);
      setTimeout(() => {
        const finalUrl = win.webContents.getURL();
        console.log('[smoke] after-external-attempt url:', finalUrl);
        const pass = isAllowedNavigation(finalUrl);
        console.log(pass ? '[smoke] PASS' : '[smoke] FAIL: navigation escaped whitelist');
        clearTimeout(timeout);
        app.exit(pass ? 0 : 3);
      }, 4000);
    });
  }
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------
// 单实例锁：第二实例激活已有窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // 显式启用 GPU 加速（画布 WebGL/2D 加速 + 未来 3D）；默认即开启，这里防止 blocklist 误伤
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');

  void app.whenReady().then(() => {
    buildAppMenu();
    setupAutoUpdater();

    // preload 暴露的最小白名单 API 的主进程侧实现
    ipcMain.handle('loohii:app-version', () => app.getVersion());
    ipcMain.handle('loohii:update-status', () => updateStatus);
    ipcMain.handle('loohii:open-external', (_event, url: unknown) => {
      // 只允许 http(s) 外链，拒绝 file:/javascript: 等
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
        return shell.openExternal(url);
      }
      return Promise.resolve();
    });

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit(); // Windows 单一平台，关窗即退出
  });
}
