import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";

import { isRecord } from "../lib/mappers";
import type { ImageAiModelLike, ImageModelCallResult, ImageModelOutput } from "./imageModel";

type DreaminaProviderLike = {
  displayName: string;
  providerType: string;
  baseUrl: string | null;
};

type DreaminaWebPageSnapshot = {
  url: string;
  title: string;
  bodyText: string;
  cookies: Array<{ name: string; domain: string }>;
};

type CapturedImageUrl = {
  url: string;
  capturedAt: number;
};

type DreaminaResultCard = {
  url: string;
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
};

type DreaminaResultCardGroup = {
  y: number;
  urls: string[];
  keys: string[];
  text: string;
};

type CapturedJsonPayload = {
  url: string;
  capturedAt: number;
  payload: unknown;
};

type DreaminaReferenceMediaUpload = {
  tempDir: string;
  imageUrls: string[];
  audioUrls: string[];
  files: string[];
  referenceSignature: string;
  reusedExistingReferences?: boolean;
  beforeReferenceItemCount: number;
  afterResetReferenceItemCount: number;
  afterReferenceItemCount: number;
  afterReferenceStats: DreaminaComposerReferenceStats;
  resetPageUrl: string;
  debugText?: string;
};

type DreaminaReferenceUploadMemory = {
  signature: string;
  imageCount: number;
  audioCount: number;
  updatedAt: number;
  source: "attempt" | "accepted";
};

let latestDreaminaReferenceUploadMemory: DreaminaReferenceUploadMemory | null = null;
const DREAMINA_REFERENCE_UPLOAD_MEMORY_KEY = "loohii:dreamina-reference-upload";
const DREAMINA_WEB_BUSY_MESSAGE = "Dreamina Web 正在处理另一个素材上传/生成任务。请等当前预检或生成结束后再试，避免多个 Clip 同时操控同一个云浏览器页面。";
let activeDreaminaWebTask: { kind: string; startedAt: number } | null = null;
const DREAMINA_REFERENCE_UPLOAD_ATTEMPTS = 2;
const DREAMINA_REFERENCE_IMAGE_MAX_DIMENSION = 1536;
const DREAMINA_REFERENCE_IMAGE_JPEG_QUALITY = 5;
const DREAMINA_REFERENCE_AUDIO_STEP_TIMEOUT_MS = 25_000;

export type DreaminaWebVideoInput = {
  prompt: string;
  referenceImageUrls: string[];
  referenceAudioUrls?: string[];
  durationSeconds?: number;
  ratio?: string;
  resolution?: string;
};

export type DreaminaComposerReferenceStats = {
  itemCount: number;
  imageCount: number;
  audioCount: number;
  videoCount: number;
  placeholderCount: number;
  unknownCount: number;
  samples: Array<{
    tag: string;
    text: string;
    className: string;
    src: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
};

type DreaminaReferenceElementSnapshot = {
  id: number;
  parentId: number | null;
  tag: string;
  text: string;
  className: string;
  src: string;
  rendered: boolean;
  historyClosest: boolean;
  hasImage: boolean;
  hasAudio: boolean;
  hasVideo: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DreaminaWebVideoResult = {
  submitId?: string;
  genStatus?: string;
  videoUrl?: string;
  raw: unknown;
  durationMs: number;
};

export type DreaminaWebVideoUploadPreflightResult = {
  ok: boolean;
  raw: unknown;
  durationMs: number;
};

export type DreaminaWebVideoQueryResult = {
  submitId: string;
  genStatus?: string;
  videoUrl?: string;
  raw: unknown;
  durationMs: number;
};

export type DreaminaWebStatus = {
  ok: boolean;
  connected: boolean;
  loggedIn: boolean;
  url: string;
  title: string;
  pageCount: number;
  cdpUrl: string;
  publicUrl: string;
  message: string;
};

export function isDreaminaWebProvider(provider?: DreaminaProviderLike | null): boolean {
  if (!provider) return false;
  const searchable = `${provider.providerType} ${provider.displayName} ${provider.baseUrl ?? ""}`.toLowerCase();
  return searchable.includes("dreamina-web") || searchable.includes("dreamina browser") || searchable.includes("dreamina-web");
}

export async function getDreaminaWebStatus(): Promise<DreaminaWebStatus> {
  const cdpUrl = dreaminaCdpUrl();
  const publicUrl = dreaminaPublicBrowserUrl();
  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 8000 });
    const context = await activeDreaminaContext(browser);
    const page = await activeDreaminaPage(context);
    const snapshot = await snapshotDreaminaPage(context, page);
    const loggedIn = isDreaminaLoggedIn(snapshot);
    return {
      ok: loggedIn,
      connected: true,
      loggedIn,
      url: snapshot.url,
      title: snapshot.title,
      pageCount: context.pages().length,
      cdpUrl,
      publicUrl,
      message: loggedIn
        ? `Dreamina 云浏览器已连接并已登录。当前页面：${snapshot.title || snapshot.url}`
        : `Dreamina 云浏览器已连接，但当前页面显示未登录。请打开 ${publicUrl} 登录后再测试。`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dreamina browser bridge failed.";
    return {
      ok: false,
      connected: false,
      loggedIn: false,
      url: "",
      title: "",
      pageCount: 0,
      cdpUrl,
      publicUrl,
      message: `Dreamina 云浏览器未连接：${message}`,
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function callDreaminaWebImageModel(
  model: ImageAiModelLike,
  input: {
    prompt: string;
    count?: number;
    size?: string;
    parameters?: Record<string, unknown>;
  },
): Promise<ImageModelCallResult> {
  return withDreaminaWebBrowserTask("image-generation", () => callDreaminaWebImageModelUnlocked(model, input));
}

async function callDreaminaWebImageModelUnlocked(
  model: ImageAiModelLike,
  input: {
    prompt: string;
    count?: number;
    size?: string;
    parameters?: Record<string, unknown>;
  },
): Promise<ImageModelCallResult> {
  const started = Date.now();
  const cdpUrl = dreaminaCdpUrl();
  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 10000 });
    const context = await activeDreaminaContext(browser);
    const page = await activeDreaminaPage(context);
    await ensureDreaminaGeneratorPage(page);

    const snapshot = await snapshotDreaminaPage(context, page);
    if (!isDreaminaLoggedIn(snapshot)) {
      throw new Error(`Dreamina 云浏览器当前未登录。请先打开 ${dreaminaPublicBrowserUrl()} 手动登录 Dreamina，再重新生成。`);
    }
    await ensureDreaminaImageMode(page);
    await closeDreaminaBlockingOverlays(page);

    const capturedImageUrls = new Map<string, CapturedImageUrl>();
    const jsonResponses: unknown[] = [];
    let captureResponses = false;
    const responseHandler = async (response: { url(): string; headers(): Record<string, string>; json(): Promise<unknown> }) => {
      if (!captureResponses) return;
      const url = response.url();
      if (!/dreamina|capcut|byte|bytedance|tos|image|generate/i.test(url)) return;
      const contentType = response.headers()["content-type"] || "";
      if (/^image\//i.test(contentType) && likelyGeneratedImageUrl(url)) {
        captureDreaminaImageUrl(capturedImageUrls, url, Date.now());
        return;
      }
      if (!/json/i.test(contentType)) return;
      try {
        const payload = await response.json();
        jsonResponses.push(payload);
        for (const imageUrl of extractImageUrls(payload)) {
          captureDreaminaImageUrl(capturedImageUrls, imageUrl, Date.now());
        }
      } catch {
        // Ignore non-JSON and streaming responses.
      }
    };
    page.on("response", responseHandler);

    const tempDir = await uploadReferenceImagesIfPossible(page, input.parameters);
    try {
      await closeDreaminaBlockingOverlays(page);
      await fillPrompt(page, input.prompt);
      await applyImageOptions(page, model, input);
      await closeDreaminaBlockingOverlays(page);
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      await clickDreaminaGoToBottom(page);
      const existingImageUrls = await collectDomImageUrls(page);
      const existingResultCardKeys = await collectDreaminaResultCardKeys(page);
      capturedImageUrls.clear();
      captureResponses = true;
      const submittedAt = Date.now();
      await clickDreaminaGenerate(page);
      const requestedImages = dreaminaRequestedImageCount(input);
      const images = await waitForDreaminaImages(
        page,
        existingImageUrls,
        existingResultCardKeys,
        capturedImageUrls,
        requestedImages,
        submittedAt,
        input.prompt,
      );
      if (images.length === 0) {
        throw new Error("Dreamina Web 生成结束后未捕获到新图片 URL。请在云浏览器里确认页面是否仍在生成、是否弹出验证，或页面结构是否变化。");
      }
      if (requestedImages > 1 && images.length < requestedImages) {
        throw new Error(`Dreamina Web 本次只捕获到 ${images.length}/${requestedImages} 张结果图。页面可能只出现了输入区任务封面，还没有渲染完整的 4 张结果卡片；请在云浏览器里点 Go to bottom 查看是否仍在生成后重试。`);
      }
      return {
        model: {
          id: model.id,
          provider: model.providerConfig?.providerType ?? model.provider,
          model: model.model,
          displayName: model.displayName,
        },
        images: images.slice(0, dreaminaRequestedImageCount(input)),
        raw: {
          provider: "dreamina-web",
          cdpUrl,
          pageUrl: page.url(),
          jsonResponses,
        },
        durationMs: Date.now() - started,
      };
    } finally {
      page.off("response", responseHandler);
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function callDreaminaWebVideoModel(input: DreaminaWebVideoInput): Promise<DreaminaWebVideoResult> {
  return withDreaminaWebBrowserTask("video-generation", () => callDreaminaWebVideoModelUnlocked(input));
}

async function callDreaminaWebVideoModelUnlocked(input: DreaminaWebVideoInput): Promise<DreaminaWebVideoResult> {
  const started = Date.now();
  const cdpUrl = dreaminaCdpUrl();
  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 10000 });
    const context = await activeDreaminaContext(browser);
    const page = await activeDreaminaPage(context);
    await ensureDreaminaGeneratorPage(page);

    const snapshot = await snapshotDreaminaPage(context, page);
    if (!isDreaminaLoggedIn(snapshot)) {
      throw new Error(`Dreamina 云浏览器当前未登录。请先打开 ${dreaminaPublicBrowserUrl()} 手动登录 Dreamina，再重新生成。`);
    }

    await ensureDreaminaVideoMode(page);
    await closeDreaminaBlockingOverlays(page);
    await applyVideoOptions(page, input);
    await closeDreaminaBlockingOverlays(page);

    const capturedPayloads: CapturedJsonPayload[] = [];
    const responseHandler = async (response: { url(): string; headers(): Record<string, string>; json(): Promise<unknown> }) => {
      const url = response.url();
      const contentType = response.headers()["content-type"] || "";
      if (!/dreamina|capcut|byte|bytedance|aigc|generate|history|queue|task|video/i.test(url)) return;
      if (!/json/i.test(contentType)) return;
      try {
        capturedPayloads.push({ url, capturedAt: Date.now(), payload: await response.json() });
      } catch {
        // Ignore non-JSON or opaque responses.
      }
    };
    page.on("response", responseHandler);

    const referenceUpload = await uploadReferenceMediaIfPossible(page, {
      imageUrls: input.referenceImageUrls,
      audioUrls: input.referenceAudioUrls ?? [],
    });
    try {
      if (referenceUpload) {
        assertDreaminaReferenceUploadAccepted(referenceUpload);
      }
      await fillPrompt(page, input.prompt);
      await assertDreaminaVideoComposerReady(page);
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
      await clickDreaminaGoToBottom(page);
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(1000);
      const existingVideoKeys = await collectDreaminaVideoUrlKeys(page);
      const existingFailureCount = await dreaminaWebVideoDomFailureCount(page);
      capturedPayloads.length = 0;
      const submittedAt = Date.now();
      await clickDreaminaGenerate(page);
      const result = await waitForDreaminaVideoResult(page, capturedPayloads, submittedAt, existingVideoKeys, existingFailureCount);
      return {
        ...result,
        raw: {
          provider: "dreamina-web",
          cdpUrl,
          pageUrl: page.url(),
          referenceAudioUrls: input.referenceAudioUrls ?? [],
          uploadedReferenceImageCount: referenceUpload?.imageUrls.length ?? 0,
          uploadedReferenceAudioCount: referenceUpload?.audioUrls.length ?? 0,
          uploadedReferenceFileNames: referenceUpload?.files.map((file) => path.basename(file)) ?? [],
          reusedExistingReferences: Boolean(referenceUpload?.reusedExistingReferences),
          composerReferenceItemCountBeforeUpload: referenceUpload?.beforeReferenceItemCount ?? 0,
          composerReferenceItemCountAfterReset: referenceUpload?.afterResetReferenceItemCount ?? 0,
          composerReferenceItemCountAfterUpload: referenceUpload?.afterReferenceItemCount ?? 0,
          composerReferenceStatsAfterUpload: referenceUpload?.afterReferenceStats ?? null,
          composerResetPageUrl: referenceUpload?.resetPageUrl ?? "",
          payloads: capturedPayloads.slice(-12).map((entry) => ({
            url: entry.url,
            capturedAt: entry.capturedAt,
            payload: summarizeDreaminaWebPayload(entry.payload),
          })),
          result: summarizeDreaminaWebPayload(result.raw),
        },
        durationMs: Date.now() - started,
      };
    } finally {
      page.off("response", responseHandler);
      if (referenceUpload?.tempDir) await rm(referenceUpload.tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function preflightDreaminaWebVideoUpload(input: DreaminaWebVideoInput): Promise<DreaminaWebVideoUploadPreflightResult> {
  return withDreaminaWebBrowserTask("video-preflight", () => preflightDreaminaWebVideoUploadUnlocked(input));
}

async function preflightDreaminaWebVideoUploadUnlocked(input: DreaminaWebVideoInput): Promise<DreaminaWebVideoUploadPreflightResult> {
  const started = Date.now();
  const cdpUrl = dreaminaCdpUrl();
  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 10000 });
    const context = await activeDreaminaContext(browser);
    const page = await activeDreaminaPage(context);
    await ensureDreaminaGeneratorPage(page);

    const snapshot = await snapshotDreaminaPage(context, page);
    if (!isDreaminaLoggedIn(snapshot)) {
      throw new Error(`Dreamina 云浏览器当前未登录。请先打开 ${dreaminaPublicBrowserUrl()} 手动登录 Dreamina，再重新预检。`);
    }

    await ensureDreaminaVideoMode(page);
    await closeDreaminaBlockingOverlays(page);
    await applyVideoOptions(page, input);
    await closeDreaminaBlockingOverlays(page);

    const existingReferenceUpload = await existingDreaminaReferenceUploadForInput(page, input);
    if (existingReferenceUpload) {
      return {
        ok: true,
        raw: {
          provider: "dreamina-web",
          cdpUrl,
          pageUrl: page.url(),
          uploadedReferenceImageCount: existingReferenceUpload.imageUrls.length,
          uploadedReferenceAudioCount: existingReferenceUpload.audioUrls.length,
          uploadedReferenceFileNames: [],
          reusedExistingReferences: true,
          composerReferenceItemCountBeforeUpload: existingReferenceUpload.beforeReferenceItemCount,
          composerReferenceItemCountAfterReset: existingReferenceUpload.afterResetReferenceItemCount,
          composerReferenceItemCountAfterUpload: existingReferenceUpload.afterReferenceItemCount,
          composerReferenceStatsAfterUpload: existingReferenceUpload.afterReferenceStats,
          composerResetPageUrl: existingReferenceUpload.resetPageUrl,
        },
        durationMs: Date.now() - started,
      };
    }

    const referenceUpload = await uploadReferenceMediaIfPossible(page, {
      imageUrls: input.referenceImageUrls,
      audioUrls: input.referenceAudioUrls ?? [],
    });
    try {
      if (referenceUpload) {
        assertDreaminaReferenceUploadAccepted(referenceUpload);
      }
      return {
        ok: true,
        raw: {
          provider: "dreamina-web",
          cdpUrl,
          pageUrl: page.url(),
          uploadedReferenceImageCount: referenceUpload?.imageUrls.length ?? 0,
          uploadedReferenceAudioCount: referenceUpload?.audioUrls.length ?? 0,
          uploadedReferenceFileNames: referenceUpload?.files.map((file) => path.basename(file)) ?? [],
          reusedExistingReferences: Boolean(referenceUpload?.reusedExistingReferences),
          composerReferenceItemCountBeforeUpload: referenceUpload?.beforeReferenceItemCount ?? 0,
          composerReferenceItemCountAfterReset: referenceUpload?.afterResetReferenceItemCount ?? 0,
          composerReferenceItemCountAfterUpload: referenceUpload?.afterReferenceItemCount ?? 0,
          composerReferenceStatsAfterUpload: referenceUpload?.afterReferenceStats ?? null,
          composerResetPageUrl: referenceUpload?.resetPageUrl ?? "",
        },
        durationMs: Date.now() - started,
      };
    } finally {
      if (referenceUpload?.tempDir) await rm(referenceUpload.tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function queryDreaminaWebVideoModel(submitId: string, options: { existingVideoUrls?: string[] } = {}): Promise<DreaminaWebVideoQueryResult> {
  return withDreaminaWebBrowserTask("video-query", () => queryDreaminaWebVideoModelUnlocked(submitId, options));
}

async function queryDreaminaWebVideoModelUnlocked(submitId: string, options: { existingVideoUrls?: string[] } = {}): Promise<DreaminaWebVideoQueryResult> {
  const started = Date.now();
  const cdpUrl = dreaminaCdpUrl();
  let browser: Browser | null = null;
  const trimmedSubmitId = submitId.trim();
  try {
    browser = await chromium.connectOverCDP(cdpUrl, { timeout: 10000 });
    const context = await activeDreaminaContext(browser);
    const page = passiveDreaminaPage(context);
    if (!page) {
      return dreaminaWebVideoQueryUnavailableResult(trimmedSubmitId, cdpUrl, started, "Dreamina 云浏览器没有可查询的页面。");
    }

    const snapshot = await snapshotDreaminaPage(context, page).catch(() => null);
    if (snapshot && !isDreaminaLoggedIn(snapshot)) {
      return dreaminaWebVideoQueryUnavailableResult(trimmedSubmitId, cdpUrl, started, "Dreamina 云浏览器当前未登录，暂时无法查询视频结果。", page.url());
    }

    const capturedPayloads: CapturedJsonPayload[] = [];
    const historyPayload = await fetchDreaminaVideoHistoryById(page, trimmedSubmitId).catch(() => null);
    if (historyPayload) capturedPayloads.push(historyPayload);
    const payloadResult = dreaminaWebVideoResultForSubmitId(capturedPayloads, trimmedSubmitId);
    const errorMessage = payloadResult.genStatus === "failed" ? dreaminaWebVideoPayloadFailureMessage(payloadResult.raw) : "";
    return {
      submitId: trimmedSubmitId,
      genStatus: payloadResult.videoUrl ? "succeeded" : payloadResult.genStatus || "running",
      videoUrl: payloadResult.videoUrl,
      raw: {
        provider: "dreamina-web",
        queryMode: "history-only",
        cdpUrl,
        pageUrl: page.url(),
        submitId: trimmedSubmitId,
        errorMessage,
        existingVideoUrlCount: options.existingVideoUrls?.length ?? 0,
        payloads: capturedPayloads.slice(-12).map((entry) => ({
          url: entry.url,
          capturedAt: entry.capturedAt,
          payload: summarizeDreaminaWebPayload(entry.payload),
        })),
        result: summarizeDreaminaWebPayload(payloadResult.raw),
      },
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Dreamina Web 查询暂时失败。");
    return dreaminaWebVideoQueryUnavailableResult(trimmedSubmitId, cdpUrl, started, message);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

function passiveDreaminaPage(context: BrowserContext): Page | null {
  const pages = context.pages();
  return pages.find((page) => /dreamina\.capcut\.com/i.test(page.url())) ?? pages[0] ?? null;
}

function dreaminaWebVideoQueryUnavailableResult(
  submitId: string,
  cdpUrl: string,
  started: number,
  message: string,
  pageUrl = "",
): DreaminaWebVideoQueryResult {
  return {
    submitId,
    genStatus: "running",
    raw: {
      provider: "dreamina-web",
      queryMode: "history-only",
      cdpUrl,
      pageUrl,
      submitId,
      warning: message,
      result: { submitId, genStatus: "running" },
    },
    durationMs: Date.now() - started,
  };
}

async function withDreaminaWebBrowserTask<T>(kind: string, run: () => Promise<T>): Promise<T> {
  if (kind === "video-query") {
    return run();
  }
  return withDreaminaWebExclusiveTask(kind, run);
}

async function withDreaminaWebExclusiveTask<T>(kind: string, run: () => Promise<T>): Promise<T> {
  if (activeDreaminaWebTask) {
    const ageSeconds = Math.max(1, Math.round((Date.now() - activeDreaminaWebTask.startedAt) / 1000));
    throw new Error(`${DREAMINA_WEB_BUSY_MESSAGE} 当前任务：${activeDreaminaWebTask.kind}，已运行 ${ageSeconds}s。`);
  }
  activeDreaminaWebTask = { kind, startedAt: Date.now() };
  try {
    return await run();
  } finally {
    activeDreaminaWebTask = null;
  }
}

export async function dreaminaWebExclusiveTaskForTest<T>(kind: string, run: () => Promise<T>): Promise<T> {
  return withDreaminaWebExclusiveTask(kind, run);
}

export async function dreaminaWebBrowserTaskForTest<T>(kind: string, run: () => Promise<T>): Promise<T> {
  return withDreaminaWebBrowserTask(kind, run);
}

async function activeDreaminaContext(browser: Browser): Promise<BrowserContext> {
  const existing = browser.contexts()[0];
  if (existing) return existing;
  return browser.newContext();
}

async function activeDreaminaPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  let dreaminaPage: Page | undefined;
  for (const page of pages) {
    if (!/dreamina\.capcut\.com/i.test(page.url())) continue;
    if (await isDreaminaCrashPage(page)) continue;
    dreaminaPage = page;
    break;
  }
  const page = dreaminaPage ?? pages[0] ?? await context.newPage();
  if (!/dreamina\.capcut\.com/i.test(page.url())) {
    await page.goto(dreaminaStartUrl(), { waitUntil: "domcontentloaded", timeout: 30000 });
  }
  return page;
}

async function ensureDreaminaGeneratorPage(page: Page): Promise<void> {
  if (!/dreamina\.capcut\.com/i.test(page.url()) || await isDreaminaCrashPage(page)) {
    await page.goto(dreaminaStartUrl(), { waitUntil: "domcontentloaded", timeout: 30000 });
  }
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => undefined);
  if (await isDreaminaCrashPage(page)) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => undefined);
  }
  if (await isDreaminaCrashPage(page)) {
    throw new Error("Dreamina 云浏览器页面已崩溃（Aw, Snap）。请重启 Dreamina 云浏览器后重试。");
  }
}

async function ensureDreaminaImageMode(page: Page): Promise<void> {
  await waitForDreaminaComposerOrModeControls(page);
  const currentMode = await visibleText(page, "[role='combobox']").catch(() => "");
  if (/\bAI Image\b/i.test(currentMode)) return;

  const modeCombo = page.locator("[role='combobox']").filter({ hasText: /\bAI (Video|Image|Agent|Avatar)\b/i }).first();
  if (!(await modeCombo.isVisible({ timeout: 3000 }).catch(() => false))) {
    const bodyText = await visibleBodyText(page);
    if (/\bAI Image\b/i.test(bodyText) && /Describe the image/i.test(bodyText)) return;
    throw new Error(`Dreamina Web 页面没有找到 AI Image/AI Video 模式选择器。请在云浏览器里确认已进入 Create 生成页。${await dreaminaPageDebugSuffix(page)}`);
  }

  await modeCombo.click({ timeout: 5000, force: true });
  await page.waitForTimeout(400);

  const imageOption = page.getByRole("option", { name: /\bAI Image\b/i }).first();
  const optionBox = await imageOption.boundingBox().catch(() => null);
  if (optionBox) {
    await page.mouse.click(optionBox.x + optionBox.width / 2, optionBox.y + optionBox.height / 2);
  } else {
    await imageOption.click({ timeout: 5000, force: true });
  }

  await page.waitForFunction(() => {
    const body = document.body?.innerText || "";
    return /\bAI Image\b/i.test(body) && /Describe the image/i.test(body);
  }, { timeout: 10000 }).catch(() => undefined);

  const finalText = await visibleBodyText(page);
  if (!/\bAI Image\b/i.test(finalText) || !/Describe the image/i.test(finalText)) {
    throw new Error("Dreamina Web 未能切换到 AI Image 图片生成模式。请在云浏览器里手动切到 AI Image 后重试。");
  }
}

async function ensureDreaminaVideoMode(page: Page): Promise<void> {
  await waitForDreaminaComposerOrModeControls(page);
  if (await dreaminaLooksLikeVideoComposer(page)) return;

  const currentMode = await visibleText(page, "[role='combobox']").catch(() => "");
  if (/\bAI Video\b/i.test(currentMode)) {
    await waitForDreaminaVideoComposerReady(page);
    if (await dreaminaLooksLikeVideoComposer(page)) return;
  }

  const modeCombo = page.locator("[role='combobox']").filter({ hasText: /\bAI (Video|Image|Agent|Avatar)\b/i }).first();
  if (!(await modeCombo.isVisible({ timeout: 3000 }).catch(() => false))) {
    await waitForDreaminaVideoComposerReady(page);
    if (await dreaminaLooksLikeVideoComposer(page)) return;
    throw new Error(`Dreamina Web 页面没有找到 AI Video/AI Image 模式选择器。请在云浏览器里确认已进入 Create 生成页。${await dreaminaPageDebugSuffix(page)}`);
  }

  await modeCombo.click({ timeout: 5000, force: true });
  await page.waitForTimeout(400);

  const videoOption = page.getByRole("option", { name: /\bAI Video\b/i }).first();
  const optionBox = await videoOption.boundingBox().catch(() => null);
  if (optionBox) {
    await page.mouse.click(optionBox.x + optionBox.width / 2, optionBox.y + optionBox.height / 2);
  } else {
    await videoOption.click({ timeout: 5000, force: true });
  }

  await page.waitForFunction(() => {
    const body = document.body?.innerText || "";
    return /Describe your video/i.test(body) || (/\bAI Video\b/i.test(body) && /Seedance|Omni reference/i.test(body));
  }, { timeout: 10000 }).catch(() => undefined);

  if (!(await dreaminaLooksLikeVideoComposer(page))) {
    throw new Error(`Dreamina Web 未能切换到 AI Video 视频生成模式。请在云浏览器里手动切到 AI Video 后重试。${await dreaminaPageDebugSuffix(page)}`);
  }
}

async function waitForDreaminaComposerOrModeControls(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const body = document.body?.innerText || "";
    return /Describe your (?:video|image)|\bAI (?:Video|Image)\b|Seedance|Seedream/i.test(body);
  }, { timeout: 15000 }).catch(() => undefined);
}

async function waitForDreaminaVideoComposerReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const body = document.body?.innerText || "";
    if (/\bLoading\.\.\./i.test(body)) return false;
    const hasReadyVideoText = /Describe your video/i.test(body)
      || (/\bAI Video\b/i.test(body) && /Dreamina Seedance|Seedance 2\.0|Omni reference/i.test(body));
    const hasMultiReferenceInput = Array.from(document.querySelectorAll("input[type='file']"))
      .some((input) => (input as HTMLInputElement).multiple);
    if (hasReadyVideoText && hasMultiReferenceInput) return true;
    return false;
  }, { timeout: 25000 }).catch(() => undefined);
}

