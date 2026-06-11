import { isRecord } from "../lib/mappers";
import { decryptModelConfigSecret } from "../lib/modelConfigCrypto";
import { prisma } from "../lib/prisma";
import { stringFrom } from "../lib/typeGuards";
import { callDreaminaWebImageModel, isDreaminaWebProvider } from "./dreaminaWebBridge";

type ProviderConfigLike = {
  id: string;
  displayName: string;
  providerType: string;
  baseUrl: string | null;
  apiKeyEncrypted: string | null;
  isActive: boolean;
};

export type ImageAiModelLike = {
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
  isActive: boolean;
  providerConfig?: ProviderConfigLike | null;
};

export type ImageModelOutput = {
  url: string;
  revisedPrompt?: string;
  providerId?: string;
};

export type ImageModelCallResult = {
  model: {
    id: string;
    provider: string;
    model: string;
    displayName: string;
  };
  images: ImageModelOutput[];
  raw: unknown;
  durationMs: number;
};

const providerImageQueues = new Map<string, Promise<void>>();
const defaultSub2ApiResponsesImageModel = "gpt-5.5";
const defaultImageRequestTimeoutMs = 8 * 60 * 1000;

export async function callConfiguredImageModel(input: {
  prompt: string;
  aiModelId?: string;
  count?: number;
  size?: string;
  parameters?: Record<string, unknown>;
}): Promise<ImageModelCallResult> {
  const model = input.aiModelId ? await findImageModelById(input.aiModelId) : await findDefaultImageModel();
  if (!model) throw new Error("No active configured image model found. Add an image model in Settings first.");
  return callImageModel(model, input);
}

export async function callImageModel(
  model: ImageAiModelLike,
  input: {
    prompt: string;
    count?: number;
    size?: string;
    parameters?: Record<string, unknown>;
  },
): Promise<ImageModelCallResult> {
  if (!isImageModel(model)) {
    throw new Error("Selected model is not an image model.");
  }
  if (!model.providerConfig) {
    throw new Error("Selected image model is not linked to a provider config.");
  }
  if (!model.providerConfig.isActive) {
    throw new Error("Selected image model provider is disabled.");
  }
  if (isDreaminaWebProvider(model.providerConfig)) {
    const defaultParams = isRecord(model.defaultParams) ? model.defaultParams : {};
    return callDreaminaWebImageModel(model, {
      ...input,
      parameters: {
        ...defaultParams,
        ...(input.parameters ?? {}),
        ...(input.size ? { size: input.size } : {}),
        ...(input.count ? { n: input.count } : {}),
      },
    });
  }
  const encryptedApiKey = model.apiKeyEncrypted ?? model.providerConfig.apiKeyEncrypted;
  if (!encryptedApiKey) {
    throw new Error("Selected image model has no API key.");
  }
  const generationsEndpoint = resolveImageGenerationsEndpoint(model.providerConfig.baseUrl, model);
  const defaultParams = isRecord(model.defaultParams) ? model.defaultParams : {};
  const body = buildImageRequestBody(model, input.prompt, {
    ...defaultParams,
    ...(input.parameters ?? {}),
    ...(input.size ? { size: input.size } : {}),
    ...(input.count ? { n: input.count } : {}),
  });
  const request = buildImageHttpRequest(model, generationsEndpoint, body);

  let apiKey: string;
  try {
    apiKey = decryptModelConfigSecret(encryptedApiKey);
  } catch {
    const fallback = process.env.IMAGE_MODEL_API_KEY;
    if (!fallback) {
      throw new Error("Failed to decrypt API key and no IMAGE_MODEL_API_KEY env var set. Please re-save your API key in Settings or set IMAGE_MODEL_API_KEY.");
    }
    apiKey = fallback;
  }

  const started = Date.now();
  let raw: unknown;
  let images: ImageModelOutput[];
  try {
    ({ raw, images } = await executeQueuedImageRequest(model, request, apiKey));
  } catch (error) {
    console.warn(`[image-generation] request_failed ${imageRequestLogSummary(model, request.endpoint, request.body)} reason=${rawImageErrorMessage(error).slice(0, 180)}`);
    throw error;
  }

  return {
    model: {
      id: model.id,
      provider: model.providerConfig.providerType,
      model: model.model,
      displayName: model.displayName,
    },
    images,
    raw,
    durationMs: Date.now() - started,
  };
}

async function executeQueuedImageRequest(
  model: ImageAiModelLike,
  request: { endpoint: URL; body: Record<string, unknown> },
  apiKey: string,
): Promise<{ raw: unknown; images: ImageModelOutput[] }> {
  const queueKey = imageProviderQueueKey(model, request.body);
  if (!queueKey) return executeImageRequest(model, request, apiKey);
  const previous = providerImageQueues.get(queueKey) ?? Promise.resolve();
  let releaseQueue!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  providerImageQueues.set(queueKey, queued);
  await previous.catch(() => undefined);
  try {
    return await executeImageRequest(model, request, apiKey);
  } finally {
    releaseQueue();
    if (providerImageQueues.get(queueKey) === queued) {
      providerImageQueues.delete(queueKey);
    }
  }
}

