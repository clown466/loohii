import { config } from "../config";
import { decryptModelConfigSecret } from "../lib/modelConfigCrypto";
import { badRequest } from "../lib/httpErrors";
import { prisma } from "../lib/prisma";

type ProviderConfigLike = {
  id: string;
  displayName: string;
  providerType: string;
  baseUrl: string | null;
  apiKeyEncrypted: string | null;
  isActive: boolean;
};

type AiModelLike = {
  id: string;
  providerConfigId: string | null;
  provider: string;
  model: string;
  displayName: string;
  modality: string;
  capabilities: unknown;
  defaultParams: unknown;
  apiKeyEncrypted: string | null;
  isActive: boolean;
  providerConfig?: ProviderConfigLike | null;
};

export type TextModelResult = {
  rawText: string;
  model: {
    id: string;
    provider: string;
    model: string;
    displayName: string;
  };
};

type TextModelHttpResult = {
  status: number;
  statusText: string;
  payload: any;
  rawText: string;
  durationMs: number;
};

type ChatModelMessage = {
  role: "system" | "user";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

export async function callConfiguredTextModel(messages: Array<{ role: "system" | "user"; content: string }>, aiModelId?: string): Promise<TextModelResult> {
  return callConfiguredChatModel(messages, aiModelId, "workflow inference", true);
}

export async function callConfiguredPlainTextModel(messages: Array<{ role: "system" | "user"; content: string }>, aiModelId?: string): Promise<TextModelResult> {
  return callConfiguredChatModel(messages, aiModelId, "prompt translation", false);
}

export async function callConfiguredVisionTextModel(messages: ChatModelMessage[], aiModelId?: string): Promise<TextModelResult> {
  return callConfiguredChatModel(messages, aiModelId, "image analysis", false);
}

async function callConfiguredChatModel(messages: ChatModelMessage[], aiModelId: string | undefined, purpose: string, preferJsonMode: boolean): Promise<TextModelResult> {
  const model = aiModelId ? await findModelById(aiModelId) : await findDefaultTextModel();
  if (!model) badRequest("No active configured text model found. Add a text model in Settings first.");
  if (!isTextModel(model)) badRequest(`Selected model is not a text/chat model. Please choose a text model for ${purpose}.`);
  if (!model.providerConfig) badRequest("Selected text model is not linked to a provider config.");
  if (!model.providerConfig.isActive) badRequest("Selected model provider is disabled.");

  const provider = model.providerConfig;
  const endpoint = resolveChatCompletionsEndpoint(provider.baseUrl);
  const apiKey = resolveApiKey(model);
  const defaultParams = isRecord(model.defaultParams) ? model.defaultParams : {};
  const baseBody = {
    temperature: 0.2,
    max_tokens: defaultMaxTokensForModel(model),
    ...(preferJsonMode ? { response_format: { type: "json_object" } } : {}),
    ...defaultParams,
    model: model.model,
    messages,
  };
  const maxAttempts = Math.max(1, config.textModelMaxAttempts);
  const timeoutMs = Math.max(30000, config.textModelTimeoutMs);
  let expandOutputBudget = false;
  let lastEmptyFinishReason = "unknown";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const body = attempt === 1 ? baseBody : retryTextModelBody(baseBody, model, expandOutputBudget);
    try {
      const result = await postChatCompletion(endpoint, apiKey, body, timeoutMs);
      if (!isSuccessStatus(result.status)) {
        console.warn(
          `[text-model] http_error attempt=${attempt}/${maxAttempts} status=${result.status} durationMs=${result.durationMs} provider=${provider.displayName} model=${model.model} host=${endpoint.host} message=${summarizeTextModelError(result.payload, result.rawText)}`,
        );
        if (shouldRetryTextModelStatus(result.status) && attempt < maxAttempts) {
          await sleep(config.textModelRetryDelayMs);
          continue;
        }
        badRequest(formatTextModelHttpError(result.status, result.statusText, result.payload, result.rawText, {
          attempt,
          maxAttempts,
          durationMs: result.durationMs,
        }));
      }

      const choice = result.payload?.choices?.[0];
      const extracted = extractTextModelContent(result.payload);
      const rawText = extracted.rawText;
      if (typeof rawText !== "string" || !rawText.trim()) {
        const finishReason = stringFromUnknown(choice?.finish_reason, "unknown");
        lastEmptyFinishReason = finishReason;
        if (isLengthFinishReason(finishReason)) {
          expandOutputBudget = true;
        }
        console.warn(
          `[text-model] empty_content attempt=${attempt}/${maxAttempts} durationMs=${result.durationMs} provider=${provider.displayName} model=${model.model} finish=${finishReason} contentSource=${extracted.source} contentType=${extracted.contentType} payloadKeys=${extracted.payloadKeys} choiceKeys=${extracted.choiceKeys} messageKeys=${extracted.messageKeys} reasoningChars=${typeof choice?.message?.reasoning_content === "string" ? choice.message.reasoning_content.length : 0}`,
        );
        if (attempt < maxAttempts) {
          await sleep(config.textModelRetryDelayMs);
          continue;
        }
        badRequest(formatEmptyTextModelResponse(lastEmptyFinishReason));
      }

      return {
        rawText,
        model: {
          id: model.id,
          provider: provider.providerType,
          model: model.model,
          displayName: model.displayName,
        },
      };
    } catch (error) {
      if (isAbortError(error)) {
        console.warn(
          `[text-model] abort_timeout attempt=${attempt}/${maxAttempts} timeoutMs=${timeoutMs} provider=${provider.displayName} model=${model.model} host=${endpoint.host}`,
        );
        if (attempt < maxAttempts) {
          await sleep(config.textModelRetryDelayMs);
          continue;
        }
        badRequest(`文本模型请求超过 ${formatSeconds(timeoutMs)} 仍未返回，已重试 ${maxAttempts} 次。请减少本次任务复杂度，或换用响应更快的文本模型。`);
      }
      throw error;
    }
  }

  badRequest("文本模型请求失败。");
}