async function dreaminaLooksLikeVideoComposer(page: Page): Promise<boolean> {
  const bodyText = await visibleBodyText(page);
  if (/\bLoading\.\.\./i.test(bodyText)) return false;
  const hasReadyText = /Describe your video/i.test(bodyText)
    || (/\bAI Video\b/i.test(bodyText) && /Seedance|Omni reference|Dreamina Seedance/i.test(bodyText));
  if (!hasReadyText) return false;
  return page.locator("input[type='file'][multiple]").count().then((count) => count > 0).catch(() => false);
}

async function dreaminaPageDebugSuffix(page: Page): Promise<string> {
  const [title, url, bodyText, controlsText] = await Promise.all([
    page.title().catch(() => ""),
    Promise.resolve(page.url()),
    visibleBodyText(page),
    visibleText(page, "[role='combobox'], button").catch(() => ""),
  ]);
  const body = bodyText.slice(0, 300);
  const controls = controlsText.slice(0, 240);
  return ` 当前页：${title || url}；URL：${url}；页面文本：${body || "空"}；控件：${controls || "空"}`;
}

async function snapshotDreaminaPage(context: BrowserContext, page: Page): Promise<DreaminaWebPageSnapshot> {
  const [title, bodyText, cookies] = await Promise.all([
    page.title().catch(() => ""),
    page.locator("body").innerText({ timeout: 5000 }).catch(() => ""),
    context.cookies().catch(() => []),
  ]);
  return {
    url: page.url(),
    title,
    bodyText,
    cookies: cookies.map((cookie) => ({ name: cookie.name, domain: cookie.domain })),
  };
}

function isDreaminaLoggedIn(snapshot: DreaminaWebPageSnapshot): boolean {
  const text = snapshot.bodyText.replace(/\s+/g, " ").trim();
  if (isDreaminaCrashText(text)) return false;
  if (/(^|\s)(Sign in|Log in|登录|登入)(\s|$)/i.test(text)) return false;
  if (/\/login|\/signin/i.test(snapshot.url)) return false;
  return snapshot.cookies.some((cookie) => /session|sid|passport|odin|uid|login/i.test(cookie.name));
}

async function isDreaminaCrashPage(page: Page): Promise<boolean> {
  const [title, bodyText] = await Promise.all([
    page.title().catch(() => ""),
    page.locator("body").innerText({ timeout: 1000 }).catch(() => ""),
  ]);
  return isDreaminaCrashText(`${title}\n${bodyText}`);
}

function isDreaminaCrashText(text: string): boolean {
  return /Aw,\s*Snap|Something went wrong while displaying this webpage|Error code:\s*\d+/i.test(text);
}

async function fillPrompt(page: Page, prompt: string): Promise<void> {
  await closeDreaminaBlockingOverlays(page);
  const selectors = [
    "textarea:visible",
    "[contenteditable='true']:visible",
    "[role='textbox']:visible",
    "input:not([type='file']):visible",
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (!(await isUsablePromptInput(candidate))) continue;
      await fillDreaminaPromptInput(page, candidate, prompt);
      return;
    }
  }
  throw new Error("Dreamina Web 页面中没有找到可填写的提示词输入框。请在云浏览器里切到 AI Image/Seedream 生成页面后重试。");
}

async function fillDreaminaPromptInput(page: Page, locator: Locator, prompt: string): Promise<void> {
  await locator.click({ timeout: 10000 });
  const filledByLocator = await locator.fill(prompt, { timeout: 10000 }).then(() => true).catch(() => false);
  if (filledByLocator && await locatorContainsPrompt(locator, prompt)) return;

  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => undefined);
  await page.keyboard.insertText(prompt);
  await page.waitForTimeout(300);
  if (await locatorContainsPrompt(locator, prompt)) return;

  await locator.evaluate((element, value) => {
    element.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: value }));
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      element.value = value;
    } else {
      element.textContent = value;
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, prompt);
  await page.waitForTimeout(300);
  if (await locatorContainsPrompt(locator, prompt)) return;
  throw new Error("Dreamina Web 提示词输入失败：页面没有保留本次提示词，请在云浏览器中确认输入框可编辑后重试。");
}

async function locatorContainsPrompt(locator: Locator, prompt: string): Promise<boolean> {
  const expected = prompt.trim().slice(0, 40);
  if (!expected) return true;
  const text = await locator.evaluate((element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
    return element.textContent || "";
  }).catch(() => "");
  return text.includes(expected);
}

async function isUsablePromptInput(locator: Locator): Promise<boolean> {
  try {
    if (!(await locator.isVisible({ timeout: 1000 }))) return false;
    const box = await locator.boundingBox();
    if (!box || box.width < 120 || box.height < 20) return false;
    const disabled = await locator.evaluate((element) => (
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? element.disabled || element.readOnly
        : false
    ));
    return !disabled;
  } catch {
    return false;
  }
}

