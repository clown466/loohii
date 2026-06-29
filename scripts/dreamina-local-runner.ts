import http from "node:http";

type JsonHandler = (body: unknown) => Promise<unknown>;

const port = numberFromEnv("DREAMINA_LOCAL_RUNNER_PORT", 4317);
const cdpUrl = process.env.DREAMINA_LOCAL_CDP_URL || process.env.DREAMINA_BROWSER_CDP_URL || "http://127.0.0.1:9222";

process.env.DREAMINA_BROWSER_CDP_URL = cdpUrl;
delete process.env.DREAMINA_LOCAL_RUNNER_URL;

const {
  callDreaminaWebVideoModel,
  getDreaminaWebStatus,
  preflightDreaminaWebVideoUpload,
  queryDreaminaWebVideoModel,
} = await import("../server/src/ai/dreaminaWebBridge.ts");

const handlers: Record<string, JsonHandler> = {
  "/status": async () => getDreaminaWebStatus(),
  "/generate-video": async (body) => callDreaminaWebVideoModel(videoInputFromBody(body)),
  "/preflight-video": async (body) => preflightDreaminaWebVideoUpload(videoInputFromBody(body)),
  "/query-video": async (body) => {
    const input = recordFromBody(body);
    const submitId = stringField(input, "submitId");
    if (!submitId) throw new Error("submitId is required.");
    const existingVideoUrls = Array.isArray(input.existingVideoUrls) ? input.existingVideoUrls.map(String) : [];
    return queryDreaminaWebVideoModel(submitId, { existingVideoUrls });
  },
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/status") {
      await sendJson(res, 200, { ok: true, data: await handlers["/status"]({}) });
      return;
    }

    if (req.method !== "POST" || !req.url || !handlers[req.url]) {
      await sendJson(res, 404, { ok: false, error: "Not found." });
      return;
    }

    const body = await readJson(req);
    const data = await handlers[req.url](body);
    await sendJson(res, 200, { ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Dreamina local runner failed.");
    await sendJson(res, 500, { ok: false, error: message });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Dreamina local runner listening on http://0.0.0.0:${port}`);
  console.log(`Dreamina Chrome CDP: ${cdpUrl}`);
});

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text);
}

async function sendJson(res: http.ServerResponse, status: number, body: unknown): Promise<void> {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

function videoInputFromBody(body: unknown) {
  const input = recordFromBody(body);
  const prompt = stringField(input, "prompt");
  if (!prompt) throw new Error("prompt is required.");
  return {
    prompt,
    referenceImageUrls: stringArrayField(input, "referenceImageUrls"),
    referenceAudioUrls: stringArrayField(input, "referenceAudioUrls"),
    durationSeconds: numberField(input, "durationSeconds"),
    ratio: stringField(input, "ratio") || undefined,
    resolution: stringField(input, "resolution") || undefined,
  };
}

function recordFromBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("JSON object body is required.");
  return body as Record<string, unknown>;
}

function stringField(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value.trim() : "";
}

function stringArrayField(input: Record<string, unknown>, key: string): string[] {
  const value = input[key];
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function numberField(input: Record<string, unknown>, key: string): number | undefined {
  const value = Number(input[key]);
  return Number.isFinite(value) ? value : undefined;
}

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}
