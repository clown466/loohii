import assert from "node:assert/strict";
import test from "node:test";
import { textModelTestInternals as t } from "./textModel";

// --- isSuccessStatus ---

test("isSuccessStatus returns true for 2xx", () => {
  assert.equal(t.isSuccessStatus(200), true);
  assert.equal(t.isSuccessStatus(201), true);
  assert.equal(t.isSuccessStatus(299), true);
});

test("isSuccessStatus returns false for non-2xx", () => {
  assert.equal(t.isSuccessStatus(199), false);
  assert.equal(t.isSuccessStatus(300), false);
  assert.equal(t.isSuccessStatus(400), false);
  assert.equal(t.isSuccessStatus(500), false);
});

// --- shouldRetryTextModelStatus ---

test("shouldRetryTextModelStatus for retryable codes", () => {
  assert.equal(t.shouldRetryTextModelStatus(408), true);
  assert.equal(t.shouldRetryTextModelStatus(429), true);
  assert.equal(t.shouldRetryTextModelStatus(500), true);
  assert.equal(t.shouldRetryTextModelStatus(502), true);
  assert.equal(t.shouldRetryTextModelStatus(503), true);
  assert.equal(t.shouldRetryTextModelStatus(409), true);
});

test("shouldRetryTextModelStatus for non-retryable codes", () => {
  assert.equal(t.shouldRetryTextModelStatus(400), false);
  assert.equal(t.shouldRetryTextModelStatus(401), false);
  assert.equal(t.shouldRetryTextModelStatus(404), false);
  assert.equal(t.shouldRetryTextModelStatus(504), false);
});

// --- isLengthFinishReason ---

test("isLengthFinishReason matches known length reasons", () => {
  assert.equal(t.isLengthFinishReason("length"), true);
  assert.equal(t.isLengthFinishReason("max_tokens"), true);
  assert.equal(t.isLengthFinishReason("token_limit"), true);
  assert.equal(t.isLengthFinishReason("LENGTH"), true);
});

test("isLengthFinishReason rejects other reasons", () => {
  assert.equal(t.isLengthFinishReason("stop"), false);
  assert.equal(t.isLengthFinishReason(""), false);
  assert.equal(t.isLengthFinishReason("content_filter"), false);
});

// --- formatEmptyTextModelResponse ---

test("formatEmptyTextModelResponse for length finish reason", () => {
  const msg = t.formatEmptyTextModelResponse("length");
  assert.match(msg, /长度上限/);
});

test("formatEmptyTextModelResponse for other finish reason", () => {
  const msg = t.formatEmptyTextModelResponse("stop");
  assert.match(msg, /empty response/);
});

// --- formatTextModelHttpError ---

test("formatTextModelHttpError uses error message from payload", () => {
  const msg = t.formatTextModelHttpError(401, "Unauthorized", { error: { message: "Invalid API key" } }, "", undefined);
  assert.match(msg, /Invalid API key/);
  assert.match(msg, /401/);
});

test("formatTextModelHttpError handles 504 gateway timeout", () => {
  const msg = t.formatTextModelHttpError(504, "Gateway Timeout", {}, "", undefined);
  assert.match(msg, /504/);
  assert.match(msg, /超时/);
});

test("formatTextModelHttpError handles 502 with retry context", () => {
  const msg = t.formatTextModelHttpError(502, "Bad Gateway", {}, "", { attempt: 2, maxAttempts: 3, durationMs: 5000 });
  assert.match(msg, /502/);
  assert.match(msg, /2\/3/);
});

test("formatTextModelHttpError falls back to raw text summary", () => {
  const msg = t.formatTextModelHttpError(503, "Service Unavailable", null, "<html><body>Down</body></html>", undefined);
  assert.match(msg, /503/);
  assert.match(msg, /Down/);
});

// --- summarizeNonJsonResponse ---

test("summarizeNonJsonResponse strips HTML tags", () => {
  const result = t.summarizeNonJsonResponse("<html><body><p>Error occurred</p></body></html>");
  assert.match(result, /Error occurred/);
  assert.doesNotMatch(result, /<html>/);
});