async function uploadReferenceImagesIfPossible(page: Page, parameters: Record<string, unknown> | undefined): Promise<string | null> {
  const referenceUrls = imageUrlsFromParameters(parameters);
  if (referenceUrls.length === 0) return null;
  const fileInput = await dreaminaReferenceFileInput(page);
  if ((await fileInput.count().catch(() => 0)) === 0) {
    throw new Error("Dreamina Web 页面没有找到参考图上传入口，无法使用传入的参考图。");
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dreamina-web-refs-"));
  const files: string[] = [];
  for (let index = 0; index < referenceUrls.length; index += 1) {
    const file = await downloadReferenceMedia(referenceUrls[index], tempDir, `reference-${index + 1}`, "image");
    files.push(file);
  }
  await fileInput.setInputFiles([], { timeout: 5000 }).catch(() => undefined);
  await setDreaminaReferenceInputFiles(fileInput, files);
  await page.waitForTimeout(1200);
  return tempDir;
}

async function uploadReferenceMediaIfPossible(
  page: Page,
  input: { imageUrls?: string[]; audioUrls?: string[] },
): Promise<DreaminaReferenceMediaUpload | null> {
  const imageUrls = uniqueHttpUrls(input.imageUrls ?? []).slice(0, 9);
  const audioUrls = uniqueHttpUrls(input.audioUrls ?? []).slice(0, 16);
  if (imageUrls.length === 0 && audioUrls.length === 0) return null;
  const referenceSignature = dreaminaReferenceUploadSignature(imageUrls, audioUrls);
  const existingStats = await dreaminaComposerReferenceStats(page);
  const reusableStats = await dreaminaReusableExistingReferenceStats(page, existingStats, referenceSignature, imageUrls.length, audioUrls.length);
  if (reusableStats) {
    await rememberDreaminaReferenceUpload(page, {
      signature: referenceSignature,
      imageCount: imageUrls.length,
      audioCount: audioUrls.length,
      updatedAt: Date.now(),
      source: "accepted",
    });
    return {
      tempDir: "",
      imageUrls,
      audioUrls,
      files: [],
      referenceSignature,
      reusedExistingReferences: true,
      beforeReferenceItemCount: reusableStats.itemCount,
      afterResetReferenceItemCount: reusableStats.itemCount,
      afterReferenceItemCount: reusableStats.itemCount,
      afterReferenceStats: reusableStats,
      resetPageUrl: page.url(),
    };
  }
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dreamina-web-media-"));
  const imageFiles: string[] = [];
  const audioFiles: string[] = [];
  try {
    for (let index = 0; index < imageUrls.length; index += 1) {
      imageFiles.push(await downloadReferenceMedia(imageUrls[index], tempDir, `image-${index + 1}`, "image"));
    }
    for (let index = 0; index < audioUrls.length; index += 1) {
      audioFiles.push(await downloadReferenceMedia(audioUrls[index], tempDir, `audio-${index + 1}`, "audio"));
    }
    let lastUpload: DreaminaReferenceMediaUpload | null = null;
    for (let attempt = 1; attempt <= DREAMINA_REFERENCE_UPLOAD_ATTEMPTS; attempt += 1) {
      const resetStats = await resetDreaminaComposerReferencesIfNeeded(page);
      const upload = await uploadReferenceMediaFilesToComposer(page, {
        imageUrls,
        audioUrls,
        imageFiles,
        audioFiles,
        tempDir,
        referenceSignature,
        resetStats,
      });
      lastUpload = upload;
      const acceptedUpload = dreaminaReferenceUploadHasExpectedCounts(upload)
        ? upload
        : await waitForLateDreaminaReferenceStats(page, upload);
      if (acceptedUpload) {
        await rememberDreaminaReferenceUpload(page, {
          signature: referenceSignature,
          imageCount: imageUrls.length,
          audioCount: audioUrls.length,
          updatedAt: Date.now(),
          source: "accepted",
        });
        return acceptedUpload;
      }
      if (attempt < DREAMINA_REFERENCE_UPLOAD_ATTEMPTS) {
        latestDreaminaReferenceUploadMemory = null;
        await page.evaluate((key) => window.localStorage.removeItem(key), DREAMINA_REFERENCE_UPLOAD_MEMORY_KEY).catch(() => undefined);
        await page.waitForTimeout(1200);
      }
    }
    if (lastUpload) return await refreshDreaminaReferenceUploadStats(page, lastUpload);
    throw new Error("Dreamina Web 参考素材上传失败：没有得到页面素材统计。");
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function waitForLateDreaminaReferenceStats(
  page: Page,
  upload: DreaminaReferenceMediaUpload,
): Promise<DreaminaReferenceMediaUpload | null> {
  await page.waitForTimeout(10_000).catch(() => undefined);
  await settleDreaminaComposerForReferenceRead(page).catch(() => undefined);
  const stats = await bestDreaminaComposerReferenceStats(page, {
    imageCount: upload.imageUrls.length,
    audioCount: upload.audioUrls.length,
  });
  if (!dreaminaReferenceStatsMeetExpected(stats, { imageCount: upload.imageUrls.length, audioCount: upload.audioUrls.length })) {
    return null;
  }
  return {
    ...upload,
    afterReferenceItemCount: stats.itemCount,
    afterReferenceStats: stats,
    debugText: "",
  };
}

async function refreshDreaminaReferenceUploadStats(
  page: Page,
  upload: DreaminaReferenceMediaUpload,
): Promise<DreaminaReferenceMediaUpload> {
  await settleDreaminaComposerForReferenceRead(page).catch(() => undefined);
  const stats = await bestDreaminaComposerReferenceStats(page, {
    imageCount: upload.imageUrls.length,
    audioCount: upload.audioUrls.length,
  });
  if (dreaminaReferenceStatsScore(stats) < dreaminaReferenceStatsScore(upload.afterReferenceStats)) {
    return upload;
  }
  return {
    ...upload,
    afterReferenceItemCount: stats.itemCount,
    afterReferenceStats: stats,
    debugText: await dreaminaReferenceUploadDebugText(page),
  };
}

async function existingDreaminaReferenceUploadForInput(
  page: Page,
  input: { referenceImageUrls?: string[]; referenceAudioUrls?: string[] },
): Promise<DreaminaReferenceMediaUpload | null> {
  const imageUrls = uniqueHttpUrls(input.referenceImageUrls ?? []).slice(0, 9);
  const audioUrls = uniqueHttpUrls(input.referenceAudioUrls ?? []).slice(0, 16);
  if (imageUrls.length === 0 && audioUrls.length === 0) return null;
  const referenceSignature = dreaminaReferenceUploadSignature(imageUrls, audioUrls);
  const visibleStats = await dreaminaReusableExistingReferenceStats(
    page,
    await dreaminaComposerReferenceStats(page),
    referenceSignature,
    imageUrls.length,
    audioUrls.length,
  );
  if (!visibleStats) return null;
  await rememberDreaminaReferenceUpload(page, {
    signature: referenceSignature,
    imageCount: imageUrls.length,
    audioCount: audioUrls.length,
    updatedAt: Date.now(),
    source: "accepted",
  });
  return {
    tempDir: "",
    imageUrls,
    audioUrls,
    files: [],
    referenceSignature,
    reusedExistingReferences: true,
    beforeReferenceItemCount: visibleStats.itemCount,
    afterResetReferenceItemCount: visibleStats.itemCount,
    afterReferenceItemCount: visibleStats.itemCount,
    afterReferenceStats: visibleStats,
    resetPageUrl: page.url(),
  };
}

async function uploadReferenceMediaFilesToComposer(
  page: Page,
  input: {
    imageUrls: string[];
    audioUrls: string[];
    imageFiles: string[];
    audioFiles: string[];
    tempDir: string;
    referenceSignature: string;
    resetStats: { beforeReferenceItemCount: number; afterResetReferenceItemCount: number; resetPageUrl: string };
  },
): Promise<DreaminaReferenceMediaUpload> {
  const fileInput = await dreaminaReferenceFileInput(page);
  if ((await fileInput.count().catch(() => 0)) === 0) {
    throw new Error("Dreamina Web 页面没有找到参考素材上传入口，无法使用传入的参考图或音频。");
  }
  await fileInput.setInputFiles([], { timeout: 5000 }).catch(() => undefined);
  if (input.imageFiles.length > 0) {
    await setDreaminaReferenceInputFiles(fileInput, input.imageFiles);
    await settleDreaminaComposerForReferenceRead(page);
    await page.waitForTimeout(5000);
  }
  if (input.audioFiles.length > 0) {
    for (let index = 0; index < input.audioFiles.length; index += 1) {
      const currentInput = await dreaminaReferenceFileInput(page);
      await setDreaminaReferenceInputFiles(currentInput, [input.audioFiles[index]]);
      await waitForDreaminaReferenceProgress(page, {
        imageCount: input.imageUrls.length,
        audioCount: index + 1,
      }, DREAMINA_REFERENCE_AUDIO_STEP_TIMEOUT_MS);
    }
  }
  await settleDreaminaComposerForReferenceRead(page);
  const afterReferenceStats = await waitForDreaminaComposerReferenceStats(
    page,
    { imageCount: input.imageUrls.length, audioCount: input.audioUrls.length },
  );
  return buildDreaminaReferenceMediaUpload(input, afterReferenceStats, await dreaminaReferenceUploadDebugText(page));
}

async function waitForDreaminaReferenceProgress(
  page: Page,
  expected: { imageCount: number; audioCount: number },
  timeoutMs: number,
): Promise<DreaminaComposerReferenceStats> {
  const started = Date.now();
  let latest = await bestDreaminaComposerReferenceStats(page, expected);
  while (Date.now() - started < timeoutMs) {
    await settleDreaminaComposerForReferenceRead(page).catch(() => undefined);
    latest = await bestDreaminaComposerReferenceStats(page, expected);
    if (
      latest.imageCount + latest.videoCount >= expected.imageCount
      && latest.audioCount >= expected.audioCount
    ) {
      return latest;
    }
    await page.waitForTimeout(700);
  }
  return latest;
}

function buildDreaminaReferenceMediaUpload(
  input: {
    imageUrls: string[];
    audioUrls: string[];
    imageFiles: string[];
    audioFiles: string[];
    tempDir: string;
    referenceSignature: string;
    resetStats: { beforeReferenceItemCount: number; afterResetReferenceItemCount: number; resetPageUrl: string };
  },
  afterReferenceStats: DreaminaComposerReferenceStats,
  debugText = "",
): DreaminaReferenceMediaUpload {
  return {
    tempDir: input.tempDir,
    imageUrls: input.imageUrls,
    audioUrls: input.audioUrls,
    files: [...input.imageFiles, ...input.audioFiles],
    referenceSignature: input.referenceSignature,
    beforeReferenceItemCount: input.resetStats.beforeReferenceItemCount,
    afterResetReferenceItemCount: input.resetStats.afterResetReferenceItemCount,
    afterReferenceItemCount: afterReferenceStats.itemCount,
    afterReferenceStats,
    resetPageUrl: input.resetStats.resetPageUrl,
    debugText,
  };
}

async function dreaminaReferenceUploadDebugText(page: Page): Promise<string> {
  return (page.evaluate(`(() => {
    const body = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    const inputs = Array.from(document.querySelectorAll("input[type='file']")).map((input, index) => {
      const element = input;
      const box = element.getBoundingClientRect();
      return {
        index,
        multiple: element.multiple,
        accept: element.getAttribute("accept") || "",
        disabled: element.disabled,
        box: Math.round(box.x) + "," + Math.round(box.y) + "," + Math.round(box.width) + "x" + Math.round(box.height),
        parentText: (element.parentElement?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
      };
    });
    return JSON.stringify({
      loading: /\bLoading\.\.\./i.test(body),
      hasDescribeVideo: /Describe your video/i.test(body),
      hasOmni: /Omni reference/i.test(body),
      inputs,
      tail: body.slice(-700),
    });
  })()`) as Promise<string>).catch(() => "");
}

async function waitForDreaminaReferenceBatch(
  page: Page,
  expected: { imageCount: number; audioCount: number },
): Promise<DreaminaComposerReferenceStats> {
  await settleDreaminaComposerForReferenceRead(page);
  return waitForDreaminaComposerReferenceStats(page, expected, dreaminaReferenceUploadTimeoutMs());
}

async function dreaminaReferenceFileInput(page: Page): Promise<Locator> {
  const multipleInput = page.locator("input[type='file'][multiple]").first();
  if ((await multipleInput.count().catch(() => 0)) > 0) return multipleInput;
  return page.locator("input[type='file']").first();
}

function dreaminaReferenceStatsMeetExpected(
  stats: DreaminaComposerReferenceStats,
  expected: { imageCount: number; audioCount: number },
): boolean {
  return (
    stats.imageCount + stats.videoCount >= expected.imageCount
    && stats.audioCount >= expected.audioCount
    && stats.itemCount >= expected.imageCount + expected.audioCount
  );
}

function dreaminaReferenceUploadHasExpectedCounts(upload: DreaminaReferenceMediaUpload): boolean {
  return dreaminaReferenceStatsMeetExpected(upload.afterReferenceStats, {
    imageCount: upload.imageUrls.length,
    audioCount: upload.audioUrls.length,
  });
}

function assertDreaminaReferenceUploadAccepted(upload: DreaminaReferenceMediaUpload): void {
  const expectedImageCount = upload.imageUrls.length;
  const expectedAudioCount = upload.audioUrls.length;
  const expectedItemCount = expectedImageCount + expectedAudioCount;
  const stats = upload.afterReferenceStats;
  const enoughImages = stats.imageCount + stats.videoCount >= expectedImageCount;
  const enoughAudio = stats.audioCount >= expectedAudioCount;
  const enoughItems = stats.itemCount >= expectedItemCount;
  if (enoughImages && enoughAudio && enoughItems) return;
  const samples = stats.samples
    .map((item) => `${item.tag}:${item.text || item.src || item.className}`)
    .join(" | ")
    .slice(0, 500);
  throw new Error(
    `Dreamina Web 素材上传校验失败：应上传 ${expectedImageCount} 张图 / ${expectedAudioCount} 段音频，`
    + `页面实际识别 ${stats.imageCount} 张图 / ${stats.audioCount} 段音频 / ${stats.videoCount} 个视频素材 / ${stats.unknownCount} 个未知素材。`
    + "已阻止正式生成，避免扣积分。"
    + (samples ? ` 页面素材：${samples}` : "")
    + (upload.debugText ? ` 页面状态：${upload.debugText.slice(0, 1200)}` : ""),
  );
}

async function setDreaminaReferenceInputFiles(fileInput: Locator, files: string[]): Promise<void> {
  const timeoutMs = dreaminaReferenceFileInputTimeoutMs(files.length);
  try {
    await fileInput.setInputFiles(files, { timeout: timeoutMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (/timeout|timed out/i.test(message)) {
      throw new Error(
        `Dreamina Web 参考素材上传到页面超时：本次 ${files.length} 个文件，已等待 ${Math.round(timeoutMs / 1000)} 秒。`
        + "素材还没成功进入 Dreamina 输入框，未提交生成，未拿到 submit_id；请减少参考素材或稍后重试。",
      );
    }
    throw error;
  }
}

function imageUrlsFromParameters(parameters: Record<string, unknown> | undefined): string[] {
  if (!parameters) return [];
  const urls: string[] = [];
  for (const key of ["image_urls", "reference_images", "images"]) {
    const value = parameters[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string" && item.trim()) urls.push(item.trim());
      if (isRecord(item) && typeof item.image_url === "string" && item.image_url.trim()) urls.push(item.image_url.trim());
    }
  }
  return Array.from(new Set(urls)).slice(0, 8);
}

function uniqueHttpUrls(values: string[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const url = String(value || "").trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function dreaminaReferenceUploadSignature(imageUrls: string[], audioUrls: string[]): string {
  return JSON.stringify({ imageUrls, audioUrls });
}

async function rememberDreaminaReferenceUpload(page: Page, memory: DreaminaReferenceUploadMemory): Promise<void> {
  latestDreaminaReferenceUploadMemory = memory;
  await page.evaluate(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: DREAMINA_REFERENCE_UPLOAD_MEMORY_KEY, value: memory }).catch(() => undefined);
}

async function dreaminaStoredReferenceUploadMemory(page: Page): Promise<DreaminaReferenceUploadMemory | null> {
  const value = await page.evaluate((key) => window.localStorage.getItem(key), DREAMINA_REFERENCE_UPLOAD_MEMORY_KEY).catch(() => null);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<DreaminaReferenceUploadMemory>;
    if (
      typeof parsed.signature === "string"
      && Number.isFinite(Number(parsed.imageCount))
      && Number.isFinite(Number(parsed.audioCount))
      && Number.isFinite(Number(parsed.updatedAt))
    ) {
      return {
        signature: parsed.signature,
        imageCount: Number(parsed.imageCount),
        audioCount: Number(parsed.audioCount),
        updatedAt: Number(parsed.updatedAt),
        source: parsed.source === "accepted" ? "accepted" : "attempt",
      };
    }
  } catch {
    return null;
  }
  return null;
}

async function dreaminaReusableExistingReferenceStats(
  page: Page,
  stats: DreaminaComposerReferenceStats,
  referenceSignature: string,
  expectedImageCount: number,
  expectedAudioCount: number,
): Promise<DreaminaComposerReferenceStats | null> {
  const memory = latestDreaminaReferenceUploadMemory ?? await dreaminaStoredReferenceUploadMemory(page);
  if (!memory) return null;
  if (memory.signature !== referenceSignature) return null;
  if (Date.now() - memory.updatedAt > 15 * 60 * 1000) return null;
  if (
    stats.imageCount + stats.videoCount >= expectedImageCount
    && stats.audioCount >= expectedAudioCount
    && stats.itemCount >= expectedImageCount + expectedAudioCount
  ) {
    return stats;
  }
  const visibleStats = await dreaminaVisibleComposerReferenceStats(page);
  if (
    visibleStats.imageCount + visibleStats.videoCount >= expectedImageCount
    && visibleStats.audioCount >= expectedAudioCount
    && visibleStats.itemCount >= expectedImageCount + expectedAudioCount
  ) {
    return visibleStats;
  }
  const composerStats = await dreaminaComposerRootReferenceStats(page);
  if (
    composerStats.imageCount + composerStats.videoCount >= expectedImageCount
    && composerStats.audioCount >= expectedAudioCount
    && composerStats.itemCount >= expectedImageCount + expectedAudioCount
  ) {
    return composerStats;
  }
  const looseStats = await dreaminaLooseComposerReferenceStats(page);
  if (
    looseStats.imageCount + looseStats.videoCount >= expectedImageCount
    && looseStats.audioCount >= expectedAudioCount
    && looseStats.itemCount >= expectedImageCount + expectedAudioCount
  ) {
    return looseStats;
  }
  return null;
}

async function dreaminaVisibleComposerReferenceStats(page: Page): Promise<DreaminaComposerReferenceStats> {
  return dreaminaRuntimeComposerReferenceStats(page)
    .then((stats) => stats.visible)
    .catch(() => emptyDreaminaComposerReferenceStats());
}

async function dreaminaLooseComposerReferenceStats(page: Page): Promise<DreaminaComposerReferenceStats> {
  return dreaminaRuntimeComposerReferenceStats(page)
    .then((stats) => stats.loose)
    .catch(() => emptyDreaminaComposerReferenceStats());
}

async function downloadReferenceMedia(url: string, tempDir: string, baseName: string, fallbackKind: "image" | "audio"): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`参考素材下载失败（${response.status}）：${url.slice(0, 160)}`);
  }
  const contentType = response.headers.get("content-type") || "";
  const extension = extensionForMediaContentType(contentType, url, fallbackKind);
  const filePath = path.join(tempDir, `${baseName}${extension}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(filePath, buffer);
  if (fallbackKind === "image") {
    return optimizeDreaminaReferenceImage(filePath, tempDir, baseName).catch(() => filePath);
  }
  return filePath;
}

async function optimizeDreaminaReferenceImage(inputPath: string, tempDir: string, baseName: string): Promise<string> {
  const outputPath = path.join(tempDir, `${baseName}-dreamina.jpg`);
  await execFilePromise("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-vf",
    `scale='min(${DREAMINA_REFERENCE_IMAGE_MAX_DIMENSION},iw)':'min(${DREAMINA_REFERENCE_IMAGE_MAX_DIMENSION},ih)':force_original_aspect_ratio=decrease`,
    "-frames:v",
    "1",
    "-q:v",
    String(DREAMINA_REFERENCE_IMAGE_JPEG_QUALITY),
    outputPath,
  ], 30_000);
  const originalSize = (await stat(inputPath).catch(() => ({ size: 0 }))).size;
  const optimizedSize = (await stat(outputPath).catch(() => ({ size: 0 }))).size;
  if (optimizedSize > 0 && (originalSize === 0 || optimizedSize < originalSize)) return outputPath;
  await rm(outputPath, { force: true }).catch(() => undefined);
  return inputPath;
}

function execFilePromise(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (error) {
        reject(new Error(output || error.message));
        return;
      }
      resolve(output);
    });
  });
}

function extensionForMediaContentType(contentType: string, url = "", fallbackKind: "image" | "audio" = "image"): string {
  if (/mpeg|mp3/i.test(contentType)) return ".mp3";
  if (/wav|wave|x-wav/i.test(contentType)) return ".wav";
  if (/m4a|mp4a|aac/i.test(contentType)) return ".m4a";
  if (/ogg/i.test(contentType)) return ".ogg";
  if (/jpeg|jpg/i.test(contentType)) return ".jpg";
  if (/webp/i.test(contentType)) return ".webp";
  if (/gif/i.test(contentType)) return ".gif";
  if (/png/i.test(contentType)) return ".png";
  const pathName = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  const match = pathName.match(/\.(png|jpe?g|webp|gif|mp3|wav|m4a|aac|ogg)(?:$|[?#])/i);
  if (match) return `.${match[1].toLowerCase().replace("jpeg", "jpg")}`;
  return fallbackKind === "audio" ? ".wav" : ".png";
}

export function dreaminaReferenceMediaForTest(input: { imageUrls?: string[]; audioUrls?: string[] }): { imageUrls: string[]; audioUrls: string[] } {
  return {
    imageUrls: uniqueHttpUrls(input.imageUrls ?? []).slice(0, 9),
    audioUrls: uniqueHttpUrls(input.audioUrls ?? []).slice(0, 16),
  };
}

export function dreaminaReferenceUploadAcceptedForTest(input: {
  imageUrls?: string[];
  audioUrls?: string[];
  stats: DreaminaComposerReferenceStats;
}): void {
  assertDreaminaReferenceUploadAccepted({
    tempDir: "",
    imageUrls: input.imageUrls ?? [],
    audioUrls: input.audioUrls ?? [],
    files: [],
    referenceSignature: dreaminaReferenceUploadSignature(input.imageUrls ?? [], input.audioUrls ?? []),
    beforeReferenceItemCount: 0,
    afterResetReferenceItemCount: 0,
    afterReferenceItemCount: input.stats.itemCount,
    afterReferenceStats: input.stats,
    resetPageUrl: "",
  });
}

export async function dreaminaExistingReferenceUploadForTest(
  input: Pick<DreaminaWebVideoInput, "referenceImageUrls" | "referenceAudioUrls">,
): Promise<DreaminaReferenceMediaUpload | null> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(dreaminaCdpUrl(), { timeout: 10000 });
    const context = await activeDreaminaContext(browser);
    const page = await activeDreaminaPage(context);
    return await existingDreaminaReferenceUploadForInput(page, input);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function dreaminaCurrentComposerReferenceStatsForTest(): Promise<{
  primary: DreaminaComposerReferenceStats;
  composer: DreaminaComposerReferenceStats;
  visible: DreaminaComposerReferenceStats;
  loose: DreaminaComposerReferenceStats;
}> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(dreaminaCdpUrl(), { timeout: 10000 });
    const context = await activeDreaminaContext(browser);
    const page = await activeDreaminaPage(context);
    await settleDreaminaComposerForReferenceRead(page).catch(() => undefined);
    return {
      primary: await dreaminaComposerReferenceStats(page),
      composer: await dreaminaComposerRootReferenceStats(page),
      visible: await dreaminaVisibleComposerReferenceStats(page),
      loose: await dreaminaLooseComposerReferenceStats(page),
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function resetDreaminaComposerReferencesIfNeeded(page: Page): Promise<{ beforeReferenceItemCount: number; afterResetReferenceItemCount: number; resetPageUrl: string }> {
  const beforeReferenceItemCount = await countDreaminaComposerReferenceItems(page);
  await page.goto(dreaminaStartUrl(), { waitUntil: "domcontentloaded", timeout: 30000 }).catch(async () => {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => undefined);
  });
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => undefined);
  await ensureDreaminaVideoMode(page);
  await clickVisibleTextOption(page, "Omni reference");
  await waitForDreaminaVideoComposerReady(page);
  await assertDreaminaVideoComposerReady(page);
  await ensureDreaminaPromptComposerOpen(page);
  await closeDreaminaBlockingOverlays(page);
  await page.waitForTimeout(800);
  return {
    beforeReferenceItemCount,
    afterResetReferenceItemCount: await countDreaminaComposerReferenceItems(page),
    resetPageUrl: page.url(),
  };
}

async function countDreaminaComposerReferenceItems(page: Page): Promise<number> {
  return dreaminaComposerReferenceStats(page).then((stats) => stats.itemCount);
}

async function waitForDreaminaComposerReferenceStats(
  page: Page,
  expected: { imageCount: number; audioCount: number },
  timeoutMs = dreaminaReferenceUploadTimeoutMs(),
): Promise<DreaminaComposerReferenceStats> {
  const started = Date.now();
  let latest = await bestDreaminaComposerReferenceStats(page, expected);
  while (Date.now() - started < timeoutMs) {
    await settleDreaminaComposerForReferenceRead(page);
    latest = await bestDreaminaComposerReferenceStats(page, expected);
    if (
      latest.imageCount + latest.videoCount >= expected.imageCount
      && latest.audioCount >= expected.audioCount
      && latest.itemCount >= expected.imageCount + expected.audioCount
    ) {
      return latest;
    }
    await page.waitForTimeout(700);
  }
  return latest;
}

async function bestDreaminaComposerReferenceStats(
  page: Page,
  expected: { imageCount: number; audioCount: number },
): Promise<DreaminaComposerReferenceStats> {
  const composer = await dreaminaComposerRootReferenceStats(page);
  if (dreaminaReferenceStatsMeetExpected(composer, expected)) return composer;
  const primary = await dreaminaComposerReferenceStats(page);
  if (dreaminaReferenceStatsMeetExpected(primary, expected)) return primary;
  const visible = await dreaminaVisibleComposerReferenceStats(page);
  if (dreaminaReferenceStatsMeetExpected(visible, expected)) return visible;
  const loose = await dreaminaLooseComposerReferenceStats(page);
  if (dreaminaReferenceStatsMeetExpected(loose, expected)) return loose;
  return [composer, primary, visible, loose].sort((left, right) => {
    return dreaminaReferenceStatsScore(right) - dreaminaReferenceStatsScore(left);
  })[0] ?? primary;
}

function dreaminaReferenceStatsScore(stats: DreaminaComposerReferenceStats): number {
  return stats.itemCount + stats.imageCount + stats.audioCount + stats.videoCount;
}

async function settleDreaminaComposerForReferenceRead(page: Page): Promise<void> {
  await page.bringToFront().catch(() => undefined);
  await clickDreaminaGoToBottom(page).catch(() => undefined);
  await ensureDreaminaPromptComposerOpen(page).catch(() => undefined);
  await page.evaluate(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" as ScrollBehavior });
    const editable = document.querySelector("[contenteditable='true'], [role='textbox']") as HTMLElement | null;
    editable?.scrollIntoView({ block: "center", inline: "nearest" });
  }).catch(() => undefined);
  await page.waitForTimeout(500);
}

async function dreaminaComposerRootReferenceStats(page: Page): Promise<DreaminaComposerReferenceStats> {
  return dreaminaRuntimeComposerReferenceStats(page)
    .then((stats) => stats.composer)
    .catch(() => emptyDreaminaComposerReferenceStats());
}

async function ensureDreaminaPromptComposerOpen(page: Page): Promise<void> {
  if (await dreaminaPromptComposerHasInput(page)) return;
  await clickDreaminaGoToBottom(page).catch(() => undefined);
  await page.waitForTimeout(500);
  if (await dreaminaPromptComposerHasInput(page)) return;
  const clickedReference = await page.evaluate(() => {
    const isRendered = (element: Element): boolean => {
      const box = (element as HTMLElement).getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const candidates = Array.from(document.querySelectorAll("[class*='reference-upload'], [class*='reference-item'], [class*='reference-group-content'], [class*='references-']"))
      .filter((element) => isRendered(element) && !element.closest("[class*='record-reference'], [class*='record-card'], [class*='history'], [class*='History']"));
    const target = candidates[candidates.length - 1] as HTMLElement | undefined;
    target?.scrollIntoView({ block: "center", inline: "nearest" });
    target?.click();
    return Boolean(target);
  }).catch(() => false);
  if (clickedReference) await page.waitForTimeout(800);
  if (await dreaminaPromptComposerHasInput(page)) return;
  await page.mouse.click(Math.round(page.viewportSize()?.width ? page.viewportSize()!.width / 2 : 680), Math.round((page.viewportSize()?.height ?? 920) - 140)).catch(() => undefined);
  await page.waitForTimeout(800);
}

async function dreaminaPromptComposerHasInput(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const body = document.body?.innerText || "";
    if (/Describe your video/i.test(body)) return true;
    const editable = Array.from(document.querySelectorAll("textarea, [contenteditable='true'], [role='textbox']"))
      .some((element) => {
        const box = (element as HTMLElement).getBoundingClientRect();
        const style = window.getComputedStyle(element as HTMLElement);
        return box.width > 120 && box.height > 20 && style.display !== "none" && style.visibility !== "hidden";
      });
    return editable;
  }).catch(() => false);
}

function dreaminaReferenceUploadTimeoutMs(): number {
  const configured = Number(process.env.DREAMINA_WEB_REFERENCE_UPLOAD_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured >= 10_000) return configured;
  return 60_000;
}

function dreaminaReferenceFileInputTimeoutMs(fileCount = 1): number {
  const configured = Number(process.env.DREAMINA_WEB_REFERENCE_FILE_INPUT_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured >= 30_000) return Math.floor(configured);
  return Math.max(120_000, Math.min(300_000, 45_000 + Math.max(1, fileCount) * 20_000));
}

function emptyDreaminaComposerReferenceStats(): DreaminaComposerReferenceStats {
  return {
    itemCount: 0,
    imageCount: 0,
    audioCount: 0,
    videoCount: 0,
    placeholderCount: 0,
    unknownCount: 0,
    samples: [],
  };
}

type DreaminaRuntimeComposerReferenceStats = {
  primary: DreaminaComposerReferenceStats;
  composer: DreaminaComposerReferenceStats;
  visible: DreaminaComposerReferenceStats;
  loose: DreaminaComposerReferenceStats;
};

const DREAMINA_COMPOSER_REFERENCE_STATS_SCRIPT = `(() => {
  const empty = () => ({
    itemCount: 0,
    imageCount: 0,
    audioCount: 0,
    videoCount: 0,
    placeholderCount: 0,
    unknownCount: 0,
    samples: [],
  });
  const normalizeAudioLabel = (value) => {
    const match = String(value || "").match(/audio[-\\s]*(\\d+)/i);
    return match ? "audio-" + Number(match[1]) : String(value || "").toLowerCase();
  };
  const classText = (element) => String(element.className || "");
  const textOf = (element) => String(element.textContent || "").replace(/\\s+/g, " ").trim();
  const srcOf = (element) => (
    element.getAttribute("src")
    || (element.querySelector("img,video,audio,source") && element.querySelector("img,video,audio,source").getAttribute("src"))
    || ""
  );
  const isRendered = (element) => {
    const style = window.getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
  };
  const isHistory = (element) => Boolean(element.closest("[class*='record-reference'], [class*='record-card'], [class*='history'], [class*='History']"));
  const imageSample = (element, className) => {
    const box = element.getBoundingClientRect();
    return {
      tag: element.tagName,
      text: "",
      className: String(className || classText(element)).replace(/\\s+/g, " ").trim().slice(0, 120),
      src: String(element.src || element.getAttribute("src") || "").slice(0, 160),
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
  };
  const audioSample = (label, className) => ({
    tag: "DIV",
    text: label,
    className,
    src: "",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const statsFromRoot = (root, audioClassName) => {
    if (!root) return empty();
    const images = Array.from(root.querySelectorAll("img[src^='blob:https://dreamina.capcut.com/']"))
      .filter((element) => isRendered(element));
    const imageUrls = new Set(images.map((element) => element.src).filter(Boolean));
    const audioLabels = new Set((textOf(root).match(/audio[-\\s]*\\d+/gi) || []).map(normalizeAudioLabel));
    return {
      itemCount: imageUrls.size + audioLabels.size,
      imageCount: imageUrls.size,
      audioCount: audioLabels.size,
      videoCount: 0,
      placeholderCount: 0,
      unknownCount: 0,
      samples: [
        ...images.slice(0, 8).map((element) => imageSample(element)),
        ...Array.from(audioLabels).slice(0, 8).map((label) => audioSample(label, audioClassName)),
      ],
    };
  };
  const composerRoots = Array.from(document.querySelectorAll("[class*='content-l'], [class*='layout-'], [class*='dimension-layout'], [class*='references-'], [class*='reference-group-content']"))
    .filter((element) => {
      if (!isRendered(element) || isHistory(element)) return false;
      const box = element.getBoundingClientRect();
      return box.y > -10 && box.height > 40;
    })
    .sort((left, right) => {
      const leftBox = left.getBoundingClientRect();
      const rightBox = right.getBoundingClientRect();
      const leftImages = left.querySelectorAll("img[src^='blob:https://dreamina.capcut.com/']").length;
      const rightImages = right.querySelectorAll("img[src^='blob:https://dreamina.capcut.com/']").length;
      return (rightImages * 100000 + rightBox.width * rightBox.height) - (leftImages * 100000 + leftBox.width * leftBox.height);
    });
  const composer = statsFromRoot(composerRoots[0], "composer-audio-label");

  const visibleContainers = Array.from(document.querySelectorAll("[class*='references-'], [class*='reference-group-'], [class*='reference-group-content']"))
    .filter((element) => {
      if (!isRendered(element) || isHistory(element)) return false;
      const text = textOf(element);
      return /Reference|audio[-\\s]*\\d+|image[-\\s]*\\d+/i.test(text) || element.querySelector("img[src^='blob:https://dreamina.capcut.com/']");
    })
    .sort((left, right) => {
      const leftBox = left.getBoundingClientRect();
      const rightBox = right.getBoundingClientRect();
      return (rightBox.width * rightBox.height) - (leftBox.width * leftBox.height);
    });
  const visible = statsFromRoot(visibleContainers[0], "visible-audio-label");

  const looseImages = Array.from(document.querySelectorAll("img[src^='blob:https://dreamina.capcut.com/']"))
    .filter((element) => isRendered(element) && !isHistory(element));
  const looseImageUrls = new Set(looseImages.map((element) => element.src).filter(Boolean));
  const looseRoots = Array.from(document.querySelectorAll("[class*='content-l'], [class*='layout-'], [class*='dimension-layout'], [class*='prompt-editor'], [class*='references-']"))
    .filter((element) => {
      if (!isRendered(element) || isHistory(element)) return false;
      const box = element.getBoundingClientRect();
      return box.y > -10;
    });
  const looseAudioLabels = new Set(looseRoots.map((element) => textOf(element)).join(" ").match(/audio[-\\s]*\\d+/gi) || []);
  const normalizedLooseAudioLabels = new Set(Array.from(looseAudioLabels).map(normalizeAudioLabel));
  const loose = {
    itemCount: looseImageUrls.size + normalizedLooseAudioLabels.size,
    imageCount: looseImageUrls.size,
    audioCount: normalizedLooseAudioLabels.size,
    videoCount: 0,
    placeholderCount: 0,
    unknownCount: 0,
    samples: [
      ...looseImages.slice(0, 8).map((element) => imageSample(element)),
      ...Array.from(normalizedLooseAudioLabels).slice(0, 8).map((label) => audioSample(label, "loose-audio-label")),
    ],
  };

  const referenceContainers = Array.from(document.querySelectorAll("[class*='references-'], [class*='reference-group-content']"))
    .filter((element) => {
      if (!isRendered(element) || isHistory(element)) return false;
      const searchable = textOf(element) + " " + classText(element) + " " + srcOf(element);
      return /Reference|audio[-\\s]*\\d+|image[-\\s]*\\d+|reference-item|reference-CP|blob:https:\\/\\/dreamina\\.capcut\\.com\\//i.test(searchable);
    })
    .sort((left, right) => {
      const leftBox = left.getBoundingClientRect();
      const rightBox = right.getBoundingClientRect();
      return (rightBox.width * rightBox.height) - (leftBox.width * leftBox.height);
    });
  const primaryRoot = referenceContainers[0];
  const primary = primaryRoot ? statsFromRoot(primaryRoot, "primary-audio-label") : empty();
  const placeholderCount = primaryRoot
    ? Array.from(primaryRoot.querySelectorAll("[class*='reference-upload'], [class*='reference-placeholder'], [class*='reference-group-background']"))
      .filter((element) => isRendered(element)).length
    : 0;
  primary.placeholderCount = placeholderCount;

  return { primary, composer, visible, loose };
})()`;

async function dreaminaRuntimeComposerReferenceStats(page: Page): Promise<DreaminaRuntimeComposerReferenceStats> {
  return page.evaluate(DREAMINA_COMPOSER_REFERENCE_STATS_SCRIPT) as Promise<DreaminaRuntimeComposerReferenceStats>;
}

function dreaminaReferenceStatsFromSnapshots(snapshots: DreaminaReferenceElementSnapshot[]): DreaminaComposerReferenceStats {
  const stats = emptyDreaminaComposerReferenceStats();
  const byId = new Map(snapshots.map((item) => [item.id, item]));
  const visibleReferenceItems = snapshots.filter((item) => {
    if (!item.rendered || item.historyClosest) return false;
    if (!/reference-item/i.test(item.className)) return false;
    return true;
  });
  const candidateItems = visibleReferenceItems.length > 0
    ? visibleReferenceItems
    : snapshots.filter((item) => {
        if (!item.rendered || item.historyClosest) return false;
        if (/reference-upload|reference-group-background/i.test(item.className)) return false;
        if (/reference-CP/i.test(item.className)) return true;
        if (/^(img|audio|video)$/i.test(item.tag)) return true;
        return false;
      });
  const seenKeys = new Set<string>();
  for (const item of candidateItems) {
    const kind = dreaminaReferenceSnapshotMediaKind(item, byId);
    const key = dreaminaReferenceSnapshotKey(item, kind, byId);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    if (kind === "placeholder") {
      stats.placeholderCount += 1;
      continue;
    }
    stats.itemCount += 1;
    if (kind === "image") stats.imageCount += 1;
    else if (kind === "audio") stats.audioCount += 1;
    else if (kind === "video") stats.videoCount += 1;
    else stats.unknownCount += 1;
    if (stats.samples.length < 12) {
      stats.samples.push({
        tag: item.tag,
        text: item.text.slice(0, 100),
        className: item.className.replace(/\s+/g, " ").trim().slice(0, 120),
        src: item.src.slice(0, 160),
        x: Math.round(item.x),
        y: Math.round(item.y),
        width: Math.round(item.width),
        height: Math.round(item.height),
      });
    }
  }
  return stats;
}

function dreaminaReferenceSnapshotMediaKind(
  item: DreaminaReferenceElementSnapshot,
  byId: Map<number, DreaminaReferenceElementSnapshot>,
): "image" | "audio" | "video" | "placeholder" | "unknown" {
  const self = `${item.text} ${item.className} ${item.src}`;
  const children = dreaminaReferenceSnapshotChildrenText(item, byId);
  const mediaText = `${self} ${children}`;
  if (/^\s*Reference\s*$/i.test(item.text) || /reference-upload|reference-placeholder|reference-group-background/i.test(self)) return "placeholder";
  if (
    /^audio$/i.test(item.tag)
    || item.hasAudio
    || /reference-attachment|(?:^|\b)audio[-\s]*\d+\b|audio[-_/]|\.(mp3|wav|m4a|aac|ogg)(?:[?#]|$)/i.test(mediaText)
  ) return "audio";
  if (
    /^video$/i.test(item.tag)
    || item.hasVideo
    || /video[-_/]|\.(mp4|mov|webm)(?:[?#]|$)/i.test(mediaText)
  ) return "video";
  if (
    /^img$/i.test(item.tag)
    || item.hasImage
    || /reference-image|image[-_/]|blob:https:\/\/dreamina\.capcut\.com\/|ibyteimg|dreamina-sign|\.(png|jpe?g|webp|gif|bmp)(?:[?#]|$)/i.test(mediaText)
  ) return "image";
  return "unknown";
}

function dreaminaReferenceSnapshotChildrenText(
  item: DreaminaReferenceElementSnapshot,
  byId: Map<number, DreaminaReferenceElementSnapshot>,
): string {
  const parts: string[] = [];
  for (const child of byId.values()) {
    if (child.parentId === item.id) parts.push(`${child.text} ${child.className} ${child.src}`);
  }
  return parts.join(" ");
}

function dreaminaReferenceSnapshotFamilyText(
  item: DreaminaReferenceElementSnapshot,
  byId: Map<number, DreaminaReferenceElementSnapshot>,
): string {
  const parts = [`${item.text} ${item.className} ${item.src}`, dreaminaReferenceSnapshotChildrenText(item, byId)];
  if (item.parentId !== null) {
    const parent = byId.get(item.parentId);
    if (parent) parts.push(`${parent.text} ${parent.className} ${parent.src}`);
  }
  return parts.join(" ");
}

function dreaminaReferenceSnapshotKey(
  item: DreaminaReferenceElementSnapshot,
  kind: "image" | "audio" | "video" | "placeholder" | "unknown",
  byId: Map<number, DreaminaReferenceElementSnapshot>,
): string {
  const selfAndChildren = `${item.text} ${item.className} ${item.src} ${dreaminaReferenceSnapshotChildrenText(item, byId)}`;
  const localAudioLabel = selfAndChildren.match(/\baudio[-\s]*\d+\b/i)?.[0] ?? "";
  if (kind === "audio" && localAudioLabel) return `${kind}:${normalizeDreaminaAudioLabel(localAudioLabel)}`;
  const localSrc = selfAndChildren.match(/(?:blob:https:\/\/dreamina\.capcut\.com\/[^\s"')]+|https?:\/\/[^\s"')]+)/i)?.[0] ?? "";
  if (localSrc) return `${kind}:${localSrc}`;
  const family = dreaminaReferenceSnapshotFamilyText(item, byId);
  const audioLabel = family.match(/\baudio[-\s]*\d+\b/i)?.[0] ?? "";
  if (audioLabel) return `${kind}:${normalizeDreaminaAudioLabel(audioLabel)}`;
  const src = family.match(/(?:blob:https:\/\/dreamina\.capcut\.com\/[^\s"')]+|https?:\/\/[^\s"')]+)/i)?.[0] ?? "";
  if (src) return `${kind}:${src}`;
  return `${kind}:${item.id}`;
}

function normalizeDreaminaAudioLabel(value: string): string {
  const match = value.match(/audio[-\s]*(\d+)/i);
  return match ? `audio-${Number(match[1])}` : value.toLowerCase();
}

async function dreaminaComposerReferenceStats(page: Page): Promise<DreaminaComposerReferenceStats> {
  return dreaminaRuntimeComposerReferenceStats(page)
    .then((stats) => stats.primary)
    .catch(() => emptyDreaminaComposerReferenceStats());
}

export function dreaminaReferenceStatsFromSnapshotsForTest(snapshots: DreaminaReferenceElementSnapshot[]): DreaminaComposerReferenceStats {
  return dreaminaReferenceStatsFromSnapshots(snapshots);
}

export function dreaminaReferenceSnapshotForTest(input: Partial<DreaminaReferenceElementSnapshot>): DreaminaReferenceElementSnapshot {
  return {
    id: input.id ?? 1,
    parentId: input.parentId ?? null,
    tag: input.tag ?? "DIV",
    text: input.text ?? "",
    className: input.className ?? "",
    src: input.src ?? "",
    rendered: input.rendered ?? true,
    historyClosest: input.historyClosest ?? false,
    hasImage: input.hasImage ?? false,
    hasAudio: input.hasAudio ?? false,
    hasVideo: input.hasVideo ?? false,
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: input.width ?? 40,
    height: input.height ?? 40,
  };
}

export function dreaminaMediaExtensionForTest(contentType: string, url = "", fallbackKind: "image" | "audio" = "image"): string {
  return extensionForMediaContentType(contentType, url, fallbackKind);
}

function dreaminaRequestedImageCount(input: { count?: number; parameters?: Record<string, unknown> }): number {
  const explicitCount = input.count ?? numberFrom(input.parameters?.n, 0) ?? numberFrom(input.parameters?.count, 0);
  if (Number.isFinite(explicitCount) && explicitCount > 0) return Math.max(1, Math.min(Math.floor(explicitCount), 4));
  return 1;
}

function dreaminaModelLabelFromModelName(modelName: string): string {
  const normalized = modelName.toLowerCase();
  if (normalized.includes("5.0") && normalized.includes("lite")) return "Image 5.0 Lite";
  if (normalized.includes("image-5") || normalized.includes("seedream-5") || normalized.includes("seedream5")) return "Image 5.0";
  if (normalized.includes("4.0") || normalized.includes("seedream-4") || normalized.includes("seedream4")) return "Image 4.0";
  return "";
}

function dreaminaQualityLabel(parameters: Record<string, unknown> | undefined): string {
  const raw = stringFrom(parameters?.dreaminaQualityLabel, "")
    || stringFrom(parameters?.qualityLabel, "")
    || stringFrom(parameters?.quality, "")
    || stringFrom(parameters?.resolution, "");
  const normalized = raw.toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("2k")) return "2K";
  if (normalized.includes("1k")) return "1K";
  if (normalized.includes("high")) return "High";
  if (normalized.includes("standard")) return "Standard";
  return raw;
}

function dreaminaCountLabel(input: { count?: number; parameters?: Record<string, unknown> }): string {
  const count = dreaminaRequestedImageCount(input);
  if (count <= 1) return "";
  return String(count);
}

async function applyImageOptions(
  page: Page,
  model: ImageAiModelLike,
  input: { count?: number; size?: string; parameters?: Record<string, unknown> },
): Promise<void> {
  const modelLabel = stringFrom(input.parameters?.dreaminaModelLabel, "")
    || stringFrom(input.parameters?.modelLabel, "")
    || dreaminaModelLabelFromModelName(model.model);
  if (modelLabel) {
    await clickVisibleTextOption(page, modelLabel);
  }
  const qualityLabel = dreaminaQualityLabel(input.parameters);
  if (qualityLabel) {
    await clickVisibleTextOption(page, qualityLabel);
  }
  const ratio = ratioFromSize(input.size || stringFrom(input.parameters?.ratio, ""));
  if (!ratio) return;
  await clickVisibleTextOption(page, ratio);
}

async function applyVideoOptions(page: Page, input: DreaminaWebVideoInput): Promise<void> {
  await clickVisibleTextOption(page, "AI Video");
  await clickVisibleTextOption(page, "Dreamina Seedance 2.0 Fast");
  await clickVisibleTextOption(page, "Omni reference");
  await selectDreaminaToolbarOption(page, /^(?:1:1|4:3|3:4|16:9|9:16|21:9)$/i, normalizeVideoRatioLabel(input.ratio));
  await selectDreaminaToolbarOption(page, /^\d{1,2}s$/i, `${normalizeVideoDurationSeconds(input.durationSeconds)}s`);
  await assertDreaminaVideoComposerReady(page);
}

async function assertDreaminaVideoComposerReady(page: Page): Promise<void> {
  if (await dreaminaLooksLikeVideoComposer(page) && await dreaminaMainToolbarShows(page, "Omni reference")) return;
  throw new Error(`Dreamina Web 未处于 AI Video / Omni reference 视频生成模式，已停止提交以免误触发生图。请在云浏览器里切到 AI Video -> Omni reference 后重试。${await dreaminaPageDebugSuffix(page)}`);
}

function normalizeVideoRatioLabel(value: unknown): string {
  const ratio = String(value || "16:9").trim();
  return /^(1:1|4:3|3:4|16:9|9:16|21:9)$/i.test(ratio) ? ratio : "16:9";
}

function normalizeVideoDurationSeconds(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 5;
  return Math.max(4, Math.min(15, Math.round(number)));
}

async function selectDreaminaToolbarOption(page: Page, currentValuePattern: RegExp, targetLabel: string): Promise<boolean> {
  if (await dreaminaMainToolbarShows(page, targetLabel)) return true;
  const controls = page.locator("[role='combobox'], button");
  const count = await controls.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    if (!(await isSafeDreaminaControl(control, { allowCurrentValue: true }))) continue;
    const text = (await control.innerText({ timeout: 500 }).catch(() => "")).replace(/\s+/g, " ").trim();
    if (!currentValuePattern.test(text)) continue;
    await control.click({ timeout: 3000, force: true });
    await page.waitForTimeout(300);
    const clicked = await clickVisibleTextOption(page, targetLabel);
    await closeDreaminaBlockingOverlays(page);
    if (clicked || await dreaminaMainToolbarShows(page, targetLabel)) return true;
  }
  return clickVisibleTextOption(page, targetLabel);
}

async function clickVisibleTextOption(page: Page, label: string): Promise<boolean> {
  await closeDreaminaBlockingOverlays(page);
  const text = label.trim();
  if (!text) return false;
  if (await dreaminaMainToolbarShows(page, text)) return true;
  const escaped = escapeRegExp(text);
  const exactPattern = new RegExp(`^\\s*${escaped}\\s*$`, "i");
  const locators = [
    page.getByRole("button", { name: exactPattern }),
    page.getByRole("option", { name: exactPattern }),
    page.getByText(exactPattern),
  ];
  for (const locator of locators) {
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (!(await isSafeDreaminaControl(candidate, { allowCurrentValue: true }))) continue;
      await candidate.click({ timeout: 3000, force: true }).catch(() => undefined);
      await page.waitForTimeout(250);
      await closeDreaminaBlockingOverlays(page);
      return true;
    }
  }
  return false;
}

async function dreaminaMainToolbarShows(page: Page, label: string): Promise<boolean> {
  const toolbarText = await page.locator("[role='combobox'], button").evaluateAll((elements) => elements
    .filter((element) => {
      const htmlElement = element as HTMLElement;
      const style = window.getComputedStyle(htmlElement);
      const box = htmlElement.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || box.width <= 0 || box.height <= 0) return false;
      if (htmlElement.closest("[role='dialog'], .lv-modal-wrapper, .side-drawer-panel")) return false;
      if (htmlElement.closest("[class*='image-card-container'], [class*='image-card-wrapper'], [class*='slot-card-container'], [class*='video-card-container']")) return false;
      return true;
    })
    .map((element) => element.textContent || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()).catch(() => "");
  return dreaminaToolbarTextContains(toolbarText, label);
}

function dreaminaToolbarTextContains(toolbarText: string, label: string): boolean {
  const text = normalizeDreaminaComparableText(toolbarText);
  const expected = normalizeDreaminaComparableText(label);
  if (!text || !expected) return false;
  if (text.includes(expected)) return true;
  if (expected === "high" && /high\s*\(\s*2k\s*\)/i.test(toolbarText)) return true;
  if (expected === "2k" && /high\s*\(\s*2k\s*\)|\b2k\b/i.test(toolbarText)) return true;
  if (expected === "1k" && /\b1k\b/i.test(toolbarText)) return true;
  return false;
}

async function closeDreaminaBlockingOverlays(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (!(await hasDreaminaBlockingOverlay(page))) return;
    let clicked = false;
    const closeButton = await findTopmostDreaminaOverlayCloseButton(page);
    if (closeButton) {
      await closeButton.click({ timeout: 1500, force: true }).catch(() => undefined);
      clicked = true;
    }
    if (!clicked) {
      await page.keyboard.press("Escape").catch(() => undefined);
    }
    await page.waitForTimeout(250);
  }
  const overlays = await describeDreaminaBlockingOverlays(page);
  if (overlays.length > 0) {
    throw new Error(`Dreamina Web 当前有弹窗未关闭。已尝试点击弹窗 X 和按 Escape，但不会自动重置生成页以免丢失当前内容。请在云浏览器里关闭该弹窗后再重新生成。弹窗：${overlays.join(" | ")}`);
  }
}

async function findTopmostDreaminaOverlayCloseButton(page: Page): Promise<Locator | null> {
  const marker = `dreamina-close-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const marked = await page.evaluate((markerValue) => {
    const markerAttribute = "data-loohii-dreamina-close-candidate";
    document.querySelectorAll(`[${markerAttribute}]`).forEach((element) => element.removeAttribute(markerAttribute));

    const isVisible = (element: Element): boolean => {
      const htmlElement = element as HTMLElement;
      const style = window.getComputedStyle(htmlElement);
      const box = htmlElement.getBoundingClientRect();
      const intersectsViewport = box.right > 0 && box.bottom > 0 && box.left < window.innerWidth && box.top < window.innerHeight;
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0 && intersectsViewport;
    };

    const elementText = (element: Element): string => (
      [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-testid"),
        element.getAttribute("data-e2e"),
        element.getAttribute("class"),
        element.textContent,
        ...Array.from(element.querySelectorAll("svg title, use")).map((child) => (
          child.textContent
          || child.getAttribute("href")
          || child.getAttribute("xlink:href")
          || child.getAttribute("class")
          || ""
        )),
      ]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    );

    const closeSignalScore = (element: Element): number => {
      const text = elementText(element);
      let score = 0;
      if (/\b(close|dismiss|exit)\b|关闭|關閉/i.test(text)) score += 1000;
      if (/close-?button|modal-?close|drawer-?close|close-?icon|icon-?close|lv-icon-close|lv-modal-close/i.test(text)) score += 2500;
      if (/^×$|^x$/i.test((element.textContent || "").trim())) score += 1200;
      if (element.matches("button,[role='button'],a,[tabindex]")) score += 250;
      return score;
    };

    const nearestClickableClose = (element: Element): HTMLElement | null => {
      let current: Element | null = element;
      for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
        if (
          current.matches("button,[role='button'],a,[tabindex],[aria-label],[title]")
          || /close|关闭|關閉/i.test(String(current.getAttribute("class") || ""))
        ) {
          return current as HTMLElement;
        }
      }
      return element as HTMLElement;
    };

    const overlays = Array.from(document.querySelectorAll("[role='dialog'], .lv-modal-wrapper, .lv-modal, .lv-drawer, .side-drawer-panel"))
      .map((element, index) => {
        const htmlElement = element as HTMLElement;
        const style = window.getComputedStyle(htmlElement);
        const box = htmlElement.getBoundingClientRect();
        const zIndex = Number(style.zIndex);
        return { element, index, box, zIndex: Number.isFinite(zIndex) ? zIndex : 0 };
      })
      .filter((item) => isVisible(item.element))
      .sort((left, right) => (
        right.zIndex - left.zIndex
        || right.index - left.index
        || (right.box.width * right.box.height) - (left.box.width * left.box.height)
      ));

    for (const overlay of overlays) {
      const candidates = new Set<HTMLElement>();
      const explicitSelector = [
        "button[aria-label*='close' i]",
        "button[aria-label*='dismiss' i]",
        "button[title*='close' i]",
        "[role='button'][aria-label*='close' i]",
        "[role='button'][title*='close' i]",
        "[aria-label*='关闭']",
        "[aria-label*='關閉']",
        "[title*='关闭']",
        "[title*='關閉']",
        "[class*='close' i]",
        "[class*='modal-close' i]",
        "[class*='drawer-close' i]",
        "svg[class*='close' i]",
        "use[href*='close' i]",
        "use[xlink\\:href*='close' i]",
      ].join(",");
      overlay.element.querySelectorAll(explicitSelector).forEach((element) => {
        const target = nearestClickableClose(element);
        if (target) candidates.add(target);
      });

      overlay.element.querySelectorAll("button,[role='button']").forEach((element) => {
        const target = element as HTMLElement;
        const box = target.getBoundingClientRect();
        const inHeaderRight = (
          box.width > 0
          && box.height > 0
          && box.width <= 80
          && box.height <= 80
          && box.top <= overlay.box.top + Math.min(140, Math.max(80, overlay.box.height * 0.25))
          && box.left >= overlay.box.right - Math.min(180, Math.max(100, overlay.box.width * 0.25))
        );
        const compact = (target.textContent || "").replace(/\s+/g, " ").trim().length <= 8;
        if (inHeaderRight && compact) candidates.add(target);
      });

      let best: { element: HTMLElement; score: number } | null = null;
      for (const candidate of candidates) {
        if (!isVisible(candidate)) continue;
        const box = candidate.getBoundingClientRect();
        if (box.width < 8 || box.height < 8 || box.width > 120 || box.height > 120) continue;
        const signal = closeSignalScore(candidate);
        const topRightBias = Math.max(0, 500 - Math.abs(overlay.box.right - (box.left + box.width / 2)) - Math.abs((box.top + box.height / 2) - overlay.box.top));
        const score = signal + topRightBias;
        if (score < 200) continue;
        if (!best || score > best.score) best = { element: candidate, score };
      }
      if (best) {
        best.element.setAttribute(markerAttribute, markerValue);
        return true;
      }
    }
    return false;
  }, marker).catch(() => false);
  if (marked) {
    const locator = page.locator(`[data-loohii-dreamina-close-candidate="${marker}"]`).first();
    if (await locator.count().catch(() => 0)) return locator;
  }

  const closeTargets = page.locator([
    ".lv-modal-wrapper [class*='close' i]",
    "[role='dialog'] [class*='close' i]",
    ".lv-modal-wrapper [aria-label*='close' i]",
    "[role='dialog'] [aria-label*='close' i]",
    ".lv-modal-wrapper [title*='close' i]",
    "[role='dialog'] [title*='close' i]",
    ".lv-modal-wrapper [aria-label*='关闭']",
    "[role='dialog'] [aria-label*='关闭']",
    ".lv-modal-wrapper [title*='关闭']",
    "[role='dialog'] [title*='关闭']",
  ].join(","));
  const count = await closeTargets.count().catch(() => 0);
  let best: { locator: Locator; score: number } | null = null;
  for (let index = 0; index < count; index += 1) {
    const target = closeTargets.nth(index);
    const score = await target.evaluate((element) => {
      const style = window.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || box.width <= 0 || box.height <= 0) return null;
      const wrapper = element.closest(".lv-modal-wrapper, [role='dialog']");
      const wrapperBox = wrapper?.getBoundingClientRect();
      const zIndex = Number(style.zIndex);
      const wrapperZIndex = wrapper ? Number(window.getComputedStyle(wrapper).zIndex) : 0;
      const isRealCloseButton = /close-button/.test(String((element as HTMLElement).className || ""));
      return (
        (isRealCloseButton ? 10_000_000_000 : 0)
        + (Number.isFinite(zIndex) ? zIndex : 0) * 1_000_000
        + (Number.isFinite(wrapperZIndex) ? wrapperZIndex : 0) * 10_000
        + (wrapperBox ? wrapperBox.width * wrapperBox.height : 0)
        + box.y
      );
    }).catch(() => null);
    if (score == null) continue;
    if (!best || score >= best.score) best = { locator: target, score };
  }
  return best?.locator ?? null;
}

async function hasDreaminaBlockingOverlay(page: Page): Promise<boolean> {
  return (await describeDreaminaBlockingOverlays(page)).length > 0;
}

async function describeDreaminaBlockingOverlays(page: Page): Promise<string[]> {
  return page.locator("[role='dialog'], .lv-modal-wrapper, .lv-modal, .lv-drawer, .side-drawer-panel").evaluateAll((elements) => elements
    .filter((element) => {
      const style = window.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      const intersectsViewport = box.right > 0 && box.bottom > 0 && box.left < window.innerWidth && box.top < window.innerHeight;
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0 && intersectsViewport;
    })
    .map((element) => {
      const className = String((element as HTMLElement).className || "").replace(/\s+/g, " ").trim().slice(0, 80);
      const text = (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
      return [className, text].filter(Boolean).join(": ");
    })
    .filter(Boolean)
    .slice(0, 3)).catch(() => []);
}

async function isSafeDreaminaControl(
  locator: Locator,
  options: { allowCurrentValue?: boolean } = {},
): Promise<boolean> {
  try {
    if (!(await locator.isVisible({ timeout: 500 }))) return false;
    const box = await locator.boundingBox();
    if (!box || box.width <= 0 || box.height <= 0) return false;
    return locator.evaluate((element, allowCurrentValue) => {
      const style = window.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || box.width <= 0 || box.height <= 0) return false;
      if (element.closest("[role='dialog'], .lv-modal-wrapper, .side-drawer-panel")) return false;
      if (element.closest("[class*='image-card-container'], [class*='image-card-wrapper'], [class*='slot-card-container'], [class*='video-card-container']")) return false;
      if (!allowCurrentValue && !String((element as HTMLElement).className || "").includes("submit-button")) return false;
      return true;
    }, Boolean(options.allowCurrentValue));
  } catch {
    return false;
  }
}

async function clickDreaminaGenerate(page: Page): Promise<void> {
  await closeDreaminaBlockingOverlays(page);
  const submitButton = await findDreaminaSubmitButton(page);
  if (submitButton) {
    await submitButton.click({ timeout: 10000, force: true });
    return;
  }
  const disabledReason = await dreaminaDisabledSubmitReason(page);
  if (disabledReason) {
    throw new Error(`Dreamina Web 生成按钮当前不可点击：${disabledReason}`);
  }

  throw new Error("Dreamina Web 页面中没有找到生成按钮。请在云浏览器里确认已进入 AI Image/Seedream 生成页面。");
}

async function dreaminaDisabledSubmitReason(page: Page): Promise<string> {
  const submitButtons = page.locator("button[class*='submit-button']");
  const count = await submitButtons.count().catch(() => 0);
  if (count <= 0) return "";
  const button = submitButtons.nth(count - 1);
  const visible = await button.isVisible({ timeout: 500 }).catch(() => false);
  if (!visible) return "";
  await button.hover({ timeout: 1500 }).catch(() => undefined);
  await page.waitForTimeout(300);
  const tooltip = await page.locator("[role='tooltip'], .lv-tooltip, [class*='tooltip']").evaluateAll((elements) => elements
    .filter((element) => {
      const style = window.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    })
    .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .at(-1) || "").catch(() => "");
  if (/prompt longer than 4000 characters/i.test(tooltip)) {
    return "提示词超过 Dreamina Web 4000 字符上限，页面已禁用生成按钮。请删减视频提示词后重试。";
  }
  const state = await button.evaluate((element) => ({
    disabled: element instanceof HTMLButtonElement ? element.disabled : false,
    ariaDisabled: element.getAttribute("aria-disabled") === "true",
    classDisabled: /\bdisabled\b|lv-btn-disabled/.test(String((element as HTMLElement).className || "")),
  })).catch(() => null);
  if (state?.disabled || state?.ariaDisabled || state?.classDisabled) {
    return tooltip || "Dreamina 页面已禁用生成按钮，通常是提示词、参考素材或参数不符合页面要求。";
  }
  return "";
}

async function waitForDreaminaVideoResult(
  page: Page,
  capturedPayloads: CapturedJsonPayload[],
  submittedAt: number,
  existingVideoKeys: Set<string>,
  existingFailureCount = 0,
): Promise<{ submitId?: string; genStatus?: string; videoUrl?: string; raw: unknown }> {
  const started = Date.now();
  const timeoutMs = dreaminaVideoGenerationTimeoutMs();
  let lastRaw: unknown = null;
  while (Date.now() - started < timeoutMs) {
    await clickDreaminaGoToBottom(page);
    const payloadResult = dreaminaWebVideoResultFromPayloads(capturedPayloads, { submittedAt, existingVideoKeys });
    if (payloadResult.videoUrl) {
      return payloadResult;
    }
    const latestSubmitId = payloadResult.submitId || dreaminaWebVideoSubmitIdFromPayloads(capturedPayloads, submittedAt);
    if (latestSubmitId) {
      const historyPayload = await fetchDreaminaVideoHistoryById(page, latestSubmitId).catch(() => null);
      if (historyPayload) {
        capturedPayloads.push(historyPayload);
        const historyResult = dreaminaWebVideoResultForSubmitId(capturedPayloads, latestSubmitId);
        if (historyResult.videoUrl) return historyResult;
        if (historyResult.genStatus === "failed") {
          throw new Error("Dreamina Web 视频任务失败。请在云浏览器里检查任务详情。");
        }
      }
    }
    if (payloadResult.genStatus === "failed") {
      throw new Error("Dreamina Web 视频任务失败。请在云浏览器里检查任务详情。");
    }
    const domResult = await collectDreaminaVideoDomResult(page, existingVideoKeys);
    lastRaw = {
      dom: domResult,
      payloads: capturedPayloads.slice(-8).map((entry) => ({
        url: entry.url,
        capturedAt: entry.capturedAt,
        payload: entry.payload,
      })),
    };
    if (domResult.videoUrl) return { videoUrl: domResult.videoUrl, genStatus: "succeeded", raw: lastRaw };
    const domFailureMessage = await dreaminaWebVideoDomFailureMessageAfterSubmission(page, domResult.bodyTail, existingFailureCount);
    if (domFailureMessage) {
      throw new Error(domFailureMessage);
    }
    if (
      Date.now() - started > 35_000
      && (
        latestSubmitId
        || /Dreaming|Generating|Queue|queue|0\s*\/\s*1|生成中/i.test(domResult.bodyTail)
        || /running|pending|queue|checked/i.test(String(payloadResult.genStatus || ""))
      )
    ) {
      if (!latestSubmitId) {
        return { genStatus: "missing-submit-id-timeout", raw: lastRaw };
      }
      return { submitId: latestSubmitId, genStatus: "running", raw: lastRaw };
    }
    if (latestSubmitId && Date.now() - started > dreaminaVideoSubmissionHandoffMs()) {
      return { submitId: latestSubmitId, genStatus: payloadResult.genStatus || "running", raw: lastRaw };
    }
    await page.waitForTimeout(1500);
  }
  const payloadResult = dreaminaWebVideoResultFromPayloads(capturedPayloads, { submittedAt, existingVideoKeys });
  return {
    submitId: payloadResult.submitId,
    genStatus: payloadResult.videoUrl
      ? "succeeded"
      : payloadResult.submitId
        ? (payloadResult.genStatus || "running")
        : "missing-submit-id-timeout",
    videoUrl: payloadResult.videoUrl,
    raw: lastRaw ?? {
      payloads: capturedPayloads.slice(-8).map((entry) => ({
        url: entry.url,
        capturedAt: entry.capturedAt,
        payload: entry.payload,
      })),
    },
  };
}

async function fetchDreaminaVideoHistoryById(page: Page, submitId: string): Promise<CapturedJsonPayload | null> {
  const historyId = submitId.trim();
  if (!/^\d{8,}$/.test(historyId)) return null;
  const url = "https://mweb-api-sg.capcut.com/mweb/v1/get_history_by_ids?aid=513641&device_platform=web&region=JP&da_version=3.3.17&web_version=7.5.0&aigc_features=app_lip_sync";
  const payload = await page.evaluate(async ({ url, historyId }) => {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history_ids: [historyId] }),
    });
    if (!response.ok) return null;
    return response.json();
  }, { url, historyId });
  if (!payload) return null;
  return { url, capturedAt: Date.now(), payload };
}