async function executeImageRequest(
  model: ImageAiModelLike,
  request: { endpoint: URL; body: Record<string, unknown> },
  apiKey: string,
): Promise<{ raw: unknown; images: ImageModelOutput[] }> {
  if (shouldUseAsyncImageTask(model, request.body)) {
    const raw = await callAsyncImageTask(request.endpoint, apiKey, request.body);
    const images = normalizeGeneratedImages(raw);
    if (images.length === 0) {
      throw new Error(`Async image model task returned no image URL or base64 image.${imageResponseShapeSuffix(raw)}`);
    }
    return { raw, images };
  }

  const timeoutMs = imageRequestTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  let rawText = "";
  try {
    response = await fetch(request.endpoint.href, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
    rawText = await response.text();
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Image model request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const raw = parseJsonOrRaw(rawText);
  if (!response.ok) {
    throw new Error(`Image model request failed (${response.status} ${response.statusText || "Error"}): ${summarizeImageError(raw, rawText)}`);
  }

  const finalRaw = shouldUseSub2ApiResponsesImageGeneration(model) ? await resolveResponsesImageGenerationResult(request.endpoint, apiKey, raw) : raw;
  const images = normalizeGeneratedImages(finalRaw);
  if (images.length === 0) {
    throw new Error(`Image model returned no image URL or base64 image.${imageResponseShapeSuffix(finalRaw)}`);
  }
  return { raw: finalRaw, images };
}

export function isImageModel(model: ImageAiModelLike): boolean {
  const modality = model.modality.trim().toLowerCase();
  const capabilities = capabilitiesToArray(model.capabilities).map((item) => item.toLowerCase());
  const searchable = `${modality} ${capabilities.join(" ")} ${model.displayName} ${model.model}`.toLowerCase();
  if (modality === "image") return true;
  if (capabilities.some((item) => ["text-to-image", "image-to-image", "multi-reference-image", "image-edit"].includes(item))) return true;
  if (/(video|audio|tts|voice|seedance|kling|runway|luma)/.test(searchable)) return false;
  return /(gpt-image|dall-e|flux|sdxl|stable-diffusion|midjourney|image)/.test(searchable);
}

async function findImageModelById(modelId: string): Promise<ImageAiModelLike | null> {
  return prisma.aiModel.findFirst({
    where: { id: modelId, isActive: true },
    include: { providerConfig: true },
  });
}

async function findDefaultImageModel(): Promise<ImageAiModelLike | null> {
  const models = await prisma.aiModel.findMany({
    where: {
      isActive: true,
      providerConfigId: { not: null },
      providerConfig: { isActive: true },
    },
    include: { providerConfig: true },
    orderBy: [{ updatedAt: "desc" }],
  });
  return models.find((model: ImageAiModelLike) => isImageModel(model)) ?? null;
}

function buildImageRequestBody(model: ImageAiModelLike, prompt: string, params: Record<string, unknown>) {
  const modelName = model.model;
  const preparedPrompt = prompt.trim();
  const body: Record<string, unknown> = {
    ...params,
    model: modelName,
    prompt: preparedPrompt,
    n: numberFrom(params.n, 1),
  };
  applyReferenceImageAliases(model, body);
  const outputFormat = normalizeImageOutputFormat(body.output_format ?? body.format);
  if (outputFormat) {
    body.output_format = outputFormat;
    delete body.format;
  }
  applyJimengImageOptions(model, body);
  const useNativeGptImage2Options = shouldUseNativeGptImage2Options(model);
  const useGptImage2Resolution = shouldUseGptImage2Resolution(model);
  if (!body.size) {
    body.size = useNativeGptImage2Options ? "1:1" : "1024x1024";
  }
  if (useGptImage2Resolution && !body.resolution) {
    body.resolution = "1k";
  }
  if (requiresPixelSizeForGptImage2(model)) {
    body.size = normalizeGptImage2PixelSize(body.size, body.resolution);
  } else if (!useNativeGptImage2Options) {
    body.size = normalizeOpenAiImageSize(body.size);
  }
  applyJimengImageOptions(model, body);
  return body;
}

function buildImageHttpRequest(model: ImageAiModelLike, generationsEndpoint: URL, body: Record<string, unknown>) {
  if (shouldUseSub2ApiResponsesImageGeneration(model)) {
    return {
      endpoint: resolveResponsesEndpoint(generationsEndpoint),
      body: buildSub2ApiResponsesImageBody(body),
    };
  }
  if (shouldUseSub2ApiImageEditsReferences(model, body)) {
    return {
      endpoint: resolveImageEditsEndpoint(generationsEndpoint),
      body: buildSub2ApiImageEditsBody(body),
    };
  }
  return { endpoint: generationsEndpoint, body };
}

export function buildImageHttpRequestForTest(model: ImageAiModelLike, prompt: string, params: Record<string, unknown>) {
  const generationsEndpoint = resolveImageGenerationsEndpoint(model.providerConfig?.baseUrl ?? null, model);
  const defaultParams = isRecord(model.defaultParams) ? model.defaultParams : {};
  const body = buildImageRequestBody(model, prompt, { ...defaultParams, ...params });
  return buildImageHttpRequest(model, generationsEndpoint, body);
}

function rawImageErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

function imageRequestLogSummary(model: ImageAiModelLike, endpoint: URL, body: Record<string, unknown>): string {
  const prompt = stringFrom(body.prompt, "") || responsesInputPrompt(body);
  const refs = referenceImageUrlsFromBody(body);
  const imageTool = responsesImageTool(body);
  const refHosts = refs
    .map((url) => hostFromUrl(url))
    .filter(Boolean)
    .slice(0, 8)
    .join(",");
  return [
    `provider=${model.providerConfig?.displayName ?? model.provider}`,
    `model=${model.displayName}`,
    `endpoint=${endpoint.pathname}`,
    `size=${stringFrom(body.size, "") || stringFrom(imageTool?.size, "")}`,
    `resolution=${stringFrom(body.resolution, "")}`,
    `quality=${stringFrom(body.quality, "") || stringFrom(imageTool?.quality, "")}`,
    `promptLen=${prompt.length}`,
    `refs=${refs.length}`,
    refHosts ? `refHosts=${refHosts}` : "",
  ].filter(Boolean).join(" ");
}

function hostFromUrl(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function buildSub2ApiImageEditsBody(body: Record<string, unknown>) {
  const referenceImageUrls = referenceImageUrlsFromBody(body);
  const next: Record<string, unknown> = { ...body };
  delete next.image_urls;
  delete next.reference_images;
  next.images = referenceImageUrls.map((url) => ({ image_url: url }));
  return next;
}

function buildSub2ApiResponsesImageBody(body: Record<string, unknown>) {
  const referenceImageUrls = referenceImageUrlsFromBody(body);
  const responsesModel = sub2ApiResponsesModelFromBody(body);
  const next: Record<string, unknown> = {
    model: responsesModel,
    input: buildResponsesImageInput(body, referenceImageUrls),
    stream: false,
    tool_choice: { type: "image_generation" },
    tools: [buildResponsesImageTool(body)],
  };
  for (const key of ["metadata", "service_tier", "user"]) {
    if (body[key] !== undefined) next[key] = body[key];
  }
  return next;
}

function sub2ApiResponsesModelFromBody(body: Record<string, unknown>): string {
  const configured = stringFrom(
    body.responses_model ??
      body.responsesModel ??
      body.image_responses_model ??
      body.imageResponsesModel ??
      process.env.SUB2API_RESPONSES_IMAGE_MODEL,
    "",
  );
  return configured || defaultSub2ApiResponsesImageModel;
}

function buildResponsesImageInput(body: Record<string, unknown>, referenceImageUrls: string[]) {
  const content: Record<string, unknown>[] = [{
    type: "input_text",
    text: stringFrom(body.prompt, ""),
  }];
  for (const imageUrl of referenceImageUrls) {
    content.push({
      type: "input_image",
      image_url: imageUrl,
    });
  }
  return [{
    type: "message",
    role: "user",
    content,
  }];
}

function buildResponsesImageTool(body: Record<string, unknown>) {
  const tool: Record<string, unknown> = {
    type: "image_generation",
    model: body.model,
  };
  if (isGptImage2Body(body) && body.quality === undefined) {
    tool.quality = "high";
  }
  for (const key of [
    "size",
    "quality",
    "background",
    "output_format",
    "output_compression",
    "moderation",
    "style",
    "partial_images",
    "input_fidelity",
  ]) {
    if (body[key] !== undefined) tool[key] = body[key];
  }
  const count = numberFrom(body.n, 1);
  if (count > 1) tool.n = count;
  return tool;
}

function applyReferenceImageAliases(model: ImageAiModelLike, body: Record<string, unknown>) {
  const imageUrls = referenceImageUrlsFromBody({ image_urls: body.image_urls });
  if (imageUrls.length === 0 || body.reference_images) return;
  if (shouldUseReferenceImagesAlias(model)) {
    body.reference_images = imageUrls;
  }
}

function shouldUseReferenceImagesAlias(model: ImageAiModelLike): boolean {
  return isSub2ApiGptImage2Provider(model);
}

function applyJimengImageOptions(model: ImageAiModelLike, body: Record<string, unknown>) {
  if (!isJimengApiImageProvider(model)) return;
  const size = stringFrom(body.size, "");
  if (!body.ratio) {
    body.ratio = normalizeJimengImageRatio(size);
  }
  if (!body.resolution) {
    body.resolution = normalizeJimengImageResolution(body.quality ?? body.resolution);
  }
  delete body.size;
  delete body.quality;
  delete body.output_format;
  delete body.format;
}

function isJimengApiImageProvider(model: ImageAiModelLike): boolean {
  const provider = `${model.providerConfig?.providerType ?? ""} ${model.providerConfig?.displayName ?? ""} ${model.providerConfig?.baseUrl ?? ""} ${model.provider}`.toLowerCase();
  return provider.includes("jimeng-api") || provider.includes("dreamina-api") || provider.includes("jimeng");
}

function normalizeJimengImageRatio(size: string): string {
  const raw = size.toLowerCase();
  const parsed = parseImageAspectRatio(raw);
  if (!parsed) return "1:1";
  const ratio = parsed.width / parsed.height;
  const options = [
    { value: "1:1", ratio: 1 },
    { value: "16:9", ratio: 16 / 9 },
    { value: "9:16", ratio: 9 / 16 },
    { value: "4:3", ratio: 4 / 3 },
    { value: "3:4", ratio: 3 / 4 },
    { value: "3:2", ratio: 3 / 2 },
    { value: "2:3", ratio: 2 / 3 },
  ];
  return options.reduce((best, option) => (
    Math.abs(option.ratio - ratio) < Math.abs(best.ratio - ratio) ? option : best
  ), options[0]).value;
}

function normalizeJimengImageResolution(value: unknown): string {
  const raw = stringFrom(value, "1k").toLowerCase();
  if (raw === "2k" || raw === "4k") return raw;
  return "1k";
}

function shouldUseGptImage2Resolution(model: ImageAiModelLike): boolean {
  return isGptImage2Model(model) && imageProviderBaseUrlMatches(model, /(airelayzone\.com|aizahuo\.shop)/i);
}

function shouldUseNativeGptImage2Options(model: ImageAiModelLike): boolean {
  return isGptImage2Model(model) && imageProviderBaseUrlMatches(model, /(airelayzone\.com)/i);
}

function shouldUseSub2ApiImageEditsReferences(model: ImageAiModelLike, body: Record<string, unknown>): boolean {
  return isSub2ApiGptImage2Provider(model) && referenceImageUrlsFromBody(body).length > 0;
}

function shouldUseSub2ApiResponsesImageGeneration(model: ImageAiModelLike): boolean {
  return isAizahuoGptImage2Provider(model);
}

function isSub2ApiGptImage2Provider(model: ImageAiModelLike): boolean {
  return isGptImage2Model(model) && imageProviderBaseUrlMatches(model, /(hkapi|huakai|toapis|aizahuo\.shop)/i);
}

function isAizahuoGptImage2Provider(model: ImageAiModelLike): boolean {
  return isGptImage2Model(model) && imageProviderBaseUrlMatches(model, /aizahuo\.shop/i);
}

function isGptImage2Model(model: ImageAiModelLike): boolean {
  return /gpt-image-2/i.test(model.model);
}

function isGptImage2Body(body: Record<string, unknown>): boolean {
  return /gpt-image-2/i.test(stringFrom(body.model, ""));
}

function requiresPixelSizeForGptImage2(model: ImageAiModelLike): boolean {
  return isSub2ApiGptImage2Provider(model);
}

function imageProviderBaseUrlMatches(model: ImageAiModelLike, pattern: RegExp): boolean {
  const baseUrl = model.providerConfig?.baseUrl ?? "";
  const host = hostFromUrl(baseUrl);
  return pattern.test(host || baseUrl);
}

function imageProviderQueueKey(model: ImageAiModelLike, body: Record<string, unknown>): string {
  if (!shouldUseSub2ApiImageEditsReferences(model, body) && !(shouldUseSub2ApiResponsesImageGeneration(model) && referenceImageUrlsFromBody(body).length > 0)) return "";
  return [
    model.providerConfigId || model.providerConfig?.id || "",
    model.providerConfig?.baseUrl || "",
    model.model,
  ].join(":");
}

function referenceImageUrlsFromBody(body: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const pushUrl = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed && !urls.includes(trimmed)) urls.push(trimmed);
  };
  if (Array.isArray(body.image_urls)) {
    for (const value of body.image_urls) pushUrl(value);
  }
  if (Array.isArray(body.reference_images)) {
    for (const value of body.reference_images) pushUrl(value);
  }
  if (Array.isArray(body.images)) {
    for (const value of body.images) {
      if (isRecord(value)) pushUrl(value.image_url);
      else pushUrl(value);
    }
  }
  if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (!isRecord(item) || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (isRecord(part) && part.type === "input_image") pushUrl(part.image_url);
      }
    }
  }
  return urls;
}

