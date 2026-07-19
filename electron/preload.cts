/**
 * loohii 桌面壳 preload（沙箱内运行，仅能用白名单 electron API）。
 * 向页面暴露 window.loohiiShell 最小 API：版本、更新状态、打开外部链接。
 * 页面可通过 `'loohiiShell' in window` 判断自己运行在桌面壳内。
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('loohiiShell', {
  /** 壳（安装包）版本号，如 "0.1.0" */
  appVersion: (): Promise<string> => ipcRenderer.invoke('loohii:app-version'),
  /** 自动更新状态：idle/checking/available/none/downloaded/error */
  updateStatus: (): Promise<string> => ipcRenderer.invoke('loohii:update-status'),
  /** 用系统默认浏览器打开 http(s) 外链（主进程校验协议） */
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('loohii:open-external', url),
  platform: process.platform,
} as const);