function dreaminaVideoGenerationTimeoutMs(): number {
  const number = Number(process.env.DREAMINA_WEB_VIDEO_TIMEOUT_MS);
  return Number.isFinite(number) && number > 0 ? Math.max(35_000, Math.floor(number)) : 240_000;
}

function dreaminaVideoSubmissionHandoffMs(): number {
  const number = Number(process.env.DREAMINA_WEB_VIDEO_SUBMIT_HANDOFF_MS);
  return Number.isFinite(number) && number > 0 ? Math.max(3_000, Math.floor(number)) : 8_000;
}

function dreaminaWebVideoResultFromPayloads(
  payloads: CapturedJsonPayload[],
  options: { submittedAt?: number; existingVideoKeys?: Set<string> } = {},
): { submitId?: string; genStatus?: string; videoUrl?: string; raw: unknown } {
  for (let index = payloads.length - 1; index >= 0; index -= 1) {
    const entry = payloads[index];
    if (options.submittedAt && entry.capturedAt < options.submittedAt) continue;
    if (isDreaminaCreditHistoryPayload(entry)) continue;
    const payload = entry.payload;
    const decodedVideoUrl = findDeepStringValues(payload, ["video_url", "videoUrl", "main_url", "mainUrl", "play_url", "playUrl", "url"])
      .map(decodeDreaminaVideoCandidateUrl)
      .find((url) => url && isDreaminaGeneratedVideoUrl(url) && !options.existingVideoKeys?.has(dreaminaVideoUrlKey(url)));
    const submitId = findDeepStringValue(payload, ["submit_id", "submitId", "history_record_id", "historyRecordId", "history_id", "historyId", "task_id", "taskId"]);
    const status = dreaminaWebVideoRecordStatus(payload) || findDeepStringValue(payload, ["gen_status", "genStatus", "status", "message"]);
    if (decodedVideoUrl || submitId) {
      return {
        submitId,
        genStatus: normalizeDreaminaWebVideoStatus(status, decodedVideoUrl),
        videoUrl: decodedVideoUrl,
        raw: payload,
      };
    }
  }
  return { raw: payloads.slice(-8).map((entry) => entry.payload) };
}