test("summarizeNonJsonResponse strips script and style tags", () => {
  const result = t.summarizeNonJsonResponse('<script>alert("x")</script><style>.x{}</style>Hello');
  assert.equal(result, "Hello");
});

test("summarizeNonJsonResponse truncates to 180 chars", () => {
  const long = "x".repeat(300);
  const result = t.summarizeNonJsonResponse(long);
  assert.ok(result.length <= 180);
});

// --- isAbortError ---

test("isAbortError detects AbortError", () => {
  const err = new DOMException("The operation was aborted", "AbortError");
  assert.equal(t.isAbortError(err), true);
});

test("isAbortError rejects other errors", () => {
  assert.equal(t.isAbortError(new Error("timeout")), false);
  assert.equal(t.isAbortError(null), false);
  assert.equal(t.isAbortError("abort"), false);
});

// --- formatSeconds ---

test("formatSeconds converts milliseconds to seconds label", () => {
  assert.equal(t.formatSeconds(60000), "60 秒");
  assert.equal(t.formatSeconds(1500), "2 秒");
  assert.equal(t.formatSeconds(500), "1 秒");
});

// --- looksLikeTextModel ---

function modelLike(displayName: string, model: string) {
  return {
    id: "test",
    providerConfigId: null,
    provider: "openai-compatible",
    model,
    displayName,
    modality: "unknown",
    capabilities: {},
    defaultParams: null,
    apiKeyEncrypted: null,
    isActive: true,
  };
}

test("looksLikeTextModel identifies known text models", () => {
  assert.equal(t.looksLikeTextModel(modelLike("GPT-4o", "gpt-4o")), true);
  assert.equal(t.looksLikeTextModel(modelLike("Claude 3.5", "claude-3.5-sonnet")), true);
  assert.equal(t.looksLikeTextModel(modelLike("Gemini Pro", "gemini-pro")), true);
  assert.equal(t.looksLikeTextModel(modelLike("DeepSeek", "deepseek-chat")), true);
  assert.equal(t.looksLikeTextModel(modelLike("Qwen", "qwen-turbo")), true);
});

test("looksLikeTextModel rejects image/video models", () => {
  assert.equal(t.looksLikeTextModel(modelLike("FLUX", "flux-1-dev")), false);
  assert.equal(t.looksLikeTextModel(modelLike("Stable Diffusion", "sdxl")), false);
  assert.equal(t.looksLikeTextModel(modelLike("Seedance", "seedance-v1")), false);
});

// --- isTextModel ---

test("isTextModel identifies by modality", () => {
  assert.equal(t.isTextModel({ ...modelLike("test", "test"), modality: "text" }), true);
  assert.equal(t.isTextModel({ ...modelLike("test", "test"), modality: "chat" }), true);
  assert.equal(t.isTextModel({ ...modelLike("test", "test"), modality: "llm" }), true);
});

test("isTextModel identifies by capabilities object", () => {
  assert.equal(t.isTextModel({ ...modelLike("test", "test"), capabilities: { chat: true } }), true);
  assert.equal(t.isTextModel({ ...modelLike("test", "test"), capabilities: { "text-generation": true } }), true);
  assert.equal(t.isTextModel({ ...modelLike("test", "test"), capabilities: { "structured-output": true } }), true);
});

test("isTextModel identifies by capabilities array", () => {
  assert.equal(t.isTextModel({ ...modelLike("test", "test"), capabilities: ["chat"] }), true);
});

// --- defaultMaxTokensForModel ---

test("defaultMaxTokensForModel returns higher budget for deepseek/reasoner models", () => {
  assert.equal(t.defaultMaxTokensForModel(modelLike("DeepSeek R1", "deepseek-r1")), 6000);
  assert.equal(t.defaultMaxTokensForModel(modelLike("Reasoner", "reasoner-v1")), 6000);
});

