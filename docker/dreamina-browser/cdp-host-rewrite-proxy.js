const http = require("http");
const net = require("net");

const targetHost = process.env.CDP_TARGET_HOST || "127.0.0.1";
const targetPort = Number(process.env.CDP_TARGET_PORT || "9222");
const listenPort = Number(process.env.CDP_PROXY_PORT || "9223");
const advertisedHost = process.env.CDP_ADVERTISED_HOST || "dreamina-browser";

function rewriteJson(buffer) {
  const text = buffer.toString().replace(
    /ws:\/\/[^"/]+\/devtools\//g,
    `ws://${advertisedHost}:${listenPort}/devtools/`,
  );
  return Buffer.from(text);
}

const server = http.createServer((req, res) => {
  const headers = { ...req.headers, host: `${targetHost}:${targetPort}` };
  const upstream = http.request({
    host: targetHost,
    port: targetPort,
    path: req.url,
    method: req.method,
    headers,
  }, (upstreamResponse) => {
    const chunks = [];
    upstreamResponse.on("data", (chunk) => chunks.push(chunk));
    upstreamResponse.on("end", () => {
      let body = Buffer.concat(chunks);
      const contentType = String(upstreamResponse.headers["content-type"] || "");
      if (contentType.includes("json")) body = rewriteJson(body);
      const outputHeaders = { ...upstreamResponse.headers };
      delete outputHeaders["content-length"];
      res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.statusMessage, outputHeaders);
      res.end(body);
    });
  });
  upstream.on("error", (error) => {
    res.writeHead(502);
    res.end(String(error.message || error));
  });
  req.pipe(upstream);
});

server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(targetPort, targetHost, () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    const headers = { ...req.headers, host: `${targetHost}:${targetPort}` };
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        for (const item of value) lines.push(`${key}: ${item}`);
      } else if (value != null) {
        lines.push(`${key}: ${value}`);
      }
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  socket.on("error", () => {
    upstream.destroy();
  });
  upstream.on("end", () => {
    socket.destroy();
  });
  socket.on("end", () => {
    upstream.destroy();
  });
  upstream.on("error", () => socket.destroy());
});

server.listen(listenPort, "0.0.0.0", () => {
  console.log(`CDP host-rewrite proxy listening on 0.0.0.0:${listenPort}, target ${targetHost}:${targetPort}`);
});