function dreaminaWebVideoRecordStatus(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const directStatus = stringPayloadValue(payload.status) || stringPayloadValue(payload.gen_status) || stringPayloadValue(payload.genStatus);
  const task = isRecord(payload.task) ? payload.task : {};
  const taskStatus = stringPayloadValue(task.status);
  const itemList = Array.isArray(payload.item_list) ? payload.item_list : undefined;
  const originItemList = Array.isArray(payload.origin_item_list) ? payload.origin_item_list : undefined;
  const finishTime = Number(task.finish_time ?? payload.finish_time ?? 0);
  if (!directStatus && !taskStatus) return undefined;
  if (!dreaminaWebRecordHasGeneratedVideoItem(payload) && finishTime > 0 && itemList?.length === 0 && originItemList?.length === 0) {
    if (/^(10|30|checked|success|succeeded|complete|completed)$/i.test(directStatus || taskStatus || "")) return "failed";
  }
  return directStatus || taskStatus;
}

function dreaminaWebVideoPayloadFailureMessage(payload: unknown): string {
  const explicit = findDeepStringValue(payload, ["errorMessage", "error_message", "err_msg", "errmsg", "reason", "message"]);
  if (explicit && !/^success$/i.test(explicit)) return `Dreamina Web 视频任务失败：${explicit}`;
  return "Dreamina Web 视频任务失败或审核未通过：历史记录已结束但没有返回视频，通常是内容审核失败、生成失败或 Credits returned。";
}

