import type { Express, Request, Response, NextFunction } from "express";
import http from "node:http";
import net from "node:net";
import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import type { OutgoingHttpHeaders } from "node:http";

const VNC_HOST = process.env.DREAMINA_VNC_PROXY_HOST || "vncc.loohii.com";
const VNC_PATH_PREFIX = process.env.DREAMINA_VNC_PATH_PREFIX || "/dreamina-browser";
const VNC_TARGET_HOST = process.env.DREAMINA_VNC_TARGET_HOST || "dreamina-browser";
const VNC_TARGET_PORT = Number(process.env.DREAMINA_VNC_TARGET_PORT || 7900);

export function installVncHttpProxy(app: Express) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isVncProxyRequest(req.headers.host, req.url)) return next();
    proxyVncHttpRequest(req, res);
  });
}

export function installVncUpgradeProxy(server: Server) {
  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (!isVncProxyRequest(req.headers.host, req.url)) return;
    proxyVncUpgradeRequest(req, socket, head);
  });
}

function isVncProxyRequest(hostHeader: string | undefined, url: string | undefined): boolean {
  const host = String(hostHeader || "").split(":")[0]?.toLowerCase();
  const path = String(url || "");
  return host === VNC_HOST.toLowerCase()
    || path === VNC_PATH_PREFIX
    || path.startsWith(`${VNC_PATH_PREFIX}/`)
    || path.startsWith("/websockify");
}

function proxyVncHttpRequest(req: Request, res: Response) {
  const path = vncTargetPath(req.url);
  const upstream = http.request({
    host: VNC_TARGET_HOST,
    port: VNC_TARGET_PORT,
    method: req.method,
    path,
    headers: vncProxyHeaders(req.headers),
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

function vncTargetPath(url: string | undefined): string {
  const raw = String(url || "/");
  const withoutPrefix = raw.startsWith(`${VNC_PATH_PREFIX}/`)
    ? raw.slice(VNC_PATH_PREFIX.length)
    : raw;
  return withoutPrefix === "/" || withoutPrefix === "" ? "/vnc.html" : withoutPrefix;
}

function vncProxyHeaders(headers: IncomingMessage["headers"]): OutgoingHttpHeaders {
  const next: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "undefined") continue;
    if (name.toLowerCase() === "origin") continue;
    next[name] = value;
  }
  next.host = `${VNC_TARGET_HOST}:${VNC_TARGET_PORT}`;
  return next;
}

function proxyVncUpgradeRequest(req: IncomingMessage, socket: Socket, head: Buffer) {
  const upstream = net.connect(VNC_TARGET_PORT, VNC_TARGET_HOST, () => {
    upstream.write(buildUpgradeRequest(req));
    if (head.length > 0) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
}

function buildUpgradeRequest(req: IncomingMessage): string {
  const lines = [`${req.method || "GET"} ${vncTargetPath(req.url)} HTTP/${req.httpVersion}`];
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "undefined") continue;
    if (name.toLowerCase() === "host") {
      lines.push(`host: ${VNC_TARGET_HOST}:${VNC_TARGET_PORT}`);
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
