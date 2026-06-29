import assert from "node:assert/strict";
import test from "node:test";
import { buildImageHttpRequestForTest, normalizeGeneratedImagesForTest, type ImageAiModelLike } from "./imageModel";

function imageModel(baseUrl: string, defaultParams: unknown = null): ImageAiModelLike {
  return {
    id: "model-aizahuo-gpt-image-2",
    providerConfigId: "provider-aizahuo",
    provider: "openai-compatible",
    model: "gpt-image-2",
    displayName: "gpt-image-2",
    modality: "image",
    capabilities: {
      "image-edit": true,
      "text-to-image": true,
      "image-to-image": true,
      "multi-reference-image": true,
    },
    defaultParams,
    costCredits: 0,
    apiKeyEncrypted: null,
    isActive: true,
    providerConfig: {
      id: "provider-aizahuo",
      displayName: "aizahuo",
      providerType: "openai-compatible",
      baseUrl,
      apiKeyEncrypted: null,
      isActive: true,
    },
  };
}

function jimengImageModel(): ImageAiModelLike {
  return {
    id: "model-jimeng-image",
    providerConfigId: "provider-jimeng",
    provider: "jimeng-api",
    model: "jimeng",
    displayName: "Jimeng Image",
    modality: "image",
    capabilities: {
      "text-to-image": true,
      "image-to-image": true,
    },
    defaultParams: null,
    costCredits: 0,
    apiKeyEncrypted: null,
    isActive: true,
    providerConfig: {
      id: "provider-jimeng",
      displayName: "Jimeng/Dreamina API",
      providerType: "jimeng-api",
      baseUrl: "http://127.0.0.1:5100",
      apiKeyEncrypted: null,
      isActive: true,
    },
  };
}

test("aizahuo gpt-image-2 references use responses endpoint and pixel dimensions", () => {
  const request = buildImageHttpRequestForTest(imageModel("https://aizahuo.shop/v1"), "make this image cleaner", {
    image_urls: ["https://example.com/reference.png"],
    size: "16:9",
    resolution: "2k",
    quality: "high",
    format: "png",
  });

  assert.equal(request.endpoint.href, "https://aizahuo.shop/v1/responses");
  assert.equal(request.body.model, "gpt-5.5");
  assert.equal("prompt" in request.body, false);
  assert.equal(request.body.background, true);
  assert.equal(request.body.stream, false);
  assert.deepEqual(request.body.tool_choice, { type: "image_generation" });
  assert.deepEqual(request.body.tools, [{
    type: "image_generation",
    model: "gpt-image-2",
    size: "2048x1152",
    quality: "high",
    output_format: "png",
  }]);
  assert.deepEqual(request.body.input, [{
    type: "message",
    role: "user",
    content: [
      { type: "input_text", text: "make this image cleaner" },
      { type: "input_image", image_url: "https://example.com/reference.png" },
    ],
  }]);
  assert.equal("image_urls" in request.body, false);
  assert.equal("reference_images" in request.body, false);
  assert.equal("format" in request.body, false);
});

test("jimeng image model uses ratio and resolution instead of OpenAI size", () => {
  const request = buildImageHttpRequestForTest(jimengImageModel(), "draw a blue circle", {
    size: "1536x1024",
    quality: "2k",
    format: "png",
  });

  assert.equal(request.endpoint.href, "http://127.0.0.1:5100/v1/images/generations");
  assert.equal(request.body.model, "jimeng");
  assert.equal(request.body.prompt, "draw a blue circle");
  assert.equal(request.body.ratio, "3:2");
  assert.equal(request.body.resolution, "2k");
  assert.equal("size" in request.body, false);
  assert.equal("quality" in request.body, false);
  assert.equal("format" in request.body, false);
  assert.equal("output_format" in request.body, false);
});

test("aizahuo gpt-image-2 generations default to pixel dimensions", () => {
  const request = buildImageHttpRequestForTest(imageModel("https://aizahuo.shop/v1"), "draw a blue circle", {});

  assert.equal(request.endpoint.href, "https://aizahuo.shop/v1/responses");
  assert.equal(request.body.model, "gpt-5.5");
  assert.equal(request.body.background, true);
  assert.deepEqual(request.body.tool_choice, { type: "image_generation" });
  assert.deepEqual(request.body.tools, [{
    type: "image_generation",
    model: "gpt-image-2",
    size: "1024x1024",
    quality: "high",
  }]);
});