function dreaminaWebRecordHasGeneratedVideoItem(payload: unknown): boolean {
  return findDeepStringValues(payload, ["video_url", "videoUrl", "main_url", "mainUrl", "play_url", "playUrl", "url"])
    .map(decodeDreaminaVideoCandidateUrl)
    .some((url) => url && isDreaminaGeneratedVideoUrl(url));
}

function stringPayloadValue(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim();
}

function dreaminaWebVideoSubmitIdFromPayloads(payloads: CapturedJsonPayload[], submittedAt: number): string | undefined {
  return dreaminaWebVideoResultFromPayloads(payloads, { submittedAt }).submitId;
}

function dreaminaWebVideoResultForSubmitId(
  payloads: CapturedJsonPayload[],
  submitId: string,
): { submitId?: string; genStatus?: string; videoUrl?: string; raw: unknown } {
  const normalizedSubmitId = submitId.trim();
  for (let index = payloads.length - 1; index >= 0; index -= 1) {
    const payload = payloads[index].payload;
    if (!payloadContainsString(payload, normalizedSubmitId)) continue;
    const scopedPayload = dreaminaHistoryPayloadForSubmitId(payload, normalizedSubmitId);
    const result = dreaminaWebVideoResultFromPayloads([{ ...payloads[index], payload: scopedPayload ?? payload }]);
    if (result.videoUrl || result.genStatus || result.submitId) {
      return { ...result, submitId: result.submitId || normalizedSubmitId };
    }
    return { submitId: normalizedSubmitId, raw: payload };
  }
  return { submitId: normalizedSubmitId, raw: payloads.slice(-8).map((entry) => entry.payload) };
}