function responsesImageTool(body: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!Array.isArray(body.tools)) return undefined;
  return body.tools.find((tool): tool is Record<string, unknown> => isRecord(tool) && tool.type === "image_generation");
}

function responsesInputPrompt(body: Record<string, unknown>): string {
  if (!Array.isArray(body.input)) return "";
  const firstMessage = body.input.find((item) => isRecord(item) && Array.isArray(item.content));
  const content = isRecord(firstMessage) && Array.isArray(firstMessage.content) ? firstMessage.content : [];
  const textPart = content.find((item) => isRecord(item) && item.type === "input_text");
  return isRecord(textPart) ? stringFrom(textPart.text, "") : "";
}

function normalizeOpenAiImageSize(value: unknown): string {
  const raw = stringFrom(value, "");
  if (raw === "1:1") return "1024x1024";
  if (["1024x1024", "1536x1024", "1024x1536", "1792x1024", "1024x1792"].includes(raw)) return raw;
  const parsed = parseImageAspectRatio(raw);
  if (parsed) {
    const ratio = parsed.width / parsed.height;
    if (ratio > 1.1) return "1536x1024";
    if (ratio < 0.9) return "1024x1536";
  }
  return "1024x1024";
}

function normalizeGptImage2PixelSize(size: unknown, resolution: unknown): string {
  const raw = stringFrom(size, "1:1").toLowerCase();
  const parsed = parseImageAspectRatio(raw) ?? { width: 1, height: 1 };
  const explicitPixelSize = parsePixelSize(raw);
  if (explicitPixelSize && isValidGptImage2PixelSize(explicitPixelSize.width, explicitPixelSize.height)) {
    return `${explicitPixelSize.width}x${explicitPixelSize.height}`;
  }
  const tier = gptImage2ResolutionTier(resolution);
  const dimensions = buildGptImage2PixelDimensions(parsed.width, parsed.height, tier);
  return `${dimensions.width}x${dimensions.height}`;
}

