import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config";
import { getDreaminaWebStatus, isDreaminaWebProvider } from "../ai/dreaminaWebBridge";
import { callImageModel, isImageModel } from "../ai/imageModel";
import { asyncRoute } from "../lib/asyncRoute";
import { badRequest, notFound, routeParam, unauthorized } from "../lib/httpErrors";
import { isRecord } from "../lib/mappers";
import {
  apiKeyLast4,
  decryptModelConfigSecret,
  encryptModelConfigSecret,
} from "../lib/modelConfigCrypto";
import { prisma } from "../lib/prisma";
import { created, ok } from "../lib/response";
import { requireAuth } from "../middleware/auth";

const router = Router();

const providerSchema = z.object({
  displayName: z.string().min(1).max(160),
  providerType: z.string().min(1).max(80),
  baseUrl: z.string().max(500).optional().nullable(),
  apiKey: z.string().max(1000).optional(),
  isActive: z.boolean().optional(),
});

const modelSchema = z.object({
  providerConfigId: z.string().optional().nullable(),
  provider: z.string().min(1).max(120).optional(),
  model: z.string().min(1).max(160),
  displayName: z.string().min(1).max(160),
  modality: z.string().min(1).max(60),
  capabilities: z.union([z.array(z.string()), z.record(z.string(), z.unknown())]).optional(),
  defaultParams: z.record(z.string(), z.unknown()).optional(),
  costCredits: z.number().int().min(0).optional(),
  apiKey: z.string().max(1000).optional(),
  isActive: z.boolean().optional(),
});

const draftModelTestSchema = z.object({
  existingModelId: z.string().optional().nullable(),
  providerConfigId: z.string().min(1),
  model: z.string().min(1).max(160),
  displayName: z.string().min(1).max(160).optional(),
  modality: z.string().min(1).max(60),
  capabilities: z.union([z.array(z.string()), z.record(z.string(), z.unknown())]).optional(),
  defaultParams: z.record(z.string(), z.unknown()).optional(),
  apiKey: z.string().max(1000).optional(),
});

router.use(requireAuth);

router.get(
  "/",
  asyncRoute(async (req, res) => {
    const modelConfigsOnly = req.baseUrl.endsWith("/model-configs");
    if (modelConfigsOnly) {
      enforceModelConfigAdmin(req);
      res.setHeader("Cache-Control", "no-store");
    }
    const providersPromise = prisma.providerConfig.findMany({
      where: { isActive: true },
      orderBy: [{ isActive: "desc" }, { displayName: "asc" }],
    });
    const modelsPromise = prisma.aiModel.findMany({
        where: modelConfigsOnly ? { providerConfigId: { not: null }, isActive: true } : { isActive: true },
        include: { providerConfig: true },
        orderBy: [{ provider: "asc" }, { displayName: "asc" }],
    });
    const [providers, models] = await Promise.all([providersPromise, modelsPromise]);

    const data = {
      providers: providers.map(serializeProvider),
      models: models.map((model: AiModelLike) => serializeModel(model, { includeApiKey: modelConfigsOnly })),
    };

    if (req.baseUrl.endsWith("/models")) {
      ok(res, data.models);
      return;
    }

    ok(res, data);
  }),
);

router.post(
  "/providers",
  requireModelConfigAdmin,
  asyncRoute(async (req, res) => {
    const input = providerSchema.parse(req.body);
    const apiKey = sanitizeModelSecretInput(input.apiKey);
    const provider = await prisma.providerConfig.create({
      data: {
        displayName: input.displayName.trim(),
        providerType: input.providerType.trim(),
        baseUrl: normalizeOptionalString(input.baseUrl),
        ...(apiKey
          ? {
              apiKeyEncrypted: encryptModelConfigSecret(apiKey),
              apiKeyLast4: apiKeyLast4(apiKey),
            }
          : {}),
        isActive: input.isActive ?? true,
      },
    });

    created(res, serializeProvider(provider));
  }),
);

router.get(
  "/providers",
  asyncRoute(async (_req, res) => {
    const providers = await prisma.providerConfig.findMany({
      where: { isActive: true },
      orderBy: [{ isActive: "desc" }, { displayName: "asc" }],
    });
    ok(res, providers.map(serializeProvider));
  }),
);