function normalizeDreaminaWebVideoStatus(status: string | undefined, videoUrl: string | undefined): string | undefined {
  if (videoUrl && /^https?:\/\//i.test(videoUrl)) return "succeeded";
  if (!status) return undefined;
  if (/^(init|queued?|pending|running|processing|generating|0|20)$/i.test(status)) return "running";
  if (/success|succeed|complete|102|10/i.test(status)) return "running";
  if (/^checked$/i.test(status)) return "checked";
  if (/fail|error|reject/i.test(status)) return "failed";
  return status;
}

function dreaminaWebVideoDomFailureMessage(bodyText: string): string {
  const normalized = bodyText.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (dreaminaWebVideoLooksPending(normalized)) return "";
  const lower = normalized.toLowerCase();
  const complianceFailure =
    lower.includes("may contain inappropriate content")
    || lower.includes("contains inappropriate content")
    || lower.includes("audio may contain inappropriate")
    || lower.includes("video may contain inappropriate")
    || lower.includes("image may contain inappropriate")
    || lower.includes("sensitive content")
    || lower.includes("content policy")
    || lower.includes("violates")
    || lower.includes("violation")
    || normalized.includes("内容违规")
    || normalized.includes("不适宜")
    || normalized.includes("敏感内容")
    || normalized.includes("审核失败")
    || normalized.includes("违规");
  if (complianceFailure) {
    return `Dreamina Web 视频任务审核失败：${normalized.slice(-500)}`;
  }
  if (/generation (?:failed|error)|failed to generate|couldn[’']t generate|credits returned|checkfailed|生成失败|失败|not pass|shark not pass/i.test(normalized)) {
    return `Dreamina Web 视频任务失败或被风控：${normalized.slice(-500)}`;
  }
  return "";
}

function dreaminaWebVideoLooksPending(bodyText: string): boolean {
  return /Dreaming|Generating|Queue|queue|0\s*\/\s*1|生成中|排队中/i.test(bodyText);
}

async function dreaminaWebVideoDomFailureMessageAfterSubmission(
  page: Page,
  bodyText: string,
  existingFailureCount: number,
): Promise<string> {
  const currentFailureCount = await dreaminaWebVideoDomFailureCount(page).catch(() => 0);
  if (currentFailureCount <= existingFailureCount) return "";
  return dreaminaWebVideoDomFailureMessage(bodyText);
}

async function dreaminaWebVideoDomFailureCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const text = (document.body?.innerText || "").replace(/\s+/g, " ");
    const patterns = [
      /may contain inappropriate content/gi,
      /contains inappropriate content/gi,
      /sensitive content/gi,
      /content policy/gi,
      /审核失败/g,
      /内容违规/g,
      /敏感内容/g,
      /不适宜/g,
      /违规/g,
    ];
    return patterns.reduce((count, pattern) => count + (text.match(pattern)?.length || 0), 0);
  }).catch(() => 0);
}

function isDreaminaCreditHistoryPayload(entry: CapturedJsonPayload): boolean {
  if (/commerce\/v1\/benefits|user_credit_history|credit_history|total_credit/i.test(entry.url)) return true;
  const text = JSON.stringify(entry.payload);
  return /user_credit_history|total_credit|trade_source|FREEMIUM_RECEIVE|dre_m10n_credits_returned/i.test(text);
}

export function dreaminaWebVideoResultFromPayloadsForTest(
  payloads: CapturedJsonPayload[],
  options: { submittedAt?: number; existingVideoKeys?: Set<string> } = {},
): { submitId?: string; genStatus?: string; videoUrl?: string; raw: unknown } {
  return dreaminaWebVideoResultFromPayloads(payloads, options);
}

export function dreaminaWebVideoResultForSubmitIdForTest(
  payloads: CapturedJsonPayload[],
  submitId: string,
): { submitId?: string; genStatus?: string; videoUrl?: string; raw: unknown } {
  return dreaminaWebVideoResultForSubmitId(payloads, submitId);
}

export function dreaminaWebVideoPendingStatusForTest(options: { latestSubmitId?: string; bodyTail?: string; payloadGenStatus?: string }): { submitId?: string; genStatus: string } {
  const latestSubmitId = options.latestSubmitId?.trim();
  if (
    latestSubmitId
    || dreaminaWebVideoLooksPending(options.bodyTail || "")
    || /running|pending|queue|checked/i.test(String(options.payloadGenStatus || ""))
  ) {
    return latestSubmitId
      ? { submitId: latestSubmitId, genStatus: "running" }
      : { genStatus: "missing-submit-id-timeout" };
  }
  return { genStatus: "waiting" };
}

export function dreaminaWebVideoDomFailureMessageForTest(bodyText: string): string {
  return dreaminaWebVideoDomFailureMessage(bodyText);
}

export function dreaminaWebVideoDomFailureMessageAfterSubmissionForTest(
  bodyText: string,
  existingFailureCount: number,
  currentFailureCount: number,
): string {
  if (currentFailureCount <= existingFailureCount) return "";
  return dreaminaWebVideoDomFailureMessage(bodyText);
}

function findDeepStringValue(value: unknown, keys: string[]): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDeepStringValue(item, keys);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const keySet = new Set(keys.map((key) => key.toLowerCase()));
  for (const [key, item] of Object.entries(value)) {
    if (keySet.has(key.toLowerCase()) && (typeof item === "string" || typeof item === "number")) {
      const text = String(item).trim();
      if (text) return text;
    }
    const found = findDeepStringValue(item, keys);
    if (found) return found;
  }
  return undefined;
}

function findDeepStringValues(value: unknown, keys: string[]): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => findDeepStringValues(item, keys));
  }
  if (!isRecord(value)) return [];
  const keySet = new Set(keys.map((key) => key.toLowerCase()));
  const values: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (keySet.has(key.toLowerCase()) && (typeof item === "string" || typeof item === "number")) {
      const text = String(item).trim();
      if (text) values.push(text);
    }
    values.push(...findDeepStringValues(item, keys));
  }
  return values;
}

function decodeDreaminaVideoCandidateUrl(value: string): string | undefined {
  return /^[a-zA-Z0-9+/=]{80,}$/.test(value) ? decodeBase64Maybe(value) : value;
}

function decodeBase64Maybe(value: string): string | undefined {
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8").trim();
    return /^https?:\/\//i.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function summarizeDreaminaWebPayload(value: unknown): unknown {
  const text = JSON.stringify(value);
  if (!text || text.length <= 6000) return value;
  const parsed = isRecord(value) ? value : {};
  return {
    ret: parsed.ret,
    errmsg: parsed.errmsg,
    message: parsed.message,
    submitId: findDeepStringValue(value, ["submit_id", "submitId", "history_record_id", "historyRecordId", "history_id", "historyId", "task_id", "taskId"]),
    status: findDeepStringValue(value, ["gen_status", "genStatus", "status", "message"]),
    videoUrl: dreaminaWebVideoResultFromPayloads([{ url: "", capturedAt: Date.now(), payload: value }]).videoUrl,
    summary: text.slice(0, 6000),
  };
}

function dreaminaHistoryPayloadForSubmitId(value: unknown, submitId: string): unknown | undefined {
  if (!isRecord(value)) return undefined;
  const data = isRecord(value.data) ? value.data : undefined;
  const direct = data?.[submitId] ?? value[submitId];
  if (direct !== undefined) return direct;
  return findDreaminaHistoryRecord(value, submitId);
}

function findDreaminaHistoryRecord(value: unknown, submitId: string): unknown | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDreaminaHistoryRecord(item, submitId);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const identifiers = [
    value.history_record_id,
    value.historyRecordId,
    value.history_id,
    value.historyId,
    value.task_id,
    value.taskId,
  ].map((item) => typeof item === "string" || typeof item === "number" ? String(item).trim() : "");
  if (identifiers.includes(submitId)) return value;
  for (const item of Object.values(value)) {
    const found = findDreaminaHistoryRecord(item, submitId);
    if (found) return found;
  }
  return undefined;
}

async function collectDreaminaVideoUrlKeys(page: Page): Promise<Set<string>> {
  const domResult = await collectDreaminaVideoDomResult(page, new Set());
  return new Set(domResult.videoUrls.map(dreaminaVideoUrlKey));
}

