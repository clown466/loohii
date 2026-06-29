import type { Express, Request, Response, NextFunction } from "express";
import http from "node:http";
import net from "node:net";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import type { OutgoingHttpHeaders } from "node:http";

interface VncProxyConfig {
  host: string;
  pathPrefix: string;
  targetHost: string;
  targetPort: number;
}

const DREAMINA_VNC: VncProxyConfig = {
  host: process.env.DREAMINA_VNC_PROXY_HOST || "vncc.loohii.com",
  pathPrefix: process.env.DREAMINA_VNC_PATH_PREFIX || "/dreamina-browser",
  targetHost: process.env.DREAMINA_VNC_TARGET_HOST || "dreamina-browser",
  targetPort: Number(process.env.DREAMINA_VNC_TARGET_PORT || 7900),
};

const ROXY_VNC: VncProxyConfig = {
  host: "",
  pathPrefix: process.env.ROXY_VNC_PATH_PREFIX || "/roxy-browser",
  targetHost: process.env.ROXY_VNC_TARGET_HOST || "172.19.0.6",
  targetPort: Number(process.env.ROXY_VNC_TARGET_PORT || 6082),
};

const ALL_PROXIES = [DREAMINA_VNC, ROXY_VNC];

export function installVncHttpProxy(app: Express) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const config = matchVncProxy(req.headers.host, req.url);
    if (!config) return next();
    proxyVncHttpRequest(req, res, config);
  });
}

export function installVncUpgradeProxy(server: Server) {
  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const config = matchVncProxy(req.headers.host, req.url);
    if (!config) return;
    proxyVncUpgradeRequest(req, socket, head, config);
  });
}

function matchVncProxy(hostHeader: string | undefined, url: string | undefined): VncProxyConfig | null {
  const host = String(hostHeader || "").split(":")[0]?.toLowerCase();
  const path = String(url || "").split("?")[0];
  for (const config of ALL_PROXIES) {
    if ((config.host && host === config.host.toLowerCase())
      || path === config.pathPrefix
      || path.startsWith(`${config.pathPrefix}/`)) {
      return config;
    }
  }
  // Fallback: bare /websockify goes to dreamina-browser (legacy noVNC clients)
  if (path.startsWith("/websockify")) return DREAMINA_VNC;
  return null;
}

function proxyVncHttpRequest(req: Request, res: Response, config: VncProxyConfig) {
  const rawPath = String(req.url || "/").split("?")[0];
  const withoutPrefix = rawPath.startsWith(`${config.pathPrefix}/`)
    ? rawPath.slice(config.pathPrefix.length)
    : rawPath;
  if (withoutPrefix === "/" || withoutPrefix === "") {
    const wsPath = encodeURIComponent(`${config.pathPrefix.slice(1)}/websockify`);
    res.redirect(302, `${config.pathPrefix}/vnc.html?path=${wsPath}`);
    return;
  }
  const targetPath = vncTargetPath(req.url, config.pathPrefix);
  const upstream = http.request({
    host: config.targetHost,
    port: config.targetPort,
    method: req.method,
    path: targetPath,
    headers: vncProxyHeaders(req.headers, config),
  }, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.statusMessage, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on("error", (error) => {
    if (!res.headersSent) {
      res.status(502).type("text/plain").send(`noVNC proxy error: ${error.message}`);
      return;
    }
    res.end();
  });
  req.pipe(upstream);
}

function vncTargetPath(url: string | undefined, pathPrefix: string): string {
  const raw = String(url || "/");
  const withoutPrefix = raw.startsWith(`${pathPrefix}/`)
    ? raw.slice(pathPrefix.length)
    : raw;
  return withoutPrefix === "/" || withoutPrefix === "" ? "/vnc.html" : withoutPrefix;
}

function vncProxyHeaders(headers: IncomingMessage["headers"], config: VncProxyConfig): OutgoingHttpHeaders {
  const next: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "undefined") continue;
    if (name.toLowerCase() === "origin") continue;
    next[name] = value;
  }
  next.host = `${config.targetHost}:${config.targetPort}`;
  return next;
}

function proxyVncUpgradeRequest(req: IncomingMessage, socket: Socket, head: Buffer, config: VncProxyConfig) {
  const upstream = net.connect(config.targetPort, config.targetHost, () => {
    upstream.write(buildUpgradeRequest(req, config));
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
}

function buildUpgradeRequest(req: IncomingMessage, config: VncProxyConfig): string {
  const lines = [`${req.method || "GET"} ${vncTargetPath(req.url, config.pathPrefix)} HTTP/${req.httpVersion}`];
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "undefined") continue;
    if (name.toLowerCase() === "host") {
      lines.push(`host: ${config.targetHost}:${config.targetPort}`);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) lines.push(`${name}: ${item}`);
      continue;
    }
    lines.push(`${name}: ${value}`);
  }
  return `${lines.join("\r\n")}\r\n\r\n`;
}