async function postChatCompletion(endpoint: URL, apiKey: string, body: Record<string, unknown>, timeoutMs: number): Promise<TextModelHttpResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint.href, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const rawText = await response.text();
    return {
      status: response.status,
      statusText: response.statusText,
      payload: parseJsonOrRaw(rawText),
      rawText,
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonOrRaw(text: string): any {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

function shouldRetryTextModelStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status === 500 || status === 502 || status === 503;
}

function retryTextModelBody<T extends Record<string, unknown>>(body: T, model: AiModelLike, expandOutputBudget: boolean): T {
  const next = omitResponseFormat(body);
  if (!expandOutputBudget) return next;

  return {
    ...next,
    max_tokens: expandedMaxTokensForModel(model, Number(next.max_tokens)),
  };
}

function omitResponseFormat<T extends Record<string, unknown>>(body: T): T {
  const { response_format: _responseFormat, ...rest } = body;
  return rest as T;
}

function extractTextModelContent(payload: any): {
  rawText: string | undefined;
  source: string;
  contentType: string;
  payloadKeys: string;
  choiceKeys: string;
  messageKeys: string;
} {
  const choice = payload?.choices?.[0];
  const message = choice?.message;
  const candidates: Array<[string, unknown]> = [
    ["choices[0].message.content", message?.content],
    ["choices[0].message.tool_calls", toolCallsToText(message?.tool_calls)],
    ["choices[0].message.function_call.arguments", message?.function_call?.arguments],
    ["choices[0].delta.content", choice?.delta?.content],
    ["choices[0].delta.tool_calls", toolCallsToText(choice?.delta?.tool_calls)],
    ["choices[0].text", choice?.text],
    ["output_text", payload?.output_text],
    ["content", payload?.content],
  ];

  let firstEmptyString: { rawText: string; source: string; value: unknown } | undefined;
  for (const [source, value] of candidates) {
    const text = contentValueToText(value);
    if (typeof text === "string" && text.trim()) {
      return {
        rawText: text,
        source,
        contentType: contentTypeForLog(value),
        payloadKeys: keysForLog(payload),
        choiceKeys: keysForLog(choice),
        messageKeys: keysForLog(message),
      };
    }
    if (!firstEmptyString && typeof text === "string") {
      firstEmptyString = { rawText: text, source, value };
    }
  }

  return {
    rawText: firstEmptyString?.rawText,
    source: firstEmptyString?.source ?? "none",
    contentType: contentTypeForLog(firstEmptyString?.value),
    payloadKeys: keysForLog(payload),
    choiceKeys: keysForLog(choice),
    messageKeys: keysForLog(message),
  };
}

function contentValueToText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.map(contentValueToText).filter(isNonEmptyString);
    return parts.length ? parts.join("\n") : undefined;
  }
  if (isRecord(value)) {
    for (const key of ["text", "output_text", "content", "arguments"]) {
      const nested = contentValueToText(value[key]);
      if (typeof nested === "string" && nested.trim()) return nested;
    }
  }
  return undefined;
}

function toolCallsToText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .map((call) => {
      if (!isRecord(call)) return undefined;
      return contentValueToText(call.function) ?? contentValueToText(call);
    })
    .filter(isNonEmptyString);
  return parts.length ? parts.join("\n") : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function keysForLog(value: unknown): string {
  if (!isRecord(value)) return contentTypeForLog(value);
  const keys = Object.keys(value).slice(0, 12);
  return keys.length ? keys.join("|") : "empty";
}