async function collectDreaminaVideoDomResult(
  page: Page,
  existingVideoKeys: Set<string>,
): Promise<{ bodyTail: string; videoUrl: string; videoUrls: string[]; ignoredVideoUrls: string[] }> {
  const evaluated = await (page.evaluate(dreaminaVideoDomResultScript(Array.from(existingVideoKeys))) as Promise<{
    bodyTail: string;
    videoUrl: string;
    videoUrls: string[];
    ignoredVideoUrls: string[];
  }>).catch(() => null);
  if (evaluated) return evaluated;

  const body = await visibleBodyText(page);
  const videos = await page.locator("video").evaluateAll((elements) => elements
    .map((element) => element instanceof HTMLVideoElement ? element.currentSrc || element.src || "" : "")
    .filter((url) => /^https?:\/\//i.test(url) && !/record-loading-animation|capcut-web-login-static|static\/media|avatar|login-static/i.test(url)))
    .catch(() => []);
  const videoUrls = videos.filter(isDreaminaGeneratedVideoUrl);
  const freshVideos = videoUrls.filter((url) => !existingVideoKeys.has(dreaminaVideoUrlKey(url)));
  const ignoredVideoUrls = videoUrls.filter((url) => existingVideoKeys.has(dreaminaVideoUrlKey(url)));
  return {
    bodyTail: body.slice(-1500),
    videoUrl: freshVideos[0] || "",
    videoUrls: freshVideos,
    ignoredVideoUrls,
  };
}

function dreaminaVideoDomResultScript(existingVideoKeys: string[]): string {
  const existingKeysJson = JSON.stringify(existingVideoKeys);
  return `(() => {
    const isGeneratedVideoUrl = (url) => {
      if (!/^https?:\\/\\//i.test(url)) return false;
      if (/record-loading-animation|capcut-web-login-static|static\\/media|avatar|login-static/i.test(url)) return false;
      const decoded = decodeURIComponent(url).toLowerCase();
      if (/mime_type=(audio|image)[_/]/i.test(decoded)) return false;
      if (/\\.(wav|mp3|m4a|aac|ogg|oga|flac|aiff?|png|jpe?g|webp|gif|bmp|heic|avif)(?:[?#]|$)/i.test(decoded)) return false;
      return /\\.(mp4|mov|webm)(?:\\?|#|$)/i.test(decoded) || /mime_type=video|\\/video\\/|tos|capcut|byte/i.test(decoded);
    };
    const videoUrlKey = (url) => {
      try {
        const parsed = new URL(url);
        return (parsed.hostname + parsed.pathname).toLowerCase();
      } catch {
        return String(url).split("?")[0].toLowerCase();
      }
    };
    const body = (document.body && document.body.innerText || "").replace(/\\s+/g, " ").trim();
    const videos = Array.from(document.querySelectorAll("video"))
      .map((video) => video.currentSrc || video.src || "")
      .filter(isGeneratedVideoUrl);
    const existingSet = new Set(${existingKeysJson});
    const freshVideos = videos.filter((url) => !existingSet.has(videoUrlKey(url)));
    const ignoredVideoUrls = videos.filter((url) => existingSet.has(videoUrlKey(url)));
    return {
      bodyTail: body.slice(-1500),
      videoUrl: freshVideos[0] || "",
      videoUrls: freshVideos,
      ignoredVideoUrls,
    };
  })()`;
}

function newestDreaminaVideoUrl(urls: string[]): string | undefined {
  return urls.filter(isDreaminaGeneratedVideoUrl).at(-1);
}

function isDreaminaGeneratedVideoUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (/imagex|CommitImageUpload|record-loading-animation|capcut-web-login-static|static\/media|avatar|login-static/i.test(url)) return false;
  if (isDreaminaNonVideoMediaUrl(url)) return false;
  return /\.(mp4|mov|webm)(?:\?|#|$)/i.test(url) || /mime_type=video|\/video\/|capcut|byte|tos/i.test(url);
}

function isDreaminaNonVideoMediaUrl(url: string): boolean {
  const lowered = decodeURIComponent(url).toLowerCase();
  if (/\.(wav|mp3|m4a|aac|ogg|oga|flac|aiff?)(?:[?#]|$)/i.test(lowered)) return true;
  if (/\.(png|jpe?g|webp|gif|bmp|heic|avif)(?:[?#]|$)/i.test(lowered)) return true;
  const mimeTypes = dreaminaUrlMimeTypes(url);
  return mimeTypes.some((mimeType) => !/^video(?:_|\/)/i.test(mimeType));
}

function dreaminaUrlMimeTypes(url: string): string[] {
  try {
    const parsed = new URL(url);
    return parsed.searchParams
      .getAll("mime_type")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
  } catch {
    const matches = Array.from(url.matchAll(/[?&]mime_type=([^&#]+)/gi));
    return matches
      .map((match) => decodeURIComponent(match[1] ?? "").trim().toLowerCase())
      .filter(Boolean);
  }
}

function dreaminaVideoUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch {
    return url.split("?")[0].toLowerCase();
  }
}

function payloadContainsString(value: unknown, needle: string): boolean {
  if (!needle) return false;
  if (typeof value === "string" || typeof value === "number") return String(value).includes(needle);
  if (Array.isArray(value)) return value.some((item) => payloadContainsString(item, needle));
  if (!isRecord(value)) return false;
  return Object.values(value).some((item) => payloadContainsString(item, needle));
}

async function clickDreaminaGoToBottom(page: Page): Promise<void> {
  const buttons = page.getByRole("button", { name: /^Go to bottom$/i });
  const count = await buttons.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (!(await isSafeDreaminaControl(button, { allowCurrentValue: true }))) continue;
    await button.click({ timeout: 2000, force: true }).catch(() => undefined);
    await page.waitForTimeout(500);
    return;
  }
}

async function findDreaminaSubmitButton(page: Page): Promise<Locator | null> {
  const selectors = [
    "button[class*='submit-button']",
  ];
  const started = Date.now();
  while (Date.now() - started < 15000) {
    for (const selector of selectors) {
      const buttons = page.locator(selector);
      const count = await buttons.count().catch(() => 0);
      for (let index = 0; index < count; index += 1) {
        const button = buttons.nth(index);
        if (await isEnabledDreaminaSubmitButton(button) && await isSafeDreaminaControl(button)) return button;
      }
    }
    await page.waitForTimeout(500);
  }
  return null;
}

async function isEnabledDreaminaSubmitButton(locator: Locator): Promise<boolean> {
  try {
    if (!(await locator.isVisible({ timeout: 500 }))) return false;
    const box = await locator.boundingBox();
    if (!box || box.width < 20 || box.height < 20) return false;
    const state = await locator.evaluate((element) => {
      const className = String(element.className || "");
      return {
        disabled: element instanceof HTMLButtonElement ? element.disabled : false,
        ariaDisabled: element.getAttribute("aria-disabled") === "true",
        classDisabled: /\bdisabled\b|lv-btn-disabled/.test(className),
        text: (element.textContent || "").trim(),
      };
    });
    if (state.disabled || state.ariaDisabled || state.classDisabled) return false;
    if (/regenerate|edit prompt/i.test(state.text)) return false;
    return true;
  } catch {
    return false;
  }
}

async function waitForDreaminaImages(
  page: Page,
  existingImageUrls: Set<string>,
  existingResultCardKeys: Set<string>,
  capturedImageUrls: Map<string, CapturedImageUrl>,
  requestedCount: number,
  submittedAt: number,
  submittedPrompt: string,
): Promise<ImageModelOutput[]> {
  const timeoutMs = dreaminaGenerationTimeoutMs();
  const minWaitMs = dreaminaMinimumGenerationWaitMs();
  const stabilizationMs = dreaminaImageResultStabilizationMs();
  const fallbackMs = dreaminaNetworkFallbackWaitMs();
  const existingImageKeys = new Set(Array.from(existingImageUrls).map(dreaminaImageUrlKey));
  const started = Date.now();
  let bestImages: ImageModelOutput[] = [];
  let bestSignature = "";
  let lastChangedAt = started;
  while (Date.now() - started < timeoutMs) {
    const requested = Math.max(1, Math.min(Math.floor(requestedCount || 1), 4));
    await clickDreaminaGoToBottom(page);
    const cardGroups = await collectDreaminaResultCardGroups(page);
    const newCardGroup = selectNewestDreaminaResultCardGroup(cardGroups, existingResultCardKeys, submittedPrompt, requested);
    if (newCardGroup) {
      const urls = preferredDreaminaCardGroupUrls(newCardGroup, capturedImageUrls, submittedAt);
      const images = urls.map((url) => ({ url }));
      const signature = newCardGroup.keys.join("|");
      if (signature !== bestSignature || images.length > bestImages.length) {
        bestImages = images;
        bestSignature = signature;
        lastChangedAt = Date.now();
      }
      const waited = Date.now() - submittedAt;
      if (waited >= minWaitMs && bestImages.length >= requested) return bestImages.slice(0, requested);
      if (requested <= 1 && waited >= minWaitMs && bestImages.length > 0 && Date.now() - lastChangedAt >= stabilizationMs) {
        return bestImages.slice(0, requested);
      }
      await page.waitForTimeout(3000);
      continue;
    }

    const keyedUrls = new Map<string, string>();
    for (const item of capturedImageUrls.values()) {
      if (item.capturedAt >= submittedAt) setPreferredDreaminaImageUrl(keyedUrls, item.url);
    }
    const domUrls = await collectDomImageUrls(page);
    for (const url of domUrls) {
      setPreferredDreaminaImageUrl(keyedUrls, url);
    }
    const images = Array.from(keyedUrls.entries())
      .filter(([key, url]) => !existingImageUrls.has(url) && !existingImageKeys.has(key))
      .map(([, url]) => url)
      .filter(likelyGeneratedImageUrl)
      .map((url) => ({ url }));
    const signature = images.map((image) => dreaminaImageUrlKey(image.url)).join("|");
    if (signature && signature !== bestSignature) {
      bestImages = images;
      bestSignature = signature;
      lastChangedAt = Date.now();
    }
    const waited = Date.now() - submittedAt;
    const canUseNetworkFallback = requested <= 1 || waited >= fallbackMs;
    if (canUseNetworkFallback && waited >= minWaitMs && bestImages.length >= requested) return bestImages.slice(0, requested);
    if (canUseNetworkFallback && waited >= minWaitMs && bestImages.length > 0 && Date.now() - lastChangedAt >= stabilizationMs) {
      return bestImages.slice(0, requested);
    }
    await page.waitForTimeout(3000);
  }
  return bestImages;
}

function preferredDreaminaCardGroupUrls(
  group: DreaminaResultCardGroup,
  capturedImageUrls: Map<string, CapturedImageUrl>,
  submittedAt: number,
): string[] {
  return group.urls.map((url, index) => {
    const key = group.keys[index] || dreaminaImageUrlKey(url);
    const captured = capturedImageUrls.get(key);
    if (captured && captured.capturedAt >= submittedAt && dreaminaImageUrlScore(captured.url) > dreaminaImageUrlScore(url)) {
      return captured.url;
    }
    return url;
  });
}

async function collectDreaminaResultCardKeys(page: Page): Promise<Set<string>> {
  const groups = await collectDreaminaResultCardGroups(page);
  return new Set(groups.flatMap((group) => group.keys));
}

async function collectDreaminaResultCardGroups(page: Page): Promise<DreaminaResultCardGroup[]> {
  const cards = await page.evaluate(() => {
    const cardSelector = [
      "[class*='image-card-container']",
      "[class*='image-card-wrapper']",
      "[class*='slot-card-container']",
    ].join(",");
    const result: Array<{ url: string; x: number; y: number; width: number; height: number; text: string }> = [];
    const seen = new Set<string>();
    for (const element of Array.from(document.querySelectorAll(cardSelector))) {
      const image = element instanceof HTMLImageElement ? element : element.querySelector("img");
      const url = image ? (image.currentSrc || image.src || "") : "";
      if (!url || seen.has(url)) continue;
      const box = element.getBoundingClientRect();
      const imageWidth = image instanceof HTMLImageElement ? image.naturalWidth : 0;
      const imageHeight = image instanceof HTMLImageElement ? image.naturalHeight : 0;
      if (box.width < 96 || box.height < 96) continue;
      if (imageWidth > 0 && imageHeight > 0 && imageWidth < 256 && imageHeight < 256) continue;
      const textRoot = element.closest("[class*='task'], [class*='history'], [class*='generate'], [class*='creation'], [class*='result'], [class*='card-list']")
        || element.parentElement?.parentElement?.parentElement
        || element.parentElement
        || element;
      seen.add(url);
      result.push({
        url,
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
        text: (textRoot.textContent || "").replace(/\s+/g, " ").trim(),
      });
    }
    return result;
  }).catch(() => []);

  const keyedCards: DreaminaResultCard[] = [];
  const preferredByKey = new Map<string, DreaminaResultCard>();
  for (const card of cards) {
    if (!likelyGeneratedImageUrl(card.url)) continue;
    const key = dreaminaImageUrlKey(card.url);
    const candidate: DreaminaResultCard = { ...card, key };
    const existing = preferredByKey.get(key);
    if (!existing || dreaminaImageUrlScore(candidate.url) > dreaminaImageUrlScore(existing.url)) {
      preferredByKey.set(key, candidate);
    }
  }
  keyedCards.push(...preferredByKey.values());
  keyedCards.sort((left, right) => left.y - right.y || left.x - right.x);

  const rows: DreaminaResultCard[][] = [];
  for (const card of keyedCards) {
    const row = rows.find((items) => Math.abs(items[0].y - card.y) <= Math.max(48, Math.min(items[0].height, card.height) / 2));
    if (row) {
      row.push(card);
    } else {
      rows.push([card]);
    }
  }

  return rows
    .map((row) => row.sort((left, right) => left.x - right.x))
    .filter((row) => row.length > 0)
    .map((row) => {
      const urls = row.map((card) => card.url);
      const keys = row.map((card) => card.key);
      return {
        y: Math.min(...row.map((card) => card.y)),
        urls,
        keys,
        text: row.map((card) => card.text).join(" ").replace(/\s+/g, " ").trim(),
      };
    })
    .filter((group) => group.urls.length > 0);
}

function selectNewestDreaminaResultCardGroup(
  groups: DreaminaResultCardGroup[],
  existingResultCardKeys: Set<string>,
  submittedPrompt: string,
  requestedCount: number,
): DreaminaResultCardGroup | null {
  const requested = Math.max(1, Math.min(Math.floor(requestedCount || 1), 4));
  const mappedGroups = groups
    .map((group) => {
      const urls: string[] = [];
      const keys: string[] = [];
      group.urls.forEach((url, index) => {
        const key = group.keys[index] || dreaminaImageUrlKey(url);
        if (existingResultCardKeys.has(key)) return;
        urls.push(url);
        keys.push(key);
      });
      return {
        y: group.y,
        urls,
        keys,
        text: group.text,
        promptMatch: dreaminaGroupTextMatchesPrompt(group.text, submittedPrompt),
      };
    })
    .filter((group) => group.urls.length > 0);

  const completeNewGroups = mappedGroups
    .filter((group) => group.urls.length >= requested)
    .sort((left, right) => {
      if (Number(right.promptMatch) !== Number(left.promptMatch)) return Number(right.promptMatch) - Number(left.promptMatch);
      if (right.urls.length !== left.urls.length) return right.urls.length - left.urls.length;
      return right.y - left.y;
    });
  if (completeNewGroups[0]) return completeNewGroups[0];

  const promptMatchedGroups = mappedGroups
    .filter((group) => group.promptMatch)
    .sort((left, right) => {
      if (right.urls.length !== left.urls.length) return right.urls.length - left.urls.length;
      return right.y - left.y;
    });
  if (promptMatchedGroups[0]) return promptMatchedGroups[0];
  if (requested > 1 && submittedPrompt.trim()) return null;

  return mappedGroups
    .sort((left, right) => {
      if (right.urls.length !== left.urls.length) return right.urls.length - left.urls.length;
      return right.y - left.y;
    })[0] ?? null;
}

function dreaminaGroupTextMatchesPrompt(groupText: string, prompt: string): boolean {
  const text = normalizeDreaminaComparableText(groupText);
  const expected = normalizeDreaminaComparableText(prompt);
  if (!text || !expected) return false;
  if (text.includes(expected.slice(0, Math.min(expected.length, 80)))) return true;
  if (expected.length <= 32) return text.includes(expected);
  return text.includes(expected.slice(0, 32)) && text.includes(expected.slice(-24));
}

function normalizeDreaminaComparableText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

async function collectDomImageUrls(page: Page): Promise<Set<string>> {
  const urls = await page.evaluate(() => {
    const result = new Set<string>();
    for (const image of Array.from(document.images)) {
      const src = image.currentSrc || image.src;
      if (!src) continue;
      if (image.naturalWidth >= 256 || image.naturalHeight >= 256) result.add(src);
    }
    for (const source of Array.from(document.querySelectorAll("source[srcset]"))) {
      const srcset = source.getAttribute("srcset") || "";
      const first = srcset.split(",")[0]?.trim().split(/\s+/)[0];
      if (first) result.add(first);
    }
    return Array.from(result);
  }).catch(() => []);
  return new Set(urls);
}

function extractImageUrls(value: unknown): string[] {
  const urls: string[] = [];
  const visit = (item: unknown) => {
    if (typeof item === "string") {
      if (likelyGeneratedImageUrl(item)) urls.push(item);
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    if (!isRecord(item)) return;
    for (const child of Object.values(item)) visit(child);
  };
  visit(value);
  return Array.from(new Set(urls));
}

function likelyGeneratedImageUrl(url: string): boolean {
  if (!/^(https?:|data:image\/|blob:)/i.test(url)) return false;
  if (/\.svg(?:~|\?|#|$)|model-dreamina|logo|avatar|icon|sprite|emoji|favicon|transparent|placeholder/i.test(url)) return false;
  if (/data:image\//i.test(url)) return true;
  if (/\.(png|jpe?g|webp)(\?|$)/i.test(url)) return true;
  return /tos|byteimg|capcut|dreamina|image|result|generated|aigc/i.test(url);
}

function dreaminaImageUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    const normalizedPath = parsed.pathname.replace(/~tplv[^/?#]*/i, "");
    return normalizedPath;
  } catch {
    return url.split("?")[0].replace(/~tplv[^/?#]*/i, "");
  }
}

function captureDreaminaImageUrl(map: Map<string, CapturedImageUrl>, url: string, capturedAt: number): void {
  if (!likelyGeneratedImageUrl(url)) return;
  const key = dreaminaImageUrlKey(url);
  const existing = map.get(key);
  if (!existing || dreaminaImageUrlScore(url) > dreaminaImageUrlScore(existing.url)) {
    map.set(key, { url, capturedAt });
  }
}

function setPreferredDreaminaImageUrl(map: Map<string, string>, url: string): void {
  if (!likelyGeneratedImageUrl(url)) return;
  const key = dreaminaImageUrlKey(url);
  const existing = map.get(key);
  if (!existing || dreaminaImageUrlScore(url) > dreaminaImageUrlScore(existing)) {
    map.set(key, url);
  }
}

function dreaminaImageUrlScore(url: string): number {
  let score = 0;
  if (/aigc_resize_mark:0:0/i.test(url)) score += 80;
  if (/\bformat=\.png\b|\.png(?:\?|$)/i.test(url)) score += 30;
  if (/\bformat=\.webp\b|\.webp(?:\?|$)/i.test(url)) score += 10;
  const matchedSize = url.match(/(?:resize|aigc_resize_mark):(\d{2,5}):(\d{2,5})/i);
  if (matchedSize) score += Math.min(40, (Number(matchedSize[1]) + Number(matchedSize[2])) / 100);
  return score;
}

async function visibleText(page: Page, selector: string): Promise<string> {
  const texts = await page.locator(selector).evaluateAll((elements) => elements
    .filter((element) => {
      const style = window.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    })
    .map((element) => element.textContent || "")
    .join("\n"));
  return texts.replace(/\s+/g, " ").trim();
}

async function visibleBodyText(page: Page): Promise<string> {
  return page.locator("body").innerText({ timeout: 3000 }).then((text) => text.replace(/\s+/g, " ").trim()).catch(() => "");
}

function ratioFromSize(value: string): string {
  const raw = value.trim().toLowerCase();
  if (/^\d+:\d+$/.test(raw)) return raw;
  const matched = raw.match(/^(\d{2,5})x(\d{2,5})$/);
  if (!matched) return "";
  const width = Number(matched[1]);
  const height = Number(matched[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "";
  const ratio = width / height;
  const options = [
    { value: "1:1", ratio: 1 },
    { value: "16:9", ratio: 16 / 9 },
    { value: "9:16", ratio: 9 / 16 },
    { value: "4:3", ratio: 4 / 3 },
    { value: "3:4", ratio: 3 / 4 },
  ];
  return options.reduce((best, option) => (
    Math.abs(option.ratio - ratio) < Math.abs(best.ratio - ratio) ? option : best
  ), options[0]).value;
}

function dreaminaCdpUrl(): string {
  return process.env.DREAMINA_BROWSER_CDP_URL || "http://127.0.0.1:9222";
}

function dreaminaStartUrl(): string {
  return process.env.DREAMINA_BROWSER_START_URL || "https://dreamina.capcut.com/ai-tool/generate";
}

function dreaminaPublicBrowserUrl(): string {
  return process.env.DREAMINA_BROWSER_PUBLIC_URL || "https://loohii.com/dreamina-browser/vnc.html";
}

function dreaminaGenerationTimeoutMs(): number {
  const configured = Number(process.env.DREAMINA_WEB_GENERATION_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured >= 60_000) return configured;
  return 10 * 60 * 1000;
}

function dreaminaMinimumGenerationWaitMs(): number {
  const configured = Number(process.env.DREAMINA_WEB_MIN_WAIT_MS);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return 25_000;
}

function dreaminaImageResultStabilizationMs(): number {
  const configured = Number(process.env.DREAMINA_WEB_RESULT_STABLE_MS);
  if (Number.isFinite(configured) && configured >= 1000) return configured;
  return 12_000;
}

function dreaminaNetworkFallbackWaitMs(): number {
  const configured = Number(process.env.DREAMINA_WEB_NETWORK_FALLBACK_WAIT_MS);
  if (Number.isFinite(configured) && configured >= 60_000) return configured;
  return 4 * 60 * 1000;
}

function stringFrom(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberFrom(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