test("aizahuo gpt-image-2 responses model can be overridden by model defaults", () => {
  const request = buildImageHttpRequestForTest(
    imageModel("https://aizahuo.shop/v1", { responses_model: "gpt-5.4" }),
    "draw a cinematic comic panel",
    {},
  );

  assert.equal(request.endpoint.href, "https://aizahuo.shop/v1/responses");
  assert.equal(request.body.model, "gpt-5.4");
  assert.equal(request.body.background, true);
  assert.deepEqual(request.body.tools, [{
    type: "image_generation",
    model: "gpt-image-2",
    size: "1024x1024",
    quality: "high",
  }]);
});

test("aizahuo gpt-image-2 preserves explicit pixel dimensions", () => {
  const request = buildImageHttpRequestForTest(imageModel("https://aizahuo.shop/v1"), "draw a cinematic wide shot", {
    size: "1824x1024",
    resolution: "1k",
  });

  assert.equal(request.endpoint.href, "https://aizahuo.shop/v1/responses");
  assert.equal(request.body.model, "gpt-5.5");
  assert.equal(request.body.background, true);
  assert.deepEqual(request.body.tool_choice, { type: "image_generation" });
  assert.deepEqual(request.body.tools, [{
    type: "image_generation",
    model: "gpt-image-2",
    size: "1824x1024",
    quality: "high",
  }]);
});

test("aizahuo gpt-image-2 responses background mode can be disabled per request", () => {
  const request = buildImageHttpRequestForTest(imageModel("https://aizahuo.shop/v1"), "draw a blue circle", {
    responses_background: false,
  });

  assert.equal(request.endpoint.href, "https://aizahuo.shop/v1/responses");
  assert.equal("background" in request.body, false);
});

test("aizahuo gpt-image-2 maps common aspect ratios to valid pixel dimensions", () => {
  const wide = buildImageHttpRequestForTest(imageModel("https://aizahuo.shop/v1"), "draw a cinematic ultra wide shot", {
    size: "21:9",
    resolution: "2k",
  });
  const square4k = buildImageHttpRequestForTest(imageModel("https://aizahuo.shop/v1"), "draw a detailed square poster", {
    size: "1:1",
    resolution: "4k",
  });
  const tall = buildImageHttpRequestForTest(imageModel("https://aizahuo.shop/v1"), "draw a tall mobile comic panel", {
    size: "1:3",
    resolution: "1k",
  });

  assert.deepEqual(wide.body.tools, [{
    type: "image_generation",
    model: "gpt-image-2",
    size: "2048x880",
    quality: "high",
  }]);
  assert.deepEqual(square4k.body.tools, [{
    type: "image_generation",
    model: "gpt-image-2",
    size: "2880x2880",
    quality: "high",
  }]);
  assert.deepEqual(tall.body.tools, [{
    type: "image_generation",
    model: "gpt-image-2",
    size: "1024x3072",
    quality: "high",
  }]);
});

test("responses image_generation output result is normalized as base64 image", () => {
  const images = normalizeGeneratedImagesForTest({
    output: [{
      id: "ig_123",
      type: "image_generation_call",
      result: "aGVsbG8=",
      revised_prompt: "draw a blue circle",
    }],
  });

  assert.deepEqual(images, [{
    url: "data:image/png;base64,aGVsbG8=",
    revisedPrompt: "draw a blue circle",
    providerId: "ig_123",
  }]);
});

test("responses image_generation output is normalized even while provider marks call generating", () => {
  const images = normalizeGeneratedImagesForTest({
    id: "resp_123",
    status: "completed",
    output: [{
      id: "ig_456",
      type: "image_generation_call",
      status: "generating",
      result: "aGVsbG8=",
    }],
  });

  assert.deepEqual(images, [{
    url: "data:image/png;base64,aGVsbG8=",
    revisedPrompt: undefined,
    providerId: "ig_456",
  }]);
});