function contentTypeForLog(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function stringFromUnknown(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isLengthFinishReason(value: string): boolean {
  return /^(length|max_tokens|token_limit)$/i.test(value);
}

function formatEmptyTextModelResponse(finishReason: string): string {
  if (isLengthFinishReason(finishReason)) {
    return "文本模型输出达到长度上限但没有返回可用内容。系统已自动重试并扩大输出预算，仍失败时请减少本次文本/资产复杂度，或切换到输出更稳定的文本模型。";
  }
  return "Text model returned an empty response.";
}

function formatTextModelHttpError(status: number, statusText: string, payload: any, rawText: string, context?: { attempt: number; maxAttempts: number; durationMs: number }): string {
  const message = payload?.error?.message ?? payload?.message;
  const suffix = context ? `（第 ${context.attempt}/${context.maxAttempts} 次，等待 ${formatSeconds(context.durationMs)}）` : "";
  if (typeof message === "string" && message.trim()) {
    return `文本模型请求失败（${status} ${statusText || "Error"}）${suffix}：${message.trim()}`;
  }
  if (status === 504) {
    return `文本模型服务超时（504）${suffix}。供应商网关在模型返回前断开；这通常是供应商约 60 秒网关限制，不是本站等待时间太短。系统已自动重试，仍失败时请换用响应更快的文本模型。`;
  }
  if (status === 502) {
    return `文本模型服务暂时不可用（502）${suffix}。系统已自动重试，仍失败时请稍后重试或切换模型供应商。`;
  }
  const snippet = summarizeNonJsonResponse(rawText);
  return `文本模型请求失败（${status} ${statusText || "Error"}）${suffix}${snippet ? `：${snippet}` : ""}`;
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

function summarizeTextModelError(payload: any, rawText: string): string {
  const message = payload?.error?.message ?? payload?.message;
  if (typeof message === "string" && message.trim()) {
    return message.replace(/\s+/g, " ").trim().slice(0, 180);
  }
  return summarizeNonJsonResponse(rawText) || "empty response";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function formatSeconds(ms: number): string {
  return `${Math.round(ms / 1000)} 秒`;
}

async function findModelById(modelId: string): Promise<AiModelLike | null> {
  return prisma.aiModel.findFirst({
    where: { id: modelId, isActive: true },
    include: { providerConfig: true },
  });
}

async function findDefaultTextModel(): Promise<AiModelLike | null> {
  const models = await prisma.aiModel.findMany({
    where: {
      isActive: true,
      providerConfigId: { not: null },
      providerConfig: { isActive: true },
    },
    include: { providerConfig: true },
    orderBy: [{ updatedAt: "desc" }],
  });

  return (
    models.find((model: AiModelLike) => isTextModel(model)) ?? null
  );
}

function isTextModel(model: AiModelLike): boolean {
  const modality = model.modality.toLowerCase();
  const capabilities = capabilitiesToArray(model.capabilities);
  return (
    modality === "text" ||
    modality === "chat" ||
    modality === "llm" ||
    capabilities.includes("chat") ||
    capabilities.includes("text-generation") ||
    capabilities.includes("structured-output") ||
    looksLikeTextModel(model)
  );
}

function defaultMaxTokensForModel(model: AiModelLike): number {
  const value = `${model.displayName} ${model.model}`.toLowerCase();
  if (/(deepseek|reasoner|thinking|r1)/.test(value)) return 6000;
  if (/gemini/.test(value)) return 8000;
  return 4000;
}

function expandedMaxTokensForModel(model: AiModelLike, current: number): number {
  const value = `${model.displayName} ${model.model}`.toLowerCase();
  const target = /gemini/.test(value) ? 12000 : 8000;
  return Math.max(Number.isFinite(current) ? current : 0, target);
}

function looksLikeTextModel(model: AiModelLike): boolean {
  const value = `${model.displayName} ${model.model}`.toLowerCase();
  if (/(image|flux|midjourney|sdxl|stable-diffusion|seedance|video|tts|voice|audio)/.test(value)) {
    return false;
  }
  return /(gpt|claude|gemini|deepseek|qwen|doubao|kimi|llama|mistral|chat)/.test(value);
}

function resolveApiKey(model: AiModelLike): string {
  const provider = model.providerConfig;
  const encryptedApiKey = model.apiKeyEncrypted ?? provider?.apiKeyEncrypted;
  if (encryptedApiKey) {
    return decryptModelConfigSecret(encryptedApiKey);
  }
  if (provider?.providerType === "openai" && config.openAiApiKey) {
    return config.openAiApiKey;
  }
  badRequest("Selected text model has no API key.");
}

function resolveChatCompletionsEndpoint(baseUrl: string | null): URL {
  const raw = (baseUrl || config.openAiBaseUrl).trim();
  if (!raw) badRequest("Text model provider base URL is required.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    badRequest("Text model provider base URL must be an absolute URL.");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  return new URL(`${pathname}/chat/completions`, url.origin);
}

function capabilitiesToArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => key);
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