router.get(
  "/providers/:providerId",
  asyncRoute(async (req, res) => {
    const providerId = routeParam(req.params.providerId, "providerId");
    const provider = await prisma.providerConfig.findUnique({ where: { id: providerId } });
    if (!provider) notFound("Provider config not found");
    ok(res, serializeProvider(provider));
  }),
);

router.patch(
  "/providers/:providerId",
  requireModelConfigAdmin,
  asyncRoute(async (req, res) => {
    const providerId = routeParam(req.params.providerId, "providerId");
    const existing = await prisma.providerConfig.findUnique({ where: { id: providerId } });
    if (!existing) notFound("Provider config not found");

    const input = providerSchema.partial().parse(req.body);
    const apiKey = sanitizeModelSecretInput(input.apiKey);
    const provider = await prisma.providerConfig.update({
      where: { id: existing.id },
      data: {
        ...(input.displayName === undefined ? {} : { displayName: input.displayName.trim() }),
        ...(input.providerType === undefined ? {} : { providerType: input.providerType.trim() }),
        ...(input.baseUrl === undefined ? {} : { baseUrl: normalizeOptionalString(input.baseUrl) }),
        ...(apiKey
          ? {
              apiKeyEncrypted: encryptModelConfigSecret(apiKey),
              apiKeyLast4: apiKeyLast4(apiKey),
            }
          : {}),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
    });

    ok(res, serializeProvider(provider));
  }),
);

router.post(
  "/providers/:providerId/test",
  requireModelConfigAdmin,
  asyncRoute(async (req, res) => {
    const providerId = routeParam(req.params.providerId, "providerId");
    const provider = await prisma.providerConfig.findUnique({ where: { id: providerId } });
    if (!provider) notFound("Provider config not found");

    const result = await testProvider(provider);
    await prisma.providerConfig.update({
      where: { id: provider.id },
      data: {
        testStatus: result.ok ? "ok" : "failed",
        testLatencyMs: result.latencyMs,
        testError: result.ok ? null : result.message,
        lastTestedAt: new Date(),
      },
    });

    ok(res, result);
  }),
);

router.post(
  "/test-draft",
  requireModelConfigAdmin,
  asyncRoute(async (req, res) => {
    const input = draftModelTestSchema.parse(req.body);
    const providerConfig = await prisma.providerConfig.findUnique({ where: { id: input.providerConfigId } });
    if (!providerConfig) badRequest("Provider config not found");

    const existingModel = input.existingModelId
      ? await prisma.aiModel.findUnique({ where: { id: input.existingModelId } })
      : null;
    if (input.existingModelId && !existingModel) notFound("Model not found");

    const apiKey = sanitizeModelSecretInput(input.apiKey);
    const now = new Date();
    const modelName = input.model.trim();
    const draftModel: AiModelLike = {
      id: existingModel?.id ?? "draft-model-test",
      providerConfigId: providerConfig.id,
      provider: providerConfig.providerType,
      model: modelName,
      displayName: input.displayName?.trim() || modelName,
      modality: input.modality,
      capabilities: normalizeCapabilities(input.capabilities ?? inferredCapabilitiesForModality(input.modality)),
      defaultParams: input.defaultParams ?? {},
      costCredits: existingModel?.costCredits ?? 0,
      apiKeyEncrypted: apiKey ? encryptModelConfigSecret(apiKey) : existingModel?.apiKeyEncrypted ?? null,
      apiKeyLast4: apiKey ? apiKeyLast4(apiKey) : existingModel?.apiKeyLast4 ?? null,
      isActive: true,
      providerConfig,
      createdAt: existingModel?.createdAt ?? now,
      updatedAt: now,
    };

    ok(res, await testModel(draftModel));
  }),
);

router.delete(
  "/providers/:providerId",
  requireModelConfigAdmin,
  asyncRoute(async (req, res) => {
    const providerId = routeParam(req.params.providerId, "providerId");
    const existing = await prisma.providerConfig.findUnique({ where: { id: providerId } });
    if (!existing) notFound("Provider config not found");
    await prisma.providerConfig.update({ where: { id: existing.id }, data: { isActive: false } });
    ok(res, { deleted: true });
  }),
);

router.post(
  "/",
  requireModelConfigAdmin,
  asyncRoute(async (req, res) => {
    const input = modelSchema.parse(req.body);
    const providerConfig = input.providerConfigId
      ? await prisma.providerConfig.findUnique({ where: { id: input.providerConfigId } })
      : null;
    if (input.providerConfigId && !providerConfig) {
      badRequest("Provider config not found");
    }

    const providerKey = providerConfig?.id ?? input.provider?.trim() ?? providerConfig?.providerType;
    if (!providerKey) {
      badRequest("provider or providerConfigId is required");
    }

    const existing = await prisma.aiModel.findUnique({
      where: { provider_model_modality: { provider: providerKey, model: input.model.trim(), modality: input.modality } },
    });
    const apiKey = sanitizeModelSecretInput(input.apiKey);
    const data = {
      providerConfigId: providerConfig?.id ?? null,
      provider: providerKey,
      model: input.model.trim(),
      displayName: input.displayName.trim(),
      modality: input.modality,
      capabilities: normalizeCapabilities(input.capabilities ?? inferredCapabilitiesForModality(input.modality)),
      defaultParams: input.defaultParams ?? {},
      costCredits: input.costCredits ?? 1,
      ...(apiKey
        ? {
            apiKeyEncrypted: encryptModelConfigSecret(apiKey),
            apiKeyLast4: apiKeyLast4(apiKey),
          }
        : {}),
      isActive: input.isActive ?? true,
    };

    const model = existing
      ? await prisma.aiModel.update({
          where: { id: existing.id },
          data,
          include: { providerConfig: true },
        })
      : await prisma.aiModel.create({
          data,
          include: { providerConfig: true },
        });

    created(res, serializeModel(model));
  }),
);

router.post(
  "/:modelId/test",
  requireModelConfigAdmin,
  asyncRoute(async (req, res) => {
    const modelId = routeParam(req.params.modelId, "modelId");
    const model = await prisma.aiModel.findUnique({
      where: { id: modelId },
      include: { providerConfig: true },
    });
    if (!model) notFound("Model not found");
    if (!model.providerConfig) badRequest("Model is not linked to a provider config");
    ok(res, await testModel(model));
  }),
);

router.patch(
  "/:modelId",
  requireModelConfigAdmin,
  asyncRoute(async (req, res) => {
    const modelId = routeParam(req.params.modelId, "modelId");
    const existing = await prisma.aiModel.findUnique({ where: { id: modelId } });
    if (!existing) notFound("Model not found");

    const input = modelSchema.partial().parse(req.body);
    const apiKey = input.apiKey?.trim();
    const providerConfig = input.providerConfigId
      ? await prisma.providerConfig.findUnique({ where: { id: input.providerConfigId } })
      : undefined;
    if (input.providerConfigId && !providerConfig) {
      badRequest("Provider config not found");
    }

    const nextModality = input.modality ?? existing.modality;
    const nextCapabilities =
      input.capabilities !== undefined
        ? normalizeCapabilities(input.capabilities)
        : input.modality !== undefined
          ? normalizeCapabilities(inferredCapabilitiesForModality(nextModality))
          : undefined;

    const model = await prisma.aiModel.update({
      where: { id: existing.id },
      data: {
        ...(providerConfig === undefined
          ? {}
          : {
              providerConfigId: providerConfig?.id ?? null,
              provider: providerConfig?.id ?? input.provider ?? existing.provider,
            }),
        ...(input.provider !== undefined && providerConfig === undefined
          ? { provider: input.provider.trim() }
          : {}),
        ...(input.model === undefined ? {} : { model: input.model.trim() }),
        ...(input.displayName === undefined ? {} : { displayName: input.displayName.trim() }),
        ...(input.modality === undefined ? {} : { modality: input.modality }),
        ...(nextCapabilities === undefined ? {} : { capabilities: nextCapabilities }),
        ...(input.defaultParams === undefined ? {} : { defaultParams: input.defaultParams }),
        ...(input.costCredits === undefined ? {} : { costCredits: input.costCredits }),
        ...(apiKey
          ? {
              apiKeyEncrypted: encryptModelConfigSecret(apiKey),
              apiKeyLast4: apiKeyLast4(apiKey),
            }
          : {}),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
      include: { providerConfig: true },
    });

    ok(res, serializeModel(model));
  }),
);

router.delete(
  "/:modelId",
  requireModelConfigAdmin,
  asyncRoute(async (req, res) => {
    const modelId = routeParam(req.params.modelId, "modelId");
    const existing = await prisma.aiModel.findUnique({ where: { id: modelId } });
    if (!existing) notFound("Model not found");
    await prisma.aiModel.update({ where: { id: modelId }, data: { isActive: false } });
    ok(res, { deleted: true });
  }),
);

export const modelsRouter = router;

function serializeProvider(provider: ProviderConfigLike) {
  const apiKey = decryptModelApiKeyForResponse(provider.apiKeyEncrypted);
  return {
    id: provider.id,
    displayName: provider.displayName,
    providerType: provider.providerType,
    baseUrl: provider.baseUrl ?? undefined,
    hasApiKey: Boolean(provider.apiKeyEncrypted),
    apiKeyLast4: provider.apiKeyLast4 ?? undefined,
    apiKeyMasked: maskedSecretForDisplay(apiKey, provider.apiKeyLast4),
    isActive: provider.isActive,
    testStatus: provider.testStatus ?? undefined,
    testLatencyMs: provider.testLatencyMs ?? undefined,
    testError: provider.testError ?? undefined,
    lastTestedAt: provider.lastTestedAt?.toISOString(),
    createdAt: provider.createdAt.toISOString(),
    updatedAt: provider.updatedAt.toISOString(),
  };
}

function serializeModel(model: AiModelLike, options: { includeApiKey?: boolean } = {}) {
  const decryptedApiKey = decryptModelApiKeyForResponse(model.apiKeyEncrypted);
  const apiKey = options.includeApiKey ? decryptedApiKey : undefined;
  return {
    id: model.id,
    providerConfigId: model.providerConfigId ?? undefined,
    provider: model.providerConfig?.providerType ?? model.provider,
    model: model.model,
    displayName: model.displayName,
    modality: model.modality,
    capabilities: capabilitiesToArray(model.capabilities),
    defaultParams: model.defaultParams,
    costCredits: model.costCredits,
    hasApiKey: Boolean(model.apiKeyEncrypted),
    apiKey,
    apiKeyLast4: model.apiKeyLast4 ?? undefined,
    apiKeyMasked: maskedSecretForDisplay(decryptedApiKey, model.apiKeyLast4),
    isActive: model.isActive,
    providerConfig: model.providerConfig ? serializeProvider(model.providerConfig) : undefined,
    createdAt: model.createdAt.toISOString(),
    updatedAt: model.updatedAt.toISOString(),
  };
}

function maskedSecretForDisplay(secret: string | undefined, last4: string | null) {
  if (!last4) return undefined;
  const prefix = secret?.match(/^(us|hk|jp|sg)-/i)?.[0].toLowerCase() ?? "";
  return `${prefix}****${last4}`;
}

function decryptModelApiKeyForResponse(apiKeyEncrypted: string | null) {
  if (!apiKeyEncrypted) return undefined;
  try {
    return decryptModelConfigSecret(apiKeyEncrypted);
  } catch {
    return undefined;
  }
}

function sanitizeModelSecretInput(value: string | undefined | null) {
  return value?.trim().replace(/^Bearer\s+/i, "") || "";
}

async function testProvider(provider: ProviderConfigLike, apiKeyEncryptedOverride?: string | null, allowModelKeyFallback = true) {
  const started = Date.now();

  if (provider.providerType === "mock") {
    return {
      ok: true,
      status: "ok",
      message: "Mock provider is available.",
      latencyMs: 0,
    };
  }

  if (isJimengApiProvider(provider)) {
    return testJimengApiProvider(provider, started, apiKeyEncryptedOverride, allowModelKeyFallback);
  }

  if (isDreaminaWebProvider(provider)) {
    return testDreaminaWebProvider(started);
  }

  if (!provider.baseUrl) {
    return testError(started, "Base URL is required.");
  }

  const encryptedApiKey = apiKeyEncryptedOverride ?? (allowModelKeyFallback ? await resolveProviderTestApiKey(provider) : null);
  if (!encryptedApiKey) {
    return testError(started, "API Key is configured per model. Add or edit a model API Key, then test the model.");
  }

  const endpoint = resolveProviderModelsEndpoint(provider.baseUrl);
  if (typeof endpoint === "string") {
    return testError(started, endpoint);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(endpoint.href, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${decryptModelConfigSecret(encryptedApiKey)}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      return {
        ok: false,
        status: "error",
        message: `Provider returned HTTP ${response.status}.`,
        error: `Provider returned ${response.status}`,
        latencyMs,
      };
    }

    return { ok: true, status: "ok", message: `连接测试成功 (${latencyMs}ms)`, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const message = error instanceof Error ? error.message : "Provider test failed.";
    return {
      ok: false,
      status: "error",
      message,
      error: message,
      latencyMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function testModel(model: AiModelLike) {
  const started = Date.now();
  const kind = normalizeModelKind(model.modality, capabilitiesToArray(model.capabilities));
  if (!model.providerConfig) return testError(started, "Model is not linked to a provider config.");

  if (isJimengApiProvider(model.providerConfig) && kind !== "image") {
    return testJimengApiProvider(model.providerConfig, started, resolveModelApiKeyEncrypted(model), false, model.model);
  }

  if (isDreaminaWebProvider(model.providerConfig)) {
    const result = await testDreaminaWebProvider(started);
    return {
      ...result,
      message: result.ok ? `Dreamina Web 模型可用：${result.message}` : result.message,
    };
  }

  if (kind === "text") {
    return testTextModel(model);
  }

  if (kind === "image" || (kind === "unknown" && isImageModel(model))) {
    try {
      const result = await callImageModel(model, {
        prompt: "A simple tiny test image: a blue circle on a white background.",
        count: 1,
      });
      return {
        ok: true,
        status: "ok",
        message: `图片模型测试成功 (${result.durationMs}ms)，返回 ${result.images.length} 张图片。`,
        latencyMs: result.durationMs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image model test failed.";
      return {
        ok: false,
        status: "error",
        message,
        error: message,
        latencyMs: Date.now() - started,
      };
    }
  }

  const providerResult = await testProvider(model.providerConfig, resolveModelApiKeyEncrypted(model), false);
  return {
    ...providerResult,
    message: providerResult.ok
      ? `${labelForModelKind(kind)}模型暂使用供应商连通性测试：${providerResult.message}`
      : providerResult.message,
  };
}

async function testTextModel(model: AiModelLike) {
  const started = Date.now();
  const provider = model.providerConfig;
  if (!provider) return testError(started, "Model is not linked to a provider config.");
  if (!provider.baseUrl) return testError(started, "Base URL is required.");
  const encryptedApiKey = resolveModelApiKeyEncrypted(model);
  if (!encryptedApiKey) return testError(started, "Model API Key is required.");

  const endpoint = resolveChatCompletionsEndpoint(provider.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const defaultParams = isRecord(model.defaultParams) ? model.defaultParams : {};
    const response = await fetch(endpoint.href, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${decryptModelConfigSecret(encryptedApiKey)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        temperature: 0,
        max_tokens: 8,
        ...defaultParams,
        model: model.model,
        messages: [{ role: "user", content: "Reply with OK." }],
      }),
      signal: controller.signal,
    });
    const rawText = await response.text();
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      return {
        ok: false,
        status: "error",
        message: `文本模型测试失败（${response.status}）：${summarizeNonJsonResponse(rawText) || response.statusText}`,
        error: rawText.slice(0, 500),
        latencyMs,
      };
    }
    return {
      ok: true,
      status: "ok",
      message: `文本模型测试成功 (${latencyMs}ms)`,
      latencyMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Text model test failed.";
    return {
      ok: false,
      status: "error",
      message,
      error: message,
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function testError(started: number, message: string) {
  return {
    ok: false,
    status: "error",
    message,
    error: message,
    latencyMs: Date.now() - started,
  };
}

async function testJimengApiProvider(
  provider: ProviderConfigLike,
  started: number,
  apiKeyEncryptedOverride?: string | null,
  allowModelKeyFallback = true,
  modelName?: string,
) {
  const baseUrl = provider.baseUrl?.trim() || "http://127.0.0.1:5100";
  const encryptedApiKey = apiKeyEncryptedOverride ?? (allowModelKeyFallback ? await resolveProviderTestApiKey(provider) : null);
  if (!encryptedApiKey) {
    return testError(started, "请在模型 API Key 里填写 Dreamina/Jimeng sessionid。国际站按 jimeng-api 规则加 us-/hk-/jp-/sg- 前缀。");
  }

  let endpoint: URL;
  try {
    endpoint = new URL("/token/check", `${baseUrl.replace(/\/+$/, "")}/`);
  } catch {
    return testError(started, "Jimeng API Base URL must be valid, for example http://127.0.0.1:5100.");
  }

  const sessionToken = decryptModelConfigSecret(encryptedApiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(endpoint.href, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: sessionToken }),
      signal: controller.signal,
    });
    const rawText = await response.text();
    const latencyMs = Date.now() - started;
    const payload = parseJsonMaybe(rawText);
    if (!response.ok) {
      return {
        ok: false,
        status: "error",
        message: `Jimeng API 测试失败（${response.status}）：${summarizeNonJsonResponse(rawText) || response.statusText}`,
        error: rawText.slice(0, 500),
        latencyMs,
      };
    }
    const live = isRecord(payload) ? Boolean(payload.live) : false;
    if (!live) {
      return {
        ok: false,
        status: "error",
        message: "Session 测试未通过：token/check 返回 live=false，请重新从 Dreamina/Jimeng Cookie 获取 sessionid。",
        error: rawText.slice(0, 500),
        latencyMs,
      };
    }
    const modelHint = modelName ? `，模型 ${modelName}` : "";
    return {
      ok: true,
      status: "ok",
      message: `Jimeng API session 有效${modelHint} (${latencyMs}ms)。测试不消耗视频积分。`,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const message = error instanceof Error && error.name === "AbortError"
      ? "Jimeng API 测试超时，请确认 5100 服务可访问。"
      : error instanceof Error
        ? error.message
        : "Jimeng API test failed.";
    return {
      ok: false,
      status: "error",
      message,
      error: message,
      latencyMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function testDreaminaWebProvider(started: number) {
  const status = await getDreaminaWebStatus();
  const latencyMs = Date.now() - started;
  return {
    ok: status.ok,
    status: status.ok ? "ok" : "error",
    message: status.message,
    error: status.ok ? undefined : status.message,
    latencyMs,
    raw: {
      connected: status.connected,
      loggedIn: status.loggedIn,
      url: status.url,
      title: status.title,
      publicUrl: status.publicUrl,
    },
  };
}

async function resolveProviderTestApiKey(provider: ProviderConfigLike): Promise<string | null> {
  if (provider.apiKeyEncrypted) return provider.apiKeyEncrypted;
  const model = await prisma.aiModel.findFirst({
    where: {
      providerConfigId: provider.id,
      apiKeyEncrypted: { not: null },
      isActive: true,
    },
    orderBy: { updatedAt: "desc" },
    select: { apiKeyEncrypted: true },
  });
  return model?.apiKeyEncrypted ?? null;
}

function resolveModelApiKeyEncrypted(model: AiModelLike): string | null {
  return model.apiKeyEncrypted ?? model.providerConfig?.apiKeyEncrypted ?? null;
}

function normalizeModelKind(modality: string, capabilities: string[] = []) {
  const normalized = modality.trim().toLowerCase();
  const normalizedCapabilities = capabilities.map((item) => item.trim().toLowerCase());
  if (["text", "chat", "llm"].includes(normalized)) return "text";
  if (normalizedCapabilities.some((item) => ["chat", "text-generation", "structured-output"].includes(item))) return "text";
  if (normalized === "image" || normalizedCapabilities.some((item) => item.includes("image"))) return "image";
  if (normalized === "video" || normalizedCapabilities.some((item) => item.includes("video"))) return "video";
  if (normalized === "audio" || normalizedCapabilities.some((item) => item.includes("audio") || item.includes("speech") || item.includes("voice"))) return "audio";
  return "unknown";
}

function labelForModelKind(kind: string) {
  if (kind === "video") return "视频";
  if (kind === "audio") return "音频";
  if (kind === "image") return "图片";
  return "文本";
}

function resolveChatCompletionsEndpoint(baseUrl: string): URL {
  const url = new URL(baseUrl.trim());
  const pathname = url.pathname.replace(/\/+$/, "");
  return new URL(`${pathname}/chat/completions`, url.origin);
}

function summarizeNonJsonResponse(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function parseJsonMaybe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isJimengApiProvider(provider: ProviderConfigLike): boolean {
  const value = `${provider.providerType} ${provider.displayName} ${provider.baseUrl || ""}`.toLowerCase();
  return value.includes("jimeng-api") || value.includes("dreamina-api") || value.includes("jimeng");
}

function requireModelConfigAdmin(req: Request, _res: Response, next: NextFunction) {
  enforceModelConfigAdmin(req);
  next();
}

function enforceModelConfigAdmin(req: Request) {
  const adminEmails = (process.env.MODEL_CONFIG_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (adminEmails.length === 0) return;
  if (req.user?.email && adminEmails.includes(req.user.email.toLowerCase())) return;
  unauthorized("Only model configuration administrators can manage model settings.");
}

function resolveProviderModelsEndpoint(baseUrl: string): URL | string {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return "Base URL must be a valid absolute URL.";
  }

  if (url.username || url.password) {
    return "Base URL must not include credentials.";
  }

  const hostname = url.hostname.toLowerCase();
  const localDevHttp = config.nodeEnv !== "production" && url.protocol === "http:" && isLoopbackHost(hostname);
  if (url.protocol !== "https:" && !localDevHttp) {
    return "Base URL must use HTTPS.";
  }

  if (isPrivateHost(hostname) && !localDevHttp) {
    return "Base URL cannot point to localhost or a private network.";
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  return new URL(`${pathname}/models`, url.origin);
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function isPrivateHost(hostname: string): boolean {
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "metadata.google.internal" ||
    hostname === "::1" ||
    hostname === "[::1]"
  ) {
    return true;
  }

  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeCapabilities(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return Object.fromEntries(value.filter(Boolean).map((item) => [String(item), true]));
  }

  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }

  return {};
}

function inferredCapabilitiesForModality(modality: string): string[] {
  const normalized = modality.trim().toLowerCase();
  if (normalized === "image") {
    return ["text-to-image", "image-to-image", "multi-reference-image", "image-edit"];
  }
  if (normalized === "video") {
    return ["text-to-video", "image-to-video", "multi-reference-video", "first-last-frame-video", "audio-reference-video"];
  }
  if (normalized === "audio") {
    return ["text-to-speech", "speech-to-text", "voice-clone", "music-generation"];
  }
  return ["chat", "text-generation", "structured-output"];
}

function capabilitiesToArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => key);
  }

  return [];
}

interface ProviderConfigLike {
  id: string;
  displayName: string;
  providerType: string;
  baseUrl: string | null;
  apiKeyEncrypted: string | null;
  apiKeyLast4: string | null;
  isActive: boolean;
  testStatus: string | null;
  testLatencyMs: number | null;
  testError: string | null;
  lastTestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface AiModelLike {
  id: string;
  providerConfigId: string | null;
  provider: string;
  model: string;
  displayName: string;
  modality: string;
  capabilities: unknown;
  defaultParams: unknown;
  costCredits: number;
  apiKeyEncrypted: string | null;
  apiKeyLast4: string | null;
  isActive: boolean;
  providerConfig?: ProviderConfigLike | null;
  createdAt: Date;
  updatedAt: Date;
}
