import assert from "node:assert/strict";
import test from "node:test";
import { buildTextModelRequestBodyForTest, formatEmptyTextModelResponseForTest } from "./textModel";

test("empty text model response reports HTML provider pages as base URL/config errors", () => {
  const message = formatEmptyTextModelResponseForTest(
    "unknown",
    "<!doctype html><html><head><title>4router</title></head><body>not an api response</body></html>",
  );

  assert.match(message, /returned HTML instead of API JSON/);
  assert.match(message, /Base URL/);
});

test("empty text model response keeps token-limit guidance for length finishes", () => {
  const message = formatEmptyTextModelResponseForTest("length", "");

  assert.match(message, /长度上限/);
});

test("anthropic providers send system prompt as top-level system parameter", () => {
  const body = buildTextModelRequestBodyForTest(
    {
      id: "model-claude",
      providerConfigId: "provider-claude",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      displayName: "claude-sonnet-4-6",
      modality: "text",
      capabilities: ["chat"],
      defaultParams: {},
      apiKeyEncrypted: null,
      isActive: true,
      providerConfig: {
        id: "provider-claude",
        displayName: "Claude AI",
        providerType: "anthropic",
        baseUrl: "https://4router.net/v1",
        apiKeyEncrypted: null,
        isActive: true,
      },
    },
    [
      { role: "system", content: "Return JSON only." },
      { role: "user", content: "Extract assets." },
    ],
    true,
  );

  assert.equal(body.system, "Return JSON only.");
  assert.deepEqual(body.messages, [{ role: "user", content: "Extract assets." }]);
  assert.equal("response_format" in body, false);
});