function gptImage2ResolutionTier(value: unknown): "1k" | "2k" | "4k" {
  const raw = stringFrom(value, "1k").toLowerCase();
  if (raw === "2k" || raw === "4k") return raw;
  return "1k";
}

function parseImageAspectRatio(value: string): { width: number; height: number } | null {
  const ratioMatch = value.match(/^(\d{1,3}):(\d{1,3})$/);
  if (ratioMatch) {
    const width = Number(ratioMatch[1]);
    const height = Number(ratioMatch[2]);
    return validPositivePair(width, height) ? { width, height } : null;
  }
  const pixelSize = parsePixelSize(value);
  return pixelSize ? { width: pixelSize.width, height: pixelSize.height } : null;
}

function parsePixelSize(value: string): { width: number; height: number } | null {
  const pixelMatch = value.match(/^(\d{2,5})x(\d{2,5})$/);
  if (!pixelMatch) return null;
  const width = Number(pixelMatch[1]);
  const height = Number(pixelMatch[2]);
  return validPositivePair(width, height) ? { width, height } : null;
}

function validPositivePair(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

const gptImage2GridSize = 16;
const gptImage2MaxEdge = 3840;
const gptImage2MinPixels = 655_360;
const gptImage2MaxPixels = 8_294_400;

function buildGptImage2PixelDimensions(width: number, height: number, tier: "1k" | "2k" | "4k"): { width: number; height: number } {
  const rawRatio = width / height;
  const ratio = Math.min(3, Math.max(1 / 3, rawRatio));
  let nextWidth: number;
  let nextHeight: number;
  if (tier === "1k") {
    if (ratio >= 1) {
      nextHeight = 1024;
      nextWidth = nextHeight * ratio;
    } else {
      nextWidth = 1024;
      nextHeight = nextWidth / ratio;
    }
  } else {
    const longEdge = tier === "2k" ? 2048 : 3840;
    if (ratio >= 1) {
      nextWidth = longEdge;
      nextHeight = longEdge / ratio;
    } else {
      nextHeight = longEdge;
      nextWidth = longEdge * ratio;
    }
  }
  return constrainGptImage2PixelDimensions({
    width: roundToGrid(nextWidth, "nearest"),
    height: roundToGrid(nextHeight, "nearest"),
  });
}

function constrainGptImage2PixelDimensions(dimensions: { width: number; height: number }): { width: number; height: number } {
  let width = Math.max(gptImage2GridSize, dimensions.width);
  let height = Math.max(gptImage2GridSize, dimensions.height);
  if (Math.max(width, height) > gptImage2MaxEdge) {
    const scale = gptImage2MaxEdge / Math.max(width, height);
    width = roundToGrid(width * scale, "floor");
    height = roundToGrid(height * scale, "floor");
  }
  if (width * height > gptImage2MaxPixels) {
    const scale = Math.sqrt(gptImage2MaxPixels / (width * height));
    width = roundToGrid(width * scale, "floor");
    height = roundToGrid(height * scale, "floor");
  }
  while (width * height > gptImage2MaxPixels) {
    if (width >= height) width = Math.max(gptImage2GridSize, width - gptImage2GridSize);
    else height = Math.max(gptImage2GridSize, height - gptImage2GridSize);
  }
  if (width * height < gptImage2MinPixels) {
    const scale = Math.sqrt(gptImage2MinPixels / (width * height));
    width = roundToGrid(width * scale, "ceil");
    height = roundToGrid(height * scale, "ceil");
  }
  while (Math.max(width, height) / Math.min(width, height) > 3) {
    if (width >= height) width = Math.max(gptImage2GridSize, width - gptImage2GridSize);
    else height = Math.max(gptImage2GridSize, height - gptImage2GridSize);
  }
  return { width, height };
}

function isValidGptImage2PixelSize(width: number, height: number): boolean {
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const totalPixels = width * height;
  return width % gptImage2GridSize === 0 &&
    height % gptImage2GridSize === 0 &&
    longEdge <= gptImage2MaxEdge &&
    longEdge / shortEdge <= 3 &&
    totalPixels >= gptImage2MinPixels &&
    totalPixels <= gptImage2MaxPixels;
}

function roundToGrid(value: number, mode: "nearest" | "floor" | "ceil"): number {
  const scaled = value / gptImage2GridSize;
  const rounded = mode === "floor" ? Math.floor(scaled) : mode === "ceil" ? Math.ceil(scaled) : Math.round(scaled);
  return Math.max(gptImage2GridSize, rounded * gptImage2GridSize);
}

function normalizeImageOutputFormat(value: unknown): string {
  const raw = stringFrom(value, "").toLowerCase();
  if (raw === "jpg") return "jpeg";
  if (["png", "jpeg", "webp"].includes(raw)) return raw;
  return "";
}

function normalizeGeneratedImages(raw: unknown): ImageModelOutput[] {
  if (!isRecord(raw)) return [];
  if (isRecord(raw.response)) {
    const nested = normalizeGeneratedImages(raw.response);
    if (nested.length > 0) return nested;
  }
  for (const key of ["result", "output", "image", "images"]) {
    const nestedValue = raw[key];
    if (Array.isArray(nestedValue)) {
      const nestedImages = nestedValue.flatMap((item) => normalizeGeneratedImages(isRecord(item) ? item : { url: item }));
      if (nestedImages.length > 0) return nestedImages;
    } else if (isRecord(nestedValue)) {
      const nestedImages = normalizeGeneratedImages(nestedValue);
      if (nestedImages.length > 0) return nestedImages;
    }
  }
  const data = [
    ...(Array.isArray(raw.data) ? raw.data : []),
    ...(Array.isArray(raw.output) ? raw.output : []),
    ...(Array.isArray(raw.images) ? raw.images : []),
  ];
  const images = data.flatMap((item) => {
    if (!isRecord(item)) return [];
    const url = firstString(
      item.url,
      item.image_url,
      item.imageUrl,
      item.output_url,
      item.outputUrl,
      item.file_url,
      item.fileUrl,
    );
    const b64Json = firstString(item.b64_json, item.b64, item.base64, item.image_base64, item.imageBase64, item.result);
    const imageUrl = url || imageUrlFromImageResult(b64Json);
    if (!imageUrl) return [];
    return [{
      url: imageUrl,
      revisedPrompt: stringFrom(item.revised_prompt, undefined),
      providerId: stringFrom(item.id, undefined),
    }];
  });
  if (images.length > 0) return images;

  const directUrl = firstString(raw.url, raw.image_url, raw.imageUrl, raw.output_url, raw.outputUrl, raw.file_url, raw.fileUrl);
  if (directUrl) return [{ url: directUrl }];
  const directBase64 = firstString(raw.b64_json, raw.b64, raw.base64, raw.image_base64, raw.imageBase64, raw.result);
  const directImageUrl = imageUrlFromImageResult(directBase64);
  if (directImageUrl) {
    return [{
      url: directImageUrl,
      revisedPrompt: stringFrom(raw.revised_prompt, undefined),
      providerId: stringFrom(raw.id, undefined),
    }];
  }
  return [];
}

export function normalizeGeneratedImagesForTest(raw: unknown): ImageModelOutput[] {
  return normalizeGeneratedImages(raw);
}

function imageUrlFromImageResult(value: string): string {
  if (!value) return "";
  if (/^(https?:|data:image\/)/i.test(value)) return value;
  return `data:image/png;base64,${value}`;
}

function resolveImageGenerationsEndpoint(baseUrl: string | null, model?: ImageAiModelLike): URL {
  const raw = (baseUrl || "https://api.openai.com/v1").trim();
  const url = new URL(raw);
  const pathname = url.pathname.replace(/\/+$/, "");
  if (model && isJimengApiImageProvider(model) && !pathname.endsWith("/v1")) {
    return new URL(`${pathname}/v1/images/generations`, url.origin);
  }
  return new URL(`${pathname}/images/generations`, url.origin);
}

function resolveImageEditsEndpoint(generationsEndpoint: URL): URL {
  const basePath = generationsEndpoint.pathname.replace(/\/images\/generations\/?$/, "");
  return new URL(`${basePath}/images/edits`, generationsEndpoint.origin);
}

function resolveResponsesEndpoint(generationsEndpoint: URL): URL {
  const basePath = generationsEndpoint.pathname.replace(/\/images\/generations\/?$/, "");
  return new URL(`${basePath}/responses`, generationsEndpoint.origin);
}

function resolveResponseRetrieveEndpoint(responsesEndpoint: URL, responseId: string): URL {
  const pathname = responsesEndpoint.pathname.replace(/\/+$/, "");
  return new URL(`${pathname}/${encodeURIComponent(responseId)}`, responsesEndpoint.origin);
}

async function resolveResponsesImageGenerationResult(
  responsesEndpoint: URL,
  apiKey: string,
  raw: unknown,
): Promise<unknown> {
  const immediateImages = normalizeGeneratedImages(raw);
  if (immediateImages.length > 0) return raw;
  const responseId = responsesResponseId(raw);
  if (!responseId) return raw;

  const started = Date.now();
  const timeoutMs = imageRequestTimeoutMs();
  let lastRaw = raw;
  while (Date.now() - started < timeoutMs) {
    if (!responsesImageGenerationStillRunning(lastRaw) && normalizeGeneratedImages(lastRaw).length > 0) return lastRaw;
    await sleep(3000);
    const retrieveResponse = await fetch(resolveResponseRetrieveEndpoint(responsesEndpoint, responseId).href, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const text = await retrieveResponse.text();
    const nextRaw = parseJsonOrRaw(text);
    lastRaw = nextRaw;
    if (!retrieveResponse.ok) {
      throw new Error(`Responses image result poll failed (${retrieveResponse.status} ${retrieveResponse.statusText || "Error"}): ${summarizeImageError(nextRaw, text)}`);
    }
    const status = responsesStatus(nextRaw);
    if (status === "failed" || status === "error" || status === "cancelled" || status === "canceled" || responsesError(nextRaw)) {
      throw new Error(`Responses image result failed: ${summarizeImageError(nextRaw, text)}`);
    }
  }

  return lastRaw;
}

function responsesResponseId(raw: unknown): string {
  return isRecord(raw) ? stringFrom(raw.id, "") : "";
}

function responsesStatus(raw: unknown): string {
  return isRecord(raw) ? stringFrom(raw.status, "").toLowerCase() : "";
}

function responsesError(raw: unknown): boolean {
  return isRecord(raw) && raw.error != null && !(isRecord(raw.error) && Object.keys(raw.error).length === 0);
}

function responsesImageGenerationStillRunning(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  const status = responsesStatus(raw);
  if (status && status !== "completed" && status !== "succeeded" && status !== "success") return true;
  const output = Array.isArray(raw.output) ? raw.output : [];
  return output.some((item) => {
    if (!isRecord(item) || stringFrom(item.type, "") !== "image_generation_call") return false;
    const itemStatus = stringFrom(item.status, "").toLowerCase();
    return itemStatus === "generating" || itemStatus === "running" || itemStatus === "queued" || itemStatus === "in_progress";
  });
}

function resolveImageAsyncEndpoint(generationsEndpoint: URL): URL {
  const pathname = generationsEndpoint.pathname.replace(/\/+$/, "");
  return new URL(`${pathname}/async`, generationsEndpoint.origin);
}

function resolveImageTaskEndpoint(generationsEndpoint: URL, taskId: string): URL {
  const basePath = generationsEndpoint.pathname.replace(/\/images\/generations\/?$/, "");
  return new URL(`${basePath}/images/tasks/${encodeURIComponent(taskId)}`, generationsEndpoint.origin);
}

function shouldUseAsyncImageTask(model: ImageAiModelLike, body: Record<string, unknown>): boolean {
  const baseUrl = model.providerConfig?.baseUrl ?? "";
  if (!/airelayzone\.com/i.test(baseUrl)) return false;
  if (!/gpt-image-2/i.test(model.model)) return false;
  const imageUrls = Array.isArray(body.image_urls) ? body.image_urls : [];
  const resolution = stringFrom(body.resolution, "").toLowerCase();
  const prompt = stringFrom(body.prompt, "");
  return imageUrls.length > 0 || resolution === "2k" || resolution === "4k" || prompt.length > 2400;
}

async function callAsyncImageTask(
  generationsEndpoint: URL,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const submitEndpoint = resolveImageAsyncEndpoint(generationsEndpoint);
  const submitResponse = await fetch(submitEndpoint.href, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const submitText = await submitResponse.text();
  const submitRaw = parseJsonOrRaw(submitText);
  if (!submitResponse.ok) {
    throw new Error(`Async image task submit failed (${submitResponse.status} ${submitResponse.statusText || "Error"}): ${summarizeImageError(submitRaw, submitText)}`);
  }

  const immediateImages = normalizeGeneratedImages(submitRaw);
  if (immediateImages.length > 0) return submitRaw;

  const taskId = taskIdFrom(submitRaw);
  if (!taskId) {
    throw new Error("Async image task submit returned no task id.");
  }

  const taskEndpoint = resolveImageTaskEndpoint(generationsEndpoint, taskId);
  const started = Date.now();
  const timeoutMs = 8 * 60 * 1000;
  let lastRaw: unknown = submitRaw;
  while (Date.now() - started < timeoutMs) {
    await sleep(3000);
    const taskResponse = await fetch(taskEndpoint.href, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const taskText = await taskResponse.text();
    const taskRaw = parseJsonOrRaw(taskText);
    lastRaw = taskRaw;
    if (!taskResponse.ok) {
      throw new Error(`Async image task poll failed (${taskResponse.status} ${taskResponse.statusText || "Error"}): ${summarizeImageError(taskRaw, taskText)}`);
    }

    const status = stringFrom(isRecord(taskRaw) ? taskRaw.status : "", "").toLowerCase();
    if (status === "succeeded" || status === "success" || status === "completed") {
      return { ...(isRecord(taskRaw) ? taskRaw : { task: taskRaw }), asyncSubmit: submitRaw };
    }
    if (status === "failed" || status === "error" || status === "cancelled" || status === "canceled") {
      throw new Error(`Async image task failed: ${summarizeImageError(taskRaw, taskText)}`);
    }
  }

  throw new Error(`Async image task timed out after ${Math.round(timeoutMs / 1000)}s: ${summarizeImageError(lastRaw, JSON.stringify(lastRaw).slice(0, 500))}`);
}

function taskIdFrom(raw: unknown): string {
  if (!isRecord(raw)) return "";
  return stringFrom(raw.id, "") || stringFrom(raw.task_id, "") || stringFrom(raw.taskId, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function imageRequestTimeoutMs(): number {
  const configured = Number(process.env.IMAGE_MODEL_REQUEST_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured >= 30_000) return configured;
  return defaultImageRequestTimeoutMs;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function parseJsonOrRaw(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function summarizeImageError(payload: unknown, rawText: string): string {
  const compactRaw = rawText.replace(/\s+/g, " ").trim();
  if (/<!doctype html|<html|bad gateway|cloudflare/i.test(compactRaw)) {
    return "Upstream image service returned an HTML Bad Gateway page.";
  }
  if (isRecord(payload)) {
    const message = payload.error && isRecord(payload.error) ? payload.error.message : payload.message;
    if (typeof message === "string" && message.trim()) return formatImageProviderError(message, payload).slice(0, 300);
  }
  return compactRaw.slice(0, 300);
}

function formatImageProviderError(message: string, payload: Record<string, unknown>): string {
  const trimmed = message.trim();
  const data = isRecord(payload.data) ? payload.data : {};
  const starlingMessage = stringFrom(data.fail_starling_message, "");
  const failCode = stringFrom(data.fail_code, "");
  if (/shark not pass reject/i.test(trimmed)) {
    return [
      "Dreamina 风控拒绝生成：账号被判定存在异常活动，请稍后再试，或在浏览器里手动生成一次后重试。",
      starlingMessage,
      failCode ? `fail_code=${failCode}` : "",
    ].filter(Boolean).join(" ");
  }
  return trimmed;
}

function imageResponseShapeSuffix(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const parts: string[] = [];
  const status = stringFrom(payload.status, "");
  if (status) parts.push(`status=${status}`);
  const message = imageResponseMessage(payload);
  if (message) parts.push(`message=${message.slice(0, 160)}`);
  const keys = Object.keys(payload).slice(0, 12);
  if (keys.length > 0) parts.push(`keys=${keys.join(",")}`);
  return parts.length > 0 ? ` Response: ${parts.join("; ")}.` : "";
}

function imageResponseMessage(payload: Record<string, unknown>): string {
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim();
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
  if (isRecord(payload.error) && typeof payload.error.message === "string" && payload.error.message.trim()) {
    return payload.error.message.trim();
  }
  if (isRecord(payload.response)) return imageResponseMessage(payload.response);
  return "";
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

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function numberFrom(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(4, number)) : fallback;
}