test("defaultMaxTokensForModel returns higher budget for gemini", () => {
  assert.equal(t.defaultMaxTokensForModel(modelLike("Gemini Pro", "gemini-pro")), 8000);
});

test("defaultMaxTokensForModel returns 4000 for standard models", () => {
  assert.equal(t.defaultMaxTokensForModel(modelLike("GPT-4o", "gpt-4o")), 4000);
});

// --- expandedMaxTokensForModel ---

test("expandedMaxTokensForModel expands gemini to 12000", () => {
  assert.equal(t.expandedMaxTokensForModel(modelLike("Gemini", "gemini-pro"), 4000), 12000);
});

test("expandedMaxTokensForModel expands standard to 8000", () => {
  assert.equal(t.expandedMaxTokensForModel(modelLike("GPT-4", "gpt-4"), 4000), 8000);
});

test("expandedMaxTokensForModel keeps current if already higher", () => {
  assert.equal(t.expandedMaxTokensForModel(modelLike("GPT-4", "gpt-4"), 10000), 10000);
});

// --- capabilitiesToArray ---

test("capabilitiesToArray converts object to enabled keys", () => {
  assert.deepEqual(t.capabilitiesToArray({ chat: true, image: false, "text-generation": true }), ["chat", "text-generation"]);
});

test("capabilitiesToArray handles array input", () => {
  assert.deepEqual(t.capabilitiesToArray(["chat", "streaming"]), ["chat", "streaming"]);
});

test("capabilitiesToArray returns empty for non-object", () => {
  assert.deepEqual(t.capabilitiesToArray(null), []);
  assert.deepEqual(t.capabilitiesToArray("string"), []);
  assert.deepEqual(t.capabilitiesToArray(42), []);
});

// --- resolveChatCompletionsEndpoint ---

test("resolveChatCompletionsEndpoint appends /chat/completions", () => {
  const url = t.resolveChatCompletionsEndpoint("https://api.openai.com/v1");
  assert.equal(url.href, "https://api.openai.com/v1/chat/completions");
});

test("resolveChatCompletionsEndpoint strips trailing slashes", () => {
  const url = t.resolveChatCompletionsEndpoint("https://api.example.com/v1/");
  assert.equal(url.href, "https://api.example.com/v1/chat/completions");
});

test("resolveChatCompletionsEndpoint falls back to default for empty URL", () => {
  const url = t.resolveChatCompletionsEndpoint("");
  assert.match(url.href, /\/chat\/completions$/);
});

// --- extractTextModelContent ---

test("extractTextModelContent extracts from standard choices[0].message.content", () => {
  const result = t.extractTextModelContent({
    choices: [{ message: { content: "Hello world" } }],
  });
  assert.equal(result.rawText, "Hello world");
  assert.equal(result.source, "choices[0].message.content");
});

test("extractTextModelContent extracts from output_text", () => {
  const result = t.extractTextModelContent({ output_text: "Direct output" });
  assert.equal(result.rawText, "Direct output");
  assert.equal(result.source, "output_text");
});

test("extractTextModelContent returns undefined for empty payload", () => {
  const result = t.extractTextModelContent({});
  assert.equal(result.rawText, undefined);
});

test("extractTextModelContent extracts from tool_calls arguments", () => {
  const result = t.extractTextModelContent({
    choices: [{
      message: {
        tool_calls: [{ function: { arguments: '{"key":"value"}' } }],
      },
    }],
  });
  assert.equal(result.rawText, '{"key":"value"}');
});

// --- parseJsonOrRaw ---

test("parseJsonOrRaw parses valid JSON", () => {
  assert.deepEqual(t.parseJsonOrRaw('{"key":"value"}'), { key: "value" });
});

test("parseJsonOrRaw wraps invalid JSON", () => {
  assert.deepEqual(t.parseJsonOrRaw("not json"), { raw: "not json" });
});

test("parseJsonOrRaw returns null for empty string", () => {
  assert.equal(t.parseJsonOrRaw(""), null);
});
