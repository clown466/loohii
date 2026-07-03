import { Router } from "express";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { TEAM_SCENE_PATTERN } from "./workflowPatterns.js";
import { callDreaminaWebVideoModel, preflightDreaminaWebVideoUpload, queryDreaminaWebVideoModel } from "../ai/dreaminaWebBridge";
import { callConfiguredImageModel } from "../ai/imageModel";
import { callConfiguredPlainTextModel, callConfiguredTextModel, callConfiguredVisionTextModel } from "../ai/textModel";
import { config } from "../config";
import { asyncRoute } from "../lib/asyncRoute";
import { applyWorkflowAssetImageToCanvasScenes, canvasSyncableImageUrl, fillMissingAssetImageAcrossEpisodes } from "../lib/canvasAssetImageSync";
import { allocateClipDialogueToBeats, extractDialogueSpeakerNames as extractAllocatedDialogueSpeakerNames } from "../lib/clipDialogueAllocator";
import { storyboardReferencesFromGenerationRecords } from "../lib/canvasStoryboardReferences";
import { normalizeCanvasVideoReferenceInputs } from "../lib/canvasVideoReferences";
import { HttpError, badRequest, notFound, routeParam } from "../lib/httpErrors";
import { isRecord } from "../lib/mappers";
import { decryptModelConfigSecret } from "../lib/modelConfigCrypto";
import { prisma } from "../lib/prisma";
import { hoistRepeatedShotRules } from "../lib/workflowPromptDedupe";
import { ok } from "../lib/response";
import {
  buildSceneVisualBible,
  detectSceneVisualConflict,
  resolveSceneVisualLockForSetting,
  type SceneVisualBible,
} from "../lib/sceneVisualContinuity.js";
import {
  clipStoryboardBoardLayoutStrategy,
  ensureClipStoryboardBoardLayoutPrompt,
  finalizeClipStoryboardImagePrompt,
  stripComicStoryboardLayoutPrompt,
  stripLegacyClipStoryboardImageLayoutPrompt,
} from "../lib/storyboardPrompt";
import { requireAuth } from "../middleware/auth";

const router = Router();
const activeWorkflowRuns = new Map<string, number>();
const activeImageGenerations = new Map<string, number>();
const LOCAL_UPLOAD_ROOT = process.env.LOCAL_UPLOAD_ROOT || "/var/lib/loohii/uploads";
const DREAMINA_CLI_PATH = process.env.DREAMINA_CLI_PATH || "dreamina";
const ACTIVE_IMAGE_GENERATION_LOCK_TTL_MS = 15 * 60 * 1000;
const IMAGE_GENERATION_RUNNING_TTL_MS = 20 * 60 * 1000;
const WORKFLOW_METADATA_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;
const GENERATED_IMAGE_DOWNLOAD_TIMEOUT_MS = 60 * 1000;
const GENERATED_IMAGE_DOWNLOAD_RETRY_COUNT = 3;
const DREAMINA_CLI_TIMEOUT_MS = 180 * 1000;
const DREAMINA_QUERY_TIMEOUT_MS = 180 * 1000;
const WORKFLOW_PROMPT_FIELD_MAX_CHARS = 600;
const PROMPT_API_MAX_CHARS = 20000;
const SEGMENTED_STORYBOARD_SOURCE_LENGTH = 6500;
const SEGMENTED_STORYBOARD_TIMEOUT_FALLBACK_LENGTH = 5000;
const DREAMINA_WEB_VIDEO_PROMPT_MAX_CHARS = 4000;
const DREAMINA_WEB_VIDEO_PROMPT_TARGET_CHARS = 3900;
const COMPACT_WORKFLOW_VIDEO_MIN_BEAT_CHARS = 70;
const COMPACT_WORKFLOW_VIDEO_SECOND_PASS_MIN_BEAT_CHARS = 48;
const COMPACT_WORKFLOW_VIDEO_MAX_BEAT_CHARS = 300;
const COMPACT_WORKFLOW_VIDEO_FOOTER = "No subtitles, UI, watermarks, random text, gore, or identity drift.";
const MIN_CLIP_STORYBOARD_PANEL_COUNT = 5;
const MAX_CLIP_STORYBOARD_PANEL_COUNT = 12;
const COMPACT_CHARACTER_TRAIT_KEYS = new Set([
  "visualAuthority",
  "referenceImageAssetId",
  "referenceImageUrl",
  "referenceImageUploadedAt",
  "generatedImageAssetId",
  "generatedImageUrl",
  "workflowSource",
  "episode",
  "fruitIdentity",
  "personality",
  "height",
  "primaryLook",
  "expressionNotes",
  "habitualActions",
  "variantNotes",
  "signatureProps",
  "boundPropNames",
  "colorPalette",
  "lockedVisualIdentity",
  "referencePolicy",
  "imageAnalysis",
  "imageAnalysisError",
]);

const workflowDraftSchema = z.object({
  episodeId: z.string().max(180).optional(),
  sourceText: z.string().max(300000).optional(),
  sourceName: z.string().max(240).optional(),
  selectedEpisode: z.string().max(160).optional(),
  activeStage: z.string().max(80).optional(),
  breakdownScenes: z.array(z.record(z.string(), z.unknown())).optional(),
  clips: z.array(z.record(z.string(), z.unknown())).optional(),
  lastRun: z.record(z.string(), z.unknown()).optional(),
  assets: z
    .object({
      characters: z.array(z.unknown()).optional(),
      scenes: z.array(z.unknown()).optional(),
      props: z.array(z.unknown()).optional(),
    })
    .optional(),
  stageStatuses: z.record(z.string(), z.string()).optional(),
});

const episodeInputSchema = z.object({
  title: z.string().min(1).max(160),
  copyAssetsFromEpisodeId: z.string().max(180).optional(),
});

const runWorkflowSchema = z.object({
  episodeId: z.string().max(180).optional(),
  stage: z.enum(["assets", "storyboard", "full-breakdown"]).default("full-breakdown"),
  sourceText: z.string().min(20).max(300000),
  sourceName: z.string().max(240).optional(),
  selectedEpisode: z.string().min(1).max(160).default("第 1 集"),
  aiModelId: z.string().optional(),
});

const optimizeClipSchema = z.object({
  episodeId: z.string().max(180).optional(),
  aiModelId: z.string().optional(),
});

const seedancePromptSchema = z.object({
  episodeId: z.string().max(180).optional(),
  aiModelId: z.string().optional(),
});

const clipStoryboardPlanSchema = z.object({
  episodeId: z.string().max(180).optional(),
  aiModelId: z.string().optional(),
  panelMode: z.enum(["ai", "manual"]).default("ai"),
  panelCount: z.number().int().min(MIN_CLIP_STORYBOARD_PANEL_COUNT).max(MAX_CLIP_STORYBOARD_PANEL_COUNT).optional(),
});

const workflowAssetReferenceImageSchema = z
  .object({
    assetKind: z.enum(["characters", "scenes", "props"]),
    assetName: z.string().min(1).max(180),
    imageDataUrl: z.string().min(20).max(9_000_000).optional(),
    imageUrl: z.string().min(8).max(12000).optional(),
    fileName: z.string().max(240).optional(),
    mimeType: z.string().max(120).optional(),
    sizeBytes: z.number().int().min(0).max(12_000_000).optional(),
    aiModelId: z.string().optional(),
  })
  .refine((value) => Boolean(value.imageDataUrl || value.imageUrl), {
    message: "imageDataUrl or imageUrl is required",
  });

const workflowAssetImageGenerationSchema = z.object({
  episodeId: z.string().max(180).optional(),
  assetKind: z.enum(["characters", "scenes", "props"]),
  assetName: z.string().min(1).max(180),
  prompt: z.string().optional(),
  usePromptAsFinal: z.boolean().optional(),
  preservePromptExact: z.boolean().optional(),
  variant: z.enum(["clean", "with-props"]).optional(),
  aiModelId: z.string().optional(),
  size: z.string().max(40).optional(),
  useCurrentReference: z.boolean().optional(),
  referenceImageUrls: z.array(z.string().min(8).max(12000)).max(16).optional(),
  referenceAssetIds: z.array(z.string().min(1).max(120)).max(16).optional(),
  writeBackToAsset: z.boolean().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

const canvasImageGenerationSchema = z.object({
  prompt: z.string().min(1),
  aiModelId: z.string().optional(),
  size: z.string().max(40).optional(),
  referenceImageUrls: z.array(z.string().min(8).max(12000)).max(16).optional(),
  count: z.number().int().min(1).max(4).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  submitOnly: z.boolean().optional(),
});

const canvasVideoGenerationSchema = z.object({
  prompt: z.string().min(1),
  referenceImageUrls: z.array(z.string().min(8).max(12000)).max(16).optional(),
  referenceAudioUrls: z.array(z.string().min(8).max(12000)).max(16).optional(),
  aiModelId: z.string().optional(),
  resolution: z.string().max(40).optional(),
  durationSeconds: z.number().int().min(4).max(15).optional(),
  ratio: z.string().max(40).optional(),
  count: z.number().int().min(1).max(4).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  submitId: z.string().max(160).optional(),
  dryRun: z.boolean().optional(),
});

const canvasPromptTranslationSchema = z.object({
  prompt: z.string().min(1).max(PROMPT_API_MAX_CHARS),
  aiModelId: z.string().optional(),
  sourceLanguage: z.enum(["auto", "Chinese", "English"]).default("auto"),
  targetLanguage: z.enum(["English", "Chinese"]).default("English"),
  preserveStructure: z.boolean().default(true),
  context: z.string().max(2000).optional(),
});

const canvasPromptInspectionSchema = z.object({
  prompt: z.string().min(1).max(PROMPT_API_MAX_CHARS),
  question: z.string().min(1).max(2000),
  aiModelId: z.string().optional(),
  context: z.string().max(2000).optional(),
});

const canvasPromptOptimizationSchema = z.object({
  prompt: z.string().min(1).max(PROMPT_API_MAX_CHARS),
  aiModelId: z.string().optional(),
  targetProvider: z.string().max(160).default("Dreamina Web"),
  failureReason: z.string().max(2000).optional(),
  context: z.string().max(2000).optional(),
});

const workflowAssetImageHistoryQuerySchema = z.object({
  assetKind: z.enum(["characters", "scenes", "props"]),
  assetName: z.string().min(1).max(180),
});

const workflowAssetImageSelectionSchema = z.object({
  assetKind: z.enum(["characters", "scenes", "props"]),
  assetName: z.string().min(1).max(180),
  assetId: z.string().min(1).max(120),
});

const workflowAssetImageClearSchema = z.object({
  assetKind: z.enum(["characters", "scenes", "props"]),
  assetName: z.string().min(1).max(180),
});

const workflowAssetImageDeletionSchema = z.object({
  assetKind: z.enum(["characters", "scenes", "props"]),
  assetName: z.string().min(1).max(180),
});

const workflowAssetRemovalSchema = z.object({
  assetKind: z.enum(["characters", "scenes", "props"]),
  assetName: z.string().min(1).max(180),
});

const episodeQuerySchema = z.object({
  episodeId: z.string().max(180).optional(),
});

router.use(requireAuth);

function rejectPromptCompression(kind: "image" | "video", prompt: string): void {
  if (prompt.length <= PROMPT_API_MAX_CHARS) return;
  const label = kind === "video" ? "视频提示词" : "生图提示词";
  badRequest(`${label}超过接口上限 ${PROMPT_API_MAX_CHARS} 字符（当前 ${prompt.length}）。已拒绝提交，未压缩提示词。请手动拆分或删减后再生成。`);
}

function rejectDreaminaWebVideoPromptLimit(prompt: string): void {
  if (prompt.length <= DREAMINA_WEB_VIDEO_PROMPT_MAX_CHARS) return;
  badRequest(`Dreamina Web 视频提示词超过 4000 字符（当前 ${prompt.length}）。Dreamina 页面会禁用生成按钮，已拒绝提交，未压缩提示词。请手动删减或重新推理更短的视频提示词后再生成。`);
}

const DREAMINA_WEB_VIDEO_MAX_IMAGE_REFERENCES = 9;
const DREAMINA_WEB_VIDEO_MAX_AUDIO_REFERENCES = 2;
const DEFAULT_VIDEO_MAX_IMAGE_REFERENCES = 9;
const DEFAULT_VIDEO_MAX_AUDIO_REFERENCES = 16;

type NormalizedStoryboardShot = {
  id: string;
  title: string;
  description: string;
  action: string;
  dialogue: string;
  durationSeconds: number;
  shotSize: string;
  cameraAngle: string;
  cameraMove: string;
  composition: string;
  lens: string;
  aperture: string;
  shutter: string;
  iso: string;
  sound: string;
  music: string;
  subtitle: string;
  characters: string[];
  setting: string;
  references: string;
  canonicalSceneId: string;
  sceneVisualLock: string;
  sceneZone: string;
  sceneAnchors: string[];
  visualPrompt: string;
  directorBoardPrompt: string;
  status: string;
};

type WorkflowAuthorityCharacter = {
  name: string;
  role: string;
  bio: string;
  prompt: string;
  traits: Record<string, unknown>;
};

type WorkflowAuthorityContext = {
  globalPrompt: string;
  negativePrompt: string;
  setupSettings: Record<string, unknown>;
  setupSettingsSummary: string;
  characterIdentityRules: string;
  existingCharacters: WorkflowAuthorityCharacter[];
  requiresSpecificFruitIdentity: boolean;
};

type CharacterCanonicalizer = {
  canonicalizeName: (name: string) => string;
  canonicalizeList: (names: string[]) => string[];
  canonicalizeText: (text: string) => string;
};

type StoryboardControlLevel = "hard" | "medium" | "soft" | "none";
type StoryboardType = "multi_panel" | "start_end_keyframes" | "mood_reference" | "none";
type ClipDialogueDensity = "low" | "medium" | "high";

const STORYBOARD_BREAKDOWN_QUALITY_RULES = [
  "- Preserve source event order exactly. If the source says an action happens before dialogue, keep that action in an earlier beat and start the dialogue later.",
  "- Do not make a character speak before the source says they speak. Dialogue can overlap action only when the source explicitly makes them simultaneous.",
  "- Each shot must contain concrete visible content. Never output camera-only shots such as close-up, eye-level, static, 85mm without describing what is visible.",
  "- For every shot with characters, include blocking in action/references/visualPrompt: screen side or relative position, facing direction, held items, worn items, and visible state.",
  "- Temporary contamination, wet clothing, splashes, slime, stains, soot, wounds, or damage must be scoped to the exact affected character and current story moment. Do not carry it across a location/time transition or into later clips unless the source explicitly says it is still visible.",
  "- Clip-to-clip memory should preserve durable spatial layout, held/owned props, restraints, wardrobe changes, injuries with explicit persistence, and entry/exit positions; it should not preserve one-off spill residue by default.",
  "- Shot durations should vary between 1 and 3 seconds. Do not assign every shot 3 seconds.",
  "- Clip duration should follow the actual story beat within the video model range of 4-15 seconds. Prefer 7-10 shots only for longer/full clips with several actions, reactions, or dialogue timing changes.",
];

const VIDEO_STATE_AND_ASSET_RULES = [
  "Every S beat must include camera language: shot size, camera angle, camera movement, composition/blocking, and lens or focal length.",
  "Every beat must explicitly restate current physical state for characters who are actually visible in that beat because the video model has no memory from previous clips.",
  "Respect locked asset images and asset fact cards as hard constraints. Do not write actions that conflict with worn gear, helmets, masks, held props, body type, or locked identity.",
  "Only introduce a state change such as removing a helmet or dropping a weapon when the source text, current shots, or project settings explicitly allow it.",
  "Carry state forward across beats and clips until the source or shots clearly changes it back.",
  "Treat temporary contamination, wet clothing, wounds, soot, splashes, slime, stains, spills, and damage as scoped state, not permanent identity. Attach it only to the exact affected character, carry it only while the source/current shots keep emphasizing it, and drop it after a location/time transition unless the source explicitly says it remains visible.",
  "Never spread a temporary state from one character to the whole cast or to later clips by default. If a later beat needs the state, restate the affected character by name and why it is still visible.",
  "For each beat, mention screen side or relative position, facing direction, held items, worn items, and visible contamination/damage only for visible characters; do not list the whole clip cast unless they all appear.",
  "Infer acting from the current story beat. Add emotion, facial expression, and dialogue delivery only where it helps the shot, especially close-ups, reactions, and spoken lines; do not force the same acting note into every S beat.",
];

type ClipPreflight = {
  pass: boolean;
  status: string;
  warnings: string[];
  estimatedDuration: number;
  targetDuration: number;
  maxDuration: number;
  dialogueWordCount: number;
  dialogueWordsPerSecond: number;
  shotCount: number;
  panelCount: number;
  hasStartState: boolean;
  hasEndState: boolean;
};

type NormalizedWorkflowClip = {
  id: string;
  title: string;
  plotGoal: string;
  targetDuration: number;
  maxDuration: number;
  estimatedDuration: number;
  sceneType: string;
  storyboardControlLevel: StoryboardControlLevel;
  storyboardType: StoryboardType;
  panelCount: number;
  startState: string;
  endState: string;
  emotionArc: string;
  dialogueWordCount: number;
  dialogueDensity: ClipDialogueDensity;
  characters: string[];
  setting: string;
  shotIds: string[];
  layoutMemory: string;
  directorFreedom: string;
  seedancePrompt: string;
  storyboardPrompt: string;
  storyboardPanelCount: number;
  storyboardNotes: string;
  preflight: ClipPreflight;
};

type ClipVideoStoryboardBeat = {
  label: string;
  text: string;
  dialogue?: string;
  camera?: string;
  composition?: string;
  action?: string;
  sourceTitle?: string;
  sourceDescription?: string;
  sourceReferences?: string;
  sourceVisualPrompt?: string;
  visibleCharacters?: string[];
  state?: string;
  performance?: string;
};

type WorkflowEpisodeSummary = {
  id: string;
  title: string;
  selectedEpisode: string;
  canvasSceneId: string;
  updatedAt?: string;
  sourceName?: string;
  clipCount: number;
  sceneCount: number;
};

router.get(
  "/projects/:projectId/workflow/episodes",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    ok(res, getWorkflowEpisodeList(project.metadata));
  }),
);

router.post(
  "/projects/:projectId/workflow/episodes",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    const input = episodeInputSchema.parse(req.body);
    const metadata = isRecord(project.metadata) ? project.metadata : {};
    const now = new Date().toISOString();
    const episodes = getWorkflowEpisodes(metadata);
    const sourceEpisode = input.copyAssetsFromEpisodeId
      ? getWorkflowEpisodeById(metadata, input.copyAssetsFromEpisodeId)
      : getActiveWorkflowEpisode(metadata);
    const id = uniqueWorkflowEpisodeId(input.title, metadata);
    const selectedEpisode = input.title.trim();
    const workflow = {
      sourceText: "",
      sourceName: "",
      selectedEpisode,
      activeStage: "source",
      breakdownScenes: [],
      clips: [],
      assets: isRecord(sourceEpisode.workflow.assets) ? sourceEpisode.workflow.assets : defaultAssets(),
      stageStatuses: defaultStageStatuses(),
      updatedAt: now,
      lastRun: undefined,
    };
    const writtenMetadata = writeWorkflowEpisode(metadata, id, workflow, true);
    const nextMetadata = {
      ...writtenMetadata,
      canvasScenes: {
        ...(isRecord(writtenMetadata.canvasScenes) ? writtenMetadata.canvasScenes : {}),
        [id]: {
          nodes: [],
          edges: [],
          updatedAt: now,
        },
      },
    };
    await prisma.project.update({
      where: { id: project.id },
      data: { metadata: nextMetadata },
    });

    ok(res, {
      episode: workflowEpisodeSummary(id, workflow),
      episodes: getWorkflowEpisodeList(nextMetadata),
      workflow,
    });
  }),
);

router.get(
  "/projects/:projectId/workflow",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    const query = episodeQuerySchema.parse(req.query);
    const requestEpisodeId = resolveWorkflowEpisodeId(project.metadata, query.episodeId || "");
    const workflow = normalizeWorkflowStoryboardPrompts(getWorkflowState(project.metadata, requestEpisodeId));
    ok(res, {
      ...workflow,
      episodeId: requestEpisodeId || workflowEpisodeIdForWorkflow(project.metadata, workflow),
      episodes: getWorkflowEpisodeList(project.metadata),
      assets: await sanitizeWorkflowDraftAssets(project.id, workflow.assets),
    });
  }),
);

router.put(
  "/projects/:projectId/workflow",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    const query = episodeQuerySchema.parse(req.query);
    const input = workflowDraftSchema.parse(req.body);
    const requestEpisodeId = resolveWorkflowEpisodeId(project.metadata, input.episodeId || query.episodeId || "");
    const metadata = isRecord(project.metadata) ? project.metadata : {};
    const current = getWorkflowState(metadata, requestEpisodeId);
    const currentLastRun = isRecord(current.lastRun) ? current.lastRun : {};
    const incomingLastRun = isRecord(input.lastRun) ? input.lastRun : {};
    const currentStatus = stringFrom(currentLastRun.status, "");
    const incomingStatus = stringFrom(incomingLastRun.status, "");
    const currentClipCount = Array.isArray(current.clips) ? current.clips.length : 0;
    const currentSceneCount = Array.isArray(current.breakdownScenes) ? current.breakdownScenes.length : 0;
    const incomingClipCount = Array.isArray(input.clips) ? input.clips.length : undefined;
    const incomingSceneCount = Array.isArray(input.breakdownScenes) ? input.breakdownScenes.length : undefined;
    if (
      currentStatus === "storyboard-repaired" &&
      incomingStatus !== "storyboard-repaired" &&
      incomingClipCount !== undefined &&
      incomingClipCount < currentClipCount &&
      (incomingSceneCount === undefined || incomingSceneCount < currentSceneCount)
    ) {
      badRequest("当前分镜已被后端修复，拒绝用旧页面草稿覆盖。请刷新页面后继续编辑。");
    }
    const safeInput = {
      ...input,
      ...(input.breakdownScenes
        ? { breakdownScenes: input.breakdownScenes.map((scene, index) => enrichWorkflowScene(scene, index, current.sceneVisualBibles)) }
        : {}),
      ...(input.clips ? { clips: input.clips.map((clip, index) => normalizeWorkflowClip(clip, index)) } : {}),
      ...(input.assets
        ? {
            assets: await sanitizeWorkflowDraftAssets(project.id, input.assets),
          }
        : {}),
    };
    const next = normalizeWorkflowStoryboardPrompts({
      ...current,
      ...safeInput,
      updatedAt: new Date().toISOString(),
    });
    const episodeId = requestEpisodeId || workflowEpisodeIdForWorkflow(metadata, next);
    const nextMetadata = writeWorkflowEpisode(metadata, episodeId, next, true);

    await prisma.project.update({
      where: { id: project.id },
      data: { metadata: nextMetadata },
    });

    ok(res, { ...next, episodeId, episodes: getWorkflowEpisodeList(nextMetadata) });
  }),
);

router.post(
  "/projects/:projectId/workflow/assets/reference-image",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    const query = episodeQuerySchema.parse(req.query);
    const input = workflowAssetReferenceImageSchema.parse(req.body);
    const assetName = input.assetName.trim();
    const imageUrl = input.imageUrl || input.imageDataUrl;
    if (!imageUrl) badRequest("imageDataUrl or imageUrl is required");
    const storedReferenceImage = await persistWorkflowAssetReferenceImageInput(req, imageUrl, {
      userId: req.user!.id,
      projectId: project.id,
      assetKind: input.assetKind,
      assetName,
      fileName: input.fileName,
      mimeType: input.mimeType,
    });

    const asset = await prisma.asset.create({
      data: {
        projectId: project.id,
        uploadedById: req.user!.id,
        type: "IMAGE",
        title: input.fileName || `${assetName} reference image`,
        url: storedReferenceImage.url,
        storageKey: storedReferenceImage.storageKey,
        mimeType: storedReferenceImage.mimeType || input.mimeType,
        sizeBytes: storedReferenceImage.sizeBytes || input.sizeBytes,
        metadata: {
          source: "workflow-asset-reference-upload",
          workflowAssetKind: input.assetKind,
          assetName,
          analysisStatus: "pending",
          ...(storedReferenceImage.originalUrl ? { originalImageUrl: storedReferenceImage.originalUrl } : {}),
        },
      },
    });

    let analysis: Record<string, unknown> | null = null;
    let analysisError: string | undefined;
    try {
      const result = await callConfiguredVisionTextModel(
        [
          {
            role: "system",
            content:
              "You analyze uploaded visual reference images for an AI animation production asset library. Return only valid JSON. Keep facts concise and treat the image as visual authority.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: buildWorkflowAssetReferencePrompt(project, input.assetKind, assetName),
              },
              {
                type: "image_url",
                image_url: { url: storedReferenceImage.url },
              },
            ],
          },
        ],
        input.aiModelId,
      );
      analysis = normalizeWorkflowAssetReferenceAnalysis(result.rawText);
    } catch (error) {
      analysisError = error instanceof Error ? error.message : "资产图片识别失败";
    }

    const updatedAsset = await prisma.asset.update({
      where: { id: asset.id },
      data: {
        metadata: {
          source: "workflow-asset-reference-upload",
          workflowAssetKind: input.assetKind,
          assetName,
          analysisStatus: analysis ? "succeeded" : "failed",
          analysis,
          analysisError,
          ...(storedReferenceImage.originalUrl ? { originalImageUrl: storedReferenceImage.originalUrl } : {}),
        },
      },
    });
    const requestEpisodeId = resolveWorkflowEpisodeId(project.metadata, query.episodeId || "");
    const workflow = await syncWorkflowAssetReference(project, input.assetKind, assetName, updatedAsset, analysis, analysisError, requestEpisodeId);

    ok(res, {
      asset: updatedAsset,
      analysis,
      analysisError,
      workflow,
    });
  }),
);

router.get(
  "/projects/:projectId/workflow/assets/images",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    const query = episodeQuerySchema.parse(req.query);
    const input = workflowAssetImageHistoryQuerySchema.parse(req.query);
    const requestEpisodeId = resolveWorkflowEpisodeId(project.metadata, query.episodeId || "");
    const workflow = getWorkflowState(project.metadata, requestEpisodeId);
    const currentAsset = findWorkflowAssetItem(workflow.assets, input.assetKind, input.assetName.trim());
    const currentReferenceUrl = stringFrom(currentAsset?.referenceImageUrl, "");
    const currentGeneratedUrl = stringFrom(currentAsset?.generatedImageUrl, "");
    const primaryCurrentAssetId = currentReferenceUrl
      ? stringFrom(currentAsset?.referenceImageAssetId, "")
      : stringFrom(currentAsset?.generatedImageAssetId, "");
    const primaryCurrentUrl = primaryCurrentAssetId ? "" : currentReferenceUrl || currentGeneratedUrl;
    const currentAssetIds = new Set(
      [
        primaryCurrentAssetId,
      ].filter(Boolean),
    );
    const currentUrls = new Set(
      [
        primaryCurrentUrl,
      ].filter(Boolean),
    );
    const records = await prisma.asset.findMany({
      where: {
        projectId: project.id,
        type: "IMAGE",
        deletedAt: null,
      },
      include: {
        generation: {
          select: {
            id: true,
            prompt: true,
            status: true,
            input: true,
            parameters: true,
            aiModelId: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const currentRecordFilters = workflowAssetCurrentRecordFilters(currentAsset);
    const currentRecords = currentRecordFilters.length > 0
      ? await prisma.asset.findMany({
          where: {
            projectId: project.id,
            type: "IMAGE",
            deletedAt: null,
            OR: currentRecordFilters,
          },
          include: {
            generation: {
              select: {
                id: true,
                prompt: true,
                status: true,
                input: true,
                parameters: true,
                aiModelId: true,
                createdAt: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        })
      : [];
    const images = workflowAssetHistoryRecordsForAsset(currentAsset, input.assetKind, input.assetName, mergeAssetRecordsById(currentRecords, records))
      .slice(0, 80)
      .map((asset: any) => workflowAssetImageHistoryItem(asset, currentAssetIds, currentUrls));
    ok(res, { images });
  }),
);

router.post(
  "/projects/:projectId/workflow/assets/select-image",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    const query = episodeQuerySchema.parse(req.query);
    const input = workflowAssetImageSelectionSchema.parse(req.body);
    const assetName = input.assetName.trim();
    const requestEpisodeId = resolveWorkflowEpisodeId(project.metadata, query.episodeId || "");
    const workflow = getWorkflowState(project.metadata, requestEpisodeId);
    const currentWorkflowAsset = findWorkflowAssetItem(workflow.assets, input.assetKind, assetName);
    const asset = await prisma.asset.findFirst({
      where: {
        id: input.assetId,
        projectId: project.id,
        type: "IMAGE",
        deletedAt: null,
      },
    });
    if (!asset) notFound("Asset image not found");
    const assetMetadata = isRecord(asset.metadata) ? asset.metadata : {};
    const isCanvasGeneratedImage = stringFrom(assetMetadata.source, "") === "canvas-image-generation";
    if (!isCanvasGeneratedImage && !matchesWorkflowAssetImage(asset, input.assetKind, assetName)) {
      badRequest("这张图片不属于当前资产，不能设为当前图。");
    }
    if (input.assetKind === "scenes" && !workflowSceneImageCompatible(currentWorkflowAsset, assetMetadata)) {
      badRequest("这张场景图属于另一个规范场景，不能设为当前场景图。");
    }
    const assignableAsset = isCanvasGeneratedImage
      ? await prisma.asset.update({
          where: { id: asset.id },
          data: {
            title: `${assetName} selected canvas image`,
            metadata: {
              ...assetMetadata,
              workflowAssetKind: input.assetKind,
              assetName,
              ...(input.assetKind === "scenes" ? workflowSceneImageMetadata(currentWorkflowAsset) : {}),
              selectedFromCanvas: true,
              selectedAsAssetImageAt: new Date().toISOString(),
            },
          },
        })
      : asset;
    const selectedWorkflow = await syncWorkflowSelectedAssetImage(project, input.assetKind, assetName, assignableAsset, requestEpisodeId);
    ok(res, { workflow: selectedWorkflow, asset: assignableAsset });
  }),
);

router.post(
  "/projects/:projectId/workflow/assets/clear-image",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    const query = episodeQuerySchema.parse(req.query);
    const input = workflowAssetImageClearSchema.parse(req.body);
    const assetName = input.assetName.trim();
    const requestEpisodeId = resolveWorkflowEpisodeId(project.metadata, query.episodeId || "");
    const workflow = await clearWorkflowAssetCurrentImage(project, input.assetKind, assetName, requestEpisodeId);
    ok(res, { workflow });
  }),
);

router.delete(
  "/projects/:projectId/workflow/assets/images/:assetId",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    const query = episodeQuerySchema.parse(req.query);
    const assetId = routeParam(req.params.assetId, "assetId");
    const input = workflowAssetImageDeletionSchema.parse(req.body);
    const assetName = input.assetName.trim();
    const asset = await prisma.asset.findFirst({
      where: {
        id: assetId,
        projectId: project.id,
        type: "IMAGE",
        deletedAt: null,
      },
    });
    if (!asset) notFound("Asset image not found");
    if (!matchesWorkflowAssetImage(asset, input.assetKind, assetName)) {
      badRequest("这张图片不属于当前资产，不能删除。");
    }

    const metadata = isRecord(project.metadata) ? project.metadata : {};
    const requestEpisodeId = resolveWorkflowEpisodeId(metadata, query.episodeId || "");
    const workflow = getWorkflowState(metadata, requestEpisodeId);
    const assets: Record<string, unknown> = isRecord(workflow.assets) ? workflow.assets : defaultAssets();
    const currentItems: unknown[] = Array.isArray((assets as Record<string, unknown>)[input.assetKind])
      ? ((assets as Record<string, unknown>)[input.assetKind] as unknown[])
      : [];
    const assetKey = normalizeCompareText(assetName);
    let removedCurrent = false;
    const nextItems = currentItems.map((item: unknown) => {
      if (!isRecord(item)) return item;
      if (normalizeCompareText(stringFrom(item.name ?? item.title, "")) !== assetKey) return item;
      const next = { ...item };
      let itemRemovedCurrent = false;
      for (const [assetIdKey, urlKey] of [
        ["referenceImageAssetId", "referenceImageUrl"],
        ["generatedImageAssetId", "generatedImageUrl"],
      ] as const) {
        if (stringFrom(next[assetIdKey], "") === asset.id || stringFrom(next[urlKey], "") === asset.url) {
          delete next[assetIdKey];
          delete next[urlKey];
          itemRemovedCurrent = true;
          removedCurrent = true;
        }
      }
      if (itemRemovedCurrent) {
        delete next.visualAuthority;
        delete next.selectedImageAt;
        delete next.generatedImageAt;
        delete next.generationId;
      }
      return next;
    });
    const nextWorkflow = {
      ...workflow,
      activeStage: "assets",
      assets: {
        characters: Array.isArray(assets.characters) ? assets.characters : [],
        scenes: Array.isArray(assets.scenes) ? assets.scenes : [],
        props: Array.isArray(assets.props) ? assets.props : [],
        [input.assetKind]: nextItems,
      },
      stageStatuses: {
        ...workflow.stageStatuses,
        assets: "done",
      },
      updatedAt: new Date().toISOString(),
    };

    const episodeId = requestEpisodeId || workflowEpisodeIdForWorkflow(metadata, nextWorkflow);
    const nextMetadata = writeWorkflowEpisode(metadata, episodeId, nextWorkflow, true);

    await prisma.$transaction([
      prisma.asset.update({
        where: { id: asset.id },
        data: {
          deletedAt: new Date(),
          metadata: {
            ...(isRecord(asset.metadata) ? asset.metadata : {}),
            deletedFromWorkflowHistoryAt: new Date().toISOString(),
          },
        },
      }),
      prisma.project.update({
        where: { id: project.id },
        data: { metadata: nextMetadata },
      }),
    ]);

    ok(res, { workflow: { ...nextWorkflow, episodeId, episodes: getWorkflowEpisodeList(nextMetadata) }, deleted: true, removedCurrent });
  }),
);

router.delete(
  "/projects/:projectId/workflow/assets",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    const query = episodeQuerySchema.parse(req.query);
    const input = workflowAssetRemovalSchema.parse(req.body);
    const assetName = input.assetName.trim();
    const metadata = isRecord(project.metadata) ? project.metadata : {};
    const requestEpisodeId = resolveWorkflowEpisodeId(metadata, query.episodeId || "");
    const workflow = getWorkflowState(metadata, requestEpisodeId);
    const assets = isRecord(workflow.assets) ? workflow.assets : defaultAssets();
    const currentItems: unknown[] = Array.isArray((assets as Record<string, unknown>)[input.assetKind])
      ? ((assets as Record<string, unknown>)[input.assetKind] as unknown[])
      : [];
    const removeKey = normalizeCompareText(assetName);
    const nextItems = currentItems.filter((item: unknown) => {
      if (!isRecord(item)) return true;
      return normalizeCompareText(stringFrom(item.name ?? item.title, "")) !== removeKey;
    });
    const removed = nextItems.length !== currentItems.length;
    const nextWorkflow = {
      ...workflow,
      activeStage: "assets",
      assets: {
        characters: Array.isArray(assets.characters) ? assets.characters : [],
        scenes: Array.isArray(assets.scenes) ? assets.scenes : [],
        props: Array.isArray(assets.props) ? assets.props : [],
        [input.assetKind]: nextItems,
      },
      stageStatuses: {
        ...workflow.stageStatuses,
        assets: "done",
      },
      updatedAt: new Date().toISOString(),
    };

    if (removed) {
      const episodeId = requestEpisodeId || workflowEpisodeIdForWorkflow(metadata, nextWorkflow);
      const nextMetadata = writeWorkflowEpisode(metadata, episodeId, nextWorkflow, true);
      await prisma.project.update({
        where: { id: project.id },
        data: { metadata: nextMetadata },
      });
      ok(res, { workflow: { ...nextWorkflow, episodeId, episodes: getWorkflowEpisodeList(nextMetadata) }, removed });
      return;
    }

    ok(res, { workflow: nextWorkflow, removed });
  }),
);

router.post(
  "/projects/:projectId/workflow/canvas/generate-image",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    const input = canvasImageGenerationSchema.parse(req.body);
    const prompt = normalizeCanvasImageGenerationPrompt(input.prompt, input.metadata);
    if (!prompt) badRequest("Image prompt is required.");
    rejectPromptCompression("image", prompt);
    const referenceImageUrls = input.referenceImageUrls ?? [];
    const outputCount = input.count ?? 1;
    const requestMetadata = input.metadata ?? {};
    const requestParameters = {
      ...(input.parameters ?? {}),
      ...(referenceImageUrls.length > 0 ? { image_urls: referenceImageUrls } : {}),
      ...(outputCount > 1 ? { n: outputCount } : {}),
    };
    await expireStaleImageGenerations(project.id, req.user!.id);
    const generationLockKey = imageGenerationLockKey({
      kind: "canvas-image-generation",
      userId: req.user!.id,
      projectId: project.id,
      prompt,
      aiModelId: input.aiModelId ?? "",
      size: input.size ?? "",
      parameters: requestParameters,
    });
    if (!acquireActiveImageGeneration(generationLockKey)) {
      badRequest("同一图片生成请求已在进行中，请等待上一条完成后再重试。");
    }

    let generationId = "";
    let backgroundStarted = false;
    try {
      const generation = await prisma.generation.create({
        data: {
          projectId: project.id,
          userId: req.user!.id,
          aiModelId: input.aiModelId,
          prompt,
          input: {
            kind: "canvas-image-generation",
            size: input.size,
            referenceImageUrls,
            parameters: requestParameters,
            metadata: requestMetadata,
          },
          parameters: requestParameters,
          status: "RUNNING",
          startedAt: new Date(),
        },
      });
      generationId = generation.id;

      if (input.submitOnly) {
        backgroundStarted = true;
        runCanvasImageGenerationJob({
          req,
          userId: req.user!.id,
          projectId: project.id,
          generationId: generation.id,
          prompt,
          aiModelId: input.aiModelId,
          size: input.size,
          referenceImageUrls,
          requestParameters,
          requestMetadata,
          count: outputCount,
          generationLockKey,
        });
        ok(res, {
          generation,
          prompt,
          submitted: true,
        });
        return;
      }

      const { generation: updatedGeneration, asset, assets, image, images } = await completeCanvasImageGenerationJob({
        req,
        userId: req.user!.id,
        projectId: project.id,
        generationId: generation.id,
        prompt,
        aiModelId: input.aiModelId,
        size: input.size,
        referenceImageUrls,
        requestParameters,
        requestMetadata,
        count: outputCount,
      });

      ok(res, {
        generation: updatedGeneration,
        asset,
        assets,
        image,
        images,
        prompt,
      });
    } catch (error) {
      if (!generationId) throw error;
      const message = formatImageGenerationFailure(error, "Canvas image generation failed.");
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          status: "FAILED",
          errorMessage: message,
          completedAt: new Date(),
        },
      });
      logRawImageGenerationFailure(generationId, error, message);
      badRequest(message);
    } finally {
      if (!input.submitOnly || !backgroundStarted) {
        releaseActiveImageGeneration(generationLockKey);
      }
    }
  }),
);

router.post(
  "/projects/:projectId/workflow/canvas/generate-video",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    await expireStaleVideoGenerations(project.id, req.user!.id);
    const input = canvasVideoGenerationSchema.parse(req.body);
    const prompt = input.prompt.trim();
    if (!prompt) badRequest("Video prompt is required.");
    rejectPromptCompression("video", prompt);
    const providerContext = await resolveCanvasVideoProviderContext(input.aiModelId);
    const maxImageReferences = providerContext.provider === "dreamina-web"
      ? DREAMINA_WEB_VIDEO_MAX_IMAGE_REFERENCES
      : DEFAULT_VIDEO_MAX_IMAGE_REFERENCES;
    const maxAudioReferences = providerContext.provider === "dreamina-web"
      ? DREAMINA_WEB_VIDEO_MAX_AUDIO_REFERENCES
      : DEFAULT_VIDEO_MAX_AUDIO_REFERENCES;
    const normalizedReferences = normalizeCanvasVideoReferenceInputs({
      metadata: project.metadata,
      requestMetadata: input.metadata,
      referenceImageUrls: input.referenceImageUrls ?? [],
      referenceAudioUrls: input.referenceAudioUrls ?? [],
      maxImageReferences,
      maxAudioReferences,
    });
    const referenceImageUrls = normalizedReferences.referenceImageUrls;
    const referenceAudioUrls = normalizedReferences.referenceAudioUrls;
    if (providerContext.provider === "dreamina-web") {
      rejectDreaminaWebVideoPromptLimit(prompt);
    }
    const normalizedResolution = normalizeDreaminaVideoResolution(input.resolution);
    const normalizedDuration = normalizeDreaminaVideoDuration(input.durationSeconds);
    const normalizedRatio = normalizeCanvasVideoRatio(input.ratio, prompt, project.aspectRatio);
    const providerParameters = canvasVideoProviderParameters(providerContext);
    const requestMetadata = {
      ...(input.metadata ?? {}),
      normalizedVideoReferences: {
        source: normalizedReferences.source,
        storyboardImageUrl: normalizedReferences.storyboardImageUrl,
        imageSourceNodeIds: normalizedReferences.imageSourceNodeIds,
        audioSourceNodeIds: normalizedReferences.audioSourceNodeIds,
        referenceImageCount: referenceImageUrls.length,
        referenceAudioCount: referenceAudioUrls.length,
      },
    };
    if (input.dryRun && providerContext.provider === "dreamina-web") {
      const preflightReferenceImageUrls = referenceImageUrls.filter((url) => /^https?:\/\//i.test(url)).slice(0, DREAMINA_WEB_VIDEO_MAX_IMAGE_REFERENCES);
      if (preflightReferenceImageUrls.length === 0) badRequest("Dreamina Web 全能参考视频需要至少连接 1 张公网参考图。");
      const preflightReferenceAudioUrls = referenceAudioUrls.filter((url) => /^https?:\/\//i.test(url)).slice(0, DREAMINA_WEB_VIDEO_MAX_AUDIO_REFERENCES);
      const preflight = await preflightDreaminaWebVideoUpload({
          prompt,
          referenceImageUrls: preflightReferenceImageUrls,
          referenceAudioUrls: preflightReferenceAudioUrls,
          durationSeconds: normalizedDuration,
          ratio: normalizedRatio,
          resolution: normalizedResolution,
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Dreamina Web 素材预检失败。";
          throw new HttpError(400, message);
        });
      ok(res, {
        dryRun: true,
        generation: null,
        asset: null,
        video: null,
        submitId: null,
        genStatus: "dry-run",
        references: {
          referenceImageUrls,
          referenceAudioUrls,
          storyboardImageUrl: normalizedReferences.storyboardImageUrl,
          source: normalizedReferences.source,
          imageSourceNodeIds: normalizedReferences.imageSourceNodeIds,
          audioSourceNodeIds: normalizedReferences.audioSourceNodeIds,
        },
        raw: {
          dryRun: true,
          provider: providerContext.provider,
          videoModel: providerContext.videoModel,
          functionMode: providerContext.functionMode,
          referenceImageCount: referenceImageUrls.length,
          referenceAudioCount: referenceAudioUrls.length,
          storyboardImageUrl: normalizedReferences.storyboardImageUrl,
          resolution: normalizedResolution,
          durationSeconds: normalizedDuration,
          ratio: normalizedRatio,
          dreaminaUploadPreflight: preflight.raw,
        },
      });
      return;
    }
    if (input.dryRun) {
      ok(res, {
        dryRun: true,
        generation: null,
        asset: null,
        video: null,
        submitId: null,
        genStatus: "dry-run",
        references: {
          referenceImageUrls,
          referenceAudioUrls,
          storyboardImageUrl: normalizedReferences.storyboardImageUrl,
          source: normalizedReferences.source,
          imageSourceNodeIds: normalizedReferences.imageSourceNodeIds,
          audioSourceNodeIds: normalizedReferences.audioSourceNodeIds,
        },
        raw: {
          dryRun: true,
          provider: providerContext.provider,
          videoModel: providerContext.videoModel,
          functionMode: providerContext.functionMode,
          referenceImageCount: referenceImageUrls.length,
          referenceAudioCount: referenceAudioUrls.length,
          storyboardImageUrl: normalizedReferences.storyboardImageUrl,
          resolution: normalizedResolution,
          durationSeconds: normalizedDuration,
          ratio: normalizedRatio,
        },
      });
      return;
    }
    const previousSubmitGeneration = input.submitId ? await prisma.generation.findFirst({
      where: {
        projectId: project.id,
        userId: req.user!.id,
        providerJobId: input.submitId,
        input: { path: ["kind"], equals: "canvas-video-generation" },
      },
      orderBy: { updatedAt: "desc" },
    }) : null;
    if (previousSubmitGeneration && isTerminalGenerationStatus(previousSubmitGeneration.status)) {
      const previousParameters = isRecord(previousSubmitGeneration.parameters) ? previousSubmitGeneration.parameters : {};
      const previousRaw = isRecord(previousParameters.raw) ? previousParameters.raw : previousParameters.raw;
      const terminalStatus = canvasVideoGenerationStatusToProviderStatus(previousSubmitGeneration.status, previousParameters);
      ok(res, {
        generation: previousSubmitGeneration,
        asset: null,
        video: null,
        submitId: input.submitId,
        genStatus: terminalStatus,
        references: {
          referenceImageUrls: generationReferenceUrls(previousSubmitGeneration.input, previousSubmitGeneration.parameters, "referenceImageUrls", referenceImageUrls),
          referenceAudioUrls: generationReferenceUrls(previousSubmitGeneration.input, previousSubmitGeneration.parameters, "referenceAudioUrls", referenceAudioUrls),
          storyboardImageUrl: generationReferenceUrls(previousSubmitGeneration.input, previousSubmitGeneration.parameters, "referenceImageUrls", referenceImageUrls)[0] || normalizedReferences.storyboardImageUrl,
          source: "existing-generation",
        },
        raw: withCanvasVideoStatusRaw(
          isRecord(previousRaw) && previousSubmitGeneration.errorMessage && !previousRaw.errorMessage
            ? { ...previousRaw, errorMessage: previousSubmitGeneration.errorMessage }
            : previousRaw,
          terminalStatus,
        ),
      });
      return;
    }
    const existingGeneration = previousSubmitGeneration && ["QUEUED", "RUNNING"].includes(previousSubmitGeneration.status) ? previousSubmitGeneration : null;
    const existingReferenceImageUrls = existingGeneration ? generationReferenceUrls(existingGeneration.input, existingGeneration.parameters, "referenceImageUrls", referenceImageUrls) : referenceImageUrls;
    const existingReferenceAudioUrls = existingGeneration ? generationReferenceUrls(existingGeneration.input, existingGeneration.parameters, "referenceAudioUrls", referenceAudioUrls) : referenceAudioUrls;
    const generationReferenceImageUrls = existingGeneration ? existingReferenceImageUrls : referenceImageUrls;
    const generationReferenceAudioUrls = existingGeneration ? existingReferenceAudioUrls : referenceAudioUrls;
    const generation = existingGeneration ?? await prisma.generation.create({
      data: {
        projectId: project.id,
        userId: req.user!.id,
        aiModelId: input.aiModelId,
        prompt,
        input: {
          kind: "canvas-video-generation",
          referenceImageUrls,
          referenceAudioUrls,
          resolution: normalizedResolution,
          durationSeconds: normalizedDuration,
          ratio: normalizedRatio,
          count: input.count ?? 1,
          parameters: input.parameters ?? {},
          metadata: requestMetadata,
          submitId: input.submitId,
          provider: providerContext.provider,
          videoModel: providerContext.videoModel,
          functionMode: providerContext.functionMode,
        },
        parameters: {
          ...(input.parameters ?? {}),
          referenceImageUrls,
          referenceAudioUrls,
          resolution: normalizedResolution,
          durationSeconds: normalizedDuration,
          ratio: normalizedRatio,
          ...providerParameters,
        },
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    try {
      const result = await runCanvasVideoGeneration(req, providerContext, {
        userId: req.user!.id,
        projectId: project.id,
        generationId: generation.id,
        prompt,
        referenceImageUrls: generationReferenceImageUrls,
        referenceAudioUrls: generationReferenceAudioUrls,
        durationSeconds: normalizedDuration,
        resolution: normalizedResolution,
        ratio: normalizedRatio,
        submitId: input.submitId,
        existingRaw: existingGeneration && isRecord(existingGeneration.parameters) ? existingGeneration.parameters.raw : undefined,
      });

      const completed = Boolean(result.video?.url);
      const failed = !completed && isFailedCanvasVideoStatus(result.genStatus);
      const resultRaw = existingGeneration ? mergeCanvasVideoQueryRaw(existingGeneration.parameters, result.raw) : result.raw;
      const resultRawWithStatus = withCanvasVideoStatusRaw(resultRaw, result.genStatus);
      const resultErrorMessage = failed ? canvasVideoResultFailureMessage(resultRawWithStatus) || "Dreamina Web 视频任务失败。" : null;
      const updatedGeneration = await prisma.generation.update({
        where: { id: generation.id },
        data: {
          status: completed ? "SUCCEEDED" : failed ? "FAILED" : "RUNNING",
          completedAt: completed || failed ? new Date() : null,
          errorMessage: resultErrorMessage,
          providerJobId: result.submitId || input.submitId || null,
          parameters: {
            ...(existingGeneration && isRecord(existingGeneration.parameters) ? existingGeneration.parameters : input.parameters ?? {}),
            referenceImageUrls: generationReferenceImageUrls,
            referenceAudioUrls: generationReferenceAudioUrls,
            resolution: normalizedResolution,
            durationSeconds: normalizedDuration,
            ratio: normalizedRatio,
            ...providerParameters,
            submitId: result.submitId || input.submitId,
            genStatus: result.genStatus,
            normalizedVideoReferences: {
              source: existingGeneration ? "existing-generation" : normalizedReferences.source,
              storyboardImageUrl: existingGeneration ? generationReferenceImageUrls[0] || "" : normalizedReferences.storyboardImageUrl,
              imageSourceNodeIds: existingGeneration ? [] : normalizedReferences.imageSourceNodeIds,
              audioSourceNodeIds: existingGeneration ? [] : normalizedReferences.audioSourceNodeIds,
              referenceImageCount: generationReferenceImageUrls.length,
              referenceAudioCount: generationReferenceAudioUrls.length,
            },
            raw: resultRawWithStatus,
          },
        },
      });

      let asset: Awaited<ReturnType<typeof prisma.asset.create>> | null = null;
      if (result.video?.url) {
        asset = await prisma.asset.create({
          data: {
            projectId: project.id,
            uploadedById: req.user!.id,
            generationId: generation.id,
            type: "VIDEO",
            title: "Canvas generated video",
            url: result.video.url,
            mimeType: result.video.mimeType,
            metadata: {
              source: "canvas-video-generation",
              ...providerParameters,
              prompt,
              referenceImageUrls: generationReferenceImageUrls,
              referenceAudioUrls: generationReferenceAudioUrls,
              durationSeconds: normalizedDuration,
              resolution: normalizedResolution,
              ratio: normalizedRatio,
              submitId: result.submitId || input.submitId,
              raw: resultRawWithStatus,
              ...requestMetadata,
            },
          },
        });
      }

      ok(res, {
        generation: updatedGeneration,
        asset,
        video: result.video,
        submitId: result.submitId || input.submitId,
        genStatus: result.genStatus,
        references: {
          referenceImageUrls: generationReferenceImageUrls,
          referenceAudioUrls: generationReferenceAudioUrls,
          storyboardImageUrl: existingGeneration ? generationReferenceImageUrls[0] || "" : normalizedReferences.storyboardImageUrl,
          source: existingGeneration ? "existing-generation" : normalizedReferences.source,
        },
        raw: resultRawWithStatus,
      });
    } catch (error) {
      const message = formatCanvasVideoGenerationFailure(providerContext, error);
      await prisma.generation.update({
        where: { id: generation.id },
        data: {
          status: "FAILED",
          errorMessage: message,
          completedAt: new Date(),
        },
      });
      badRequest(message);
    }
  }),
);

router.post(
  "/projects/:projectId/workflow/canvas/translate-prompt",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    const input = canvasPromptTranslationSchema.parse(req.body);
    const prompt = input.prompt.trim();
    if (!prompt) badRequest("Prompt is required.");
    const started = Date.now();
    const result = await callConfiguredPlainTextModel(
      [
        {
          role: "system",
          content: [
            "You are a professional prompt translation engine for AI image and video production.",
            "Return only the translated prompt text. Do not wrap it in markdown, JSON, quotes, labels, or explanations.",
            "Translate the prompt faithfully without summarizing, compressing, expanding, rewriting story content, changing dialogue, or adding new requirements.",
            "Preserve line breaks, numbering, panel labels, parameter names, character names, quoted dialogue, image-reference mentions, model parameters, and technical terms unless translation is necessary.",
            "If text is already in the target language, return it unchanged except for obviously mixed-language fragments that need translation.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Project: ${project.name}`,
            project.description ? `Project description: ${project.description}` : "",
            input.context ? `Canvas context: ${input.context}` : "",
            `Source language: ${input.sourceLanguage}`,
            `Target language: ${input.targetLanguage}`,
            `Preserve structure: ${input.preserveStructure ? "yes" : "no"}`,
            "",
            "Prompt to translate:",
            prompt,
          ].filter(Boolean).join("\n"),
        },
      ],
      input.aiModelId,
    );
    const parsed = tryParseModelJson(result.rawText);
    const translatedPrompt = parsed.ok && isRecord(parsed.value)
      ? cleanTranslatedPrompt(stringFrom(parsed.value.translatedPrompt ?? parsed.value.translation ?? parsed.value.prompt, ""))
      : cleanTranslatedPrompt(result.rawText);
    if (!translatedPrompt || isTranslationPlaceholder(translatedPrompt)) badRequest("提示词翻译失败：文本模型返回了无效占位内容，请重试或切换文本模型。");
    ok(res, {
      prompt,
      translatedPrompt,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      model: result.model,
      durationMs: Date.now() - started,
    });
  }),
);

router.post(
  "/projects/:projectId/workflow/canvas/optimize-prompt",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    const input = canvasPromptOptimizationSchema.parse(req.body);
    const prompt = input.prompt.trim();
    if (!prompt) badRequest("Prompt is required.");
    const started = Date.now();
    const result = await callConfiguredPlainTextModel(
      [
        {
          role: "system",
          content: [
            "You are a manual prompt safety optimization editor for AI image and video production.",
            "Return only the optimized prompt text. Do not wrap it in markdown, JSON, quotes, labels, or explanations.",
            "Make the prompt less likely to fail moderation for the target provider while preserving the broad story meaning, chronology, shot order, panel labels, duration, ratio, character names, reference-image mentions, and production intent.",
            "Preserve every character dialogue line exactly. Do not change wording, punctuation, speaker names, quoted dialogue, or subtitles.",
            "Do not summarize, compress, shorten, expand, or add new story beats.",
            "Only soften risky visual/action wording into production-safe, non-graphic, non-realistic, comedic animation phrasing when needed.",
            "Prefer terms such as prop, staged, slapstick, malfunction, pressure surge, dramatic recoil, chaotic motion, visible danger, urgent escape, off-screen impact, stylized action, and no-injury aftermath.",
            "Keep the original language and structure unless a small local wording change is necessary for moderation safety.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Project: ${project.name}`,
            project.description ? `Project description: ${project.description}` : "",
            `Target provider: ${input.targetProvider}`,
            input.failureReason ? `Moderation/failure reason: ${input.failureReason}` : "",
            input.context ? `Canvas context: ${input.context}` : "",
            "",
            "Prompt to optimize manually:",
            prompt,
          ].filter(Boolean).join("\n"),
        },
      ],
      input.aiModelId,
    );
    const optimizedPrompt = cleanOptimizedPrompt(result.rawText);
    if (isPromptOptimizationModelRefusal(optimizedPrompt)) {
      badRequest("提示词优化失败：文本模型拒绝处理该提示词，请切换文本模型，或手动降低敏感动作/画面描述后重试。");
    }
    if (!optimizedPrompt || isPromptOptimizationPlaceholder(optimizedPrompt)) {
      badRequest("提示词优化失败：文本模型返回了无效占位内容，请重试或切换文本模型。");
    }
    const missingDialogue = missingPreservedDialogueFragments(prompt, optimizedPrompt);
    if (missingDialogue.length > 0) {
      badRequest(`提示词优化失败：模型改动或遗漏了角色台词，请重试或换文本模型。缺少：${missingDialogue.slice(0, 3).join(" / ")}`);
    }
    ok(res, {
      prompt,
      optimizedPrompt,
      targetProvider: input.targetProvider,
      failureReason: input.failureReason || "",
      model: result.model,
      durationMs: Date.now() - started,
    });
  }),
);

router.post(
  "/projects/:projectId/workflow/canvas/inspect-prompt",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    const input = canvasPromptInspectionSchema.parse(req.body);
    const prompt = input.prompt.trim();
    const question = input.question.trim();
    if (!prompt) badRequest("Prompt is required.");
    if (!question) badRequest("Question is required.");
    const started = Date.now();
    const result = await callConfiguredPlainTextModel(
      [
        {
          role: "system",
          content: [
            "You are a prompt inspection assistant for AI storyboard, image, and video production.",
            "Answer the user's question using only the supplied prompt text.",
            "Do not rewrite, translate, summarize, compress, expand, or improve the prompt unless the user explicitly asks for that.",
            "Do not invent missing characters, dialogue, props, shots, scenes, or continuity details.",
            "Keep character names, quoted dialogue, panel labels, image-reference names, and technical terms exactly as written when citing them.",
            "Prefer a concise Chinese answer for Chinese questions. Use bullet points or a small table when it makes the answer easier to scan.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            `Project: ${project.name}`,
            project.description ? `Project description: ${project.description}` : "",
            input.context ? `Canvas context: ${input.context}` : "",
            "",
            "User question:",
            question,
            "",
            "Prompt to inspect:",
            prompt,
          ].filter(Boolean).join("\n"),
        },
      ],
      input.aiModelId,
    );
    const answer = cleanPlainModelAnswer(result.rawText);
    if (!answer) badRequest("提示词检查失败：文本模型没有返回可用答案，请重试或切换文本模型。");
    ok(res, {
      prompt,
      question,
      answer,
      model: result.model,
      durationMs: Date.now() - started,
    });
  }),
);

router.post(
  "/projects/:projectId/workflow/assets/generate-image",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    const query = episodeQuerySchema.parse(req.query);
    const input = workflowAssetImageGenerationSchema.parse(req.body);
    const requestEpisodeId = resolveWorkflowEpisodeId(project.metadata, input.episodeId || query.episodeId || "");
    const assetName = input.assetName.trim();
    const imageVariant = input.variant === "with-props" ? "with-props" : "clean";
    const workflow = getWorkflowState(project.metadata, requestEpisodeId);
    const existingAsset = findWorkflowAssetItem(workflow.assets, input.assetKind, assetName);
    const referenceImageUrls = collectWorkflowAssetReferenceUrls(existingAsset, input);
    const exactPrompt = stringFrom(input.prompt, "").trim();
    const strippedExactPrompt = stripLegacyWorkflowAssetPromptScaffold(exactPrompt);
    const prompt = input.preservePromptExact
      ? strippedExactPrompt || buildWorkflowAssetImagePrompt(project, input.assetKind, assetName, existingAsset, undefined, referenceImageUrls.length)
      : input.usePromptAsFinal
        ? ensureWorkflowAssetPromptAuthority(project, input.assetKind, assetName, existingAsset, stringFrom(input.prompt, ""), referenceImageUrls.length)
        : buildWorkflowAssetImagePrompt(project, input.assetKind, assetName, existingAsset, input.prompt, referenceImageUrls.length);
    if (!prompt.trim()) badRequest("Asset image prompt is required.");
    rejectPromptCompression("image", prompt);
    if (input.useCurrentReference && referenceImageUrls.length === 0) {
      badRequest("当前资产没有可公网访问的参考图，无法参考已有图生成。请先上传公开参考图或选择一张历史生成图。");
    }
    const requestParameters = {
      ...(input.parameters ?? {}),
      ...(referenceImageUrls.length > 0 ? { image_urls: referenceImageUrls } : {}),
    };
    const currentSceneBibles = input.assetKind === "scenes" && Array.isArray(workflow.sceneVisualBibles)
      ? workflow.sceneVisualBibles
      : [];
    const currentBible = input.assetKind === "scenes"
      ? currentSceneBibles.find((bible) => bible.canonicalSceneId === stringFrom(existingAsset?.canonicalSceneId, ""))
      : undefined;
    const visualConflictWarning = input.assetKind === "scenes"
      ? sceneVisualConflictWarning(currentBible, prompt)
      : "";
    await expireStaleImageGenerations(project.id, req.user!.id);
    const generationLockKey = imageGenerationLockKey({
      kind: "workflow-asset-image",
      userId: req.user!.id,
      projectId: project.id,
      assetKind: input.assetKind,
      assetName,
      prompt,
      aiModelId: input.aiModelId ?? "",
      size: input.size ?? "",
      parameters: requestParameters,
    });
    if (!acquireActiveImageGeneration(generationLockKey)) {
      badRequest("同一图片生成请求已在进行中，请等待上一条完成后再重试。");
    }

    let generationId = "";
    try {
      const generation = await prisma.generation.create({
        data: {
          projectId: project.id,
          userId: req.user!.id,
          aiModelId: input.aiModelId,
          prompt,
          input: {
            kind: "workflow-asset-image",
            assetKind: input.assetKind,
            assetName,
            variant: imageVariant,
            size: input.size,
            referenceImageUrls,
            referenceAssetIds: input.referenceAssetIds ?? [],
            ...(input.assetKind === "scenes" ? workflowSceneImageMetadata(existingAsset) : {}),
            ...(input.assetKind === "scenes" ? { visualConflictWarning } : {}),
            ...(input.assetKind === "scenes" ? { metadata: { visualConflictWarning } } : {}),
            parameters: requestParameters,
          },
          parameters: requestParameters,
          status: "RUNNING",
          startedAt: new Date(),
        },
      });
      generationId = generation.id;

      const result = await callConfiguredImageModel({
        prompt,
        aiModelId: input.aiModelId,
        size: input.size,
        parameters: requestParameters,
      });
      const image = result.images[0];
      if (!image) badRequest("Image model returned no image.");
      const storedImage = await persistGeneratedImageOutput(req, image.url, {
        userId: req.user!.id,
        projectId: project.id,
        generationId: generation.id,
        prefix: "asset",
      });
      const persistedImage = { ...image, url: storedImage.url };

      const asset = await prisma.asset.create({
        data: {
          projectId: project.id,
          uploadedById: req.user!.id,
          generationId: generation.id,
          type: "IMAGE",
          title: `${assetName} generated asset image`,
          url: storedImage.url,
          mimeType: storedImage.mimeType,
          metadata: {
            source: "workflow-asset-image-generation",
            workflowAssetKind: input.assetKind,
            assetName,
            variant: imageVariant,
            prompt,
            size: input.size,
            referenceImageUrls,
            referenceAssetIds: input.referenceAssetIds ?? [],
            ...(input.assetKind === "scenes" ? workflowSceneImageMetadata(existingAsset) : {}),
            ...(input.assetKind === "scenes" ? { visualConflictWarning } : {}),
            parameters: requestParameters,
            model: result.model,
            revisedPrompt: image.revisedPrompt,
            durationMs: result.durationMs,
            ...(storedImage.originalUrl ? { originalProviderImageUrl: storedImage.originalUrl } : {}),
          },
        },
      });
      const updatedGeneration = await prisma.generation.update({
        where: { id: generation.id },
        data: {
          aiModelId: result.model.id,
          status: "SUCCEEDED",
          completedAt: new Date(),
          parameters: {
            ...requestParameters,
            model: result.model,
            durationMs: result.durationMs,
          },
        },
      });
      const nextWorkflow = input.writeBackToAsset === false
        ? (() => {
            const workflow = getWorkflowState(project.metadata, requestEpisodeId);
            const episodeId = requestEpisodeId || workflowEpisodeIdForWorkflow(project.metadata, workflow);
            return { ...workflow, episodeId, episodes: getWorkflowEpisodeList(project.metadata) };
          })()
        : await syncWorkflowGeneratedAssetImage(project, input.assetKind, assetName, asset, {
            prompt,
            generationId: generation.id,
            model: result.model,
            revisedPrompt: image.revisedPrompt,
            visualConflictWarning,
          }, requestEpisodeId);

      ok(res, {
        workflow: nextWorkflow,
        generation: updatedGeneration,
        asset,
        image: persistedImage,
        prompt,
      });
    } catch (error) {
      if (!generationId) throw error;
      const message = formatImageGenerationFailure(error, "Asset image generation failed.");
      await prisma.generation.update({
        where: { id: generationId },
        data: {
          status: "FAILED",
          errorMessage: message,
          completedAt: new Date(),
        },
      });
      logRawImageGenerationFailure(generationId, error, message);
      badRequest(message);
    } finally {
      releaseActiveImageGeneration(generationLockKey);
    }
  }),
);

router.post(
  "/projects/:projectId/workflow/run",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    const query = episodeQuerySchema.parse(req.query);
    const input = runWorkflowSchema.parse(req.body);
    const requestEpisodeId = resolveWorkflowEpisodeId(
      project.metadata,
      input.episodeId || query.episodeId || workflowEpisodeIdForTitle(input.selectedEpisode, "episode-001"),
    );
    const runLockKey = `${req.user!.id}:${project.id}:${requestEpisodeId}`;
    if (activeWorkflowRuns.has(runLockKey)) {
      badRequest("当前项目已有 AI 智能拆解任务正在运行，请等待上一条任务完成后再重试。");
    }
    activeWorkflowRuns.set(runLockKey, Date.now());
    try {
      await persistWorkflowRunStarted(project, input, requestEpisodeId);
      const sourcePreview = input.sourceText.slice(0, 2000);
      const userMessage = await prisma.agentMessage.create({
        data: {
          projectId: project.id,
          userId: req.user!.id,
          role: "USER",
          content: `Run workflow ${input.stage}: ${input.selectedEpisode}`,
          payload: {
            sourceName: input.sourceName,
            selectedEpisode: input.selectedEpisode,
            sourceLength: input.sourceText.length,
            sourcePreview,
          },
        },
      });

      const breakdown = await generateWorkflowBreakdown(project, { ...input, episodeId: requestEpisodeId });
      const saved = await persistWorkflowRun({
        project,
        userId: req.user!.id,
        parentMessageId: userMessage.id,
        input: { ...input, episodeId: requestEpisodeId },
        normalized: breakdown.normalized,
        model: breakdown.model,
        rawText: breakdown.rawText,
      });

      ok(res, saved);
    } catch (error) {
      await persistWorkflowRunFailed(project, input, error, requestEpisodeId);
      throw error;
    } finally {
      activeWorkflowRuns.delete(runLockKey);
    }
  }),
);

router.post(
  "/projects/:projectId/workflow/clips/:clipId/optimize",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    const clipId = routeParam(req.params.clipId, "clipId");
    const query = episodeQuerySchema.parse(req.query);
    const input = optimizeClipSchema.parse(req.body ?? {});
    const requestEpisodeId = resolveWorkflowEpisodeId(project.metadata, input.episodeId || query.episodeId || "");
    const metadata = isRecord(project.metadata) ? project.metadata : {};
    const currentWorkflow = getWorkflowState(metadata, requestEpisodeId);
    const clipIndex = currentWorkflow.clips.findIndex((clip) => clip.id === clipId);
    if (clipIndex < 0) notFound("Workflow clip not found");

    const clip = currentWorkflow.clips[clipIndex];
    const shotIdSet = new Set(clip.shotIds);
    const targetShots = currentWorkflow.breakdownScenes.filter((shot) => shotIdSet.has(shot.id));
    if (targetShots.length === 0) badRequest("当前 Clip 没有关联分镜，无法优化。");

    const authority = await workflowAuthorityContext(project, currentWorkflow.sourceText);
    const modelResult = await callWorkflowTextModel(
      "Clip AI优化",
      [
        {
          role: "system",
          content:
            "You are a clip-level storyboard optimizer for an AI animation studio. Return only valid JSON. Do not wrap it in markdown. Optimize only the given clip.",
        },
        {
          role: "user",
          content: buildClipOptimizationPrompt(project, currentWorkflow, clip, targetShots, authority),
        },
      ],
      input.aiModelId,
    );
    const optimizedJson = await parseModelJsonWithRepair("Clip AI优化", modelResult.rawText, input.aiModelId, storyboardJsonShape());
    const optimizedShots = optimizeWorkflowClipShots(
      canonicalizeStoryboardShots(normalizeOptimizedClipShots(optimizedJson, targetShots), authority),
      clip.id,
    );
    const optimizedClip = {
      ...buildWorkflowClip(optimizedShots, clipIndex, workflowClipContext(project, workflowAssetCharacters(currentWorkflow.assets), currentWorkflow.assets, currentWorkflow.sourceText)),
      id: clip.id,
      title: clip.title,
    };
    const nextBreakdownScenes = currentWorkflow.breakdownScenes.flatMap((shot) => {
      if (!shotIdSet.has(shot.id)) return [shot];
      if (shot.id !== targetShots[0].id) return [];
      return optimizedShots;
    });
    const nextClips = currentWorkflow.clips.map((item, index) =>
      index === clipIndex
        ? optimizedClip
        : {
            ...item,
            shotIds: item.shotIds.filter((shotId) => !shotIdSet.has(shotId)),
          },
    );
    const next = {
      ...currentWorkflow,
      breakdownScenes: nextBreakdownScenes,
      clips: nextClips,
      stageStatuses: {
        ...currentWorkflow.stageStatuses,
        storyboard: "done",
      },
      lastRun: {
        ...(isRecord(currentWorkflow.lastRun) ? currentWorkflow.lastRun : {}),
        status: "clip-optimized",
        stage: "clip-optimize",
        model: modelResult.model,
        clipId: clip.id,
        completedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };

    const episodeId = requestEpisodeId || workflowEpisodeIdForWorkflow(metadata, next);
    const nextMetadata = writeWorkflowEpisode(metadata, episodeId, next, true);
    await prisma.project.update({
      where: { id: project.id },
      data: { metadata: nextMetadata },
    });

    ok(res, { ...next, episodeId, episodes: getWorkflowEpisodeList(nextMetadata) });
  }),
);

router.post(
  "/projects/:projectId/workflow/clips/:clipId/seedance-prompt",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    const clipId = routeParam(req.params.clipId, "clipId");
    const query = episodeQuerySchema.parse(req.query);
    const input = seedancePromptSchema.parse(req.body ?? {});
    const requestEpisodeId = resolveWorkflowEpisodeId(project.metadata, input.episodeId || query.episodeId || "");
    const metadata = isRecord(project.metadata) ? project.metadata : {};
    const currentWorkflow = getWorkflowState(metadata, requestEpisodeId);
    const clipIndex = currentWorkflow.clips.findIndex((clip) => clip.id === clipId);
    if (clipIndex < 0) notFound("Workflow clip not found");

    const clip = currentWorkflow.clips[clipIndex];
    const shotIdSet = new Set(clip.shotIds);
    const targetShots = currentWorkflow.breakdownScenes.filter((shot) => shotIdSet.has(shot.id));
    if (targetShots.length === 0) badRequest("当前 Clip 没有关联分镜，无法生成视频提示词。");

    const authority = await workflowAuthorityContext(project, currentWorkflow.sourceText);
    const recoveredStoryboardPrompt = await recoverWorkflowClipStoryboardPrompt(project.id, metadata, requestEpisodeId, currentWorkflow, clip);
    const clipForPrompt = recoveredStoryboardPrompt && recoveredStoryboardPrompt !== clip.storyboardPrompt
      ? { ...clip, storyboardPrompt: recoveredStoryboardPrompt }
      : clip;
    const canonicalTargetShots = canonicalizeStoryboardShots(targetShots, authority);
    const canonicalClipForPrompt = canonicalizeWorkflowClipCharacters(clipForPrompt, authority);
    const generated = regenerateWorkflowClipSeedancePrompt(project, currentWorkflow, canonicalClipForPrompt, canonicalTargetShots);
    if (input.aiModelId) {
      generated.seedancePrompt = await refineWorkflowClipSeedancePrompt({
        project,
        workflow: currentWorkflow,
        clip: canonicalClipForPrompt,
        shots: canonicalTargetShots,
        prompt: generated.seedancePrompt,
        aiModelId: input.aiModelId,
        authority,
      });
    }
    const nextClip = {
      ...clip,
      ...(canonicalClipForPrompt.storyboardPrompt && canonicalClipForPrompt.storyboardPrompt !== clip.storyboardPrompt
        ? { storyboardPrompt: canonicalClipForPrompt.storyboardPrompt }
        : {}),
      ...generated,
    };
    const nextClips = currentWorkflow.clips.map((item, index) => (index === clipIndex ? nextClip : item));
    const next = {
      ...currentWorkflow,
      clips: nextClips,
      stageStatuses: {
        ...currentWorkflow.stageStatuses,
        video: "done",
      },
      lastRun: {
        ...(isRecord(currentWorkflow.lastRun) ? currentWorkflow.lastRun : {}),
        status: "seedance-prompt-generated",
        stage: "video",
        clipId: clip.id,
        completedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };

    const episodeId = requestEpisodeId || workflowEpisodeIdForWorkflow(metadata, next);
    const nextMetadata = writeWorkflowEpisode(metadata, episodeId, next, true);
    await prisma.project.update({
      where: { id: project.id },
      data: { metadata: nextMetadata },
    });

    ok(res, {
      workflow: { ...next, episodeId, episodes: getWorkflowEpisodeList(nextMetadata) },
      clip: nextClip,
      prompt: nextClip.seedancePrompt,
    });
  }),
);

router.post(
  "/projects/:projectId/workflow/clips/:clipId/storyboard-plan",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    const clipId = routeParam(req.params.clipId, "clipId");
    const query = episodeQuerySchema.parse(req.query);
    const input = clipStoryboardPlanSchema.parse(req.body ?? {});
    const requestEpisodeId = resolveWorkflowEpisodeId(project.metadata, input.episodeId || query.episodeId || "");
    const metadata = isRecord(project.metadata) ? project.metadata : {};
    const currentWorkflow = getWorkflowState(metadata, requestEpisodeId);
    const clip = currentWorkflow.clips.find((item) => item.id === clipId);
    if (!clip) notFound("Workflow clip not found");

    const shotIdSet = new Set(clip.shotIds);
    const targetShots = currentWorkflow.breakdownScenes.filter((shot) => shotIdSet.has(shot.id));
    if (targetShots.length === 0) badRequest("当前 Clip 没有关联分镜，无法推理故事板。");

    const authority = await workflowAuthorityContext(project, currentWorkflow.sourceText);
    const modelResult = await callWorkflowTextModel(
      "Clip故事板推理",
      [
        {
          role: "system",
          content:
            "You are a clip-level director storyboard planner for AI video production. Return only strict JSON. Do not wrap it in markdown.",
        },
        {
          role: "user",
          content: buildClipStoryboardPlanPrompt(project, currentWorkflow, clip, targetShots, authority, input),
        },
      ],
      input.aiModelId,
    );
    const structured = await parseModelJsonWithRepair("Clip故事板推理", modelResult.rawText, input.aiModelId, clipStoryboardPlanJsonShape());
    const continuity = clipStoryboardContinuityContext(currentWorkflow, clip, targetShots);
    const plan = normalizeClipStoryboardPlan(structured, clip, targetShots, input, project.aspectRatio, currentWorkflow, authority);
    const prompt = finalizeClipStoryboardImagePrompt(enforceClipStoryboardDialoguePrompt(
      enforceClipStoryboardContinuityPrompt(plan.prompt, continuity),
      targetShots,
    ), plan.panelCount, project.aspectRatio);
    const nextClip = {
      ...clip,
      storyboardPrompt: prompt,
      storyboardPanelCount: plan.panelCount,
      storyboardNotes: plan.notes || "",
      seedancePrompt: "",
    };
    const savedMetadata = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${project.id} FOR UPDATE`;
      const currentProject = await tx.project.findUnique({
        where: { id: project.id },
        select: { metadata: true },
      });
      const freshMetadata = isRecord(currentProject?.metadata) ? currentProject.metadata : {};
      const freshWorkflow = getWorkflowState(freshMetadata, requestEpisodeId);
      const freshNext = {
        ...freshWorkflow,
        clips: freshWorkflow.clips.map((item) => (item.id === clip.id ? nextClip : item)),
        stageStatuses: {
          ...freshWorkflow.stageStatuses,
          storyboard: "done",
          video: "idle",
        },
        lastRun: {
          ...(isRecord(freshWorkflow.lastRun) ? freshWorkflow.lastRun : {}),
          status: "clip-storyboard-planned",
          stage: "storyboard",
          clipId: clip.id,
          completedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      };
      const episodeId = requestEpisodeId || workflowEpisodeIdForWorkflow(freshMetadata, freshNext);
      const nextMetadata = writeWorkflowEpisode(freshMetadata, episodeId, freshNext, true);
      await tx.project.update({
        where: { id: project.id },
        data: { metadata: nextMetadata as Prisma.InputJsonValue },
      });
      return { nextMetadata, freshNext, episodeId };
    });

    ok(res, {
      ...plan,
      prompt,
      continuityCharacters: continuity.continuityCharacters,
      model: modelResult.model,
      workflow: { ...savedMetadata.freshNext, episodeId: savedMetadata.episodeId, episodes: getWorkflowEpisodeList(savedMetadata.nextMetadata) },
      clip: nextClip,
    });
  }),
);

async function findOwnedProject(projectId: string, ownerId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
  if (!project) notFound("Project not found");
  return project;
}

async function workflowAuthorityContext(project: any, _sourceText = ""): Promise<WorkflowAuthorityContext> {
  const settings = isRecord(project.settings) ? project.settings : {};
  const setupSettings = isRecord(settings.setupSettings) ? settings.setupSettings : {};
  const globalPrompt = stringFrom(settings.globalPrompt, stringFrom(setupSettings.globalPrompt, "")) ?? "";
  const negativePrompt = stringFrom(settings.negativePrompt, "");
  const characterIdentityRules = stringFrom(
    setupSettings.characterIdentityRules,
    firstLineAfterLabel(globalPrompt, "Character identity rules:") ?? "",
  );
  const existingCharacters = await prisma.character.findMany({
    where: { projectId: project.id, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 80,
    select: { name: true, role: true, bio: true, prompt: true, traits: true },
  });
  const characters: WorkflowAuthorityCharacter[] = existingCharacters.map((character: any) => ({
    name: stringFrom(character.name, ""),
    role: stringFrom(character.role, "SUPPORTING"),
    bio: compactPromptText(stringFrom(character.bio, "")),
    prompt: compactPromptText(stringFrom(character.prompt, "")),
    traits: compactCharacterTraits(character.traits),
  }));
  return {
    globalPrompt,
    negativePrompt,
    setupSettings,
    setupSettingsSummary: summarizeSetupSettings(setupSettings),
    characterIdentityRules,
    existingCharacters: characters,
    requiresSpecificFruitIdentity: requiresSpecificFruitIdentityText(characterIdentityRules),
  };
}

function projectAuthorityPromptBlock(authority: WorkflowAuthorityContext): string {
  return [
    "Project global settings authority:",
    "- The following project-level settings are mandatory for every inference in this project: globalPrompt, negativePrompt, setupSettings, directorNotes, projectTone, characterIdentityRules, scriptRules, and Existing Character records.",
    "- Apply these settings to asset extraction, script breakdown, storyboard prompts, director boards, and video prompts.",
    "- Preserve locked character identity, project tone, visual style, and script rules unless the user explicitly changes the project global settings.",
    authority.globalPrompt ? `Global prompt: ${authority.globalPrompt}` : "",
    authority.negativePrompt ? `Negative prompt: ${authority.negativePrompt}` : "",
    authority.setupSettingsSummary ? `Setup settings: ${authority.setupSettingsSummary}` : "",
    authority.characterIdentityRules ? `Character identity rules: ${authority.characterIdentityRules}` : "",
  ].filter(Boolean).join("\n");
}

function existingAssetNameLanguageRules(authority: WorkflowAuthorityContext): string {
  if (authority.existingCharacters.length === 0) return "";
  return [
    "Existing asset name lock:",
    "- When the source text uses Chinese, story prose may remain Chinese for review, but existing asset identities must not be translated or renamed.",
    "- Character, prop, and scene names that match Existing Character records or existing project asset memory must use the existing canonical asset name exactly.",
    "- Dialogue speaker labels should use the canonical existing character name when the speaker is an existing character; keep only the spoken dialogue text in the source language.",
    "- If the source says 克洛伊/克洛依, use Chloe when Chloe exists; 弗洛拉/芙洛拉 uses Flora; 鲍勃 uses Bob; 里奥/利奥 uses Leo; 蒂芙尼 uses Tiffany; 尤金 uses Eugene. Apply this mapping only for matching existing records.",
    "- Put the Chinese wording in aliases or references if useful; do not create duplicate Chinese-named assets for existing characters.",
  ].join("\n");
}

async function generateWorkflowBreakdown(project: any, input: z.infer<typeof runWorkflowSchema>) {
  const authority = await workflowAuthorityContext(project, input.sourceText);
  if (input.stage === "storyboard") {
    const currentWorkflow = getWorkflowState(project.metadata, input.episodeId);
    ensureWorkflowAssetsExtractedForStoryboard(currentWorkflow.assets);
    const storyboardAssets = workflowAssetsWithSceneVisualBiblesForStoryboard(currentWorkflow);
    const storyboardResult = await generateStoryboardJson(project, input, storyboardAssets, authority);
    const storyboardJson = storyboardResult.structured;
    const merged = mergeBreakdownJson(storyboardAssets, storyboardJson);

    return {
      normalized: normalizeBreakdown(merged, input, project, authority),
      model: storyboardResult.model,
      rawText: JSON.stringify(
        {
          storyboardOnly: true,
          storyboard: storyboardJson,
        },
        null,
        2,
      ),
    };
  }

  if (input.stage === "assets") {
    const assetsResult = await callWorkflowTextModel(
      "资产提取",
      [
        {
          role: "system",
          content:
            "You are an asset extraction agent for an AI animation studio. Return only valid JSON. Do not wrap it in markdown. Use strict JSON: double-quoted keys, no trailing commas, no raw double quote characters inside string values.",
        },
        {
          role: "user",
          content: buildAssetExtractionPrompt(project, input, authority),
        },
      ],
      input.aiModelId,
    );
    const assetsJson = await parseModelJsonWithRepair("资产提取", assetsResult.rawText, input.aiModelId, assetJsonShape());
    return {
      normalized: normalizeBreakdown(
        assetsJson,
        input,
        project,
        authority,
      ),
      model: assetsResult.model,
      rawText: assetsResult.rawText,
    };
  }

  const assetsResult = await callWorkflowTextModel(
    "资产提取",
    [
      {
        role: "system",
        content:
          "You are an asset extraction agent for an AI animation studio. Return only valid JSON. Do not wrap it in markdown. Use strict JSON: double-quoted keys, no trailing commas, no raw double quote characters inside string values.",
      },
      {
        role: "user",
        content: buildAssetExtractionPrompt(project, input, authority),
      },
    ],
    input.aiModelId,
  );
  const assetsJson = await parseModelJsonWithRepair("资产提取", assetsResult.rawText, input.aiModelId, assetJsonShape());
  const canonicalAssetsJson = canonicalizeWorkflowAssetsWithAuthority(normalizeWorkflowAssets(assetsJson), authority);
  await persistWorkflowAssetsProgress(project, input, canonicalAssetsJson, authority);

  const storyboardResult = await generateStoryboardJson(project, input, canonicalAssetsJson, authority);
  const storyboardJson = storyboardResult.structured;
  const merged = mergeBreakdownJson(canonicalAssetsJson, storyboardJson);

  return {
    normalized: normalizeBreakdown(merged, input, project, authority),
    model: storyboardResult.model,
    rawText: JSON.stringify(
      {
        splitWorkflow: true,
        assets: assetsJson,
        storyboard: storyboardJson,
      },
      null,
      2,
    ),
  };
}

async function generateStoryboardJson(
  project: any,
  input: z.infer<typeof runWorkflowSchema>,
  assetsJson: unknown,
  authority: WorkflowAuthorityContext,
) {
  if (input.sourceText.length >= SEGMENTED_STORYBOARD_SOURCE_LENGTH) {
    return generateSegmentedStoryboardJson(project, input, assetsJson, authority);
  }

  let firstResult: Awaited<ReturnType<typeof callWorkflowTextModel>>;
  try {
    firstResult = await callWorkflowTextModel(
      "分镜拆解",
      [
        {
          role: "system",
          content:
            "You are a storyboard breakdown agent for an AI animation studio. Return only valid JSON. Do not wrap it in markdown. Use strict JSON: double-quoted keys, no trailing commas, no raw double quote characters inside string values.",
        },
        {
          role: "user",
          content: buildStoryboardOnlyPrompt(project, input, assetsJson, authority),
        },
      ],
      input.aiModelId,
    );
  } catch (error) {
    if (!isWorkflowTextTimeoutError(error) || input.sourceText.length < SEGMENTED_STORYBOARD_TIMEOUT_FALLBACK_LENGTH) throw error;
    return generateSegmentedStoryboardJson(project, input, assetsJson, authority);
  }
  const firstStructured = await parseModelJsonWithRepair("分镜拆解", firstResult.rawText, input.aiModelId, storyboardJsonShape());
  if (!hasSourceLanguageMismatch(input.sourceText, firstStructured)) {
    return { ...firstResult, structured: firstStructured };
  }

  const retryResult = await callWorkflowTextModel(
    "分镜拆解语言修正",
    [
      {
        role: "system",
        content:
          "You are a storyboard breakdown agent for an AI animation studio. Return only valid JSON. Do not wrap it in markdown. Use strict JSON: double-quoted keys, no trailing commas, no raw double quote characters inside string values.",
      },
      {
        role: "user",
        content: [
          buildStoryboardOnlyPrompt(project, input, assetsJson, authority),
          "",
          "Critical correction:",
          "- The previous output was rejected because it translated or mixed the source language.",
          "- Regenerate from the original source text.",
          "- If the source is English, every human-readable string field must be English and must contain no Chinese characters.",
          "- Preserve quoted dialogue in the source language whenever possible.",
        ].join("\n"),
      },
    ],
    input.aiModelId,
  );
  return {
    ...retryResult,
    structured: await parseModelJsonWithRepair("分镜拆解语言修正", retryResult.rawText, input.aiModelId, storyboardJsonShape()),
  };
}

async function generateSegmentedStoryboardJson(
  project: any,
  input: z.infer<typeof runWorkflowSchema>,
  assetsJson: unknown,
  authority: WorkflowAuthorityContext,
) {
  const chunks = splitSourceTextForStoryboard(input.sourceText);
  if (chunks.length <= 1) throw new Error("分镜拆解超时，且原文无法安全分段。");
  const storyboard: unknown[] = [];
  const rawParts: unknown[] = [];
  let model: Awaited<ReturnType<typeof callWorkflowTextModel>>["model"] | undefined;
  console.info(`[workflow-model] fallback segmented storyboard chunks=${chunks.length} sourceLength=${input.sourceText.length}`);
  await persistWorkflowRunProgress(project, input, {
    phase: "segmented-storyboard",
    message: `分镜拆解已自动分为 ${chunks.length} 段，正在准备第 1 段。`,
    currentPart: 0,
    totalParts: chunks.length,
  });

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    await persistWorkflowRunProgress(project, input, {
      phase: "segmented-storyboard",
      message: `正在拆解分段 ${index + 1}/${chunks.length}`,
      currentPart: index + 1,
      totalParts: chunks.length,
    });
    const chunkInput = {
      ...input,
      sourceText: chunk.text,
      selectedEpisode: `${input.selectedEpisode} · part ${index + 1}/${chunks.length}`,
    };
    const result = await callWorkflowTextModel(
      `分镜拆解分段 ${index + 1}/${chunks.length}`,
      [
        {
          role: "system",
          content:
            "You are a storyboard breakdown agent for an AI animation studio. Return only valid JSON. Do not wrap it in markdown. Use strict JSON: double-quoted keys, no trailing commas, no raw double quote characters inside string values.",
        },
        {
          role: "user",
          content: buildSegmentedStoryboardPrompt(project, chunkInput, assetsJson, authority, {
            partIndex: index,
            totalParts: chunks.length,
            previousTail: chunks[index - 1]?.tail ?? "",
            nextHead: chunks[index + 1]?.head ?? "",
          }),
        },
      ],
      input.aiModelId,
    );
    model = result.model;
    const structured = await parseModelJsonWithRepair(`分镜拆解分段 ${index + 1}/${chunks.length}`, result.rawText, input.aiModelId, storyboardJsonShape());
    const partStoryboard = isRecord(structured) ? arrayFrom(structured.storyboard) : [];
    storyboard.push(...partStoryboard);
    rawParts.push({ part: index + 1, rawText: result.rawText });
    await persistWorkflowRunProgress(project, input, {
      phase: "segmented-storyboard",
      message: `已完成分段 ${index + 1}/${chunks.length}`,
      currentPart: index + 1,
      totalParts: chunks.length,
      generatedShots: storyboard.length,
    });
  }

  return {
    rawText: JSON.stringify({ segmentedStoryboard: true, parts: rawParts }, null, 2),
    model: model ?? await selectedWorkflowModelSummary(input.aiModelId),
    structured: { storyboard },
  };
}

function isWorkflowTextTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /524|timeout|timed out|超过|网关|gateway|cloudflare|A timeout occurred/i.test(message);
}

type WorkflowModelSummary = {
  id: string;
  provider: string;
  model: string;
  displayName: string;
};

async function selectedWorkflowModelSummary(aiModelId?: string): Promise<WorkflowModelSummary> {
  const fallback = {
    id: aiModelId || "",
    provider: "",
    model: "",
    displayName: aiModelId || "未选择模型",
  };
  try {
    const model = aiModelId
      ? await prisma.aiModel.findFirst({
          where: { id: aiModelId, isActive: true },
          include: { providerConfig: true },
        })
      : (await prisma.aiModel.findMany({
          where: {
            isActive: true,
            providerConfigId: { not: null },
            providerConfig: { isActive: true },
          },
          include: { providerConfig: true },
          orderBy: [{ updatedAt: "desc" }],
        })).find(isWorkflowTextModelSummaryCandidate);

    if (!model) return fallback;
    return {
      id: model.id,
      provider: model.providerConfig?.providerType || model.provider,
      model: model.model,
      displayName: model.displayName,
    };
  } catch {
    return fallback;
  }
}

function isWorkflowTextModelSummaryCandidate(model: { modality: string; capabilities: unknown }): boolean {
  const modality = model.modality.toLowerCase();
  if (modality.includes("text") || modality.includes("chat")) return true;
  const capabilities = Array.isArray(model.capabilities)
    ? model.capabilities.map((item) => String(item).toLowerCase())
    : typeof model.capabilities === "string"
      ? [model.capabilities.toLowerCase()]
      : isRecord(model.capabilities)
        ? Object.entries(model.capabilities)
            .filter(([, value]) => Boolean(value))
            .map(([key]) => key.toLowerCase())
        : [];
  return capabilities.some((item) => item.includes("text") || item.includes("chat"));
}

async function callWorkflowTextModel(
  stageLabel: string,
  messages: Array<{ role: "system" | "user"; content: string }>,
  aiModelId?: string,
) {
  const started = Date.now();
  console.info(`[workflow-model] start stage=${stageLabel} messages=${messages.length}`);
  try {
    const result = await callConfiguredTextModel(messages, aiModelId);
    console.info(`[workflow-model] done stage=${stageLabel} durationMs=${Date.now() - started} model=${result.model.displayName}`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[workflow-model] failed stage=${stageLabel} durationMs=${Date.now() - started}: ${message}`);
    if (error instanceof HttpError) {
      throw new HttpError(error.status, `${stageLabel}失败：${error.message}`);
    }
    throw error;
  }
}

function defaultWorkflowState(selectedEpisode = "第 1 集") {
  return {
    sourceText: "",
    sourceName: "",
    selectedEpisode,
    activeStage: "source",
    breakdownScenes: [],
    clips: [],
    sceneVisualBibles: [],
    assets: defaultAssets(),
    stageStatuses: defaultStageStatuses(),
    updatedAt: undefined,
    lastRun: undefined,
  };
}

function normalizeWorkflowStateRecord(value: unknown, fallbackEpisode = "第 1 集") {
  const record = isRecord(value) ? value : {};
  const sceneVisualBibles = Array.isArray(record.sceneVisualBibles)
    ? record.sceneVisualBibles.filter((item): item is SceneVisualBible => isRecord(item))
    : [];
  const breakdownScenes = Array.isArray(record.breakdownScenes)
    ? record.breakdownScenes.map((scene, index) => enrichWorkflowScene(scene, index, sceneVisualBibles))
    : [];
  const clips = Array.isArray(record.clips)
    ? record.clips.map((clip, index) => normalizeWorkflowClip(clip, index))
    : deriveWorkflowClipsFromShots(breakdownScenes);
  return {
    sourceText: stringFrom(record.sourceText, ""),
    sourceName: stringFrom(record.sourceName, ""),
    selectedEpisode: stringFrom(record.selectedEpisode, fallbackEpisode),
    activeStage: stringFrom(record.activeStage, "source"),
    breakdownScenes,
    clips: normalizeStoryboardPromptClips(clips),
    sceneVisualBibles,
    assets: applySceneVisualLocksToWorkflowAssets(isRecord(record.assets) ? record.assets : defaultAssets(), sceneVisualBibles),
    stageStatuses: isRecord(record.stageStatuses) ? record.stageStatuses : defaultStageStatuses(),
    updatedAt: stringFrom(record.updatedAt, undefined),
    lastRun: isRecord(record.lastRun) ? record.lastRun : undefined,
  };
}

function normalizeWorkflowStoryboardPrompts<T extends { clips?: unknown[] }>(workflow: T): T {
  if (!Array.isArray(workflow.clips)) return workflow;
  return {
    ...workflow,
    clips: normalizeStoryboardPromptClips(workflow.clips),
  };
}

function normalizeStoryboardPromptClips(clips: unknown[]): NormalizedWorkflowClip[] {
  return clips.map((clip, index) => {
    const normalized = normalizeWorkflowClip(clip, index);
    return {
      ...normalized,
      storyboardPrompt: stripLegacyClipStoryboardImageLayoutPrompt(normalized.storyboardPrompt),
    };
  });
}

function legacyWorkflowState(metadata: unknown) {
  if (isRecord(metadata) && isRecord(metadata.workflowCenter)) {
    return normalizeWorkflowStateRecord(metadata.workflowCenter);
  }
  return defaultWorkflowState();
}

function getWorkflowState(metadata: unknown, episodeId?: string) {
  if (episodeId) return getWorkflowEpisodeById(metadata, episodeId).workflow;
  return getActiveWorkflowEpisode(metadata).workflow;
}

function getActiveWorkflowEpisode(metadata: unknown): { id: string; workflow: ReturnType<typeof normalizeWorkflowStateRecord> } {
  const record = isRecord(metadata) ? metadata : {};
  const activeEpisodeId = stringFrom(record.activeEpisodeId, "");
  if (activeEpisodeId) return getWorkflowEpisodeById(record, activeEpisodeId);
  const episodes = getWorkflowEpisodes(record);
  const firstEpisodeId = Object.keys(episodes)[0];
  if (firstEpisodeId) return getWorkflowEpisodeById(record, firstEpisodeId);
  const legacy = legacyWorkflowState(record);
  return { id: workflowEpisodeIdForTitle(legacy.selectedEpisode, "episode-001"), workflow: legacy };
}

function getWorkflowEpisodeById(metadata: unknown, episodeId: string): { id: string; workflow: ReturnType<typeof normalizeWorkflowStateRecord> } {
  const episodes = getWorkflowEpisodes(metadata);
  const resolvedId = resolveWorkflowEpisodeId(metadata, episodeId) || episodeId;
  const episode = episodes[resolvedId];
  if (isRecord(episode) && isRecord(episode.workflowCenter)) {
    return { id: resolvedId, workflow: normalizeWorkflowStateRecord(episode.workflowCenter, stringFrom(episode.title, "第 1 集")) };
  }
  const legacy = legacyWorkflowState(metadata);
  return { id: resolvedId || workflowEpisodeIdForTitle(legacy.selectedEpisode, "episode-001"), workflow: legacy };
}

function getWorkflowEpisodes(metadata: unknown): Record<string, Record<string, unknown>> {
  if (!isRecord(metadata) || !isRecord(metadata.episodes)) return {};
  const result: Record<string, Record<string, unknown>> = {};
  for (const [id, value] of Object.entries(metadata.episodes)) {
    if (id && isRecord(value)) result[id] = value;
  }
  return result;
}

function writeWorkflowEpisode(
  metadata: Record<string, unknown>,
  episodeId: string,
  workflow: any,
  makeActive = false,
): Record<string, unknown> {
  const id = episodeId || workflowEpisodeIdForTitle(workflow.selectedEpisode, "episode-001");
  const episodes = getWorkflowEpisodes(metadata);
  const workflowWithSceneLocks = applySceneVisualLocksToWorkflowRecord(workflow);
  return {
    ...metadata,
    workflowCenter: workflowWithSceneLocks,
    ...(makeActive
      ? {
          activeEpisodeId: id,
          currentEpisodeId: id,
          selectedEpisodeId: id,
          activeCanvasSceneId: workflowEpisodeCanvasSceneId(id),
        }
      : {}),
    episodes: {
      ...episodes,
      [id]: {
        ...(episodes[id] ?? {}),
        id,
        title: workflowWithSceneLocks.selectedEpisode || stringFrom(episodes[id]?.title, "第 1 集"),
        canvasSceneId: workflowEpisodeCanvasSceneId(id),
        workflowCenter: workflowWithSceneLocks,
        updatedAt: workflowWithSceneLocks.updatedAt ?? new Date().toISOString(),
      },
    },
  };
}

function getWorkflowEpisodeList(metadata: unknown): { activeEpisodeId: string; episodes: WorkflowEpisodeSummary[] } {
  const record = isRecord(metadata) ? metadata : {};
  const episodes = getWorkflowEpisodes(record);
  const summaries = Object.entries(episodes)
    .map(([id, episode]) => {
      const workflow = normalizeWorkflowStateRecord(isRecord(episode.workflowCenter) ? episode.workflowCenter : {}, stringFrom(episode.title, "第 1 集"));
      return workflowEpisodeSummary(id, workflow, episode);
    })
    .sort((a, b) => episodeSortKey(a, b));
  const legacy = legacyWorkflowState(record);
  const legacyId = workflowEpisodeIdForTitle(legacy.selectedEpisode, "episode-001");
  if (summaries.length === 0) {
    summaries.unshift(workflowEpisodeSummary(legacyId, legacy));
  }
  const requestedActiveEpisodeId = stringFrom(record.activeEpisodeId, summaries[0]?.id ?? legacyId);
  const activeEpisodeId = summaries.some((item) => item.id === requestedActiveEpisodeId)
    ? requestedActiveEpisodeId
    : summaries[0]?.id ?? legacyId;
  return { activeEpisodeId, episodes: summaries };
}

function workflowEpisodeSummary(id: string, workflow: any, episode?: Record<string, unknown>): WorkflowEpisodeSummary {
  const updatedAt = stringFrom(episode?.updatedAt, undefined) ?? stringFrom(workflow?.updatedAt, undefined);
  return {
    id,
    title: stringFrom(episode?.title, stringFrom(workflow?.selectedEpisode, "第 1 集")),
    selectedEpisode: stringFrom(workflow?.selectedEpisode, stringFrom(episode?.title, "第 1 集")),
    canvasSceneId: stringFrom(episode?.canvasSceneId, workflowEpisodeCanvasSceneId(id)),
    updatedAt,
    sourceName: stringFrom(workflow?.sourceName, ""),
    clipCount: Array.isArray(workflow?.clips) ? workflow.clips.length : 0,
    sceneCount: Array.isArray(workflow?.breakdownScenes) ? workflow.breakdownScenes.length : 0,
  };
}

function workflowEpisodeIdForWorkflow(metadata: unknown, workflow: any): string {
  const title = workflow.selectedEpisode || "第 1 集";
  for (const summary of getWorkflowEpisodeList(metadata).episodes) {
    if (normalizeCompareText(summary.selectedEpisode) === normalizeCompareText(title) || normalizeCompareText(summary.title) === normalizeCompareText(title)) {
      return summary.id;
    }
  }
  return workflowEpisodeIdForTitle(title, "episode-001");
}

function resolveWorkflowEpisodeId(metadata: unknown, episodeIdOrTitle: string): string {
  const requested = episodeIdOrTitle.trim();
  if (!requested) return "";
  const episodes = getWorkflowEpisodes(metadata);
  if (episodes[requested]) return requested;
  if (/^episode(?:-|$)/i.test(requested)) return getActiveWorkflowEpisode(metadata).id;
  const requestedKey = normalizeCompareText(requested);
  for (const summary of getWorkflowEpisodeList(metadata).episodes) {
    if (
      normalizeCompareText(summary.id) === requestedKey ||
      normalizeCompareText(summary.title) === requestedKey ||
      normalizeCompareText(summary.selectedEpisode) === requestedKey
    ) {
      return summary.id;
    }
  }
  return getActiveWorkflowEpisode(metadata).id;
}

function workflowEpisodeIdForTitle(title: string, fallback: string): string {
  const text = title.trim();
  const numberMatch = text.match(/(?:第\s*)?(\d{1,4})\s*(?:集|话|章|回|episode|ep\b)/i) ?? text.match(/(?:episode|ep)\s*0*(\d{1,4})/i);
  if (numberMatch) return `episode-${String(Number(numberMatch[1])).padStart(3, "0")}`;
  const slug = text
    .toLowerCase()
    .replace(/[\u3400-\u9fff]+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug ? `episode-${slug}` : fallback;
}

function uniqueWorkflowEpisodeId(title: string, metadata: unknown): string {
  const episodes = getWorkflowEpisodes(metadata);
  const base = workflowEpisodeIdForTitle(title, `episode-${String(Object.keys(episodes).length + 1).padStart(3, "0")}`);
  if (!episodes[base]) return base;
  for (let index = 2; index < 1000; index += 1) {
    const id = `${base}-${index}`;
    if (!episodes[id]) return id;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function workflowEpisodeCanvasSceneId(episodeId: string): string {
  return episodeId || "default";
}

function episodeSortKey(a: WorkflowEpisodeSummary, b: WorkflowEpisodeSummary): number {
  const aNumber = Number(a.id.match(/episode-(\d+)/)?.[1] ?? Number.NaN);
  const bNumber = Number(b.id.match(/episode-(\d+)/)?.[1] ?? Number.NaN);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) return aNumber - bNumber;
  return a.title.localeCompare(b.title, "zh-Hans-CN");
}

type WorkflowAssetKind = "characters" | "scenes" | "props";
type WorkflowAssetsRecord = {
  characters: Record<string, unknown>[];
  locations: Record<string, unknown>[];
  props: Record<string, unknown>[];
};

const REUSABLE_ASSET_IMAGE_KEYS = [
  "referenceImageUrl",
  "referenceImageAssetId",
  "generatedImageUrl",
  "generatedImageAssetId",
  "visualAuthority",
  "referenceAnalysisStatus",
  "imageAnalysis",
  "generatedImagePrompt",
  "generatedImageRevisedPrompt",
  "generatedImageAt",
  "generationId",
  "imageGenerationModel",
] as const;

async function sanitizeWorkflowDraftAssets(
  projectId: string,
  assets: { characters?: unknown[]; scenes?: unknown[]; props?: unknown[] },
) {
  const normalized: Record<WorkflowAssetKind, unknown[]> = {
    characters: Array.isArray(assets.characters) ? assets.characters : [],
    scenes: Array.isArray(assets.scenes) ? assets.scenes : [],
    props: Array.isArray(assets.props) ? assets.props : [],
  };
  const referencedAssetIds = new Set<string>();
  for (const kind of Object.keys(normalized) as WorkflowAssetKind[]) {
    for (const item of normalized[kind]) {
      if (!isRecord(item)) continue;
      for (const key of ["referenceImageAssetId", "generatedImageAssetId"]) {
        const assetId = stringFrom(item[key], "");
        if (assetId) referencedAssetIds.add(assetId);
      }
    }
  }

  const activeAssets = referencedAssetIds.size > 0
    ? await prisma.asset.findMany({
        where: {
          id: { in: Array.from(referencedAssetIds) },
          projectId,
          deletedAt: null,
        },
        select: { id: true, url: true },
      })
    : [];
  const activeAssetIds = new Set(activeAssets.map((asset: { id: string }) => asset.id));
  const activeAssetUrls = new Map<string, string>(activeAssets.map((asset: { id: string; url: string }) => [asset.id, asset.url]));
  const fallbackImageCandidates = await loadWorkflowAssetImageCandidates(projectId);
  const hasOnlyDeletedImageReferences = (item: unknown) => {
    if (!isRecord(item)) return false;
    const ids = ["referenceImageAssetId", "generatedImageAssetId"]
      .map((key) => stringFrom(item[key], ""))
      .filter(Boolean);
    return ids.length > 0 && !ids.some((id) => activeAssetIds.has(id));
  };
  const hydrateImageUrls = (kind: WorkflowAssetKind, item: unknown) => {
    if (!isRecord(item)) return item;
    const next = { ...item };
    for (const [assetIdKey, urlKey] of [
      ["referenceImageAssetId", "referenceImageUrl"],
      ["generatedImageAssetId", "generatedImageUrl"],
    ] as const) {
      const assetId = stringFrom(next[assetIdKey], "");
      const assetUrl = assetId ? activeAssetUrls.get(assetId) : "";
      const currentUrl = stringFrom(next[urlKey], "");
      if (isReusableWorkflowImageUrl(assetUrl) && !isReusableWorkflowImageUrl(currentUrl)) {
        next[urlKey] = assetUrl;
      }
    }
    if (!isReusableWorkflowImageUrl(stringFrom(next.referenceImageUrl, "")) && !isReusableWorkflowImageUrl(stringFrom(next.generatedImageUrl, ""))) {
      const fallback = findWorkflowAssetImageCandidate(fallbackImageCandidates[kind], workflowAssetDisplayName(next), kind, next);
      if (fallback) {
        next.referenceImageUrl = fallback.url;
        next.referenceImageAssetId = fallback.id;
        next.generatedImageUrl = stringFrom(next.generatedImageUrl, fallback.url);
        next.generatedImageAssetId = stringFrom(next.generatedImageAssetId, fallback.id);
        next.visualAuthority = stringFrom(next.visualAuthority, "latest-project-asset-image");
      }
    }
    return next;
  };
  const keepAndHydrate = (kind: WorkflowAssetKind, item: unknown) => {
    if (!hasOnlyDeletedImageReferences(item)) return true;
    if (kind === "scenes") return true;
    return Boolean(isRecord(item) && findWorkflowAssetImageCandidate(fallbackImageCandidates[kind], workflowAssetDisplayName(item), kind, item));
  };

  return {
    characters: normalized.characters.filter((item) => keepAndHydrate("characters", item)).map((item) => hydrateImageUrls("characters", item)),
    scenes: normalized.scenes.filter((item) => keepAndHydrate("scenes", item)).map((item) => hydrateImageUrls("scenes", item)),
    props: normalized.props.filter((item) => keepAndHydrate("props", item)).map((item) => hydrateImageUrls("props", item)),
  };
}

type WorkflowAssetImageCandidate = {
  id: string;
  name: string;
  url: string;
  canonicalSceneId: string;
};

async function loadWorkflowAssetImageCandidates(projectId: string): Promise<Record<WorkflowAssetKind, WorkflowAssetImageCandidate[]>> {
  const candidates: Record<WorkflowAssetKind, WorkflowAssetImageCandidate[]> = {
    characters: [],
    scenes: [],
    props: [],
  };
  const records = await prisma.asset.findMany({
    where: {
      projectId,
      type: "IMAGE",
      deletedAt: null,
      OR: [
        { url: { startsWith: "http://" } },
        { url: { startsWith: "https://" } },
        { url: { startsWith: "/api/uploads/public/" } },
      ],
    },
    select: {
      id: true,
      url: true,
      metadata: true,
      character: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 800,
  });
  const seen = new Set<string>();
  const push = (kind: WorkflowAssetKind, name: string, id: string, url: string, metadata: Record<string, unknown>) => {
    const normalizedName = normalizeCompareText(name);
    if (!normalizedName || !isReusableWorkflowImageUrl(url)) return;
    const key = `${kind}:${normalizedName}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates[kind].push({ id, name, url, canonicalSceneId: stringFrom(metadata.canonicalSceneId, "") });
  };
  for (const asset of records) {
    const metadata = isRecord(asset.metadata) ? asset.metadata : {};
    const characterName = stringFrom(metadata.characterName, stringFrom(asset.character?.name, ""));
    if (characterName) push("characters", characterName, asset.id, asset.url, metadata);

    const workflowKind = parseWorkflowAssetKind(metadata.workflowAssetKind);
    const assetName = stringFrom(metadata.assetName, "");
    if (workflowKind && assetName) push(workflowKind, assetName, asset.id, asset.url, metadata);
  }
  return candidates;
}

function parseWorkflowAssetKind(value: unknown): WorkflowAssetKind | null {
  return value === "characters" || value === "scenes" || value === "props" ? value : null;
}

function workflowAssetDisplayName(item: Record<string, unknown>): string {
  return stringFrom(item.name ?? item.title, "");
}

function findWorkflowAssetImageCandidate(
  candidates: WorkflowAssetImageCandidate[],
  name: string,
  kind: WorkflowAssetKind,
  targetItem?: Record<string, unknown>,
): WorkflowAssetImageCandidate | undefined {
  const target = normalizeCompareText(name);
  if (!target) return undefined;
  const compatibleCandidates = candidates.filter((candidate) => workflowAssetImageCandidateCompatible(candidate, kind, targetItem));
  return compatibleCandidates.find((candidate) => normalizeCompareText(candidate.name) === target)
    ?? compatibleCandidates.find((candidate) => workflowAssetNamesMatch(kind, candidate.name, name))
    ?? compatibleCandidates.find((candidate) => {
      const candidateName = normalizeCompareText(candidate.name);
      return Boolean(candidateName && (candidateName.includes(target) || target.includes(candidateName)));
    });
}

function workflowAssetImageCandidateCompatible(
  candidate: WorkflowAssetImageCandidate,
  kind: WorkflowAssetKind,
  targetItem?: Record<string, unknown>,
): boolean {
  if (kind !== "scenes") return true;
  const targetCanonicalSceneId = stringFrom(targetItem?.canonicalSceneId, "");
  if (!targetCanonicalSceneId) return false;
  return candidate.canonicalSceneId === targetCanonicalSceneId;
}

function workflowSceneImageMetadata(asset: Record<string, unknown> | undefined): Record<string, unknown> {
  const canonicalSceneId = stringFrom(asset?.canonicalSceneId, "");
  const canonicalSceneName = stringFrom(asset?.canonicalSceneName, stringFrom(asset?.name ?? asset?.title, ""));
  const sceneVisualLock = stringFrom(asset?.sceneVisualLock, "");
  const sceneZone = stringFrom(asset?.sceneZone, "");
  return {
    ...(canonicalSceneId ? { canonicalSceneId } : {}),
    ...(canonicalSceneName ? { canonicalSceneName } : {}),
    ...(sceneVisualLock ? { sceneVisualLock } : {}),
    ...(sceneZone ? { sceneZone } : {}),
  };
}

function workflowSceneImageCompatible(asset: Record<string, unknown> | undefined, imageMetadata: Record<string, unknown>): boolean {
  const targetCanonicalSceneId = stringFrom(asset?.canonicalSceneId, "");
  const imageCanonicalSceneId = stringFrom(imageMetadata.canonicalSceneId, "");
  if (!targetCanonicalSceneId || !imageCanonicalSceneId) return true;
  return targetCanonicalSceneId === imageCanonicalSceneId;
}

function isReusableWorkflowImageUrl(value: unknown): value is string {
  return typeof value === "string" && (/^https?:\/\//i.test(value) || /^\/api\/uploads\/public\//i.test(value));
}

function buildWorkflowAssetReferencePrompt(project: any, assetKind: "characters" | "scenes" | "props", assetName: string): string {
  const settings = isRecord(project.settings) ? project.settings : {};
  const setupSettings = isRecord(settings.setupSettings) ? settings.setupSettings : {};
  return [
    `Project title: ${project.name}`,
    `Project description: ${project.description ?? ""}`,
    `Project global prompt: ${stringFrom(settings.globalPrompt, "")}`,
    `Project setup settings: ${JSON.stringify(setupSettings).slice(0, 4000)}`,
    `Asset kind: ${assetKind}`,
    `Asset name: ${assetName}`,
    "",
    "Return this exact JSON shape:",
    `{"description":"short image-based asset summary","visualPrompt":"short future generation prompt","lockedVisualIdentity":"short immutable visual identity or empty","referencePolicy":"how future prompts should use this image","facts":["short visual facts"],"personality":"character personality or empty","height":"character relative/estimated height or empty","primaryLook":"dominant story look or empty","expressionNotes":"useful character expressions or empty","habitualActions":"signature gestures/actions or empty","variantNotes":"mask/no-mask, gear on/off, clean/damaged, or other state variants or empty","signatureProps":"signature outfit/props or empty","colorPalette":"compact color palette or empty","timeOfDay":"scene time of day or empty","function":"prop/story function or empty"}`,
    "",
    "Rules:",
    "- The uploaded image is the visual authority for this asset.",
    "- Do not invent unconfirmed details.",
    "- Keep every field short and practical for later image/video prompts.",
    "- For characters, identify the visual authority state, useful alternate states, expressions, habitual gestures, and any mask/gear on/off rules visible or strongly implied.",
    "- For scenes, describe geography, mood, lighting, and timeOfDay if visible.",
    "- For props, describe shape, material, usage, and function if visible.",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeWorkflowAssetReferenceAnalysis(rawText: string): Record<string, unknown> {
  const parsed = tryParseModelJson(rawText);
  if (!parsed.ok || !isRecord(parsed.value)) throw new Error("识图模型没有返回 JSON 对象。");
  const value = parsed.value;
  return {
    description: stringFrom(value.description, ""),
    visualPrompt: stringFrom(value.visualPrompt ?? value.prompt, ""),
    lockedVisualIdentity: stringFrom(value.lockedVisualIdentity, ""),
    referencePolicy: stringFrom(value.referencePolicy, ""),
    facts: Array.isArray(value.facts) ? value.facts.map(String).slice(0, 20) : [],
    personality: stringFrom(value.personality, ""),
    height: stringFrom(value.height, ""),
    primaryLook: stringFrom(value.primaryLook, ""),
    expressionNotes: stringFrom(value.expressionNotes, ""),
    habitualActions: stringFrom(value.habitualActions, ""),
    variantNotes: stringFrom(value.variantNotes, ""),
    signatureProps: stringFrom(value.signatureProps, ""),
    colorPalette: stringFrom(value.colorPalette, ""),
    timeOfDay: stringFrom(value.timeOfDay, ""),
    function: stringFrom(value.function, ""),
  };
}

async function syncWorkflowAssetReference(
  project: any,
  assetKind: "characters" | "scenes" | "props",
  assetName: string,
  asset: any,
  analysis: Record<string, unknown> | null,
  analysisError?: string,
  episodeId?: string,
) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${project.id} FOR UPDATE`;
    const currentProject = await tx.project.findUnique({
      where: { id: project.id },
      select: { metadata: true },
    });
    const metadata = isRecord(currentProject?.metadata) ? currentProject.metadata : {};
    const workflow = getWorkflowState(metadata, episodeId);
    const assets = isRecord(workflow.assets) ? workflow.assets : defaultAssets();
    const rawItems: unknown[] = Array.isArray(assets[assetKind]) ? assets[assetKind] : [];
    const currentItems = rawItems.filter((item: unknown): item is Record<string, unknown> => isRecord(item));
    const assetKey = normalizeCompareText(assetName);
    const existingIndex = currentItems.findIndex((item) => normalizeCompareText(stringFrom(item.name ?? item.title, "")) === assetKey);
    const existing = existingIndex >= 0 ? currentItems[existingIndex] : {};
    const nextItem = {
      ...existing,
      id: stringFrom(existing.id, asset.id),
      name: stringFrom(existing.name ?? existing.title, assetName),
      title: stringFrom(existing.title, assetName),
      description: stringFrom(analysis?.description, stringFrom(existing.description, "")),
      visualPrompt: stringFrom(analysis?.visualPrompt, stringFrom(existing.visualPrompt, "")),
      lockedVisualIdentity: stringFrom(analysis?.lockedVisualIdentity, stringFrom(existing.lockedVisualIdentity, "")),
      referencePolicy: stringFrom(analysis?.referencePolicy, stringFrom(existing.referencePolicy, "")),
      referenceImageUrl: stringFrom(asset.url, stringFrom(existing.referenceImageUrl, "")),
      referenceImageAssetId: asset.id,
      visualAuthority: "uploaded-reference-image",
      referenceAnalysisStatus: analysis ? "succeeded" : "failed",
      imageAnalysis: analysis ?? undefined,
      ...(analysis?.personality ? { personality: analysis.personality } : {}),
      ...(analysis?.height ? { height: analysis.height } : {}),
      ...(analysis?.primaryLook ? { primaryLook: analysis.primaryLook } : {}),
      ...(analysis?.expressionNotes ? { expressionNotes: analysis.expressionNotes } : {}),
      ...(analysis?.habitualActions ? { habitualActions: analysis.habitualActions } : {}),
      ...(analysis?.variantNotes ? { variantNotes: analysis.variantNotes } : {}),
      ...(analysis?.signatureProps ? { signatureProps: analysis.signatureProps } : {}),
      ...(analysis?.colorPalette ? { colorPalette: analysis.colorPalette } : {}),
      ...(analysis?.timeOfDay ? { timeOfDay: analysis.timeOfDay } : {}),
      ...(analysis?.function ? { function: analysis.function } : {}),
      ...(analysisError ? { referenceAnalysisError: analysisError } : {}),
    };
    const nextItems =
      existingIndex >= 0
        ? currentItems.map((item: Record<string, unknown>, index: number) => (index === existingIndex ? nextItem : item))
        : [nextItem, ...currentItems];
    const nextWorkflow = {
      ...workflow,
      activeStage: "assets",
      assets: {
        characters: Array.isArray(assets.characters) ? assets.characters : [],
        scenes: Array.isArray(assets.scenes) ? assets.scenes : [],
        props: Array.isArray(assets.props) ? assets.props : [],
        [assetKind]: nextItems,
      },
      stageStatuses: {
        ...workflow.stageStatuses,
        assets: "done",
      },
      updatedAt: new Date().toISOString(),
    };

    const targetEpisodeId = episodeId || workflowEpisodeIdForWorkflow(metadata, nextWorkflow);
    const nextMetadata = writeWorkflowEpisode(metadata, targetEpisodeId, nextWorkflow, true);
    const currentImageUrl = stringFrom(nextItem.referenceImageUrl, "");
    const canvasImageUrl = canvasSyncableImageUrl(currentImageUrl);
    let finalMetadata = nextMetadata;
    if (canvasImageUrl) {
      const filledMetadata = fillMissingAssetImageAcrossEpisodes(nextMetadata, { assetKind, assetName, field: "referenceImageUrl", imageUrl: currentImageUrl, imageAssetId: asset.id }).metadata;
      finalMetadata = applyWorkflowAssetImageToCanvasScenes(filledMetadata, { assetKind, assetName, imageUrl: canvasImageUrl, imageAssetId: asset.id, episodeId: targetEpisodeId }, nextWorkflow.updatedAt).metadata;
    }
    await tx.project.update({
      where: { id: project.id },
      data: { metadata: finalMetadata as Prisma.InputJsonValue },
    });

    return { ...nextWorkflow, episodeId: targetEpisodeId, episodes: getWorkflowEpisodeList(finalMetadata) };
  }, WORKFLOW_METADATA_TRANSACTION_OPTIONS);
}

async function syncWorkflowGeneratedAssetImage(
  project: any,
  assetKind: "characters" | "scenes" | "props",
  assetName: string,
  asset: any,
  generation: {
    prompt: string;
    generationId: string;
    model: Record<string, unknown>;
    revisedPrompt?: string;
    visualConflictWarning?: string;
  },
  episodeId?: string,
) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${project.id} FOR UPDATE`;
    const currentProject = await tx.project.findUnique({
      where: { id: project.id },
      select: { metadata: true },
    });
    const metadata = isRecord(currentProject?.metadata) ? currentProject.metadata : {};
    const workflow = getWorkflowState(metadata, episodeId);
    const assets = isRecord(workflow.assets) ? workflow.assets : defaultAssets();
    const rawItems: unknown[] = Array.isArray(assets[assetKind]) ? assets[assetKind] : [];
    const currentItems = rawItems.filter((item: unknown): item is Record<string, unknown> => isRecord(item));
    const assetKey = normalizeCompareText(assetName);
    const existingIndex = currentItems.findIndex((item) => normalizeCompareText(stringFrom(item.name ?? item.title, "")) === assetKey);
    const existing = existingIndex >= 0 ? currentItems[existingIndex] : {};
    const nextItem = {
      ...existing,
      id: stringFrom(existing.id, asset.id),
      name: stringFrom(existing.name ?? existing.title, assetName),
      title: stringFrom(existing.title, assetName),
      visualPrompt: cleanWorkflowAssetPromptSeed(existing.visualPrompt),
      referenceImageUrl: asset.url,
      referenceImageAssetId: asset.id,
      generatedImageUrl: asset.url,
      generatedImageAssetId: asset.id,
      generatedImagePrompt: generation.prompt,
      generatedImageRevisedPrompt: generation.revisedPrompt,
      ...(assetKind === "scenes" ? { visualConflictWarning: generation.visualConflictWarning ?? "" } : {}),
      generatedImageAt: new Date().toISOString(),
      generationId: generation.generationId,
      imageGenerationModel: generation.model,
      visualAuthority: "generated-asset-image",
      referenceAnalysisStatus: "generated",
    };
    const nextItems =
      existingIndex >= 0
        ? currentItems.map((item: Record<string, unknown>, index: number) => (index === existingIndex ? nextItem : item))
        : [nextItem, ...currentItems];
    const nextWorkflow = {
      ...workflow,
      activeStage: "assets",
      assets: {
        characters: Array.isArray(assets.characters) ? assets.characters : [],
        scenes: Array.isArray(assets.scenes) ? assets.scenes : [],
        props: Array.isArray(assets.props) ? assets.props : [],
        [assetKind]: nextItems,
      },
      stageStatuses: {
        ...workflow.stageStatuses,
        assets: "done",
      },
      updatedAt: new Date().toISOString(),
    };

    const targetEpisodeId = episodeId || workflowEpisodeIdForWorkflow(metadata, nextWorkflow);
    const nextMetadata = writeWorkflowEpisode(metadata, targetEpisodeId, nextWorkflow, true);
    const currentImageUrl = stringFrom(nextItem.referenceImageUrl, "") || stringFrom(nextItem.generatedImageUrl, "");
    const canvasImageUrl = canvasSyncableImageUrl(currentImageUrl);
    let finalMetadata = nextMetadata;
    if (canvasImageUrl) {
      const filledMetadata = fillMissingAssetImageAcrossEpisodes(nextMetadata, { assetKind, assetName, field: "generatedImageUrl", imageUrl: currentImageUrl, imageAssetId: asset.id }).metadata;
      finalMetadata = applyWorkflowAssetImageToCanvasScenes(filledMetadata, { assetKind, assetName, imageUrl: canvasImageUrl, imageAssetId: asset.id, episodeId: targetEpisodeId }, nextWorkflow.updatedAt).metadata;
    }
    await tx.project.update({
      where: { id: project.id },
      data: { metadata: finalMetadata as Prisma.InputJsonValue },
    });

    return { ...nextWorkflow, episodeId: targetEpisodeId, episodes: getWorkflowEpisodeList(finalMetadata) };
  }, WORKFLOW_METADATA_TRANSACTION_OPTIONS);
}

async function syncWorkflowSelectedAssetImage(
  project: any,
  assetKind: "characters" | "scenes" | "props",
  assetName: string,
  asset: any,
  episodeId?: string,
) {
  const metadata = isRecord(project.metadata) ? project.metadata : {};
  const workflow = getWorkflowState(metadata, episodeId);
  const assets = isRecord(workflow.assets) ? workflow.assets : defaultAssets();
  const rawItems: unknown[] = Array.isArray(assets[assetKind]) ? assets[assetKind] : [];
  const currentItems = rawItems.filter((item: unknown): item is Record<string, unknown> => isRecord(item));
  const assetKey = normalizeCompareText(assetName);
  const existingIndex = currentItems.findIndex((item) => normalizeCompareText(stringFrom(item.name ?? item.title, "")) === assetKey);
  const existing = existingIndex >= 0 ? currentItems[existingIndex] : {};
  const metadataRecord = isRecord(asset.metadata) ? asset.metadata : {};
  const nextItem = {
    ...existing,
    id: stringFrom(existing.id, asset.id),
    name: stringFrom(existing.name ?? existing.title, assetName),
    title: stringFrom(existing.title, assetName),
    referenceImageUrl: asset.url,
    referenceImageAssetId: asset.id,
    generatedImageUrl: asset.url,
    generatedImageAssetId: asset.id,
    generatedImagePrompt: stringFrom(metadataRecord.prompt, stringFrom(existing.generatedImagePrompt, "")),
    selectedImageAt: new Date().toISOString(),
    visualAuthority: "selected-asset-history-image",
    referenceAnalysisStatus: stringFrom(metadataRecord.analysisStatus, stringFrom(existing.referenceAnalysisStatus, "selected")),
  };
  const nextItems =
    existingIndex >= 0
      ? currentItems.map((item: Record<string, unknown>, index: number) => (index === existingIndex ? nextItem : item))
      : [nextItem, ...currentItems];
  const nextWorkflow = {
    ...workflow,
    activeStage: "assets",
    assets: {
      characters: Array.isArray(assets.characters) ? assets.characters : [],
      scenes: Array.isArray(assets.scenes) ? assets.scenes : [],
      props: Array.isArray(assets.props) ? assets.props : [],
      [assetKind]: nextItems,
    },
    stageStatuses: {
      ...workflow.stageStatuses,
      assets: "done",
    },
    updatedAt: new Date().toISOString(),
  };

  const targetEpisodeId = episodeId || workflowEpisodeIdForWorkflow(metadata, nextWorkflow);
  const nextMetadata = writeWorkflowEpisode(metadata, targetEpisodeId, nextWorkflow, true);
  const currentImageUrl = stringFrom(nextItem.referenceImageUrl, "") || stringFrom(nextItem.generatedImageUrl, "");
  const canvasImageUrl = canvasSyncableImageUrl(currentImageUrl);
  let finalMetadata = nextMetadata;
  if (canvasImageUrl) {
    const filledMetadata = fillMissingAssetImageAcrossEpisodes(nextMetadata, { assetKind, assetName, field: "generatedImageUrl", imageUrl: currentImageUrl, imageAssetId: asset.id }).metadata;
    finalMetadata = applyWorkflowAssetImageToCanvasScenes(filledMetadata, { assetKind, assetName, imageUrl: canvasImageUrl, imageAssetId: asset.id, episodeId: targetEpisodeId, force: true }, nextWorkflow.updatedAt).metadata;
  }
  await prisma.project.update({
    where: { id: project.id },
    data: { metadata: finalMetadata },
  });

  return { ...nextWorkflow, episodeId: targetEpisodeId, episodes: getWorkflowEpisodeList(finalMetadata) };
}

async function clearWorkflowAssetCurrentImage(
  project: any,
  assetKind: "characters" | "scenes" | "props",
  assetName: string,
  episodeId?: string,
) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${project.id} FOR UPDATE`;
    const currentProject = await tx.project.findUnique({
      where: { id: project.id },
      select: { metadata: true },
    });
    const metadata = isRecord(currentProject?.metadata) ? currentProject.metadata : {};
    const workflow = getWorkflowState(metadata, episodeId);
    const assets = isRecord(workflow.assets) ? workflow.assets : defaultAssets();
    const rawItems: unknown[] = Array.isArray(assets[assetKind]) ? assets[assetKind] : [];
    const currentItems = rawItems.filter((item: unknown): item is Record<string, unknown> => isRecord(item));
    const assetKey = normalizeCompareText(assetName);
    let cleared = false;
    const nextItems = currentItems.map((item: Record<string, unknown>) => {
      if (normalizeCompareText(stringFrom(item.name ?? item.title, "")) !== assetKey) return item;
      const next = { ...item };
      for (const key of [
        "referenceImageUrl",
        "referenceImageAssetId",
        "generatedImageUrl",
        "generatedImageAssetId",
        "generatedImagePrompt",
        "generatedImageRevisedPrompt",
        "selectedImageAt",
        "generatedImageAt",
        "generationId",
        "imageGenerationModel",
      ]) {
        delete next[key];
      }
      delete next.visualAuthority;
      cleared = true;
      return next;
    });
    const nextWorkflow = {
      ...workflow,
      activeStage: "assets",
      assets: {
        characters: Array.isArray(assets.characters) ? assets.characters : [],
        scenes: Array.isArray(assets.scenes) ? assets.scenes : [],
        props: Array.isArray(assets.props) ? assets.props : [],
        [assetKind]: nextItems,
      },
      stageStatuses: {
        ...workflow.stageStatuses,
        assets: "done",
      },
      updatedAt: new Date().toISOString(),
    };
    const targetEpisodeId = episodeId || workflowEpisodeIdForWorkflow(metadata, nextWorkflow);
    const nextMetadata = writeWorkflowEpisode(metadata, targetEpisodeId, nextWorkflow, true);
    const finalMetadata = applyWorkflowAssetImageToCanvasScenes(nextMetadata, { assetKind, assetName, imageUrl: "", imageAssetId: "", episodeId: targetEpisodeId }, nextWorkflow.updatedAt).metadata;
    if (cleared) {
      await tx.project.update({
        where: { id: project.id },
        data: { metadata: finalMetadata as Prisma.InputJsonValue },
      });
    }
    return { ...nextWorkflow, episodeId: targetEpisodeId, episodes: getWorkflowEpisodeList(cleared ? finalMetadata : metadata) };
  });
}

function findWorkflowAssetItem(assets: unknown, assetKind: "characters" | "scenes" | "props", assetName: string): Record<string, unknown> | undefined {
  const record = isRecord(assets) ? assets : {};
  const items = Array.isArray(record[assetKind]) ? record[assetKind] : [];
  return items.find((item): item is Record<string, unknown> => {
    if (!isRecord(item)) return false;
    return workflowAssetItemMatchesName(item, assetKind, assetName);
  });
}

function matchesWorkflowAssetImage(asset: any, assetKind: "characters" | "scenes" | "props", assetName: string): boolean {
  const metadata = isRecord(asset.metadata) ? asset.metadata : {};
  if (assetKind === "characters") {
    const characterName = stringFrom(metadata.characterName, "");
    if (characterName && workflowAssetNamesMatch(assetKind, characterName, assetName)) return true;
  }
  const workflowKind = stringFrom(metadata.workflowAssetKind, "");
  const metadataName = stringFrom(metadata.assetName, "");
  return workflowKind === assetKind && Boolean(metadataName) && workflowAssetNamesMatch(assetKind, metadataName, assetName);
}

function workflowAssetHistoryRecordsForAsset(
  currentAsset: Record<string, unknown> | undefined,
  assetKind: "characters" | "scenes" | "props",
  assetName: string,
  records: any[],
): any[] {
  const currentAssetIds = new Set([
    stringFrom(currentAsset?.referenceImageAssetId, ""),
    stringFrom(currentAsset?.generatedImageAssetId, ""),
  ].filter(Boolean));
  const currentUrls = new Set([
    stringFrom(currentAsset?.referenceImageUrl, ""),
    stringFrom(currentAsset?.generatedImageUrl, ""),
  ].filter(Boolean));

  return records.filter((asset: any) => {
    if (currentAssetIds.has(asset.id)) return true;
    if (currentUrls.has(stringFrom(asset.url, ""))) return true;
    return matchesWorkflowAssetImage(asset, assetKind, assetName);
  });
}

function workflowAssetCurrentRecordFilters(currentAsset: Record<string, unknown> | undefined): Prisma.AssetWhereInput[] {
  const ids = [
    stringFrom(currentAsset?.referenceImageAssetId, ""),
    stringFrom(currentAsset?.generatedImageAssetId, ""),
  ].filter(Boolean);
  const urls = [
    stringFrom(currentAsset?.referenceImageUrl, ""),
    stringFrom(currentAsset?.generatedImageUrl, ""),
  ].filter(Boolean);
  const filters: Prisma.AssetWhereInput[] = [];
  if (ids.length > 0) filters.push({ id: { in: Array.from(new Set(ids)) } });
  if (urls.length > 0) filters.push({ url: { in: Array.from(new Set(urls)) } });
  return filters;
}

function mergeAssetRecordsById(...recordGroups: any[][]): any[] {
  const merged = new Map<string, any>();
  for (const records of recordGroups) {
    for (const record of records) {
      const id = stringFrom(record?.id, "");
      if (!id || merged.has(id)) continue;
      merged.set(id, record);
    }
  }
  return Array.from(merged.values());
}

function workflowAssetImageHistoryItem(asset: any, currentAssetIds: Set<string>, currentUrls: Set<string>) {
  const metadata = isRecord(asset.metadata) ? asset.metadata : {};
  const generation = isRecord(asset.generation) ? asset.generation : undefined;
  const model = isRecord(metadata.model) ? metadata.model : {};
  const metadataParameters = isRecord(metadata.parameters) ? metadata.parameters : {};
  const generationInput = isRecord(generation?.input) ? generation.input : {};
  const generationParameters = isRecord(generation?.parameters) ? generation.parameters : {};
  const parameters = Object.keys(metadataParameters).length > 0 ? metadataParameters : generationParameters;
  const referenceImageUrls = Array.isArray(metadata.referenceImageUrls)
    ? metadata.referenceImageUrls
    : Array.isArray(generationInput.referenceImageUrls)
      ? generationInput.referenceImageUrls
      : [];
  const durationMsRaw = metadata.durationMs;
  const durationMs = typeof durationMsRaw === "number" && Number.isFinite(durationMsRaw) ? durationMsRaw : undefined;
  return {
    id: asset.id,
    url: asset.url,
    title: stringFrom(asset.title, "资产图片"),
    source: stringFrom(metadata.source, asset.generationId ? "generated" : "uploaded"),
    prompt: stringFrom(metadata.prompt, stringFrom(generation?.prompt, "")),
    revisedPrompt: stringFrom(metadata.revisedPrompt, ""),
    modelId: stringFrom(model.id, stringFrom(generation?.aiModelId, "")),
    modelLabel: stringFrom(model.displayName, stringFrom(model.model, "")),
    modelProvider: stringFrom(model.provider, ""),
    size: stringFrom(metadata.size, stringFrom(generationInput.size, "")),
    resolution: stringFrom(parameters.resolution, ""),
    quality: stringFrom(parameters.quality, ""),
    referenceImageCount: referenceImageUrls.length,
    variant: stringFrom(metadata.variant, stringFrom(generationInput.variant, "")),
    durationMs,
    status: stringFrom(generation?.status, ""),
    createdAt: asset.createdAt instanceof Date ? asset.createdAt.toISOString() : String(asset.createdAt ?? ""),
    generationId: stringFrom(asset.generationId, ""),
    isCurrent: currentAssetIds.has(asset.id) || currentUrls.has(asset.url),
  };
}

function collectWorkflowAssetReferenceUrls(
  existingAsset: Record<string, unknown> | undefined,
  input: z.infer<typeof workflowAssetImageGenerationSchema>,
): string[] {
  const requested = Array.isArray(input.referenceImageUrls) ? input.referenceImageUrls : [];
  const current = input.useCurrentReference
    ? [
        stringFrom(existingAsset?.referenceImageUrl, ""),
        stringFrom(existingAsset?.generatedImageUrl, ""),
      ]
    : [];
  const seen = new Set<string>();
  return [...requested, ...current]
    .map((url) => url.trim())
    .filter((url) => /^https?:\/\//i.test(url))
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .slice(0, 16);
}

function workflowAssetHasUsableImage(asset: unknown): boolean {
  if (!isRecord(asset)) return false;
  return isReusableWorkflowImageUrl(stringFrom(asset.referenceImageUrl, "")) || isReusableWorkflowImageUrl(stringFrom(asset.generatedImageUrl, ""));
}

function workflowAssetDisplayNameForReadiness(asset: unknown): string {
  if (!isRecord(asset)) return "未命名资产";
  return stringFrom(asset.name, stringFrom(asset.title, "未命名资产"));
}

function workflowAssetImageReadinessForServer(assets: unknown): {
  ready: boolean;
  total: number;
  withImage: number;
  missing: string[];
} {
  const record = isRecord(assets) ? assets : {};
  const missing: string[] = [];
  let total = 0;
  let withImage = 0;
  for (const kind of ["characters", "scenes", "props"] as const) {
    for (const asset of arrayFrom(record[kind])) {
      const name = workflowAssetDisplayNameForReadiness(asset);
      if (!name) continue;
      total += 1;
      if (workflowAssetHasUsableImage(asset)) {
        withImage += 1;
      } else {
        missing.push(name);
      }
    }
  }
  return { ready: total > 0 && missing.length === 0, total, withImage, missing };
}

function ensureWorkflowAssetsExtractedForStoryboard(assets: unknown): void {
  const readiness = workflowAssetImageReadinessForServer(assets);
  if (readiness.total > 0) return;
  badRequest("请先提取角色、场景、道具资产后再拆分镜。资产图可以按需要补充，不是拆分镜硬门槛。");
}

function inferConcreteFruitIdentity(assetName: string, asset: Record<string, unknown> | undefined): string {
  const explicit = stringFrom(asset?.fruitIdentity, "");
  if (explicit) return explicit;
  const text = [
    assetName,
    stringFrom(asset?.name, ""),
    stringFrom(asset?.title, ""),
    stringFrom(asset?.role, ""),
    stringFrom(asset?.description, ""),
    stringFrom(asset?.visualPrompt, ""),
    stringFrom(asset?.lockedVisualIdentity, ""),
  ].join("\n").toLowerCase();
  if (isGroupAssetText(text)) return "mixed random fruit crowd";
  const rules: Array<[RegExp, string]> = [
    [/(chloe|peach|水蜜桃|桃)/i, "peach"],
    [/(leo|lemon|柠檬)/i, "lemon"],
    [/(bob|orange|soldier|gas mask|橙|橙子|士兵|防毒面具)/i, "orange"],
    [/(tiffany|beauty|glam|ceo|boss|美妆|老板|反派)/i, "dragon fruit"],
    [/(eugene|timid|scared|nervous|害怕|胆小|紧张)/i, "pear"],
    [/(scientist|lab|实验|科学)/i, "kiwi"],
    [/(guard|security|保安|守卫)/i, "pineapple"],
    [/(strawberry|草莓)/i, "strawberry"],
    [/(banana|香蕉)/i, "banana"],
    [/(watermelon|西瓜)/i, "watermelon"],
    [/(mango|芒果)/i, "mango"],
    [/(apple|苹果)/i, "apple"],
    [/(grape|葡萄)/i, "grape cluster"],
    [/(pear|梨)/i, "pear"],
    [/(pineapple|菠萝)/i, "pineapple"],
    [/(kiwi|猕猴桃)/i, "kiwi"],
  ];
  const matched = rules.find(([pattern]) => pattern.test(text));
  if (matched) return matched[1];
  const choices = ["apple", "orange", "lemon", "pear", "peach", "grape cluster", "pineapple", "mango", "kiwi", "strawberry", "watermelon"];
  const seed = Array.from(assetName || "character").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return choices[seed % choices.length];
}

function isGroupAssetText(value: string): boolean {
  return /(zombies?|undead|corpse|crowd|group|mob|victims?|background|extras?|群像|背景|群众|人群|一群|丧尸|僵尸|亡灵|受害者)/i.test(value);
}

function isMixedRandomFruitIdentity(value: string): boolean {
  return /mixed random fruit crowd/i.test(value);
}

function promptHasConcreteFruitIdentity(prompt: string, expectedFruitIdentity: string): boolean {
  if (expectedFruitIdentity && prompt.toLowerCase().includes(expectedFruitIdentity.toLowerCase())) return true;
  return /(banana|apple|orange|lemon|grape|strawberry|pineapple|peach|pear|mango|kiwi|watermelon|dragon fruit|橙子|橙|柠檬|葡萄|草莓|菠萝|水蜜桃|桃|梨|芒果|猕猴桃|西瓜|火龙果|香蕉|苹果)/i.test(prompt);
}

function looksLikeWorkflowAssetFinalPrompt(value: unknown): boolean {
  const text = typeof value === "string" ? value : "";
  return (
    text.includes("Project authority:") ||
    text.includes("User final prompt:") ||
    text.includes("Asset kind: characters") ||
    text.includes("Asset kind: scenes") ||
    text.includes("Asset kind: props") ||
    text.includes("Create a clean character production reference sheet") ||
    text.includes("Create a clean scene/location production reference image") ||
    text.includes("Create a clean prop production reference image")
  );
}

function hasNestedWorkflowAssetFinalPrompt(value: string): boolean {
  return /User\/asset prompt to preserve:\s*(Project authority:|Asset kind:|Style:)/i.test(value) || value.split("Project authority:").length > 2;
}

function hasLegacyWorkflowAssetPromptScaffold(value: unknown): boolean {
  const text = typeof value === "string" ? value : "";
  return /Project authority:|Scene visual authority:|Character identity rules:|Project global settings authority:|Script rules:|Scene visual style:|Style notes:|Negative constraints:/i.test(text);
}

function stripLegacyWorkflowAssetPromptScaffold(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (!hasLegacyWorkflowAssetPromptScaffold(text)) return stripRedundantWorkflowAssetPromptLines(text);
  return "";
}

function stripRedundantWorkflowAssetPromptLines(value: string): string {
  return value
    .split("\n")
    .filter((line) => !/^(Style details|Style notes|Scene visual authority|Project title|Scene visual style|Negative constraints)\s*:/i.test(line.trim()))
    .filter((line) => !/Keep the project visual style consistent with the scene visual authority above/i.test(line.trim()))
    .join("\n")
    .trim();
}

function cleanWorkflowAssetPromptSeed(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || looksLikeWorkflowAssetFinalPrompt(text)) return "";
  return text;
}

function ensureWorkflowAssetPromptAuthority(
  project: any,
  assetKind: "characters" | "scenes" | "props",
  assetName: string,
  asset: Record<string, unknown> | undefined,
  finalPrompt: string,
  referenceImageCount = 0,
): string {
  const prompt = stripLegacyWorkflowAssetPromptScaffold(finalPrompt) || finalPrompt.trim();
  if (!prompt) return prompt;
  if (hasNestedWorkflowAssetFinalPrompt(prompt)) {
    return buildWorkflowAssetImagePrompt(project, assetKind, assetName, asset, undefined, referenceImageCount);
  }
  const settings = isRecord(project.settings) ? project.settings : {};
  const setupSettings = isRecord(settings.setupSettings) ? settings.setupSettings : {};
  const globalPrompt = stringFrom(settings.globalPrompt, stringFrom(setupSettings.globalPrompt, "")) ?? "";
  const characterIdentityRules = stringFrom(
    setupSettings.characterIdentityRules,
    firstLineAfterLabel(globalPrompt, "Character identity rules:") ?? "",
  );
  const explicitFruitIdentity = stringFrom(asset?.fruitIdentity, "");
  const projectRequiresFruit = requiresSpecificFruitIdentityText(characterIdentityRules) || requiresSpecificFruitIdentityText(globalPrompt);
  const fruitRequired =
    assetKind === "characters" &&
    (Boolean(explicitFruitIdentity) || projectRequiresFruit);
  const fruitIdentity = fruitRequired ? inferConcreteFruitIdentity(assetName, asset) : "";
  const promptHasRequiredFruitContext = !fruitRequired || promptHasConcreteFruitIdentity(prompt, fruitIdentity);
  if (promptHasRequiredFruitContext && !hasLegacyWorkflowAssetPromptScaffold(prompt)) return prompt;
  const mixedFruitGroup = isMixedRandomFruitIdentity(fruitIdentity);
  const stylePrompt = sceneStylePromptFromGlobalPrompt(globalPrompt).replace(/^(base style|global prompt|visual style|style|look|render|lighting|cinematic|quality)\s*:\s*/gim, "").trim();
  const promptWithoutLegacyScaffold = prompt
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !/^(Project authority|Scene visual authority|Project title|Project description|Project global prompt|Project visual style|Scene visual style|Style notes|Character identity rules|Project global settings authority|Script rules|Negative constraints)\s*:/i.test(line))
    .filter((line) => !/Keep the project visual style consistent with the scene visual authority above/i.test(line))
    .join("\n")
    .trim();
  const imagePromptLines = [
    stylePrompt ? `Style: ${stylePrompt}` : "",
    fruitRequired
      ? mixedFruitGroup
        ? "Visual identity: all visible characters are anthropomorphic fruit; use a varied mixed fruit crowd with clear fruit anatomy/material cues."
        : `Visual identity: unmistakable anthropomorphic ${fruitIdentity}; not a normal human, animal, generic zombie, or non-fruit monster. Make the ${fruitIdentity} identity readable in the silhouette, surface texture, and color palette.`
      : "",
    referenceImageCount > 0 ? `Reference images supplied to the image model: ${referenceImageCount}. Use them as visual continuity references and do not contradict them.` : "",
    "",
    promptWithoutLegacyScaffold || prompt,
  ].filter(Boolean);
  return imagePromptLines.join("\n");
}

function sceneVisualConflictWarning(bible: SceneVisualBible | undefined, candidatePrompt: string): string {
  if (!bible) return "";
  const conflict = detectSceneVisualConflict(bible, candidatePrompt);
  if (conflict.pass) return "";
  return `视觉连续性风险：当前提示词可能偏离 ${bible.canonicalName} 的场景视觉身份；${conflict.reasons.join("；")}。请保持同一时间、色调、建筑类型、材质语言和固定地标。`;
}

function buildWorkflowAssetImagePrompt(
  project: any,
  assetKind: "characters" | "scenes" | "props",
  assetName: string,
  asset: Record<string, unknown> | undefined,
  promptOverride?: string,
  referenceImageCount = 0,
): string {
  const settings = isRecord(project.settings) ? project.settings : {};
  const setupSettings = isRecord(settings.setupSettings) ? settings.setupSettings : {};
  const userPrompt = cleanWorkflowAssetPromptSeed(promptOverride);
  const globalPrompt = stringFrom(settings.globalPrompt, stringFrom(setupSettings.globalPrompt, "")) ?? "";
  const sceneStylePrompt = sceneStylePromptFromGlobalPrompt(globalPrompt);
  const characterIdentityRules = stringFrom(
    setupSettings.characterIdentityRules,
    firstLineAfterLabel(globalPrompt, "Character identity rules:") ?? "",
  );
  const explicitFruitIdentity = stringFrom(asset?.fruitIdentity, "");
  const projectRequiresFruit = requiresSpecificFruitIdentityText(characterIdentityRules) || requiresSpecificFruitIdentityText(globalPrompt);
  const fruitRequired =
    assetKind === "characters" &&
    (Boolean(explicitFruitIdentity) || projectRequiresFruit);
  const fruitIdentity = fruitRequired ? inferConcreteFruitIdentity(assetName, asset) : "";
  const mixedFruitGroup = isMixedRandomFruitIdentity(fruitIdentity);
  const assetFacts = asset ? JSON.stringify(assetKind === "scenes" ? {
    name: asset.name ?? asset.title,
    description: asset.description,
    visualPrompt: cleanWorkflowAssetPromptSeed(asset.visualPrompt),
    timeOfDay: asset.timeOfDay,
    sceneZone: asset.sceneZone,
    sceneAnchors: asset.sceneAnchors,
    referencePolicy: asset.referencePolicy,
  } : {
    name: asset.name ?? asset.title,
    role: asset.role,
    description: asset.description,
    visualPrompt: cleanWorkflowAssetPromptSeed(asset.visualPrompt),
    fruitIdentity: asset.fruitIdentity,
    personality: asset.personality,
    height: asset.height,
    primaryLook: asset.primaryLook,
    expressionNotes: asset.expressionNotes,
    habitualActions: asset.habitualActions,
    variantNotes: asset.variantNotes,
    signatureProps: asset.signatureProps,
    boundPropNames: boundPropNamesFromRecord(asset),
    colorPalette: asset.colorPalette,
    lockedVisualIdentity: cleanWorkflowAssetPromptSeed(asset.lockedVisualIdentity),
    referencePolicy: asset.referencePolicy,
    timeOfDay: asset.timeOfDay,
    function: asset.function,
  }) : "";
  const sceneVisualLock = assetKind === "scenes" ? cleanWorkflowPublicText(stringFrom(asset?.sceneVisualLock, "")) : "";
  const characterVariant = /Character image variant:\s*with signature carried props/i.test(userPrompt) ? "with-props" : "clean";
  const hasManualBoundProps = Boolean(asset && Array.isArray(asset.boundPropNames));
  const manualBoundProps = asset ? boundPropNamesFromRecord(asset) : [];
  const carriedProps =
    assetKind === "characters" && characterVariant === "with-props"
      ? hasManualBoundProps
        ? manualBoundProps.slice(0, 4)
        : mergeBoundPropNames(extractSignaturePropNames([
            stringFrom(asset?.signatureProps, ""),
            stringFrom(asset?.primaryLook, ""),
            stringFrom(asset?.habitualActions, ""),
            stringFrom(asset?.description, ""),
            stringFrom(asset?.visualPrompt, ""),
            stringFrom(asset?.lockedVisualIdentity, ""),
            userPrompt,
          ].filter(Boolean).join(", "))).slice(0, 4)
      : [];
  const carriedPropText = carriedProps.join(", ");
  const kindRule =
    assetKind === "characters"
      ? [
          "Create a clean character production reference sheet, like a professional animation character bible page.",
          "Mandatory layout: one single wide clean sheet.",
          characterVariant === "with-props"
            ? "Upper main section should occupy most of the image and show the character body clearly. Keep the face and silhouette unobstructed, but include the character's signature carried prop when one is known."
            : "Upper main section should occupy most of the image and must show the character body only, with no loose story props or held objects.",
          "Upper-left: large face close-up / head bust for the primary look, natural neutral expression, unobstructed face. Add a small clean printed info block for character name and personality.",
          characterVariant === "with-props"
            ? "Upper-right: three full-body turnaround views of the same primary look: front view, side view, and back or three-quarter rear view. At least one full-body view should show the character naturally holding or carrying their signature prop when listed. Add a simple inferred height ruler / height marker beside the turnaround views."
            : "Upper-right: three full-body turnaround views of the same primary look: front view, side view, and back or three-quarter rear view. Use natural neutral expressions and unobstructed full-body silhouettes. Add a simple inferred height ruler / height marker beside the turnaround views.",
          characterVariant === "with-props"
            ? carriedPropText
              ? `Draw these personal props with the character for video continuity: ${carriedPropText}. Keep owner + prop together and make scale/handling readable.`
              : "If no signature carried prop is known, do not invent a loose handheld prop."
            : "Do not draw pillows, handheld weapons, bags, furniture, food, tools, or other standalone props in the clean base reference. Prop-bearing variants can be generated separately.",
          "Wearable identity gear is allowed when attached to the body or worn by the character, such as a mask, helmet, armor, uniform, glasses, or backpack.",
          characterVariant === "with-props"
            ? "Lower reference strip: add compact supplemental panels for useful facial expressions, habitual body gestures, important story-state variants, and one action pose with the signature prop if it exists."
            : "Lower reference strip: add compact supplemental panels for useful facial expressions, habitual body gestures, and important story-state variants. These panels should still keep the character unobstructed and should not introduce standalone props.",
          "If the character commonly wears a mask, helmet, armor, or other long-term gear, use that dominant story state in the upper main section. Put the no-mask / gear-off variant in the lower reference strip for scenes that require it.",
          characterVariant === "with-props"
            ? "If no alternate state is known, use the lower strip for expression poses, hand gestures, posture habits, prop-holding pose when relevant, and key silhouette details."
            : "If no alternate state is known, use the lower strip for expression poses, hand gestures without props, posture habits, and key silhouette details.",
          "Keep the exact same character identity, outfit, material, proportions, colors, and silhouette across all views.",
          "Use a pure clean neutral blank background, evenly lit studio reference lighting, no environment, no decorative scene. Do not let text or info boxes cover the character drawings.",
          "Preserve the asset facts; do not add unconfirmed appearance details.",
          fruitRequired
            ? mixedFruitGroup
              ? "Visual identity: all visible characters are anthropomorphic fruit; use a varied mixed fruit crowd with clear fruit anatomy/material cues."
              : `Visual identity: unmistakable anthropomorphic ${fruitIdentity}; not a normal human, animal, generic zombie, or non-fruit monster. Make the ${fruitIdentity} identity readable in the silhouette, surface texture, and color palette.`
            : "",
        ].join("\n")
      : assetKind === "scenes"
        ? [
            "Create a clean empty scene/location production reference image. Prioritize readable layout, geography, lighting, and atmosphere.",
            "This is an environment plate only: no characters, no people, no creatures, no visible actors, no dialogue, no performance beat.",
            "If a Scene visual continuity lock is provided, inherit it exactly. The image may show a local zone, anchor, or detail, but it must remain inside the same canonical visual world.",
            "For local zones and anchors, show enough of the parent canonical scene materials and landmarks to make the relationship clear.",
          ].join("\n")
        : "Create a clean prop production reference image. Prioritize shape, material, scale, and practical use.";
  const outputRule =
    assetKind === "characters"
      ? characterVariant === "with-props"
        ? "Single image only. Clean printed text is allowed only for compact character sheet labels: name, personality, height, expressions, actions, variants, wearable outfit/gear, personal prop, and color palette. No UI chrome, no watermark, no random captions, no messy handwritten annotations."
        : "Single image only. Clean printed text is allowed only for compact character sheet labels: name, personality, height, expressions, actions, variants, wearable outfit/gear, and color palette. No UI chrome, no watermark, no random captions, no messy handwritten annotations. Do not include standalone props in this clean base reference."
      : "Single image only. No captions, no UI, no watermark, no labels, no title text, no diagram annotations unless explicitly required by the asset facts.";
  const stylePrompt = sceneStylePrompt.replace(/^(base style|global prompt|visual style|style|look|render|lighting|cinematic|quality)\s*:\s*/gim, "").trim();
  return [
    stylePrompt ? `Style: ${stylePrompt}` : "",
    `Asset kind: ${assetKind}`,
    `Asset name: ${assetName}`,
    sceneVisualLock ? `Scene visual continuity lock: ${sceneVisualLock}` : "",
    sceneVisualLock ? "This scene asset may be a canonical scene zone/anchor, not a separate new visual world. Do not reinterpret this child zone as a separate warehouse, different time of day, different color palette, or unrelated building." : "",
    sceneVisualLock ? "Preserve the same time of day, color palette, building type, material language, lighting family, and fixed landmarks from the scene visual authority." : "",
    fruitIdentity ? mixedFruitGroup ? "Fruit species policy: mixed random fruit crowd. Choose a varied mix such as apple, orange, lemon, pear, grape, peach, banana, melon, kiwi, or strawberry individuals; do not make all members the same fruit." : `Fruit species to draw and label clearly: ${fruitIdentity}` : "",
    assetFacts ? `Asset facts: ${assetFacts}` : "",
    carriedPropText ? `Personal prop continuity to include in character sheet: ${carriedPropText}` : "",
    userPrompt ? `User/asset prompt to preserve: ${userPrompt}` : "",
    referenceImageCount > 0 ? `Reference images supplied to the image model: ${referenceImageCount}. Use them as visual continuity references and do not contradict them.` : "",
    "",
    kindRule,
    assetKind === "scenes" ? "Do not add characters. Do not turn this into a poster or title card." : "",
    outputRule,
    "Make it useful as a reusable AI video/image reference asset.",
  ]
    .filter(Boolean)
    .join("\n");
}

function sceneStylePromptFromGlobalPrompt(value: string): string {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const allowed = lines.filter((line) => (
    /^(base style|global prompt|visual style|style|look|render|lighting|cinematic|quality)\s*:/i.test(line) ||
    /masterpiece|best quality|highly detailed|cinematic lighting|cartoon|3d|render|lighting/i.test(line)
  ));
  const blockedPattern = /character identity rules|script rules|core rules|核心规则|所有主要角色|叙述中|肢体|社会与职业|黑色幽默应围绕|人物与气质|叙事与世界观|镜头与节奏|边界与禁用元素|default generation strategy|project tone|director guidance/i;
  return allowed.filter((line) => !blockedPattern.test(line)).join("\n");
}

function enrichWorkflowScene(value: unknown, index: number, sceneVisualBibles: SceneVisualBible[] = []) {
  const record = isRecord(value) ? value : {};
  const title = stringFrom(record.title, `镜头 ${String(index + 1).padStart(2, "0")}`);
  const description = cleanWorkflowPublicText(stringFrom(record.description, ""));
  const action = cleanWorkflowPublicText(stringFrom(record.action, ""));
  const dialogue = cleanWorkflowPublicText(stringFrom(record.dialogue, ""));
  const durationSeconds = numberFrom(record.durationSeconds, 3);
  const characters = arrayFrom(record.characters).map((name) => String(name)).slice(0, 12);
  const setting = stringFrom(record.setting, "");
  const references = cleanWorkflowPublicText(stringFrom(record.references, ""));
  const visualPrompt = cleanWorkflowPublicText(stringFrom(record.visualPrompt, stringFrom(record.prompt, "")));
  const existingCanonicalSceneId = stringFrom(record.canonicalSceneId, "");
  const existingSceneVisualLock = cleanWorkflowPublicText(stringFrom(record.sceneVisualLock, ""));
  const existingSceneZone = stringFrom(record.sceneZone, "");
  const existingSceneAnchors = arrayFrom(record.sceneAnchors).map((name) => String(name)).slice(0, 12);
  const resolvedVisualLock = !existingSceneVisualLock
    ? resolveSceneVisualLockForSetting(setting || title || description || visualPrompt, sceneVisualBibles)
    : null;
  const canonicalSceneId = existingCanonicalSceneId || resolvedVisualLock?.canonicalSceneId || "";
  const sceneVisualLock = existingSceneVisualLock || resolvedVisualLock?.sceneVisualLock || "";
  const sceneZone = existingSceneZone || resolvedVisualLock?.sceneZone || "";
  const sceneAnchors = existingSceneAnchors.length > 0 ? existingSceneAnchors : resolvedVisualLock?.sceneAnchors ?? [];
  const professional = inferProfessionalShotFields(
    {
      title,
      description,
      action,
      dialogue,
      durationSeconds,
      characters,
      setting,
      references,
      visualPrompt,
    },
    index,
  );
  return {
    ...record,
    id: stringFrom(record.id, `shot-${String(index + 1).padStart(3, "0")}`),
    title,
    description,
    action,
    dialogue,
    durationSeconds,
    shotSize: stringFrom(record.shotSize ?? record.shot_size, professional.shotSize),
    cameraAngle: stringFrom(record.cameraAngle ?? record.camera_angle, professional.cameraAngle),
    cameraMove: stringFrom(record.cameraMove ?? record.camera_move, professional.cameraMove),
    composition: stringFrom(record.composition, professional.composition),
    lens: stringFrom(record.lens, professional.lens),
    aperture: stringFrom(record.aperture, professional.aperture),
    shutter: stringFrom(record.shutter, professional.shutter),
    iso: stringFrom(record.iso, professional.iso),
    sound: stringFrom(record.sound ?? record.soundEffects, professional.sound),
    music: stringFrom(record.music, professional.music),
    subtitle: stringFrom(record.subtitle, dialogue),
    characters,
    setting,
    references,
    canonicalSceneId,
    sceneVisualLock,
    sceneZone,
    sceneAnchors,
    visualPrompt,
    directorBoardPrompt: cleanWorkflowPromptText(stringFrom(record.directorBoardPrompt ?? record.boardPrompt, professional.directorBoardPrompt)),
    status: stringFrom(record.status, index < 2 ? "ready" : "draft"),
  };
}

function applySceneVisualLocksToWorkflowAssets(assets: Record<string, unknown>, sceneVisualBibles: SceneVisualBible[]): Record<string, unknown> {
  if (sceneVisualBibles.length === 0) return assets;
  const scenes = Array.isArray(assets.scenes)
    ? assets.scenes.map((item) => {
        if (!isRecord(item)) return item;
        const existingLock = cleanWorkflowPublicText(stringFrom(item.sceneVisualLock, ""));
        if (existingLock) return item;
        const name = stringFrom(item.name ?? item.title, "");
        const description = cleanWorkflowPublicText(stringFrom(item.description, ""));
        const visualPrompt = cleanWorkflowPublicText(stringFrom(item.visualPrompt ?? item.prompt, ""));
        const lock = resolveSceneVisualLockForSetting([name, description, visualPrompt].filter(Boolean).join(" "), sceneVisualBibles);
        if (!lock) return item;
        return {
          ...item,
          canonicalSceneId: stringFrom(item.canonicalSceneId, lock.canonicalSceneId),
          sceneVisualLock: lock.sceneVisualLock,
          sceneZone: stringFrom(item.sceneZone, lock.sceneZone),
          sceneAnchors: arrayFrom(item.sceneAnchors).length > 0 ? item.sceneAnchors : lock.sceneAnchors,
        };
      })
    : assets.scenes;
  return { ...assets, scenes };
}

function applySceneVisualLocksToWorkflowRecord(workflow: any): any {
  if (!isRecord(workflow)) return workflow;
  const sceneVisualBibles = Array.isArray(workflow.sceneVisualBibles)
    ? workflow.sceneVisualBibles.filter((item): item is SceneVisualBible => isRecord(item))
    : [];
  if (sceneVisualBibles.length === 0) return workflow;
  return {
    ...workflow,
    breakdownScenes: Array.isArray(workflow.breakdownScenes)
      ? workflow.breakdownScenes.map((scene, index) => enrichWorkflowScene(scene, index, sceneVisualBibles))
      : workflow.breakdownScenes,
    assets: applySceneVisualLocksToWorkflowAssets(isRecord(workflow.assets) ? workflow.assets : defaultAssets(), sceneVisualBibles),
  };
}

function buildAssetExtractionPrompt(
  project: any,
  input: z.infer<typeof runWorkflowSchema>,
  authority: WorkflowAuthorityContext,
): string {
  const projectAssetMemory = collectProjectAssetMemory(project.metadata, input.episodeId);
  const projectAssetMemoryPrompt = summarizeProjectAssetMemoryForPrompt(projectAssetMemory);
  return [
    `Project title: ${project.name}`,
    `Project description: ${project.description ?? ""}`,
    `Aspect ratio: ${project.aspectRatio}`,
    `Project global prompt: ${authority.globalPrompt}`,
    `Project negative prompt: ${authority.negativePrompt}`,
    authority.setupSettingsSummary ? `Project setup settings: ${authority.setupSettingsSummary}` : "",
    authority.characterIdentityRules ? `Character identity rules: ${authority.characterIdentityRules}` : "",
    projectAuthorityPromptBlock(authority),
    authority.existingCharacters.length ? "Existing Character records are authoritative:" : "",
    authority.existingCharacters.length ? summarizeAuthorityCharacters(authority.existingCharacters) : "",
    existingAssetNameLanguageRules(authority),
    projectAssetMemoryPrompt ? "Existing project asset memory is authoritative for reusable assets across episodes:" : "",
    projectAssetMemoryPrompt,
    `Episode: ${input.selectedEpisode}`,
    `Source name: ${input.sourceName ?? "manual input"}`,
    "",
    languageRules(input.sourceText),
    "",
    "Extract only reusable production assets from this one episode.",
    "Keep the response compact. Limit to at most 12 characters, 12 locations, and 20 props. Keep every string under 180 characters.",
    "Return a JSON object with this exact shape:",
    `{
  "summary": "one short episode summary",
  "characters": [
    {"name": "character name", "role": "PROTAGONIST|SUPPORTING|BACKGROUND", "description": "story role", "visualPrompt": "short visual identity", "fruitIdentity": "specific fruit species or empty", "personality": "short personality", "height": "relative/estimated height", "primaryLook": "dominant story look", "expressionNotes": "useful expressions", "habitualActions": "signature gestures/actions", "variantNotes": "mask/no-mask, gear on/off, or other state variants", "signatureProps": "signature outfit/props", "colorPalette": "compact palette", "lockedVisualIdentity": "short immutable visual identity", "referencePolicy": "how later prompts may reference this character"}
  ],
  "locations": [
    {"name": "location or scene asset", "description": "visual setting", "timeOfDay": "day/night/interior/etc"}
  ],
  "props": [
    {"name": "prop name", "description": "story function", "aliases": ["variant wording from this episode if any"]}
  ]
}`,
    "",
    "Rules:",
    "- Strict JSON only. Do not use markdown fences, comments, trailing commas, or prose outside the JSON object.",
    "- Inside string values, do not use raw English double quote characters. For dialogue, write speaker labels like Chloe: text / Leo: text and omit surrounding quote marks.",
    "- Keep all string values on one line. Do not put raw newline characters inside JSON strings.",
    "- Extract this episode only. Do not include other episodes.",
    "- Reuse existing project asset names exactly when the episode refers to the same durable character, location, or prop under a synonym. Put the new wording in aliases instead of creating a renamed duplicate.",
    "- For props, Cast Iron Pan, Cast Iron Frying Pan, Iron Pan, and Skillet are the same reusable prop unless the source explicitly introduces a different pan.",
    "- Do not extract character-worn gear as standalone props when it is part of a character's current form or historical character image. Gas masks, helmets, wristbands, badges, lanyards, monocles, tactical vests, face coverings, and attached costume gear belong in character primaryLook/variantNotes/signatureProps.",
    "- Do not extract scene fixtures as standalone props unless the object is removed, carried, used independently, or must stay visually identical across scenes. Doors, walls, stages, counters, shelves, consoles, elevators, vents, pipes, signs, billboards, server racks, and embedded set pieces belong in locations.sceneAnchors/description.",
    "- For each recurring character form, record named visual variants in variantNotes, such as Bob with gas mask, Chloe holding shotgun, Leo holding cast iron pan, or no-gear state. Later prompts should select the matching character form reference instead of inventing a separate wearable prop image.",
    "- Character facts must be stronger than prose: fill fruitIdentity, lockedVisualIdentity, and referencePolicy when applicable.",
    "- For every character, infer concise personality, relative height, primaryLook, expressionNotes, habitualActions, and variantNotes when the source or visual authority supports it.",
    "- If a character has mask/gear on and off states, put the long-term or dominant story state in primaryLook and the alternate state in variantNotes.",
    "- Do not extract character-worn gear as standalone props when it is part of a character's current form or historical character image. Put gas masks, helmets, wristbands, badges, lanyards, monocles, tactical vests, face coverings, and attached costume gear in character primaryLook/variantNotes/signatureProps.",
    "- Do not extract scene fixtures as standalone props unless the object is removed, carried, used independently, or must stay visually identical across scenes. Put doors, walls, stages, counters, shelves, consoles, elevators, vents, pipes, signs, billboards, server racks, and embedded set pieces in location sceneAnchors/description.",
    "- Treat project globalPrompt, setupSettings, and Existing Character records as authority. Do not override known character identity, prompt, bio, or trait facts.",
    authority.characterIdentityRules
      ? "- Follow Character identity rules exactly. If the rules say all characters share a species/type/theme, apply that to every extracted character."
      : "",
    authority.requiresSpecificFruitIdentity
      ? "- The Character identity rules require concrete fruit identity. Every character must have a concrete fruitIdentity such as strawberry, banana, lemon, grape, orange, peach, pear, pineapple, etc. Do not leave fruitIdentity generic."
      : "",
    "- Keep character visual descriptions short; do not invent detailed clothing or unconfirmed appearance.",
    "- If source prose describes an action that conflicts with a locked asset identity, keep the story intention but rewrite later visual use toward a valid equivalent gesture.",
    "- Keep visualPrompt concise and concrete.",
    "- Use the detected source language for story text, but keep existing canonical asset names exactly when an existing asset is referenced.",
    "",
    "Source text:",
    input.sourceText,
  ].join("\n");
}

function buildStoryboardOnlyPrompt(
  project: any,
  input: z.infer<typeof runWorkflowSchema>,
  assetsJson: unknown,
  authority: WorkflowAuthorityContext,
): string {
  const sourceDialogueLock = sourceDialogueLockLines(input.sourceText);
  return [
    `Project title: ${project.name}`,
    `Project description: ${project.description ?? ""}`,
    `Aspect ratio: ${project.aspectRatio}`,
    `Project global prompt: ${authority.globalPrompt}`,
    `Project negative prompt: ${authority.negativePrompt}`,
    authority.setupSettingsSummary ? `Project setup settings: ${authority.setupSettingsSummary}` : "",
    authority.characterIdentityRules ? `Character identity rules: ${authority.characterIdentityRules}` : "",
    projectAuthorityPromptBlock(authority),
    authority.existingCharacters.length ? "Existing Character records are authoritative:" : "",
    authority.existingCharacters.length ? summarizeAuthorityCharactersForStoryboard(authority.existingCharacters) : "",
    existingAssetNameLanguageRules(authority),
    `Episode: ${input.selectedEpisode}`,
    "",
    languageRules(input.sourceText),
    "",
    sceneVisualBiblePromptRules(),
    "",
    "Create a compact sequential storyboard beat list for this one episode.",
    "Use these extracted assets as continuity references:",
    summarizeAssetsForStoryboardPrompt(assetsJson),
    "Use the supplied Scene Visual Bible from existing assets when present. If a setting is a sub-area, set sceneZone to that sub-area and keep canonicalSceneId pointed at the parent canonical scene.",
    "",
    sourceDialogueLock.length ? "Source dialogue lock. Each item is one complete spoken turn and must stay indivisible:" : "",
    sourceDialogueLock.length ? sourceDialogueLock.map((line, index) => `D${index + 1}: ${line}`).join("\n") : "",
    "",
    "Return a JSON object with this exact shape:",
    `{
  "storyboard": [
    {
      "title": "shot or beat title",
      "description": "what happens on screen",
      "action": "main physical action",
      "dialogue": "dialogue if any",
      "durationSeconds": 3,
      "characters": ["names"],
      "setting": "location",
      "canonicalSceneId": "parent canonical scene id when known",
      "sceneZone": "sub-area inside the canonical scene, or empty",
      "sceneAnchors": ["fixed local landmarks or anchor objects"],
      "sceneVisualLock": "compact canonical visual authority lock",
      "references": "assets or continuity notes",
      "visualPrompt": "concise image/video prompt"
    }
  ]
}`,
    "",
    "Rules:",
    "- Strict JSON only. Do not use markdown fences, comments, trailing commas, or prose outside the JSON object.",
    "- Inside string values, do not use raw English double quote characters. For dialogue, write speaker labels like Chloe: text / Leo: text and omit surrounding quote marks.",
    "- Keep all string values on one line. Do not put raw newline characters inside JSON strings.",
    "- Split this one episode only. Do not include other episodes.",
    "- Return compact story beats, not a full director bible. The backend can add silent reaction/cutaway beats for pacing.",
    ...STORYBOARD_BREAKDOWN_QUALITY_RULES,
    "- Keep non-dialogue string fields short. Aim under 18 words for title, description, action, setting, references, and visualPrompt. This length limit does NOT apply to dialogue.",
    "- Put only the dialogue that belongs to that beat. Preserve dialogue words when practical, but remove the source's surrounding quotation marks.",
    "- Every dialogue value MUST begin with the speaker's name and a colon, like Flora: text. When the source attributes a line narratively (such as: Murder! ... Flora shrieked), convert it to the Flora: label. Never output unattributed dialogue.",
    "- Carry EVERY quoted dialogue line from the source text, in order, word-for-word. Do not drop, merge, summarize, or paraphrase any dialogue line.",
    "- A single speaker turn must be atomic: never split one sentence, clause, or Source dialogue lock item across multiple storyboard entries, shots, clips, or dialogue fields.",
    "- If a long spoken turn needs reaction/cutaway coverage, keep the full exact dialogue in the starting beat and make later reaction/cutaway beats silent with empty dialogue.",
    "- Prefer 1-2 seconds per beat. Use 3 seconds only for dense dialogue or complex physical action; do not output all beats as 3 seconds. Do not shorten or split dialogue to satisfy duration.",
    "- A 13-15 second continuous scene should usually contain 7-10 beats with mixed 1s/2s/3s durations.",
    "- The characters array means all characters physically present in the shot, not only speakers or foreground action. If the source says a team/group/guests move together, keep the implied silent members present until the text clearly separates them.",
    "- For close-ups or reaction cuts, keep silent team members in characters and mention in references/visualPrompt when they are background, edge-of-frame, or offscreen continuity.",
    "- If a later beat relies on a carried personal prop, establish that prop as continuity when its owner is already present in the same sequence.",
    "- Honor Character personal prop continuity exactly: when a listed owner appears in a beat, include their linked prop in references/visualPrompt/action whenever the prop is relevant, carried, aimed, held, used, or needed for continuity.",
    "- Do not leave signature weapons or carried props generic. Write owner + prop together, such as Chloe's Shotgun, Leo's Magic Pan, Bob's Heavy Gun, or Eugene's Anime Pillow when those bindings exist.",
    "- Use canonical existing character names in characters arrays and dialogue speaker labels, even when the source text is Chinese. Keep dialogue text itself in the source language.",
    "- Do not repeat character clothing or appearance details for characters with reference images. Use the character name and state that the supplied/linked character image is the visual reference.",
    "- Treat project globalPrompt, setupSettings, extracted assets, and Existing Character records as authority.",
    "- Treat uploaded/generated asset reference images and locked asset facts as stronger than source prose for visual continuity.",
    "- Use any supplied Scene Visual Bible / canonical scene ids from existing assets when present; preserve canonicalSceneId instead of inventing a new one.",
    "- If a storyboard setting is a sub-area of an existing scene, set sceneZone to the sub-area and keep canonicalSceneId pointed at the parent canonical scene.",
    "- Put stable local landmarks in sceneAnchors and keep sceneVisualLock aligned to the parent Scene Visual Bible.",
    "- If source prose describes an impossible or conflicting detail under the locked asset identity, preserve the story beat but translate it into a valid visual action. Example: a hairless fruit character cannot have hair blowing; use leaf, stem, body tilt, facial expression, prop, or costume movement instead.",
    "- Use character primaryLook and variantNotes to decide mask/gear on or off; do not randomly remove or add gear.",
    authority.characterIdentityRules
      ? "- Follow Character identity rules exactly. Use extracted asset fact cards instead of inventing character species, body type, clothing, or other unconfirmed appearance details."
      : "",
    authority.requiresSpecificFruitIdentity
      ? "- The project requires concrete fruit identities. For characters with reference images, storyboard references and visualPrompt must identify them by name and image reference only; do not rewrite fruit species, clothing, or appearance details."
      : "",
    "- Keep visualPrompt concise: setting + characters + action + camera cue.",
    "- Dialogue must stay in the detected source language. Preserve dialogue words when practical, but remove the source's surrounding quotation marks.",
    "",
    "Source text:",
    input.sourceText,
	  ].filter(Boolean).join("\n");
}

function buildSegmentedStoryboardPrompt(
  project: any,
  input: z.infer<typeof runWorkflowSchema>,
  assetsJson: unknown,
  authority: WorkflowAuthorityContext,
  segment: { partIndex: number; totalParts: number; previousTail: string; nextHead: string },
): string {
  const sourceDialogueLock = sourceDialogueLockLines(input.sourceText);
  return [
    `Project title: ${project.name}`,
    `Project description: ${project.description ?? ""}`,
    `Aspect ratio: ${project.aspectRatio}`,
    `Project global prompt: ${authority.globalPrompt}`,
    authority.characterIdentityRules ? `Character identity rules: ${authority.characterIdentityRules}` : "",
    projectAuthorityPromptBlock(authority),
    authority.existingCharacters.length ? "Existing Character records are authoritative:" : "",
    authority.existingCharacters.length ? summarizeAuthorityCharactersForStoryboard(authority.existingCharacters) : "",
    existingAssetNameLanguageRules(authority),
    `Episode: ${input.selectedEpisode}`,
    `Segment: ${segment.partIndex + 1}/${segment.totalParts}`,
    "",
    languageRules(input.sourceText),
    "",
    sceneVisualBiblePromptRules(),
    "",
    "Use these extracted assets as continuity references:",
    summarizeAssetsForStoryboardPrompt(assetsJson),
    "",
    segment.previousTail ? `Previous segment tail for continuity only, do not re-break down it:\n${segment.previousTail}` : "",
    segment.nextHead ? `Next segment head for continuity only, do not break down it:\n${segment.nextHead}` : "",
    "",
    sourceDialogueLock.length ? "Source dialogue lock inside this segment. Each item is one complete spoken turn and must stay indivisible:" : "",
    sourceDialogueLock.length ? sourceDialogueLock.map((line, index) => `D${index + 1}: ${line}`).join("\n") : "",
    "",
    "Create storyboard beats ONLY for the current segment source text. Do not include previous or next segment context as beats.",
    "Return a JSON object with this exact shape:",
    `{
  "storyboard": [
    {
      "title": "shot or beat title",
      "description": "what happens on screen",
      "action": "main physical action",
      "dialogue": "dialogue if any",
      "durationSeconds": 2,
      "characters": ["names"],
      "setting": "location",
      "canonicalSceneId": "parent canonical scene id when known",
      "sceneZone": "sub-area inside the canonical scene, or empty",
      "sceneAnchors": ["fixed local landmarks or anchor objects"],
      "sceneVisualLock": "compact canonical visual authority lock",
      "references": "assets or continuity notes",
      "visualPrompt": "concise image/video prompt"
    }
  ]
}`,
    "",
    "Rules:",
    "- Strict JSON only. Do not use markdown fences, comments, trailing commas, or prose outside the JSON object.",
    "- Inside string values, do not use raw English double quote characters. For dialogue, write speaker labels like Chloe: text / Leo: text and omit surrounding quote marks.",
    "- Keep all string values on one line. Do not put raw newline characters inside JSON strings.",
    "- Keep output compact. Use about 10-24 storyboard beats for this segment depending on story density.",
    "- Preserve story order and all quoted dialogue in this segment. Do not summarize dialogue.",
    "- A single speaker turn must be atomic: never split one sentence, clause, or Source dialogue lock item across multiple storyboard entries, shots, clips, or dialogue fields.",
    "- Prefer 1-2 seconds per beat. Use 3 seconds only for dense dialogue or complex physical action.",
    "- Keep one continuous setting/event together where practical, but split when the source changes event or location.",
    "- The characters array means characters physically present in the shot, not the entire episode cast.",
    "- Use existing asset names exactly. Do not invent renamed duplicates for characters, scenes, or props.",
    "- Use canonical existing character names in characters arrays and dialogue speaker labels, even when the source text is Chinese. Keep dialogue text itself in the source language.",
    "- Keep visualPrompt concise: setting + characters + action + camera cue.",
    "",
    "Current segment source text:",
    input.sourceText,
  ].filter(Boolean).join("\n");
}

function splitSourceTextForStoryboard(sourceText: string): Array<{ text: string; head: string; tail: string }> {
  const maxChunkChars = 2600;
  const minChunkChars = 1200;
  const paragraphs = sourceText
    .split(/\n\s*\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (paragraphs.length <= 1) {
    const chunks: string[] = [];
    for (let start = 0; start < sourceText.length; start += maxChunkChars) {
      chunks.push(sourceText.slice(start, start + maxChunkChars).trim());
    }
    return chunks.filter(Boolean).map((text) => ({
      text,
      head: text.slice(0, 500),
      tail: text.slice(-500),
    }));
  }

  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChunkChars && current.length >= minChunkChars) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks.map((text) => ({
    text,
    head: text.slice(0, 500),
    tail: text.slice(-500),
  }));
}

function buildClipOptimizationPrompt(
  project: any,
  workflow: ReturnType<typeof getWorkflowState>,
  clip: NormalizedWorkflowClip,
  shots: NormalizedStoryboardShot[],
  authority: WorkflowAuthorityContext,
): string {
  const compactClip = {
    id: clip.id,
    title: clip.title,
    plotGoal: clip.plotGoal,
    estimatedDuration: clip.estimatedDuration,
    targetDuration: clip.targetDuration,
    maxDuration: clip.maxDuration,
    sceneType: clip.sceneType,
    characters: clip.characters,
    setting: clip.setting,
    preflight: clip.preflight,
  };
  const compactShots = shots.map((shot) => ({
    id: shot.id,
    title: shot.title,
    description: shot.description,
    action: shot.action,
    dialogue: shot.dialogue,
    durationSeconds: shot.durationSeconds,
    characters: shot.characters,
    setting: shot.setting,
    references: shot.references,
    visualPrompt: shot.visualPrompt,
    shotSize: shot.shotSize,
    cameraAngle: shot.cameraAngle,
    cameraMove: shot.cameraMove,
  }));

  return [
    `Project title: ${project.name}`,
    `Project description: ${project.description ?? ""}`,
    `Aspect ratio: ${project.aspectRatio}`,
    `Project global prompt: ${authority.globalPrompt}`,
    `Project negative prompt: ${authority.negativePrompt}`,
    authority.setupSettingsSummary ? `Project setup settings: ${authority.setupSettingsSummary}` : "",
    authority.characterIdentityRules ? `Character identity rules: ${authority.characterIdentityRules}` : "",
    projectAuthorityPromptBlock(authority),
    authority.existingCharacters.length ? "Existing Character records are authoritative:" : "",
    authority.existingCharacters.length ? summarizeAuthorityCharactersForStoryboard(authority.existingCharacters) : "",
    existingAssetNameLanguageRules(authority),
    "",
    languageRules(workflow.sourceText),
    "",
    "Current extracted assets:",
    summarizeAssetsForStoryboardPrompt(workflow.assets),
    "",
    "Optimize only this Clip. Do not rewrite the whole episode and do not include shots from neighboring Clips.",
    "Return a JSON object with this exact shape:",
    storyboardJsonShape(),
    "",
    "Rules:",
    "- Strict JSON only. Do not use markdown fences, comments, trailing commas, or prose outside the JSON object.",
    "- Preserve the same plot coverage, same characters, same setting, and same story beat as the current Clip.",
    "- Fix the listed preflight risks by adjusting shot count, shot duration, and dialogue distribution.",
    "- Prefer fuller Clips only when the shots belong to the same setting, same conversation, or same continuous action beat; do not force short story beats up to 13 seconds.",
    "- Preserve key story beats first: do not pad with empty action just to reach 15 seconds, and split when a hard story turn or setting change would become unclear.",
    "- Total Clip duration must never exceed 15 seconds.",
    "- Prefer 1-2 seconds per shot. Use reaction shots, cutaways, hands, props, or reverse shots while the same speaker continues off-screen when useful.",
    "- Do not make every shot 3 seconds. Longer/full Clips should usually contain 7-10 shots with mixed 1s/2s/3s durations.",
    "- Preserve dialogue wording and source language whenever practical. Do not translate dialogue.",
    "- Use canonical existing character names in characters arrays and dialogue speaker labels, even when the source text is Chinese. Keep dialogue text itself in the source language.",
    "- Do not split dialogue in the middle of a natural clause when a cleaner sentence or punctuation break is available.",
    "- Do not write internal instructions such as Fast reaction/cutaway continuation, Dialogue beat, Continue the exchange, keep same geography, or similar process notes into output fields.",
    "- Keep visualPrompt concise: setting + character names + action + camera cue.",
    "- Preserve Character personal prop continuity. If a Clip character has a linked carried prop or signature weapon, keep that prop with the owner in action, references, and visualPrompt unless the story explicitly separates it.",
    "- Do not describe clothing or appearance for characters with reference images. Use asset names and say their linked character image is the visual authority.",
    authority.requiresSpecificFruitIdentity
      ? "- Fruit identity is locked by Character identity rules and asset fact cards; do not change a character into another fruit."
      : "",
    "",
    "Current Clip:",
    JSON.stringify(compactClip, null, 2),
    "",
    "Current Clip shots:",
    JSON.stringify(compactShots, null, 2),
    "",
    "Episode source excerpt for local context:",
    workflow.sourceText.slice(0, 12000),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildClipStoryboardPlanPrompt(
  project: any,
  workflow: ReturnType<typeof getWorkflowState>,
  clip: NormalizedWorkflowClip,
  shots: NormalizedStoryboardShot[],
  authority: WorkflowAuthorityContext,
  input: z.infer<typeof clipStoryboardPlanSchema>,
): string {
  const compactClip = {
    ...clipStoryboardContinuityContext(workflow, clip, shots),
    id: clip.id,
    title: clip.title,
    plotGoal: clip.plotGoal,
    estimatedDuration: clip.estimatedDuration,
    targetDuration: clip.targetDuration,
    maxDuration: clip.maxDuration,
    sceneType: clip.sceneType,
    storyboardControlLevel: clip.storyboardControlLevel,
    storyboardType: clip.storyboardType,
    existingPanelCount: clip.panelCount,
    startState: clip.startState,
    endState: clip.endState,
    emotionArc: clip.emotionArc,
    dialogueWordCount: clip.dialogueWordCount,
    dialogueDensity: clip.dialogueDensity,
    setting: clip.setting,
    layoutMemory: clip.layoutMemory,
    seedancePrompt: clip.seedancePrompt,
  };
  const compactShots = shots.map((shot, index) => ({
    index: index + 1,
    id: shot.id,
    title: shot.title,
    description: shot.description,
    action: shot.action,
    dialogue: shot.dialogue,
    durationSeconds: shot.durationSeconds,
    characters: shot.characters,
    setting: shot.setting,
    references: shot.references,
    visualPrompt: shot.visualPrompt,
    shotSize: shot.shotSize,
    cameraAngle: shot.cameraAngle,
    cameraMove: shot.cameraMove,
    lens: shot.lens,
    camera: [shot.shotSize, shot.cameraAngle, shot.cameraMove, shot.lens, shot.aperture, shot.shutter, shot.iso]
      .filter(Boolean)
      .join(", "),
  }));
  const clipIndex = workflow.clips.findIndex((item) => item.id === clip.id);
  const previousClip = clipIndex > 0 ? workflow.clips[clipIndex - 1] : null;
  const previousClipContinuity = previousClip
    ? {
        id: previousClip.id,
        title: previousClip.title,
        plotGoal: previousClip.plotGoal,
        setting: previousClip.setting,
        endState: previousClip.endState,
      }
    : null;
  const panelInstruction =
    input.panelMode === "manual" && input.panelCount
      ? `Use exactly ${input.panelCount} panels.`
      : "First infer the best panel count for this Clip from the story, dialogue density, action complexity, and readability. Use 5-12 panels. Keep Clip duration within 4-15 seconds and follow the actual story beat length. Prefer 8-10 panels for 10-12 second Clips and 10-12 panels only for longer 13-15 second Clips. Do not fill panels mechanically; key story beats, exact dialogue, and readable continuity are more important than maximizing panel count.";
  const dialogueLock = clipStoryboardDialogueLockLines(shots);

  return [
    `Project title: ${project.name}`,
    `Project description: ${project.description ?? ""}`,
    `Project aspect ratio: ${project.aspectRatio}`,
    `Project global prompt: ${authority.globalPrompt}`,
    `Project negative prompt: ${authority.negativePrompt}`,
    authority.setupSettingsSummary ? `Project setup settings: ${authority.setupSettingsSummary}` : "",
    authority.characterIdentityRules ? `Character identity rules: ${authority.characterIdentityRules}` : "",
    projectAuthorityPromptBlock(authority),
    authority.existingCharacters.length ? "Existing Character records are authoritative:" : "",
    authority.existingCharacters.length ? summarizeAuthorityCharactersForStoryboard(authority.existingCharacters) : "",
    existingAssetNameLanguageRules(authority),
    "",
    languageRules(workflow.sourceText),
    "",
    "Current extracted assets:",
    summarizeAssetsForStoryboardPrompt(workflow.assets),
    "",
    "Task:",
    "Plan one clip-level director storyboard image prompt for AI image generation.",
    "This must represent the whole Clip, not a single shot.",
    panelInstruction,
    "",
    "Return a JSON object with this exact shape:",
    clipStoryboardPlanJsonShape(),
    "",
    "Rules for panelCount:",
    `- panelCount must be an integer between ${MIN_CLIP_STORYBOARD_PANEL_COUNT} and ${MAX_CLIP_STORYBOARD_PANEL_COUNT}.`,
    "- Prefer a 15-second Clip structure when the complete story beat and dialogue can fit at fast American animation speaking pace.",
    "- If the Clip has several shots, distribute them across the board; do not make a separate board per shot.",
    "- The panel count must fit the Clip duration, dialogue density, action complexity, and number of camera beats. Choose fewer panels only when the story is genuinely simple or very short.",
    "",
    "Rules for storyboardPrompt:",
    "- Write the final image-generation prompt directly. Do not describe your reasoning outside JSON.",
    `- Ask for one ${project.aspectRatio || "16:9"} multi-panel comic storyboard image.`,
    "- Visual style must be polished 3D American animated dark-comedy comic storyboard: saturated colors, clean 3D render, exaggerated acting, cinematic rim light, fast comic-panel pacing.",
    `- ${clipStoryboardBoardLayoutStrategy(undefined, project.aspectRatio || "16:9")}`,
    `- ${clipStoryboardFramingStrategy()}`,
    "- Visible text in the image should be limited to small panel number labels like P1/P2/P3 and intentional speech-bubble dialogue.",
    "- Write numbered panel beats in order inside storyboardPrompt, using clear labels like Panel 1:, Panel 2:, Panel 3:. These ordered labels are used later to generate the video prompt.",
    "- Every numbered Panel beat must include a visible cast note and a framing note. Follow the panel's visible cast over the broader Required continuity characters line.",
    previousClipContinuity ? "- storyboardPrompt must include a Previous Clip continuity line and begin from the previous Clip end state unless the story explicitly changes location." : "",
    "- If Current Clip includes continuityCharacters, storyboardPrompt must include every continuity character exactly by name in a Required continuity characters line.",
    "- Include the inferred panel count and require clear panel continuity.",
    "- Preserve dialogue language. Do not translate, paraphrase, expand, shorten, or invent dialogue.",
    "- storyboardPrompt must include a Dialogue lock section that copies the spoken lines below.",
    "- If a panel has dialogue, its speech bubble must use the exact line from the Dialogue lock. Do not replace dialogue with summaries, IDs, abbreviations, or paraphrases.",
    "- Include action and dialogue beats from all shots in the Clip.",
    "- For characters with reference images, do not describe their clothing or appearance. Use character names and say the linked character images are the visual references.",
    "- Treat Clip characters as continuity context, not automatic foreground for every panel. Silent team members may stay background, edge-of-frame, or offscreen in close-ups; wide/establishing panels can include them only when the story beat needs group blocking.",
    "- Prefer most panels as one-character or two-character close acting beats. Use group panels only for a necessary story beat such as spatial orientation, combat blocking, or a clear group reaction.",
    "- Each panel's visible cast should usually be 1-2 characters; use 3 only when the beat requires interaction, and avoid 4+ unless absolutely necessary.",
    "- Do not show the same named character twice in a single panel. One panel equals one moment, not repeated animation poses.",
    "- Character reference images are complete visual authority. If a selected character image already includes a carried prop, keep it with that character, but do not ask for separate prop reference images.",
    "- Do not add independent prop assets to the storyboardPrompt unless the story action explicitly requires a non-character object.",
    "- If a connected character reference already shows a worn item or carried form, use that character form as visual authority instead of asking for a separate wearable prop reference.",
    "- Do not invent clothing, hair, fruit identity, props, or scene details that conflict with project assets.",
    "- Keep non-dialogue visible text minimal: panel numbers and speech bubbles are enough. Avoid UI chrome, watermarks, random non-dialogue text, and long paragraphs.",
    "",
    "Dialogue lock:",
    dialogueLock.length ? dialogueLock.join("\n") : "No dialogue.",
    "",
    "Current Clip:",
    JSON.stringify(compactClip, null, 2),
    "",
    "Current Clip shots:",
    JSON.stringify(compactShots, null, 2),
    previousClipContinuity ? "" : "",
    previousClipContinuity ? "Previous Clip continuity:" : "",
    previousClipContinuity ? JSON.stringify(previousClipContinuity, null, 2) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildBreakdownPrompt(project: any, input: z.infer<typeof runWorkflowSchema>, authority: WorkflowAuthorityContext): string {
  const sourceDialogueLock = sourceDialogueLockLines(input.sourceText);
  return [
    `Project title: ${project.name}`,
    `Project description: ${project.description ?? ""}`,
    `Aspect ratio: ${project.aspectRatio}`,
    `Project global prompt: ${authority.globalPrompt}`,
    `Project negative prompt: ${authority.negativePrompt}`,
    authority.setupSettingsSummary ? `Project setup settings: ${authority.setupSettingsSummary}` : "",
    authority.characterIdentityRules ? `Character identity rules: ${authority.characterIdentityRules}` : "",
    projectAuthorityPromptBlock(authority),
    authority.existingCharacters.length ? "Existing Character records are authoritative:" : "",
    authority.existingCharacters.length ? summarizeAuthorityCharacters(authority.existingCharacters) : "",
    existingAssetNameLanguageRules(authority),
    `Episode: ${input.selectedEpisode}`,
    `Source name: ${input.sourceName ?? "manual input"}`,
    "",
    languageRules(input.sourceText),
    "",
    sceneVisualBiblePromptRules(),
    "",
    sourceDialogueLock.length ? "Source dialogue lock. Each item is one complete spoken turn and must stay indivisible:" : "",
    sourceDialogueLock.length ? sourceDialogueLock.map((line, index) => `D${index + 1}: ${line}`).join("\n") : "",
    "",
    "Return a JSON object with this exact shape:",
    `{
  "summary": "one short episode summary",
  "characters": [
    {"name": "character name", "role": "PROTAGONIST|SUPPORTING|BACKGROUND", "description": "story role", "visualPrompt": "short visual identity", "fruitIdentity": "specific fruit species or empty", "personality": "short personality", "height": "relative/estimated height", "primaryLook": "dominant story look", "expressionNotes": "useful expressions", "habitualActions": "signature gestures/actions", "variantNotes": "mask/no-mask, gear on/off, or other state variants", "signatureProps": "signature outfit/props", "colorPalette": "compact palette", "lockedVisualIdentity": "short immutable visual identity", "referencePolicy": "how later prompts may reference this character"}
  ],
  "locations": [
    {"name": "canonical scene or scene asset", "description": "visual setting", "timeOfDay": "day/night/interior/etc", "canonicalSceneId": "stable canonical scene id if inferred", "sceneZone": "sub-area or empty", "sceneAnchors": ["fixed landmarks"], "sceneVisualLock": "compact canonical visual authority lock"}
  ],
  "props": [
    {"name": "prop name", "description": "story function"}
  ],
  "storyboard": [
    {
      "title": "shot or beat title",
      "description": "what happens on screen",
      "action": "main physical action",
      "dialogue": "dialogue if any",
      "durationSeconds": 2,
      "characters": ["names"],
      "setting": "location",
      "canonicalSceneId": "parent canonical scene id when known",
      "sceneZone": "sub-area inside the canonical scene, or empty",
      "sceneAnchors": ["fixed local landmarks or anchor objects"],
      "sceneVisualLock": "compact canonical visual authority lock",
      "references": "assets or continuity notes",
      "visualPrompt": "concise image/video prompt"
    }
  ]
}`,
    "",
    "Rules:",
    "- Strict JSON only. Do not use markdown fences, comments, trailing commas, or prose outside the JSON object.",
    "- Inside string values, do not use raw English double quote characters. For dialogue, write speaker labels like Chloe: text / Leo: text and omit surrounding quote marks.",
    "- Keep all string values on one line. Do not put raw newline characters inside JSON strings.",
    "- Split this one episode only. Do not include other episodes.",
    ...STORYBOARD_BREAKDOWN_QUALITY_RULES,
    "- Prefer 1-2 seconds per shot for fast short-drama pacing; use 3 seconds only for dense dialogue or complex physical action.",
    "- Do not make every shot 3 seconds. A 13-15 second continuous scene should usually contain 7-10 shots with mixed 1s/2s/3s durations.",
    "- Every dialogue value MUST begin with the speaker's name and a colon, like Flora: text. When the source attributes a line narratively (such as: Murder! ... Flora shrieked), convert it to the Flora: label. Never output unattributed dialogue.",
    "- Use canonical existing character names in characters arrays and dialogue speaker labels, even when the source text is Chinese. Keep dialogue text itself in the source language.",
    "- Carry EVERY quoted dialogue line from the source text, in order, word-for-word. Do not drop, merge, summarize, or paraphrase any dialogue line.",
    "- A single speaker turn must be atomic: never split one sentence, clause, or Source dialogue lock item across multiple storyboard entries, shots, clips, or dialogue fields.",
    "- Keep dialogue density realistic for fast American animated comedy: target 2.8-3.4 English words per second, never above 3.6 words per second.",
    "- If a spoken turn is longer than about 9 English words, keep the full exact dialogue in one dialogue field and add silent reaction/cutaway/action shots around it with empty dialogue. Do not split the words of that spoken turn.",
    "- The characters array means all characters physically present in the shot, not only speakers or foreground action. If the source says a team/group/guests move together, keep the implied silent members present until the text clearly separates them.",
    "- For close-ups or reaction cuts, keep silent team members in characters and mention in references/visualPrompt when they are background, edge-of-frame, or offscreen continuity.",
    "- If a later beat relies on a carried personal prop, establish that prop as continuity when its owner is already present in the same sequence.",
    "- Treat project globalPrompt, setupSettings, and Existing Character records as authority. Do not override known character identity, prompt, bio, or trait facts.",
    "- Character facts must include fruitIdentity, lockedVisualIdentity, and referencePolicy when applicable.",
    "- Character facts should also include personality, height, primaryLook, expressionNotes, habitualActions, variantNotes, signatureProps, and colorPalette when supported by the source or visual authority.",
    "- If a character has mask/gear on and off states, put the long-term or dominant story state in primaryLook and the alternate state in variantNotes.",
    "- Do not extract character-worn gear as standalone props when it is part of a character's current form or historical character image. Put gas masks, helmets, wristbands, badges, lanyards, monocles, tactical vests, face coverings, and attached costume gear in character primaryLook/variantNotes/signatureProps.",
    "- Do not extract scene fixtures as standalone props unless the object is removed, carried, used independently, or must stay visually identical across scenes. Put doors, walls, stages, counters, shelves, consoles, elevators, vents, pipes, signs, billboards, server racks, and embedded set pieces in location sceneAnchors/description.",
    authority.characterIdentityRules
      ? "- Follow Character identity rules exactly. If the rules define all characters as a specific species/type/theme, extract and lock that identity for every character."
      : "",
    authority.requiresSpecificFruitIdentity
      ? "- The Character identity rules require concrete fruit identity. Every character must have a concrete fruitIdentity, and later storyboard beats must use only character name + lockedVisualIdentity as character appearance context."
      : "",
    "- Do not invent hair, clothes, accessories, skin, or body details not confirmed by source text or Existing Character records.",
    "- Keep character visual descriptions short; do not invent detailed clothing if not present.",
    "- Extract assets before storyboard when possible.",
    "- Storyboard visual prompts must obey locked asset identities over prose. If prose mentions impossible details such as hair on a hairless fruit character, convert it into a valid equivalent gesture without changing the story intent.",
    "- In storyboard references and visualPrompt fields, do not restate clothing, outfit, body shape, colors, or appearance for characters that have uploaded/generated reference images. Use the character name and say the linked character image is the visual reference.",
    "- Dialogue must stay in the detected source language. Preserve dialogue words when practical, but remove the source's surrounding quotation marks.",
    "",
    "Source text:",
    input.sourceText,
  ].filter(Boolean).join("\n");
}

function mergeBreakdownJson(assetsJson: unknown, storyboardJson: unknown): Record<string, unknown> {
  const assets = isRecord(assetsJson) ? assetsJson : {};
  const storyboard = isRecord(storyboardJson) ? storyboardJson : {};
  return {
    summary: assets.summary ?? storyboard.summary ?? "",
    characters: assets.characters ?? [],
    locations: assets.locations ?? assets.scenes ?? [],
    props: assets.props ?? [],
    storyboard: storyboard.storyboard ?? storyboard.shots ?? storyboard.beats ?? [],
  };
}

function workflowAssetsWithSceneVisualBiblesForStoryboard(workflow: unknown): unknown {
  if (!isRecord(workflow)) return workflow;
  const assets: Record<string, unknown> = isRecord(workflow.assets) ? workflow.assets : defaultAssets();
  const workflowSceneVisualBibles = arrayFrom(workflow.sceneVisualBibles);
  if (workflowSceneVisualBibles.length === 0 || arrayFrom(assets.sceneVisualBibles).length > 0) return assets;
  return {
    ...assets,
    sceneVisualBibles: workflowSceneVisualBibles,
  };
}

function summarizeAssetsForPrompt(value: unknown): string {
  if (!isRecord(value)) return "{}";
  const compact = {
    characters: arrayFrom(value.characters)
      .slice(0, 30)
      .map((item) => {
        const record = isRecord(item) ? item : {};
        return {
          name: stringFrom(record.name, ""),
          visualPrompt: stringFrom(record.visualPrompt ?? record.prompt, ""),
          fruitIdentity: stringFrom(record.fruitIdentity, ""),
          personality: stringFrom(record.personality, ""),
          height: stringFrom(record.height, ""),
          primaryLook: stringFrom(record.primaryLook, ""),
          expressionNotes: stringFrom(record.expressionNotes, ""),
          habitualActions: stringFrom(record.habitualActions, ""),
          variantNotes: stringFrom(record.variantNotes, ""),
          signatureProps: stringFrom(record.signatureProps, ""),
          colorPalette: stringFrom(record.colorPalette, ""),
          lockedVisualIdentity: stringFrom(record.lockedVisualIdentity, ""),
          referencePolicy: stringFrom(record.referencePolicy, ""),
          visualAuthority: stringFrom(record.visualAuthority, ""),
          hasReferenceImage: Boolean(record.referenceImageUrl || record.generatedImageUrl),
        };
      }),
    locations: arrayFrom(value.locations ?? value.scenes)
      .slice(0, 30)
      .map((item) => {
        const record = isRecord(item) ? item : {};
        return {
          name: stringFrom(record.name ?? record.title, ""),
          timeOfDay: stringFrom(record.timeOfDay, ""),
          description: stringFrom(record.description, ""),
        };
      }),
    sceneVisualBibles: arrayFrom(value.sceneVisualBibles)
      .slice(0, 30)
      .map((item) => {
        const record = isRecord(item) ? item : {};
        const visualIdentity = isRecord(record.visualIdentity) ? record.visualIdentity : {};
        return {
          canonicalSceneId: stringFrom(record.canonicalSceneId, ""),
          canonicalName: stringFrom(record.canonicalName, ""),
          timeOfDay: stringFrom(visualIdentity.timeOfDay, ""),
          lighting: stringFrom(visualIdentity.lighting, ""),
          colorPalette: stringFrom(visualIdentity.colorPalette, ""),
          buildingType: stringFrom(visualIdentity.buildingType, ""),
          materialLanguage: stringFrom(visualIdentity.materialLanguage, ""),
          fixedLandmarks: arrayFrom(visualIdentity.fixedLandmarks).map((name) => String(name)).slice(0, 8),
          childZones: arrayFrom(record.childZones).map((zone) => {
            const zoneRecord = isRecord(zone) ? zone : {};
            return {
              id: stringFrom(zoneRecord.id, ""),
              name: stringFrom(zoneRecord.name, ""),
              role: stringFrom(zoneRecord.role, ""),
            };
          }).slice(0, 12),
          aliases: arrayFrom(record.aliases).map((name) => String(name)).slice(0, 12),
          continuityLock: stringFrom(record.continuityLock, ""),
        };
      }),
    props: arrayFrom(value.props)
      .slice(0, 50)
      .map((item) => {
        const record = isRecord(item) ? item : {};
        return {
          name: stringFrom(record.name ?? record.title, ""),
          description: stringFrom(record.description, ""),
        };
      }),
  };
  return JSON.stringify(compact).slice(0, 6000);
}

function summarizeAssetsForStoryboardPrompt(value: unknown): string {
  if (!isRecord(value)) return "{}";
  const compact = {
    characters: arrayFrom(value.characters)
      .slice(0, 30)
      .map((item) => summarizeCharacterAssetForStoryboard(isRecord(item) ? item : {})),
    locations: arrayFrom(value.locations ?? value.scenes)
      .slice(0, 30)
      .map((item) => {
        const record = isRecord(item) ? item : {};
        return {
          name: stringFrom(record.name ?? record.title, ""),
          timeOfDay: stringFrom(record.timeOfDay, ""),
          description: stringFrom(record.description, ""),
        };
      }),
    sceneVisualBibles: arrayFrom(value.sceneVisualBibles)
      .slice(0, 30)
      .map((item) => {
        const record = isRecord(item) ? item : {};
        const visualIdentity = isRecord(record.visualIdentity) ? record.visualIdentity : {};
        return {
          canonicalSceneId: stringFrom(record.canonicalSceneId, ""),
          canonicalName: stringFrom(record.canonicalName, ""),
          timeOfDay: stringFrom(visualIdentity.timeOfDay, ""),
          lighting: stringFrom(visualIdentity.lighting, ""),
          colorPalette: stringFrom(visualIdentity.colorPalette, ""),
          buildingType: stringFrom(visualIdentity.buildingType, ""),
          materialLanguage: stringFrom(visualIdentity.materialLanguage, ""),
          fixedLandmarks: arrayFrom(visualIdentity.fixedLandmarks).map((name) => String(name)).slice(0, 8),
          childZones: arrayFrom(record.childZones).map((zone) => {
            const zoneRecord = isRecord(zone) ? zone : {};
            return {
              id: stringFrom(zoneRecord.id, ""),
              name: stringFrom(zoneRecord.name, ""),
              role: stringFrom(zoneRecord.role, ""),
            };
          }).slice(0, 12),
          aliases: arrayFrom(record.aliases).map((name) => String(name)).slice(0, 12),
          continuityLock: stringFrom(record.continuityLock, ""),
        };
      }),
    props: arrayFrom(value.props)
      .slice(0, 50)
      .map((item) => {
        const record = isRecord(item) ? item : {};
        return {
          name: stringFrom(record.name ?? record.title, ""),
          description: stringFrom(record.description, ""),
        };
      }),
  };
  return JSON.stringify(compact).slice(0, 6000);
}

function workflowAssetNameFromRecord(record: Record<string, unknown>): string {
  return stringFrom(record.name ?? record.title, "").trim();
}

function assetLooksLikeContinuityTeamMember(record: Record<string, unknown>): boolean {
  const role = normalizeCompareText(stringFrom(record.role, ""));
  if (/(background|crowd|extra|zombie|victim|antagonist|villain|enemy|boss|ceo)/.test(role)) return false;
  const text = normalizeCompareText([
    record.name,
    record.title,
    record.role,
    record.description,
    record.visualPrompt,
    record.referencePolicy,
  ].map((item) => stringFrom(item, "")).join(" "));
  if (/(background|crowd|zombie|victim|antagonist|villain|enemy|boss|ceo|mutant villain)/.test(text)) return false;
  return /(protagonist|team leader|teammate|team member|squad|ally|supporting)/.test(text);
}

function clipStoryboardContinuityContext(
  workflow: ReturnType<typeof getWorkflowState>,
  clip: NormalizedWorkflowClip,
  shots: NormalizedStoryboardShot[],
): { characters: string[]; continuityCharacters: string[]; characterContinuityNote?: string } {
  const explicitCharacters = uniqueStrings([...(clip.characters ?? []), ...shots.flatMap((shot) => shot.characters)]).slice(0, 12);
  const settingKeys = new Set(uniqueStrings([clip.setting, ...shots.map((shot) => shot.setting)].filter(Boolean)).map(normalizeCompareText));
  const sameSettingShots = settingKeys.size > 0
    ? workflow.breakdownScenes.filter((shot) => settingKeys.has(normalizeCompareText(shot.setting)))
    : shots;
  const sameSettingCharacters = uniqueStrings(sameSettingShots.flatMap((shot) => shot.characters));
  const characterAssets = isRecord(workflow.assets)
    ? arrayFrom(workflow.assets.characters).map((item) => isRecord(item) ? item : {}).filter((item) => workflowAssetNameFromRecord(item))
    : [];
  const assetNames = new Set(characterAssets.map((item) => normalizeCompareText(workflowAssetNameFromRecord(item))));
  const teamHints = normalizeCompareText([
    clip.title,
    clip.plotGoal,
    clip.startState,
    clip.endState,
    clip.layoutMemory,
    clip.seedancePrompt,
    clip.storyboardPrompt,
    clip.storyboardNotes,
    ...shots.flatMap((shot) => [shot.title, shot.description, shot.action, shot.dialogue, shot.references, shot.visualPrompt, shot.directorBoardPrompt]),
  ].join("\n"));
  const likelyTeamScene = TEAM_SCENE_PATTERN.test(teamHints) || explicitCharacters.length >= 2;
  const continuityTeam = likelyTeamScene
    ? characterAssets.filter(assetLooksLikeContinuityTeamMember).map(workflowAssetNameFromRecord)
    : [];
  const allCandidates = uniqueStrings([...explicitCharacters, ...sameSettingCharacters, ...continuityTeam]);
  const droppedForMissingAsset = assetNames.size > 0
    ? allCandidates.filter((name) => !assetNames.has(normalizeCompareText(name)))
    : [];
  if (droppedForMissingAsset.length > 0) {
    console.warn(`[storyboard-continuity] Clip "${clip.id}": dropped characters without assets: ${droppedForMissingAsset.join(", ")}`);
  }
  const continuityCharacters = allCandidates
    .filter((name) => assetNames.size === 0 || assetNames.has(normalizeCompareText(name)))
    .slice(0, 12);
  const missing = continuityCharacters.filter((name) => !explicitCharacters.some((explicit) => normalizeCompareText(explicit) === normalizeCompareText(name)));
  return {
    characters: continuityCharacters.length ? continuityCharacters : explicitCharacters,
    continuityCharacters,
    ...(missing.length ? { characterContinuityNote: `Also keep these same-scene silent team members present where continuity requires: ${missing.join(", ")}.` } : {}),
  };
}

function summarizeCharacterAssetForStoryboard(record: Record<string, unknown>): Record<string, unknown> {
  const name = stringFrom(record.name, "");
  const hasReferenceImage = Boolean(
    stringFrom(record.referenceImageUrl, "") ||
      stringFrom(record.generatedImageUrl, "") ||
      stringFrom(record.referenceImageAssetId, "") ||
      stringFrom(record.generatedImageAssetId, ""),
  );
  const base = {
    name,
    role: stringFrom(record.role, ""),
    personality: stringFrom(record.personality, ""),
    habitualActions: stringFrom(record.habitualActions, ""),
    expressionNotes: stringFrom(record.expressionNotes, ""),
    hasReferenceImage,
  };
  if (hasReferenceImage) {
    return {
      ...base,
      visualReference: `Use ${name}'s linked character image as the visual reference. Do not describe or change clothing, outfit, body shape, colors, or appearance.`,
    };
  }
  return {
    ...base,
    description: stringFrom(record.description, ""),
    signatureProps: stringFrom(record.signatureProps, ""),
    visualPrompt: stringFrom(record.visualPrompt ?? record.prompt, ""),
    fruitIdentity: stringFrom(record.fruitIdentity, ""),
    primaryLook: stringFrom(record.primaryLook, ""),
    variantNotes: stringFrom(record.variantNotes, ""),
    lockedVisualIdentity: stringFrom(record.lockedVisualIdentity, ""),
    referencePolicy: stringFrom(record.referencePolicy, ""),
  };
}

type CharacterPropBinding = {
  character: string;
  props: string[];
};

function boundPropNamesFromRecord(record: Record<string, unknown>): string[] {
  return mergeBoundPropNames(arrayFrom(record.boundPropNames).map((item) => stringFrom(item, ""))).slice(0, 8);
}

function personalPropContinuityText(
  value: unknown,
  characterFilter: string[] = [],
  textLanguage: WorkflowClipContext["textLanguage"] = "Mixed",
): string {
  const bindings = inferCharacterPropBindings(value, characterFilter);
  if (bindings.length === 0) return "";
  if (textLanguage === "Chinese") {
    return [
      "角色个人道具连续性：",
      ...bindings.map((binding) => `- ${binding.character}: ${binding.props.join(", ")}`),
      "规则：这些道具属于列出的角色。除非原文明确移除或转移，否则在参考、视觉提示、故事板标签、站位图和动作节拍中保持“角色+道具”绑定。",
    ].join("\n");
  }
  return [
    "Character personal prop continuity:",
    ...bindings.map((binding) => `- ${binding.character}: ${binding.props.join(", ")}`),
    "Rule: these props belong to the listed characters. Keep owner + prop together in references, visualPrompt, storyboard labels, blocking maps, and action beats unless the source explicitly removes or transfers the prop.",
  ].join("\n");
}

function inferCharacterPropBindings(value: unknown, characterFilter: string[] = []): CharacterPropBinding[] {
  if (!isRecord(value)) return [];
  const characters = arrayFrom(value.characters)
    .map((item) => isRecord(item) ? item : {})
    .filter((item) => stringFrom(item.name, ""));
  const props = arrayFrom(value.props)
    .map((item) => isRecord(item) ? item : {})
    .filter((item) => stringFrom(item.name ?? item.title, ""));
  const filterKeys = new Set(characterFilter.map((name) => normalizeCompareText(name)).filter(Boolean));
  const output: CharacterPropBinding[] = [];

  for (const character of characters) {
    const characterName = stringFrom(character.name, "");
    if (filterKeys.size > 0 && !filterKeys.has(normalizeCompareText(characterName))) continue;
    const manualProps = boundPropNamesFromRecord(character);
    if (Array.isArray(character.boundPropNames)) {
      if (manualProps.length > 0) output.push({ character: characterName, props: manualProps });
      continue;
    }
    const searchable = [
      character.signatureProps,
      character.description,
      character.visualPrompt,
      character.lockedVisualIdentity,
      character.referencePolicy,
    ].map((item) => normalizeCompareText(stringFrom(item, ""))).filter(Boolean).join(" | ");
    if (!searchable) continue;

    const matchedProps: string[] = [];
    for (const prop of props) {
      const propName = stringFrom(prop.name ?? prop.title, "");
      if (!propName) continue;
      const propAliases = propAliasCandidates(propName, stringFrom(prop.description, ""));
      const propText = normalizeCompareText([prop.name, prop.title, prop.description, prop.function, prop.visualPrompt].map((item) => stringFrom(item, "")).join(" "));
      const ownerMatchesProp = propTextHasExplicitOwner(propText, characterName);
      const characterMentionsProp = propAliases.some((alias) => alias && searchable.includes(alias));
      if (ownerMatchesProp || characterMentionsProp) matchedProps.push(propName);
    }

    const propsFromSignature = extractSignaturePropNames(stringFrom(character.signatureProps, ""));
    const boundProps = mergeBoundPropNames([...matchedProps, ...propsFromSignature]).slice(0, 4);
    if (boundProps.length > 0) output.push({ character: characterName, props: boundProps });
  }

  return output.slice(0, 20);
}

function propAliasCandidates(name: string, description = ""): string[] {
  const base = normalizeCompareText(name);
  const aliases = new Set<string>([base]);
  if (base.includes("shotgun")) aliases.add("shotgun");
  const ironPanSignature = propCanonicalSignature(base);
  if (base.includes("magic pan") || base.includes("iron pan") || base.includes("frying pan") || base.includes("skillet") || ironPanSignature === "prop:iron-pan") {
    aliases.add("magic pan");
    aliases.add("iron magic pan");
    aliases.add("iron pan");
    aliases.add("cast iron pan");
    aliases.add("cast iron frying pan");
    aliases.add("frying pan");
    aliases.add("skillet");
  }
  if (base.includes("heavy gun")) aliases.add("heavy gun");
  if (base.includes("pillow")) aliases.add("pillow");
  void description;
  return Array.from(aliases).filter(Boolean);
}

function propTextHasExplicitOwner(propText: string, characterName: string): boolean {
  const escapedName = escapeRegExp(normalizeCompareText(characterName));
  if (!escapedName) return false;
  return new RegExp(`\\b${escapedName}\\s*'s\\b|\\bused\\s+by\\s+${escapedName}\\b|\\bcarried\\s+by\\s+${escapedName}\\b|\\bheld\\s+by\\s+${escapedName}\\b|\\bowned\\s+by\\s+${escapedName}\\b`).test(propText);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSignaturePropNames(value: string): string[] {
  return value
    .split(/[,;/|]+/)
    .map((item) => item.trim())
    .filter((item) => {
      const normalized = normalizeCompareText(item);
      if (!normalized) return false;
      return /(gun|shotgun|pan|skillet|pillow|needle|chair|button|weapon|tool|prop)/i.test(normalized);
    })
    .slice(0, 4);
}

function mergeBoundPropNames(values: string[]): string[] {
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizeCompareText(value);
    if (!normalized) continue;
    const covered = output.some((existing) => {
      const existingKey = normalizeCompareText(existing);
      return existingKey === normalized || existingKey.includes(normalized) || normalized.includes(existingKey);
    });
    if (!covered) output.push(value.trim());
  }
  return output;
}

function summarizeAuthorityCharacters(characters: WorkflowAuthorityCharacter[]): string {
  return JSON.stringify(
    characters.slice(0, 40).map((character) => ({
      name: character.name,
      role: character.role,
      bio: character.bio,
      prompt: character.prompt,
      fruitIdentity: stringFrom(character.traits.fruitIdentity, ""),
      lockedVisualIdentity: stringFrom(character.traits.lockedVisualIdentity, ""),
      referencePolicy: stringFrom(character.traits.referencePolicy, ""),
      personality: stringFrom(character.traits.personality, ""),
      height: stringFrom(character.traits.height, ""),
      primaryLook: stringFrom(character.traits.primaryLook, ""),
      expressionNotes: stringFrom(character.traits.expressionNotes, ""),
      habitualActions: stringFrom(character.traits.habitualActions, ""),
      variantNotes: stringFrom(character.traits.variantNotes, ""),
      signatureProps: stringFrom(character.traits.signatureProps, ""),
      colorPalette: stringFrom(character.traits.colorPalette, ""),
      visualAuthority: stringFrom(character.traits.visualAuthority, ""),
      hasReferenceImage: Boolean(stringFrom(character.traits.referenceImageAssetId, "") || stringFrom(character.traits.referenceImageUrl, "")),
    })),
  ).slice(0, 7000);
}

function summarizeAuthorityCharactersForStoryboard(characters: WorkflowAuthorityCharacter[]): string {
  return JSON.stringify(
    characters.slice(0, 40).map((character) => {
      const hasReferenceImage = Boolean(
        stringFrom(character.traits.referenceImageAssetId, "") ||
          stringFrom(character.traits.referenceImageUrl, "") ||
          stringFrom(character.traits.generatedImageAssetId, "") ||
          stringFrom(character.traits.generatedImageUrl, ""),
      );
      const base = {
        name: character.name,
        role: character.role,
        personality: stringFrom(character.traits.personality, ""),
        expressionNotes: stringFrom(character.traits.expressionNotes, ""),
        habitualActions: stringFrom(character.traits.habitualActions, ""),
        hasReferenceImage,
      };
      if (hasReferenceImage) {
        return {
          ...base,
          visualReference: `Use ${character.name}'s linked character image as the visual reference. Do not describe or change clothing, outfit, body shape, colors, or appearance.`,
        };
      }
      return {
        ...base,
        bio: character.bio,
        signatureProps: stringFrom(character.traits.signatureProps, ""),
        prompt: character.prompt,
        fruitIdentity: stringFrom(character.traits.fruitIdentity, ""),
        lockedVisualIdentity: stringFrom(character.traits.lockedVisualIdentity, ""),
        referencePolicy: stringFrom(character.traits.referencePolicy, ""),
        primaryLook: stringFrom(character.traits.primaryLook, ""),
        variantNotes: stringFrom(character.traits.variantNotes, ""),
        colorPalette: stringFrom(character.traits.colorPalette, ""),
        visualAuthority: stringFrom(character.traits.visualAuthority, ""),
      };
    }),
  ).slice(0, 7000);
}

function summarizeSetupSettings(settings: Record<string, unknown>): string {
  const compact = {
    customStyleName: stringFrom(settings.customStyleName, ""),
    customStylePrompt: stringFrom(settings.customStylePrompt, ""),
    generationStrategy: stringFrom(settings.generationStrategy, ""),
    projectTone: stringFrom(settings.projectTone, ""),
    directorNotes: stringFrom(settings.directorNotes, ""),
    characterIdentityRules: stringFrom(settings.characterIdentityRules, ""),
    globalPrompt: stringFrom(settings.globalPrompt, ""),
    scriptRules: isRecord(settings.scriptRules) ? settings.scriptRules : undefined,
  };
  return JSON.stringify(compact).slice(0, 5000);
}

function requiresSpecificFruitIdentityText(value: string): boolean {
  const text = value.toLowerCase();
  const mentionsFruit = /(fruit|水果|banana|apple|orange|lemon|grape|strawberry|pineapple|peach|pear|mango|kiwi|watermelon|香蕉|苹果|橙|柠檬|葡萄|草莓|菠萝|水蜜桃|桃|梨|芒果|猕猴桃|西瓜)/i.test(text);
  const universal = /(all|every|each|main characters|characters must|must have|specific|concrete|所有|全部|每个|全员|必须|具体)/i.test(text);
  return mentionsFruit && universal;
}

function firstLineAfterLabel(value: string | undefined, label: string): string | undefined {
  if (!value) return undefined;
  const line = value.split("\n").find((item) => item.trim().startsWith(label));
  return line?.slice(label.length).trim() || undefined;
}

function languageRules(sourceText: string): string {
  const language = detectSourceLanguage(sourceText);
  if (language === "English") {
    return [
      "Detected source language: English.",
      "Language lock:",
      "- Every human-readable string field you output must be English.",
      "- Do not translate titles, descriptions, actions, dialogue, references, or visual prompts into Chinese.",
      "- Dialogue must remain English. Copy dialogue words from the source whenever possible, but omit surrounding quotation marks inside JSON strings.",
      "- Asset names may keep their proper nouns exactly as written in the source.",
    ].join("\n");
  }
  if (language === "Chinese") {
    return [
      "Detected source language: Chinese.",
      "Language lock:",
      "- Human-readable story prose may be Chinese for review.",
      "- Do not translate dialogue into English unless the source itself uses English.",
      "- Copy dialogue words from the source whenever possible, but omit surrounding quotation marks inside JSON strings.",
      "- Asset names are the exception: if an existing character/prop/scene asset is referenced, keep its canonical asset name exactly instead of translating or transliterating it.",
    ].join("\n");
  }
  return [
    "Detected source language: mixed or unclear.",
    "Language lock:",
    "- Preserve the language of each source dialogue line.",
    "- Do not translate dialogue.",
    "- Keep narrative fields in the dominant source language.",
  ].join("\n");
}

function buildCharacterCanonicalizer(authority?: WorkflowAuthorityContext): CharacterCanonicalizer {
  const aliasToName = new Map<string, string>();
  const addAlias = (alias: string, canonical: string) => {
    const key = normalizeCompareText(alias);
    if (!key || !canonical || aliasToName.has(key)) return;
    aliasToName.set(key, canonical);
  };
  const hasCanonical = (name: string) =>
    (authority?.existingCharacters ?? []).some((character) => normalizeCompareText(character.name) === normalizeCompareText(name));

  for (const character of authority?.existingCharacters ?? []) {
    const canonical = character.name;
    addAlias(canonical, canonical);
    for (const alias of characterAliasCandidates(character)) addAlias(alias, canonical);
  }

  for (const [canonical, aliases] of Object.entries(COMMON_CHINESE_CHARACTER_NAME_ALIASES)) {
    if (!hasCanonical(canonical)) continue;
    for (const alias of aliases) addAlias(alias, canonical);
  }

  const canonicalizeName = (name: string): string => {
    const trimmed = String(name || "").trim();
    if (!trimmed) return "";
    return aliasToName.get(normalizeCompareText(trimmed)) ?? trimmed;
  };
  const canonicalizeList = (names: string[]): string[] => uniqueStrings(names.map(canonicalizeName).filter(Boolean));
  const canonicalizeText = (text: string): string => {
    let next = String(text || "");
    for (const [aliasKey, canonical] of Array.from(aliasToName.entries()).sort((a, b) => b[0].length - a[0].length)) {
      if (!/[\u3400-\u9fff]/.test(aliasKey)) continue;
      next = next.replace(new RegExp(escapeRegExp(aliasKey), "g"), canonical);
    }
    return next;
  };
  return { canonicalizeName, canonicalizeList, canonicalizeText };
}

const COMMON_CHINESE_CHARACTER_NAME_ALIASES: Record<string, string[]> = {
  Chloe: ["克洛伊", "克洛依", "克萝伊", "蔻依", "克洛艾"],
  Flora: ["弗洛拉", "芙洛拉", "佛洛拉", "弗罗拉", "芙萝拉"],
  Bob: ["鲍勃", "鲍伯"],
  Leo: ["里奥", "利奥", "莱奥"],
  Tiffany: ["蒂芙尼", "蒂凡尼"],
  Eugene: ["尤金"],
  Cultist: ["邪教徒", "教徒", "蔬菜教徒", "果蔬教徒"],
  Cultists: ["邪教徒", "教徒", "蔬菜教徒", "果蔬教徒"],
  Zombie: ["丧尸", "僵尸", "感染体"],
  Zombies: ["丧尸", "僵尸", "感染体"],
};

function characterAliasCandidates(character: WorkflowAuthorityCharacter): string[] {
  const traits = isRecord(character.traits) ? character.traits : {};
  const directAliases = [
    ...arrayFrom(traits.aliases),
    ...arrayFrom(traits.alias),
    ...arrayFrom(traits.chineseAliases),
    ...arrayFrom(traits.localizedNames),
    ...arrayFrom(traits.nameAliases),
  ].map((item) => stringFrom(item, ""));
  const textAliases = [
    stringFrom(traits.chineseName, ""),
    stringFrom(traits.localizedName, ""),
    stringFrom(traits.originalName, ""),
    stringFrom(traits.displayName, ""),
  ];
  return uniqueStrings([...directAliases, ...textAliases]).filter(Boolean);
}

function canonicalizeSpeakerLabelText(text: string, canonicalizer: CharacterCanonicalizer): string {
  const speakerMatch = String(text || "").match(/^([^:：]{1,40})\s*[:：]\s*([\s\S]+)$/);
  if (!speakerMatch) return canonicalizer.canonicalizeText(text);
  const speaker = canonicalizer.canonicalizeName((speakerMatch[1] ?? "").trim());
  const line = speakerMatch[2] ?? "";
  return `${speaker}: ${line}`.trim();
}

function detectSourceLanguage(sourceText: string): "English" | "Chinese" | "Mixed" {
  const cjkCount = (sourceText.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latinCount = (sourceText.match(/[A-Za-z]/g) ?? []).length;
  if (latinCount > Math.max(80, cjkCount * 4)) return "English";
  if (cjkCount > Math.max(40, latinCount)) return "Chinese";
  return "Mixed";
}

function sceneVisualBiblePromptRules(): string {
  return [
    "Scene Visual Bible / canonical scene identity rules:",
    "- Before extracting final scene assets or storyboard beats, infer canonical scenes by visual identity, not by every local object, wall, camera angle, aisle, door, altar, or corner.",
    "- A canonical scene means the same time of day, color palette, building type, material language, lighting family, and fixed landmarks.",
    "- Local altar, wall, aisle, door, corner, shelf, counter, freezer case, hallway segment, or other sub-area details should become sceneZone or sceneAnchors inside the parent canonical scene unless the source explicitly moves to a visually different location.",
    "- Do not split a local altar, wall, aisle, door, or corner into a new visual world when it is still inside the same location.",
    "- Preserve canonical identity when characters move within the same location; only change canonicalSceneId when the source clearly changes time, palette, building type, material language, lighting family, or fixed landmark set.",
    "- When the JSON shape allows it, output and preserve canonicalSceneId, sceneZone, sceneAnchors, and sceneVisualLock.",
    "- sceneVisualLock should compactly describe the fixed visual authority: canonical scene name, time of day, palette, building type, material language, lighting family, fixed landmarks, and what must not change.",
    "- Do not force perfection. The backend normalizer remains final authority, but your best-effort canonicalSceneId/sceneZone/sceneAnchors/sceneVisualLock helps preserve continuity.",
  ].join("\n");
}

function hasSourceLanguageMismatch(sourceText: string, value: unknown): boolean {
  if (detectSourceLanguage(sourceText) !== "English") return false;
  const text = collectStoryboardText(value);
  return /[\u3400-\u9fff]/.test(text);
}

function collectStoryboardText(value: unknown): string {
  const root = isRecord(value) ? value : {};
  const storyboard = arrayFrom(root.storyboard ?? root.shots ?? root.beats);
  return storyboard
    .map((item) => {
      const record = isRecord(item) ? item : {};
      return [
        record.title,
        record.description,
        record.action,
        record.dialogue,
        record.setting,
        record.references,
        record.visualPrompt,
      ]
        .filter((part) => typeof part === "string")
        .join("\n");
    })
    .join("\n");
}

async function parseModelJsonWithRepair(stageLabel: string, rawText: string, aiModelId: string | undefined, expectedShape: string): Promise<unknown> {
  const parsed = tryParseModelJson(rawText);
  if (parsed.ok) return parsed.value;

  console.warn(
    `[workflow-json] parse_failed stage=${stageLabel} chars=${rawText.length} snippet=${summarizeJsonParseFailure(rawText)}`,
  );

  const repairResult = await callWorkflowTextModel(
    `${stageLabel} JSON修复`,
    [
      {
        role: "system",
        content:
          "You repair malformed model output into strict JSON. Return only valid JSON. Do not wrap it in markdown. Do not add prose.",
      },
      {
        role: "user",
        content: [
          "Repair the following malformed or non-strict JSON-like output into one valid JSON object.",
          "Preserve the same information. Do not invent new story beats.",
          "If a string contains dialogue quotation marks, remove the surrounding quote marks or escape them correctly.",
          "No markdown fences. No comments. No trailing commas. No raw newline characters inside strings.",
          "",
          "Expected shape:",
          expectedShape,
          "",
          "Malformed output:",
          rawText.slice(0, 20000),
        ].join("\n"),
      },
    ],
    aiModelId,
  );

  const repaired = tryParseModelJson(repairResult.rawText);
  if (repaired.ok) return repaired.value;

  console.warn(
    `[workflow-json] repair_failed stage=${stageLabel} chars=${repairResult.rawText.length} snippet=${summarizeJsonParseFailure(repairResult.rawText)}`,
  );
  badRequest(`${stageLabel}失败：文本模型返回内容不是合法 JSON，自动修复后仍无法解析。`);
}

function tryParseModelJson(rawText: string): { ok: true; value: unknown } | { ok: false } {
  const cleaned = normalizeJsonCandidate(rawText);
  try {
    return { ok: true, value: JSON.parse(cleaned) };
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return { ok: true, value: JSON.parse(repairCommonJsonIssues(cleaned.slice(start, end + 1))) };
      } catch {
        // Fall through to false.
      }
    }
  }
  return { ok: false };
}

function normalizeJsonCandidate(rawText: string): string {
  return repairCommonJsonIssues(
    rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, ""),
  );
}

function repairCommonJsonIssues(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/[“”]/g, "'")
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

function summarizeJsonParseFailure(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function assetJsonShape(): string {
  return `{"summary":"short summary","characters":[{"name":"name","role":"PROTAGONIST|SUPPORTING|BACKGROUND","description":"story role","visualPrompt":"short visual identity","fruitIdentity":"specific fruit or empty","personality":"short personality","height":"relative/estimated height","primaryLook":"dominant story look","expressionNotes":"useful expressions","habitualActions":"signature gestures/actions","variantNotes":"mask/no-mask, gear on/off, or state variants","signatureProps":"signature outfit/props","colorPalette":"compact palette","lockedVisualIdentity":"locked short identity","referencePolicy":"reference rules"}],"locations":[{"name":"location","description":"visual setting","timeOfDay":"day/night/interior/etc"}],"props":[{"name":"prop","description":"story function"}]}`;
}

function storyboardJsonShape(): string {
  return `{"storyboard":[{"title":"beat title","description":"screen action","action":"main physical action","dialogue":"Speaker: dialogue text","durationSeconds":3,"characters":["names"],"setting":"location","canonicalSceneId":"scene-1-sanctuary-superstore-center","sceneZone":"Pallet Altar","sceneAnchors":["Pallet Altar","green fabric strips"],"sceneVisualLock":"Scene visual authority: Sanctuary Superstore Center...","references":"continuity notes","visualPrompt":"concise image/video prompt"}]}`;
}

function clipStoryboardPlanJsonShape(): string {
  return `{"panelCount":6,"storyboardPrompt":"final image-generation prompt for one clip-level storyboard image","notes":"short reason for panel count"}`;
}

function workflowJsonShape(): string {
  return `{"summary":"short summary","characters":[],"locations":[{"name":"location","description":"visual setting","timeOfDay":"day/night/interior/etc","canonicalSceneId":"scene-1-sanctuary-superstore-center","sceneZone":"Pallet Altar","sceneAnchors":["Pallet Altar","green fabric strips"],"sceneVisualLock":"Scene visual authority: Sanctuary Superstore Center..."}],"props":[],"storyboard":[{"title":"beat title","description":"screen action","action":"main physical action","dialogue":"Speaker: dialogue text","durationSeconds":3,"characters":["names"],"setting":"location","canonicalSceneId":"scene-1-sanctuary-superstore-center","sceneZone":"Pallet Altar","sceneAnchors":["Pallet Altar","green fabric strips"],"sceneVisualLock":"Scene visual authority: Sanctuary Superstore Center...","references":"continuity notes","visualPrompt":"concise image/video prompt"}]}`;
}

function normalizeClipStoryboardPlan(
  value: unknown,
  clip: NormalizedWorkflowClip,
  shots: NormalizedStoryboardShot[],
  input: z.infer<typeof clipStoryboardPlanSchema>,
  aspectRatio = "16:9",
  workflow?: ReturnType<typeof getWorkflowState>,
  authority?: WorkflowAuthorityContext,
): { panelCount: number; prompt: string; notes: string } {
  const record = isRecord(value) ? value : {};
  const manualPanelCount = input.panelMode === "manual" ? input.panelCount : undefined;
  const inferredPanelCount = normalizeClipNumber(
    record.panelCount ?? record.panels ?? record.gridCount,
    manualPanelCount ?? suggestClipStoryboardPanelCount(clip, shots),
    MIN_CLIP_STORYBOARD_PANEL_COUNT,
    MAX_CLIP_STORYBOARD_PANEL_COUNT,
  );
  const panelCount = manualPanelCount
    ? Math.max(MIN_CLIP_STORYBOARD_PANEL_COUNT, Math.min(MAX_CLIP_STORYBOARD_PANEL_COUNT, manualPanelCount))
    : inferredPanelCount;
  const prompt = cleanWorkflowPromptText(
    stringFrom(
      record.storyboardPrompt ?? record.prompt ?? record.imagePrompt,
      buildFallbackClipStoryboardPrompt(clip, shots, panelCount, aspectRatio, workflow, authority),
    ),
  );
  const usablePrompt = extractStoryboardPanelVideoBeats(prompt).length > 0
    ? prompt
    : buildFallbackClipStoryboardPrompt(clip, shots, panelCount, aspectRatio, workflow, authority);
  return {
    panelCount,
    prompt: finalizeClipStoryboardImagePrompt(usablePrompt || buildFallbackClipStoryboardPrompt(clip, shots, panelCount, aspectRatio, workflow, authority), panelCount, aspectRatio),
    notes: cleanWorkflowPublicText(stringFrom(record.notes ?? record.reason ?? record.reasoning, "")),
  };
}

function enforceClipStoryboardContinuityPrompt(
  prompt: string,
  continuity: ReturnType<typeof clipStoryboardContinuityContext>,
): string {
  const continuityCharacters = uniqueStrings(continuity.continuityCharacters);
  if (continuityCharacters.length === 0) return prompt;

  const promptKey = normalizeCompareText(prompt);
  const missing = continuityCharacters.filter((name) => !promptKey.includes(normalizeCompareText(name)));
  if (missing.length === 0 && /required continuity characters/i.test(prompt)) return prompt;

  const header = [
    `Required continuity characters: ${continuityCharacters.join(", ")}.`,
    "This is continuity context, not a requirement to draw every listed character in every panel. Use each panel's visible cast and framing note to decide who is actually on screen.",
    "Use linked character images as the complete visual authority. Do not add separate prop reference images; carried props already visible in character images stay with their characters.",
  ].join(" ");

  return cleanWorkflowPromptText([header, prompt].filter(Boolean).join("\n\n"));
}

function clipStoryboardDialogueLockLines(shots: NormalizedStoryboardShot[]): string[] {
  const seen = new Map<string, number>();
  const lines: string[] = [];
  for (const shot of shots) {
    const dialogue = typeof shot.dialogue === "string" ? cleanWorkflowPublicText(shot.dialogue) : "";
    if (!dialogue) continue;
    const key = normalizeCompareText(dialogue);
    const firstIndex = seen.get(key);
    if (firstIndex !== undefined) {
      lines.push(`D${lines.length + 1}: ${dialogue} (same as D${firstIndex})`);
    } else {
      seen.set(key, lines.length + 1);
      lines.push(`D${lines.length + 1}: ${dialogue}`);
    }
  }
  return lines;
}

function enforceClipStoryboardDialoguePrompt(prompt: string, shots: NormalizedStoryboardShot[]): string {
  const dialogueLines = clipStoryboardDialogueLockLines(shots);
  if (dialogueLines.length === 0) return prompt;
  const promptKey = normalizeCompareText(prompt);
  const missing = dialogueLines.filter((line) => !promptKey.includes(normalizeCompareText(line)));
  if (missing.length === 0 && /dialogue lock/i.test(prompt)) return prompt;
  const header = [
    "Dialogue lock for storyboard planning:",
    ...dialogueLines,
    "Do not translate, paraphrase, shorten, expand, or invent dialogue.",
    "If a panel has dialogue, its speech bubble must use the exact line from the Dialogue lock. Do not replace dialogue with summaries, IDs, abbreviations, or paraphrases.",
    "Place each exact dialogue line in one speech bubble on the most relevant panel only; continuation and reaction panels for the same beat use no speech bubble unless a different exact dialogue line is spoken.",
  ].join("\n");
  return cleanWorkflowPromptText([header, prompt].filter(Boolean).join("\n\n"));
}

function suggestClipStoryboardPanelCount(clip: NormalizedWorkflowClip, shots: NormalizedStoryboardShot[]): number {
  const duration = clip.estimatedDuration || shots.reduce((sum, shot) => sum + clampShotDuration(shot.durationSeconds), 0) || TARGET_CLIP_DURATION_SECONDS;
  const shotCount = Math.max(shots.length, clip.shotIds.length);
  const dialogueWords = clip.dialogueWordCount || shots.reduce((sum, shot) => sum + countEnglishWords(shot.dialogue), 0);
  const dialoguePressure = dialogueWords > TARGET_DIALOGUE_WORDS_PER_SECOND * 10 ? 1 : 0;
  if (duration < 6) return Math.max(MIN_CLIP_STORYBOARD_PANEL_COUNT, Math.min(6, shotCount + 2));
  if (duration <= 8) return Math.max(6, Math.min(8, shotCount + 3 + dialoguePressure));
  if (duration <= 12) return Math.max(8, Math.min(10, shotCount + 4 + dialoguePressure));
  return Math.max(10, Math.min(MAX_CLIP_STORYBOARD_PANEL_COUNT, shotCount + 5 + dialoguePressure));
}

function clipStoryboardFramingStrategy(): string {
  return [
    "Panel framing strategy: most panels should be medium close-ups, close-ups, reaction close-ups, over-shoulders, hand/prop inserts, and expression inserts.",
    "Use medium shots as the default fallback. Use wide/group panels only when that exact story beat needs spatial orientation or multi-character blocking.",
    "For vertical-video production, avoid making every panel a wide tableau; crop toward faces, hands, props, and single-speaker reactions so the storyboard translates cleanly to 9:16 video.",
    "Character reference images are an identity library, not a cast list for every panel.",
    "Each panel should draw only the characters required by that panel's action, dialogue, or visible-cast line; other continuity characters may be offscreen or edge-of-frame when the panel is close.",
    "Do not draw the same named character more than once inside a single panel.",
  ].join(" ");
}

function storyboardVisibleCastForShot(shot: NormalizedStoryboardShot, clip: NormalizedWorkflowClip): string[] {
  const text = normalizeCompareText([shot.title, shot.description, shot.action, shot.dialogue, shot.references, shot.visualPrompt].join(" "));
  const candidates = uniqueStrings([...(shot.characters ?? []), ...(clip.characters ?? [])]).slice(0, 12);
  const direct = candidates.filter((name) => {
    const key = normalizeCompareText(name);
    return key && text.includes(key);
  });
  if (direct.length > 0) return direct;
  return uniqueStrings(shot.characters ?? []).slice(0, 6);
}

function storyboardPanelFramingForShot(shot: NormalizedStoryboardShot, index: number): string {
  const text = normalizeCompareText([shot.shotSize, shot.cameraAngle, shot.composition, shot.title, shot.description, shot.action, shot.visualPrompt].join(" "));
  const hasDetailNeed = /\b(close|close-up|closeup|reaction|insert|detail|face|eyes|hand|prop|weapon)\b|特写|近景|反应|表情|眼神|手部|道具|武器|细节/.test(text);
  const hasWideNeed = /\b(wide|establishing|overhead|full room|group|team|everyone|all characters)\b|远景|全景|俯视|空间|全体|众人|主角团|所有角色/.test(text);
  if (hasDetailNeed || index % 3 === 1) return "close-up / reaction close-up / detail insert";
  if (hasWideNeed) return "brief medium group orientation only if needed, cropped toward the current action";
  if (index % 3 === 2) return "medium close-up / over-the-shoulder";
  return "medium close-up or tight medium shot";
}

function buildFallbackClipStoryboardPrompt(
  clip: NormalizedWorkflowClip,
  shots: NormalizedStoryboardShot[],
  panelCount: number,
  aspectRatio = "16:9",
  workflow?: ReturnType<typeof getWorkflowState>,
  authority?: WorkflowAuthorityContext,
): string {
  const shotLines = shots
    .map((shot, index) => {
      return [
        `Story beat ${String(index + 1).padStart(2, "0")} (${clampShotDuration(shot.durationSeconds)}s): ${shot.title}`,
        `show ${shot.action || shot.description}`,
        shot.dialogue ? `speech bubble when visible: ${shot.dialogue}` : "no speech bubble",
        shot.visualPrompt ? `visual cue: ${shot.visualPrompt}` : "",
      ]
        .filter(Boolean)
        .join("; ");
    })
    .join("\n");
  const panelLines = buildFallbackClipStoryboardPanelLines(clip, shots, panelCount);

  return finalizeClipStoryboardImagePrompt([
    `Create one ${aspectRatio} multi-panel 3D American comic storyboard image with ${panelCount} large panels.`,
    "This storyboard represents the whole Clip, not one isolated shot.",
    clipStoryboardBoardLayoutStrategy(panelCount, aspectRatio),
    clipStoryboardFramingStrategy(),
    `Clip title: ${clip.title}`,
    `Clip duration target: ${clip.estimatedDuration}s, never longer than 15s.`,
    `Setting: ${clip.setting || "use the current project setting"}`,
    `Characters: ${clip.characters.join(", ") || "characters from this Clip"}`,
    `Plot goal: ${clip.plotGoal}`,
    `Start state: ${clip.startState}`,
    `End state: ${clip.endState}`,
    clip.layoutMemory ? `Spatial continuity:\n${clip.layoutMemory}` : "",
    workflow?.assets ? `Current extracted assets:\n${summarizeAssetsForStoryboardPrompt(workflow.assets)}` : "",
    authority?.existingCharacters?.length ? `Existing Character records:\n${summarizeAuthorityCharactersForStoryboard(authority.existingCharacters)}` : "",
    authority?.characterIdentityRules ? `Character identity rules: ${authority.characterIdentityRules}` : "",
    authority?.globalPrompt ? `Global prompt: ${authority.globalPrompt}` : "",
    authority?.negativePrompt ? `Negative prompt: ${authority.negativePrompt}` : "",
    "Story beats to show across the comic panels:",
    shotLines,
    "Comic panels in reading order:",
    panelLines,
    "Panel planning rules: distribute the Clip action across the panels; do not create one board per single shot; keep screen direction, character positions, props, entrances, exits, and start/end states continuous.",
    "Panel cast rule: every Panel line has visible cast and framing guidance. Follow that line over the broader continuity character list.",
    "Visible board text: small panel number labels and speech-bubble dialogue only.",
    "Character rules: reference images define exact appearance. Use only short identity labels in text; do not invent clothing, hair, fruit type, or props that conflict with references.",
    "Board style: polished 3D American animated dark-comedy comic storyboard for AI video generation, saturated colors, clean 3D render, exaggerated acting, cinematic rim light, readable spatial blocking, fast comic-panel pacing.",
    "Avoid: decorative explanation paragraphs, UI chrome, watermarks, random non-dialogue text, inconsistent character identity, and isolated single-shot treatment.",
  ]
    .filter(Boolean)
    .join("\n"), panelCount, aspectRatio);
}

function buildFallbackClipStoryboardPanelLines(clip: NormalizedWorkflowClip, shots: NormalizedStoryboardShot[], panelCount: number): string {
  const count = Math.max(
    MIN_CLIP_STORYBOARD_PANEL_COUNT,
    Math.min(MAX_CLIP_STORYBOARD_PANEL_COUNT, Math.round(panelCount || suggestClipStoryboardPanelCount(clip, shots))),
  );
  if (shots.length === 0) {
    return Array.from({ length: count }, (_, index) => {
      const edge = index === 0 ? clip.startState : index === count - 1 ? clip.endState : clip.plotGoal;
      const action = cleanWorkflowPublicText(edge || clip.plotGoal || "Show the required Clip story beat clearly");
      const focusCharacter = clip.characters[index % Math.max(1, clip.characters.length)] || "current Clip subject";
      return `Panel ${index + 1}: visible cast: ${focusCharacter}; compose as medium close-up or close-up; show ${action}; no speech bubble; small corner label P${index + 1}; do not repeat the same character inside this panel.`;
    }).join("\n");
  }
  const firstPanelByShotIndex = new Map<number, number>();
  for (let index = 0; index < count; index += 1) {
    const shotIndex = Math.min(shots.length - 1, Math.floor((index * shots.length) / count));
    if (!firstPanelByShotIndex.has(shotIndex)) firstPanelByShotIndex.set(shotIndex, index);
  }
  const usedDialogueKeys = new Set<string>();
  return Array.from({ length: count }, (_, index) => {
    const shotIndex = Math.min(shots.length - 1, Math.floor((index * shots.length) / count));
    const shot = shots[shotIndex];
    const action = cleanWorkflowPublicText(shot.action || shot.description || shot.visualPrompt || "");
    const dialogue = cleanWorkflowPublicText(shot.dialogue || "");
    const dialogueKey = normalizeCompareText(dialogue);
    const shouldShowDialogue = Boolean(dialogue && dialogueKey && firstPanelByShotIndex.get(shotIndex) === index && !usedDialogueKeys.has(dialogueKey));
    if (shouldShowDialogue) usedDialogueKeys.add(dialogueKey);
    const visibleCast = limitStoryboardVisibleCast(storyboardVisibleCastForShot(shot, clip), shot, index).join(", ") || "current panel subjects only";
    const framing = storyboardPanelFramingForShot(shot, index);
    return `Panel ${index + 1}: ${[
      `visible cast: ${visibleCast}`,
      `compose as ${framing}`,
      action ? `show ${action}` : "",
      shouldShowDialogue ? `speech bubble: ${dialogue}` : "no speech bubble",
      "do not repeat the same character inside this panel",
      `small corner label P${index + 1}`,
    ].filter(Boolean).join(" | ")}.`;
  }).join("\n");
}

function limitStoryboardVisibleCast(names: string[], shot: NormalizedStoryboardShot, index: number): string[] {
  const unique = uniqueStrings(names).filter(Boolean);
  if (unique.length <= 2) return unique;
  const text = normalizeCompareText([shot.title, shot.description, shot.action, shot.dialogue, shot.references, shot.visualPrompt].join(" "));
  const needsGroup = /\b(group|team|everyone|all characters|crowd|surround|fight|battle|block|intercept|together)\b|全体|众人|主角团|团队|包围|战斗|拦截|一起/.test(text);
  if (needsGroup) return unique.slice(0, 3);
  return unique.slice(index % unique.length, index % unique.length + 2).concat(unique.slice(0, Math.max(0, (index % unique.length + 2) - unique.length))).slice(0, 2);
}

function normalizeOptimizedClipShots(value: unknown, fallbackShots: NormalizedStoryboardShot[]): NormalizedStoryboardShot[] {
  const root = isRecord(value) ? value : {};
  const items = arrayFrom(root.storyboard ?? root.shots ?? root.beats).slice(0, 30);
  if (items.length === 0) badRequest("Clip AI优化失败：模型没有返回分镜。");

  return items.map((item, index) => {
    const record = isRecord(item) ? item : {};
    const fallback = fallbackShots[Math.min(index, Math.max(0, fallbackShots.length - 1))];
    const title = cleanWorkflowPublicText(stringFrom(record.title, fallback?.title ?? `Clip shot ${index + 1}`)).slice(0, 180);
    const description = cleanWorkflowPublicText(stringFrom(record.description, stringFrom(record.summary, fallback?.description ?? "")));
    const action = cleanWorkflowPublicText(stringFrom(record.action, fallback?.action ?? ""));
    const dialogue = cleanWorkflowPublicText(stringFrom(record.dialogue, fallback?.dialogue ?? ""));
    const durationSeconds = numberFrom(record.durationSeconds, fallback?.durationSeconds ?? 3);
    const characters =
      arrayFrom(record.characters).length > 0
        ? arrayFrom(record.characters).map((name) => String(name)).slice(0, 12)
        : fallback?.characters ?? [];
    const setting = stringFrom(record.setting, fallback?.setting ?? "");
    const references = cleanWorkflowPublicText(stringFrom(record.references, fallback?.references ?? ""));
    const canonicalSceneId = stringFrom(record.canonicalSceneId, fallback?.canonicalSceneId ?? "");
    const sceneVisualLock = cleanWorkflowPublicText(stringFrom(record.sceneVisualLock, fallback?.sceneVisualLock ?? ""));
    const sceneZone = stringFrom(record.sceneZone, fallback?.sceneZone ?? "");
    const sceneAnchors = arrayFrom(record.sceneAnchors).length > 0
      ? arrayFrom(record.sceneAnchors).map((name) => String(name)).slice(0, 12)
      : fallback?.sceneAnchors ?? [];
    const visualPrompt = cleanWorkflowPublicText(stringFrom(record.visualPrompt, stringFrom(record.prompt, fallback?.visualPrompt ?? "")));
    const professional = inferProfessionalShotFields(
      {
        title,
        description,
        action,
        dialogue,
        durationSeconds,
        characters,
        setting,
        references,
        visualPrompt,
      },
      index,
    );

    return {
      id: fallback?.id ?? `shot-${String(index + 1).padStart(3, "0")}`,
      title,
      description,
      action,
      dialogue,
      durationSeconds,
      shotSize: stringFrom(record.shotSize ?? record.shot_size, fallback?.shotSize ?? professional.shotSize),
      cameraAngle: stringFrom(record.cameraAngle ?? record.camera_angle, fallback?.cameraAngle ?? professional.cameraAngle),
      cameraMove: stringFrom(record.cameraMove ?? record.camera_move, fallback?.cameraMove ?? professional.cameraMove),
      composition: stringFrom(record.composition, fallback?.composition ?? professional.composition),
      lens: stringFrom(record.lens, fallback?.lens ?? professional.lens),
      aperture: stringFrom(record.aperture, fallback?.aperture ?? professional.aperture),
      shutter: stringFrom(record.shutter, fallback?.shutter ?? professional.shutter),
      iso: stringFrom(record.iso, fallback?.iso ?? professional.iso),
      sound: stringFrom(record.sound ?? record.soundEffects, fallback?.sound ?? professional.sound),
      music: stringFrom(record.music, fallback?.music ?? professional.music),
      subtitle: stringFrom(record.subtitle, dialogue),
      characters,
      setting,
      references,
      canonicalSceneId,
      sceneVisualLock,
      sceneZone,
      sceneAnchors,
      visualPrompt,
      directorBoardPrompt: cleanWorkflowPromptText(
        stringFrom(record.directorBoardPrompt ?? record.boardPrompt, fallback?.directorBoardPrompt ?? professional.directorBoardPrompt),
      ),
      status: "ready",
    };
  });
}

function normalizeBreakdown(
  value: unknown,
  input: z.infer<typeof runWorkflowSchema>,
  project?: any,
  authority?: WorkflowAuthorityContext,
) {
  if (!isRecord(value)) badRequest("Text model JSON must be an object.");
  const characterCanonicalizer = buildCharacterCanonicalizer(authority);
  const characterAuthority = new Map<string, WorkflowAuthorityCharacter>();
  for (const character of authority?.existingCharacters ?? []) {
    const key = normalizeCompareText(character.name);
    if (key && !characterAuthority.has(key)) characterAuthority.set(key, character);
  }
  const characters = arrayFrom(value.characters).slice(0, 80).map((item, index) => {
    const record = isRecord(item) ? item : {};
    const rawName = stringFrom(record.name, `角色 ${index + 1}`).slice(0, 120);
    const name = characterCanonicalizer.canonicalizeName(rawName).slice(0, 120);
    const existing = characterAuthority.get(normalizeCompareText(name));
    const fruitIdentity = stringFrom(existing?.traits.fruitIdentity, stringFrom(record.fruitIdentity, ""));
    const lockedVisualIdentity = buildLockedVisualIdentity(name, record, existing, authority?.requiresSpecificFruitIdentity ?? false);
    const referencePolicy = stringFrom(
      existing?.traits.referencePolicy,
      stringFrom(
        record.referencePolicy,
        lockedVisualIdentity
          ? `Use only ${name} + ${lockedVisualIdentity} for visual continuity; do not add unconfirmed appearance details.`
          : "",
      ),
    );
    return {
      id: slugId("char", name, index),
      name,
      aliases: rawName && normalizeCompareText(rawName) !== normalizeCompareText(name) ? [rawName] : [],
      role: normalizeRole(stringFrom(record.role, stringFrom(existing?.role, "SUPPORTING"))),
      description: characterCanonicalizer.canonicalizeText(stringFrom(record.description, stringFrom(existing?.bio, ""))),
    visualPrompt: stringFrom(existing?.prompt, stringFrom(record.visualPrompt, stringFrom(record.prompt, ""))),
      fruitIdentity,
      personality: stringFrom(existing?.traits.personality, stringFrom(record.personality, "")),
      height: stringFrom(existing?.traits.height, stringFrom(record.height, "")),
      primaryLook: stringFrom(existing?.traits.primaryLook, stringFrom(record.primaryLook, "")),
      expressionNotes: stringFrom(existing?.traits.expressionNotes, stringFrom(record.expressionNotes, "")),
      habitualActions: stringFrom(existing?.traits.habitualActions, stringFrom(record.habitualActions, "")),
      variantNotes: stringFrom(existing?.traits.variantNotes, stringFrom(record.variantNotes, "")),
      signatureProps: stringFrom(existing?.traits.signatureProps, stringFrom(record.signatureProps, "")),
      colorPalette: stringFrom(existing?.traits.colorPalette, stringFrom(record.colorPalette, "")),
      lockedVisualIdentity,
      referencePolicy,
    };
  });

  const locations = arrayFrom(value.locations ?? value.scenes).slice(0, 80).map((item, index) => {
    const record = isRecord(item) ? item : {};
    const name = stringFrom(record.name ?? record.title, `场景 ${index + 1}`);
    return {
      id: slugId("loc", name, index),
      name,
      description: stringFrom(record.description, ""),
      timeOfDay: stringFrom(record.timeOfDay, ""),
    };
  });
  const sceneVisualBibles: SceneVisualBible[] = buildSceneVisualBible(locations);

  const props = arrayFrom(value.props).slice(0, 120).map((item, index) => {
    const record = isRecord(item) ? item : {};
    const name = stringFrom(record.name ?? record.title, `道具 ${index + 1}`);
    return {
      id: slugId("prop", name, index),
      name,
      description: stringFrom(record.description, ""),
    };
  });

  const storyboardDraft: NormalizedStoryboardShot[] = arrayFrom(value.storyboard ?? value.shots ?? value.beats).slice(0, 120).map((item, index) => {
    const record = isRecord(item) ? item : {};
    const title = characterCanonicalizer.canonicalizeText(stringFrom(record.title, `镜头 ${String(index + 1).padStart(2, "0")}`)).slice(0, 180);
    const description = cleanWorkflowPublicText(characterCanonicalizer.canonicalizeText(stringFrom(record.description, stringFrom(record.summary, ""))));
    const action = cleanWorkflowPublicText(characterCanonicalizer.canonicalizeText(stringFrom(record.action, "")));
    const dialogue = cleanWorkflowPublicText(canonicalizeSpeakerLabelText(stringFrom(record.dialogue, ""), characterCanonicalizer));
    const durationSeconds = numberFrom(record.durationSeconds, 3);
    const characters = characterCanonicalizer.canonicalizeList([
      ...arrayFrom(record.characters).map((name) => String(name)),
      ...extractAllocatedDialogueSpeakerNames(dialogue),
    ]).slice(0, 12);
    const setting = stringFrom(record.setting, "");
    const references = cleanWorkflowPublicText(characterCanonicalizer.canonicalizeText(stringFrom(record.references, "")));
    const visualPrompt = cleanWorkflowPublicText(characterCanonicalizer.canonicalizeText(stringFrom(record.visualPrompt, stringFrom(record.prompt, ""))));
    const visualLock = resolveSceneVisualLockForSetting(setting || title || description, sceneVisualBibles);
    const professional = inferProfessionalShotFields(
      {
        title,
        description,
        action,
        dialogue,
        durationSeconds,
        characters,
        setting,
        references,
        visualPrompt,
      },
      index,
    );
    return {
      id: `shot-${String(index + 1).padStart(3, "0")}`,
      title,
      description,
      action,
      dialogue,
      durationSeconds,
      shotSize: stringFrom(record.shotSize ?? record.shot_size, professional.shotSize),
      cameraAngle: stringFrom(record.cameraAngle ?? record.camera_angle, professional.cameraAngle),
      cameraMove: stringFrom(record.cameraMove ?? record.camera_move, professional.cameraMove),
      composition: stringFrom(record.composition, professional.composition),
      lens: stringFrom(record.lens, professional.lens),
      aperture: stringFrom(record.aperture, professional.aperture),
      shutter: stringFrom(record.shutter, professional.shutter),
      iso: stringFrom(record.iso, professional.iso),
      sound: stringFrom(record.sound ?? record.soundEffects, professional.sound),
      music: stringFrom(record.music, professional.music),
      subtitle: stringFrom(record.subtitle, dialogue),
      characters,
      setting,
      references,
      canonicalSceneId: visualLock?.canonicalSceneId ?? "",
      sceneVisualLock: visualLock?.sceneVisualLock ?? "",
      sceneZone: visualLock?.sceneZone ?? "",
      sceneAnchors: visualLock?.sceneAnchors ?? [],
      visualPrompt,
      directorBoardPrompt: cleanWorkflowPromptText(stringFrom(record.directorBoardPrompt ?? record.boardPrompt, professional.directorBoardPrompt)),
      status: index < 2 ? "ready" : "draft",
    };
  });
  const sourceDialogueLocks = sourceDialogueLockLines(input.sourceText)
    .map((lock) => canonicalizeSpeakerLabelText(lock, characterCanonicalizer));
  const sourceDialogueRepairedStoryboard = repairStoryboardDialogueFromSourceLocks(
    storyboardDraft,
    sourceDialogueLocks,
  );
  const storyboard = rebalanceStoryboardPacing(
    normalizeFragmentedStoryboardDialogue(sourceDialogueRepairedStoryboard, sourceDialogueLocks),
  );

  if (storyboard.length === 0 && input.stage !== "assets") {
    badRequest("Text model JSON did not include storyboard items.");
  }

  return {
    summary: stringFrom(value.summary, ""),
    episode: input.selectedEpisode,
    sourceName: input.sourceName ?? "",
    characters,
    locations,
    sceneVisualBibles,
    props,
    storyboard,
    clips: deriveWorkflowClipsFromShots(storyboard, workflowClipContext(project, characters, { characters, locations, props }, input.sourceText)),
  };
}

function canonicalizeWorkflowAssetsWithAuthority(
  assets: WorkflowAssetsRecord,
  authority?: WorkflowAuthorityContext,
): WorkflowAssetsRecord {
  const canonicalizer = buildCharacterCanonicalizer(authority);
  return {
    ...assets,
    characters: assets.characters.map((item, index) => {
      const name = canonicalizer.canonicalizeName(workflowAssetNameFromRecord(item));
      if (!name || normalizeCompareText(name) === normalizeCompareText(workflowAssetNameFromRecord(item))) return item;
      return mergeWorkflowAssetRecords(
        "characters",
        { ...item, name, title: name },
        {
          ...item,
          aliases: uniqueStrings([...workflowAssetAliasValues(item), workflowAssetNameFromRecord(item)]),
        },
        index,
      );
    }),
  };
}

function canonicalizeStoryboardShots(
  shots: NormalizedStoryboardShot[],
  authority?: WorkflowAuthorityContext,
): NormalizedStoryboardShot[] {
  const canonicalizer = buildCharacterCanonicalizer(authority);
  return shots.map((shot) => ({
    ...shot,
    title: canonicalizer.canonicalizeText(shot.title),
    description: canonicalizer.canonicalizeText(shot.description),
    action: canonicalizer.canonicalizeText(shot.action),
    dialogue: canonicalizeSpeakerLabelText(shot.dialogue, canonicalizer),
    subtitle: canonicalizeSpeakerLabelText(shot.subtitle || shot.dialogue, canonicalizer),
    characters: canonicalizer.canonicalizeList(shot.characters),
    references: canonicalizer.canonicalizeText(shot.references),
    visualPrompt: canonicalizer.canonicalizeText(shot.visualPrompt),
    directorBoardPrompt: canonicalizer.canonicalizeText(shot.directorBoardPrompt),
  }));
}

function canonicalizeWorkflowClipCharacters(
  clip: NormalizedWorkflowClip,
  authority?: WorkflowAuthorityContext,
): NormalizedWorkflowClip {
  const canonicalizer = buildCharacterCanonicalizer(authority);
  return {
    ...clip,
    characters: canonicalizer.canonicalizeList(clip.characters),
    title: canonicalizer.canonicalizeText(clip.title),
    plotGoal: canonicalizer.canonicalizeText(clip.plotGoal),
    startState: canonicalizer.canonicalizeText(clip.startState),
    endState: canonicalizer.canonicalizeText(clip.endState),
    emotionArc: canonicalizer.canonicalizeText(clip.emotionArc),
    layoutMemory: canonicalizer.canonicalizeText(clip.layoutMemory),
    directorFreedom: canonicalizer.canonicalizeText(clip.directorFreedom),
    seedancePrompt: canonicalizer.canonicalizeText(clip.seedancePrompt),
    storyboardPrompt: canonicalizer.canonicalizeText(clip.storyboardPrompt),
    storyboardNotes: canonicalizer.canonicalizeText(clip.storyboardNotes),
  };
}

function isWorkflowAssetsRecord(value: unknown): value is WorkflowAssetsRecord {
  return isRecord(value) && Array.isArray(value.characters) && Array.isArray(value.locations) && Array.isArray(value.props);
}

const TARGET_DIALOGUE_WORDS_PER_SECOND = 3.2;
const MAX_DIALOGUE_WORDS_PER_SECOND = 3.6;
const MAX_DIALOGUE_WORDS_PER_SHOT = 9;
const MAX_REBALANCED_STORYBOARD_SHOTS = 120;
const TARGET_CLIP_DURATION_SECONDS = 15;
const MIN_CLIP_TARGET_SECONDS = 4;
const MAX_CLIP_TARGET_SECONDS = 15;
const MAX_CLIP_DURATION_SECONDS = 15;
const MIN_REASONABLE_CLIP_DURATION_SECONDS = 5;
const SHORT_CLIP_MERGE_OVERFLOW_SECONDS = 2;
const MAX_CLIP_DIALOGUE_SECONDS = 15;
const CLIP_DIALOGUE_WORD_BUDGET = Math.floor(TARGET_DIALOGUE_WORDS_PER_SECOND * MAX_CLIP_DIALOGUE_SECONDS);
const TARGET_SECONDS_PER_STORYBOARD_BEAT = 2;
const MIN_CLIP_SHOTS_AT_FULL_DURATION = 7;

function sourceDialogueLockLines(sourceText: string): string[] {
  const source = String(sourceText || "");
  const quotedMatches = sourceQuoteMatches(source);
  const quotedRanges = quotedMatches.map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + (match[0]?.length ?? 0),
  }));
  const quoted = quotedMatches
    .filter((match) => isQuotedSourceDialogue(source, match[1] ?? "", match.index ?? 0, (match.index ?? 0) + (match[0]?.length ?? 0)))
    .map((match) => match[1] ?? "")
    .map((line) => cleanWorkflowPublicText(line))
    .filter((line) => line && !sourceDialogueLockLooksLikeNoise(line));
  const labelled = Array.from(source.matchAll(/(^|\n|\s)([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}|[一-龥·]{1,12})\s*[:：]\s*([^。！？.!?\n]{2,320}[。！？.!?]?)/g))
    .filter((match) => {
      const labelStart = (match.index ?? 0) + (match[1]?.length ?? 0);
      if (quotedRanges.some((range) => labelStart > range.start && labelStart < range.end)) return false;
      return !sourceDialogueLabelLooksLikeMetadata(match[2] ?? "", match[3] ?? "");
    })
    .map((match) => {
      const speaker = cleanWorkflowPublicText(match[2] ?? "");
      const line = cleanWorkflowPublicText(match[3] ?? "");
      return speaker && line ? `${speaker}: ${line}` : line;
    })
    .filter((line) => line && !sourceDialogueLockLooksLikeNoise(line));
  return uniqueStrings([...quoted, ...labelled]).slice(0, 40);
}

function sourceQuoteMatches(source: string): RegExpMatchArray[] {
  return [
    ...Array.from(source.matchAll(/"([^"\n]{2,500})"/g)),
    ...Array.from(source.matchAll(/“([^”\n]{2,500})”/g)),
    ...Array.from(source.matchAll(/[「『]([^」』\n]{2,500})[」』]/g)),
  ].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

function sourceDialogueLockLooksLikeNoise(line: string): boolean {
  const cleaned = cleanWorkflowPublicText(line);
  if (!cleaned) return true;
  if (/^[.\s…]+$/.test(cleaned)) return true;
  return false;
}

function sourceDialogueLabelLooksLikeMetadata(speaker: string, line: string): boolean {
  const speakerKey = normalizeCompareText(cleanWorkflowPublicText(speaker));
  const lineKey = normalizeCompareText(cleanWorkflowPublicText(line));
  if (!speakerKey || !lineKey) return true;
  if (/^(?:rate|status|index|temp|room temp|target temp|countdown|patch|cancel formatting|warning|critical warning|system alert)$/i.test(speakerKey)) {
    return true;
  }
  if (/^(?:heart rate|emotional fluctuation index|pain index|room temp|target temp)$/i.test(speakerKey)) {
    return true;
  }
  return false;
}

function isQuotedSourceDialogue(source: string, quote: string, startIndex: number, endIndex: number): boolean {
  const line = cleanWorkflowPublicText(quote);
  if (!line || sourceDialogueLockLooksLikeNoise(line)) return false;
  if (dialogueSpeakerName(line)) return true;
  const before = source.slice(Math.max(0, startIndex - 180), startIndex);
  const after = source.slice(endIndex, Math.min(source.length, endIndex + 180));
  const linePrefix = source.slice(source.lastIndexOf("\n", Math.max(0, startIndex - 1)) + 1, startIndex);
  const startsLine = linePrefix.trim().length === 0;
  const hasSentenceEnd = /[.!?。！？…]["'”’」』)]*$/.test(line);
  const wordCount = line.split(/\s+/).filter(Boolean).length;
  const speechVerb =
    "(?:said|asked|rasped|cursed|added|adding|replied|answered|called|shouted|yelled|screamed|shrieked|cried|muttered|whispered|growled|hissed|ordered|declared|warned|begged|pleaded|roared|laughed|continued|retorted)";
  const speakerAttribution =
    String.raw`(?:[A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}|[一-龥·]{1,12}|he|she|they|the\s+\w+(?:\s+\w+){0,3})`;
  const afterAttribution = new RegExp(String.raw`^\s*(?:[,，]\s*)?${speakerAttribution}\s+${speechVerb}\b`, "i").test(after);
  const beforeAttribution = new RegExp(String.raw`(?:${speechVerb}|:)\s*$`, "i").test(before);
  if (afterAttribution || beforeAttribution) return true;
  if (startsLine && (hasSentenceEnd || /[,，]$/.test(line) || wordCount > 2)) return true;
  if (wordCount <= 3 && !/[!?！？]/.test(line)) return false;
  return hasSentenceEnd && wordCount > 1;
}

function repairStoryboardDialogueFromSourceLocks(
  storyboard: NormalizedStoryboardShot[],
  sourceLocks: string[],
): NormalizedStoryboardShot[] {
  if (storyboard.length === 0 || sourceLocks.length === 0) return storyboard;
  const output = storyboard.map((shot) => ({ ...shot }));
  const consumed = new Set<number>();
  const locks = sourceLocks
    .map((lock) => ({
      raw: cleanVideoDialogue(lock),
      speaker: dialogueSpeakerName(lock),
      key: normalizeDialogueFragmentKey(stripDialogueSpeakerPrefix(lock)),
      wordCount: countEnglishWords(stripDialogueSpeakerPrefix(lock)),
    }))
    .filter((lock) => lock.raw && lock.key.length >= 12);

  for (const lock of locks) {
    for (let start = 0; start < output.length; start += 1) {
      if (consumed.has(start)) continue;
      const firstDialogue = cleanVideoDialogue(output[start].dialogue || "");
      if (!firstDialogue) continue;
      const firstSpeaker = dialogueSpeakerName(firstDialogue);
      if (lock.speaker && firstSpeaker && normalizeCompareText(lock.speaker) !== normalizeCompareText(firstSpeaker)) continue;
      const firstKey = normalizeDialogueFragmentKey(stripDialogueSpeakerPrefix(firstDialogue));
      if (!firstKey || !lock.key.startsWith(firstKey)) continue;
      if (firstKey === lock.key || lock.key.startsWith(firstKey)) {
        const match = findSourceDialogueLockMatch(output, start, lock.key, consumed);
        if (!match) continue;
        const speaker = firstSpeaker || lock.speaker;
        output[start] = {
          ...output[start],
          dialogue: formatLockedSourceDialogue(lock.raw, speaker),
          subtitle: formatLockedSourceDialogue(lock.raw, speaker),
          durationSeconds: Math.max(output[start].durationSeconds, clampShotDuration(Math.ceil(Math.max(lock.wordCount, 1) / TARGET_DIALOGUE_WORDS_PER_SECOND))),
        };
        for (const index of match.coveredIndexes.slice(1)) {
          output[index] = { ...output[index], dialogue: "", subtitle: "" };
          consumed.add(index);
        }
        consumed.add(start);
        break;
      }
    }
  }

  return output.map((shot, index) => refreshShotProfessionalFields(shot, index));
}

function findSourceDialogueLockMatch(
  storyboard: NormalizedStoryboardShot[],
  start: number,
  lockKey: string,
  consumed: Set<number>,
): { coveredIndexes: number[] } | null {
  let combined = "";
  const coveredIndexes: number[] = [];
  for (let index = start; index < Math.min(storyboard.length, start + 8); index += 1) {
    if (consumed.has(index) && index !== start) break;
    const dialogue = cleanVideoDialogue(storyboard[index].dialogue || "");
    if (!dialogue) {
      if (coveredIndexes.length > 0) continue;
      break;
    }
    const key = normalizeDialogueFragmentKey(stripDialogueSpeakerPrefix(dialogue));
    if (!key) continue;
    combined = normalizeDialogueFragmentKey(`${combined} ${key}`);
    if (!lockKey.startsWith(combined)) return null;
    coveredIndexes.push(index);
    if (combined === lockKey) return { coveredIndexes };
  }
  return isLongPrefixOfSourceLock(combined, lockKey) && coveredIndexes.length > 0 ? { coveredIndexes } : null;
}

function isLongPrefixOfSourceLock(fragmentKey: string, lockKey: string): boolean {
  if (!fragmentKey || !lockKey.startsWith(fragmentKey) || fragmentKey === lockKey) return false;
  const fragmentWords = fragmentKey.split(" ").filter(Boolean).length;
  const lockWords = lockKey.split(" ").filter(Boolean).length;
  return fragmentWords >= 6 && fragmentWords >= Math.min(lockWords - 1, Math.ceil(lockWords * 0.45));
}

function normalizeDialogueFragmentKey(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/["'“”‘’「」『』]/g, "")
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripDialogueSpeakerPrefix(value: string): string {
  return cleanVideoDialogue(value).replace(/^([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}|[一-龥·]{1,12})\s*[:：]\s*/, "").trim();
}

function formatLockedSourceDialogue(lock: string, speaker: string): string {
  const cleaned = cleanVideoDialogue(lock);
  if (!speaker || dialogueSpeakerName(cleaned)) return cleaned;
  return `${speaker}: ${cleaned}`;
}

function normalizeFragmentedStoryboardDialogue(storyboard: NormalizedStoryboardShot[], sourceLocks: string[] = []): NormalizedStoryboardShot[] {
  if (storyboard.length <= 1) return storyboard;
  const output = storyboard.map((shot) => ({ ...shot }));
  const sourceLockKeys = new Set(
    sourceLocks
      .map((lock) => normalizeDialogueFragmentKey(stripDialogueSpeakerPrefix(cleanVideoDialogue(lock))))
      .filter(Boolean),
  );
  let index = 0;
  while (index < output.length) {
    const current = output[index];
    const currentDialogue = cleanVideoDialogue(current.dialogue || "");
    const currentDialogueKey = normalizeDialogueFragmentKey(stripDialogueSpeakerPrefix(currentDialogue));
    if (!currentDialogue || dialogueHasTerminalPunctuation(currentDialogue) || sourceLockKeys.has(currentDialogueKey)) {
      index += 1;
      continue;
    }

    const speaker = dialogueSpeakerName(currentDialogue);
    let mergedDialogue = currentDialogue;
    let lastMergedIndex = index;
    for (let nextIndex = index + 1; nextIndex < output.length; nextIndex += 1) {
      const next = output[nextIndex];
      const nextDialogue = cleanVideoDialogue(next.dialogue || "");
      if (!nextDialogue) {
        if (lastMergedIndex === index) break;
        continue;
      }
      const nextSpeaker = dialogueSpeakerName(nextDialogue);
      if (nextSpeaker && speaker && normalizeCompareText(nextSpeaker) !== normalizeCompareText(speaker)) break;
      if (nextSpeaker && !speaker) break;
      mergedDialogue = mergeDialogueFragments(mergedDialogue, nextDialogue);
      output[nextIndex] = {
        ...next,
        dialogue: "",
        subtitle: "",
      };
      lastMergedIndex = nextIndex;
      if (dialogueHasTerminalPunctuation(mergedDialogue)) break;
    }

    if (lastMergedIndex > index) {
      output[index] = {
        ...current,
        dialogue: mergedDialogue,
        subtitle: mergedDialogue,
        durationSeconds: Math.max(current.durationSeconds, clampShotDuration(Math.ceil(countEnglishWords(mergedDialogue) / TARGET_DIALOGUE_WORDS_PER_SECOND))),
      };
      index = lastMergedIndex + 1;
      continue;
    }
    index += 1;
  }

  return output.map((shot, shotIndex) => refreshShotProfessionalFields(shot, shotIndex));
}

function mergeDialogueFragments(previous: string, next: string): string {
  const previousSpeaker = dialogueSpeakerName(previous);
  const nextSpeaker = dialogueSpeakerName(next);
  const nextText = nextSpeaker ? next.replace(/^([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}|[一-龥·]{1,12})\s*[:：]\s*/, "").trim() : next;
  const prefix = previousSpeaker ? `${previousSpeaker}: ` : "";
  const previousText = previousSpeaker ? previous.replace(/^([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}|[一-龥·]{1,12})\s*[:：]\s*/, "").trim() : previous;
  return cleanVideoDialogue(`${prefix}${previousText} ${nextText}`);
}

function dialogueHasTerminalPunctuation(dialogue: string): boolean {
  return /[.!?。！？…]["'”’」』)]*$/.test(cleanVideoDialogue(dialogue));
}

function rebalanceStoryboardPacing(storyboard: NormalizedStoryboardShot[]): NormalizedStoryboardShot[] {
  const rebalanced: NormalizedStoryboardShot[] = [];

  for (const shot of storyboard) {
    const words = countEnglishWords(shot.dialogue);
    const normalizedDuration = clampShotDuration(shot.durationSeconds);
    const requiredDuration = words > 0 ? Math.ceil(words / TARGET_DIALOGUE_WORDS_PER_SECOND) : normalizedDuration;
    const isTooDense = words > 0 && words / Math.max(1, normalizedDuration) > MAX_DIALOGUE_WORDS_PER_SECOND;

    if (!isTooDense || shouldKeepDialogueInSingleShot(shot.dialogue) || (words <= MAX_DIALOGUE_WORDS_PER_SHOT && requiredDuration <= 3)) {
      rebalanced.push(
        refreshShotProfessionalFields(
          {
            ...shot,
            durationSeconds: words > 0 ? Math.max(normalizedDuration, clampShotDuration(requiredDuration)) : normalizedDuration,
          },
          rebalanced.length,
        ),
      );
    } else {
      const fullDialogue = cleanVideoDialogue(shot.dialogue || "");
      const speechDuration = Math.max(1, Math.ceil(words / TARGET_DIALOGUE_WORDS_PER_SECOND));
      const primaryDuration = clampShotDuration(Math.min(3, speechDuration));
      rebalanced.push(
        refreshShotProfessionalFields(
          {
            ...shot,
            dialogue: fullDialogue,
            subtitle: fullDialogue,
            durationSeconds: primaryDuration,
          },
          rebalanced.length,
        ),
      );

      const silentCoverageCount = Math.min(4, Math.max(1, Math.ceil(speechDuration / 2) - 1));
      for (let coverageIndex = 0; coverageIndex < silentCoverageCount; coverageIndex += 1) {
        if (rebalanced.length >= MAX_REBALANCED_STORYBOARD_SHOTS) break;
        rebalanced.push(
          refreshShotProfessionalFields(
            {
              ...shot,
              title: `${shot.title} dialogue coverage ${coverageIndex + 1}`,
              description: `${shot.description || shot.action || shot.title} Silent visual coverage while the same dialogue continues.`,
              action: followupShotAction({ ...shot, dialogue: fullDialogue }),
              dialogue: "",
              subtitle: "",
              durationSeconds: 1,
              visualPrompt: followupShotVisualPrompt(shot),
              references: [
                shot.references,
                "Same dialogue turn continues over this silent reaction/cutaway shot.",
              ].filter(Boolean).join(" "),
            },
            rebalanced.length,
          ),
        );
      }
    }

    if (rebalanced.length >= MAX_REBALANCED_STORYBOARD_SHOTS) break;
  }

  const paced = expandSparseStoryboardGroups(rebalanced);
  return paced.map((shot, index) => ({
    ...shot,
    id: `shot-${String(index + 1).padStart(3, "0")}`,
    status: index < 2 ? "ready" : "draft",
  }));
}

function expandSparseStoryboardGroups(storyboard: NormalizedStoryboardShot[]): NormalizedStoryboardShot[] {
  const output: NormalizedStoryboardShot[] = [];
  let group: NormalizedStoryboardShot[] = [];
  const flush = () => {
    if (group.length > 0) output.push(...expandSparseClipGroup(group));
    group = [];
  };

  for (const shot of storyboard) {
    if (group.length > 0) {
      const previous = group[group.length - 1];
      const currentDuration = group.reduce((sum, item) => sum + clampShotDuration(item.durationSeconds), 0);
      const nextDuration = currentDuration + clampShotDuration(shot.durationSeconds);
      const settingChanged =
        Boolean(group[0].setting) &&
        Boolean(shot.setting) &&
        normalizeCompareText(group[0].setting) !== normalizeCompareText(shot.setting);
      const dialogueContinuation = isDialogueContinuationAcrossShotBoundary(previous, shot);
      const shouldSplit =
        !dialogueContinuation &&
        (group.length >= MAX_CLIP_STORYBOARD_PANEL_COUNT ||
          nextDuration > MAX_CLIP_DURATION_SECONDS ||
          (currentDuration >= 8 && settingChanged) ||
          (currentDuration >= 12 && nextDuration > MAX_CLIP_TARGET_SECONDS));
      if (shouldSplit) flush();
    }
    group.push(shot);
  }
  flush();
  return output;
}

function refreshShotProfessionalFields(shot: NormalizedStoryboardShot, index: number): NormalizedStoryboardShot {
  const professional = inferProfessionalShotFields(
    {
      title: shot.title,
      description: shot.description,
      action: shot.action,
      dialogue: shot.dialogue,
      durationSeconds: shot.durationSeconds,
      characters: shot.characters,
      setting: shot.setting,
      references: shot.references,
      visualPrompt: shot.visualPrompt,
    },
    index,
  );

  return {
    ...shot,
    shotSize: professional.shotSize,
    cameraAngle: professional.cameraAngle,
    cameraMove: professional.cameraMove,
    composition: professional.composition,
    lens: professional.lens,
    aperture: professional.aperture,
    shutter: professional.shutter,
    iso: professional.iso,
    sound: professional.sound,
    music: professional.music,
    directorBoardPrompt: professional.directorBoardPrompt,
  };
}

function countEnglishWords(text: string): number {
  return (text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g) ?? []).length;
}

function clampShotDuration(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.max(1, Math.min(3, Math.round(value)));
}

function shouldKeepDialogueInSingleShot(dialogue: string): boolean {
  const cleaned = cleanVideoDialogue(dialogue || "");
  if (!cleaned) return true;
  if (extractAllocatedDialogueSpeakerNames(cleaned).length > 1) return true;
  return splitDialogueIntoNaturalUnits(cleaned).length <= 1 && /[.!?。！？…]["'”’」』)]*$/.test(cleaned);
}

function splitDialogueIntoWordChunks(dialogue: string, maxWords: number): string[] {
  const speakerPrefix = dialogueSpeakerPrefix(dialogue);
  const naturalUnits = splitDialogueIntoNaturalUnits(dialogue);
  const chunks: string[] = [];
  let current = "";
  let words = 0;

  for (const unit of naturalUnits) {
    const unitWords = countEnglishWords(unit);
    if (unitWords > maxWords) {
      const forced = splitLongDialogueUnit(unit, maxWords);
      for (const piece of forced) {
        const pieceWords = countEnglishWords(piece);
        if (pieceWords > 0 && words > 0 && words + pieceWords > maxWords) {
          chunks.push(current.trim());
          current = piece;
          words = pieceWords;
        } else {
          current = [current, piece].filter(Boolean).join(" ");
          words += pieceWords;
        }
      }
      continue;
    }
    if (unitWords > 0 && words > 0 && words + unitWords > maxWords) {
      chunks.push(current.trim());
      current = unit;
      words = unitWords;
    } else {
      current = [current, unit].filter(Boolean).join(" ");
      words += unitWords;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  const normalizedChunks = chunks.length > 0 ? chunks : [dialogue];
  return normalizedChunks.map((chunk) => ensureDialogueSpeakerPrefix(chunk, speakerPrefix));
}

function dialogueSpeakerPrefix(dialogue: string): string {
  return dialogue.trim().match(/^([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}|[一-龥·]{1,12})\s*[:：]\s*/)?.[0] ?? "";
}

function ensureDialogueSpeakerPrefix(dialogue: string, speakerPrefix: string): string {
  const trimmed = dialogue.trim();
  if (!speakerPrefix || !trimmed || dialogueSpeakerPrefix(trimmed)) return trimmed;
  return `${speakerPrefix}${trimmed}`;
}

function splitDialogueIntoNaturalUnits(dialogue: string): string[] {
  const normalized = dialogue.trim().replace(/\s+/g, " ");
  if (!normalized) return [];
  const units = normalized.match(/[^.!?。！？；;]+[.!?。！？；;]*/g)?.map((item) => item.trim()).filter(Boolean) ?? [];
  return units.length > 0 ? units : [normalized];
}

function splitLongDialogueUnit(dialogue: string, maxWords: number): string[] {
  const tokens = dialogue.trim().split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];
  let words = 0;
  for (const token of tokens) {
    const tokenWords = countEnglishWords(token);
    const reachesSoftBreak = /[,，:]$/.test(token) && words >= Math.floor(maxWords * 0.6);
    if (current.length > 0 && (words + tokenWords > maxWords || reachesSoftBreak)) {
      chunks.push(current.join(" "));
      current = [];
      words = 0;
    }
    current.push(token);
    words += tokenWords;
  }
  if (current.length > 0) chunks.push(current.join(" "));
  return chunks.length > 0 ? chunks : [dialogue];
}

type WorkflowClipContext = {
  aspectRatio: string;
  visualStyle: string;
  characterIdentities: Record<string, string>;
  assets: unknown;
  textLanguage: "English" | "Chinese" | "Mixed";
};

function workflowClipContext(
  project?: any,
  characters: Array<{ name: string; lockedVisualIdentity?: string; fruitIdentity?: string }> = [],
  assets: unknown = {},
  sourceText = "",
): WorkflowClipContext {
  const settings = isRecord(project?.settings) ? project.settings : {};
  const setupSettings = isRecord(settings.setupSettings) ? settings.setupSettings : {};
  const videoStyle = [
    stringFrom(setupSettings.customStyleName, "") || stringFrom(settings.style, ""),
    stringFrom(setupSettings.customStylePrompt, ""),
    stringFrom(setupSettings.projectTone, ""),
  ]
    .filter(Boolean)
    .join("; ");
  const characterIdentities = Object.fromEntries(
    characters
      .map((character) => [
        normalizeCompareText(character.name),
        character.fruitIdentity ? `${character.name}, ${character.fruitIdentity}` : character.name,
      ])
      .filter(([, identity]) => Boolean(identity)),
  );
  return {
    aspectRatio: stringFrom(project?.aspectRatio, "16:9"),
    visualStyle: videoStyle || "cinematic 3D animated short-drama, fast pacing",
    characterIdentities,
    assets,
    textLanguage: detectSourceLanguage(sourceText),
  };
}

function workflowAssetCharacters(assets: unknown): Array<{ name: string; lockedVisualIdentity?: string; fruitIdentity?: string }> {
  const record = isRecord(assets) ? assets : {};
  return arrayFrom(record.characters).map((item) => {
    const character = isRecord(item) ? item : {};
    return {
      name: stringFrom(character.name, ""),
      lockedVisualIdentity: stringFrom(character.lockedVisualIdentity, ""),
      fruitIdentity: stringFrom(character.fruitIdentity, ""),
    };
  });
}

function normalizeWorkflowClip(value: unknown, index: number): NormalizedWorkflowClip {
  const record = isRecord(value) ? value : {};
  const estimatedDuration = normalizeClipNumber(record.estimatedDuration, TARGET_CLIP_DURATION_SECONDS, 1, MAX_CLIP_DURATION_SECONDS);
  const targetDuration = normalizeClipNumber(record.targetDuration, clampClipTarget(estimatedDuration), MIN_CLIP_TARGET_SECONDS, MAX_CLIP_TARGET_SECONDS);
  const maxDuration = normalizeClipNumber(record.maxDuration, MAX_CLIP_DURATION_SECONDS, targetDuration, MAX_CLIP_DURATION_SECONDS);
  const dialogueWordCount = normalizeClipNumber(record.dialogueWordCount, 0, 0, 5000);
  const panelCount = normalizeClipNumber(record.panelCount, 0, 0, MAX_CLIP_STORYBOARD_PANEL_COUNT);
  const storyboardControlLevel = normalizeControlLevel(stringFrom(record.storyboardControlLevel, "medium"));
  const storyboardType = normalizeStoryboardType(stringFrom(record.storyboardType, "multi_panel"));
  const title = stringFrom(record.title, `Clip ${String(index + 1).padStart(2, "0")}`);
  const shotIds = normalizeStringList(record.shotIds).slice(0, 80);
  const startState = stringFrom(record.startState, "");
  const endState = stringFrom(record.endState, "");
  const dialogueWordsPerSecond = estimatedDuration > 0 ? roundOne(dialogueWordCount / estimatedDuration) : 0;
  const preflight = normalizeClipPreflight(record.preflight, {
    estimatedDuration,
    targetDuration,
    maxDuration,
    dialogueWordCount,
    dialogueWordsPerSecond,
    shotCount: shotIds.length,
    panelCount,
    hasStartState: Boolean(startState),
    hasEndState: Boolean(endState),
  });

  return {
    id: stringFrom(record.id, `clip-${String(index + 1).padStart(3, "0")}`),
    title,
    plotGoal: stringFrom(record.plotGoal, stringFrom(record.description, title)),
    targetDuration,
    maxDuration,
    estimatedDuration,
    sceneType: stringFrom(record.sceneType, "mixed_scene"),
    storyboardControlLevel,
    storyboardType,
    panelCount,
    startState,
    endState,
    emotionArc: stringFrom(record.emotionArc, ""),
    dialogueWordCount,
    dialogueDensity: normalizeDialogueDensity(record.dialogueDensity, dialogueWordsPerSecond),
    characters: normalizeStringList(record.characters).slice(0, 12),
    setting: stringFrom(record.setting, ""),
    shotIds,
    layoutMemory: stringifyWorkflowText(record.layoutMemory),
    directorFreedom: stringifyWorkflowText(record.directorFreedom),
    seedancePrompt: stringifyWorkflowText(record.seedancePrompt),
    storyboardPrompt: stringifyWorkflowText(record.storyboardPrompt),
    storyboardPanelCount: normalizeClipNumber(record.storyboardPanelCount, 0, 0, MAX_CLIP_STORYBOARD_PANEL_COUNT),
    storyboardNotes: stringifyWorkflowText(record.storyboardNotes),
    preflight,
  };
}

function deriveWorkflowClipsFromShots(shots: NormalizedStoryboardShot[], context: WorkflowClipContext = workflowClipContext()): NormalizedWorkflowClip[] {
  if (shots.length === 0) return [];
  const groups: NormalizedStoryboardShot[][] = [];
  let current: NormalizedStoryboardShot[] = [];
  let currentDuration = 0;
  let currentDialogueWords = 0;

  for (const shot of shots) {
    const shotDuration = clampShotDuration(shot.durationSeconds);
    const shotWords = countEnglishWords(shot.dialogue);
    const nextDuration = currentDuration + shotDuration;
    const nextWords = currentDialogueWords + shotWords;
    const settingChanged =
      current.length > 0 &&
      Boolean(current[0].setting) &&
      Boolean(shot.setting) &&
      normalizeCompareText(current[0].setting) !== normalizeCompareText(shot.setting);
    const sceneEventChanged = current.length > 0 && shouldSplitClipForSceneEventBoundary(current, shot);
    const dialogueContinuation = current.length > 0 && isDialogueContinuationAcrossShotBoundary(current[current.length - 1], shot);
    const shouldSplit =
      current.length > 0 &&
      !dialogueContinuation &&
      (sceneEventChanged ||
        current.length >= MAX_CLIP_STORYBOARD_PANEL_COUNT ||
        nextDuration > MAX_CLIP_DURATION_SECONDS ||
        (currentDuration >= 8 && settingChanged) ||
        (currentDuration >= 10 && nextWords > CLIP_DIALOGUE_WORD_BUDGET) ||
        (currentDuration >= 12 && nextDuration > MAX_CLIP_TARGET_SECONDS));

    if (shouldSplit) {
      groups.push(current);
      current = [];
      currentDuration = 0;
      currentDialogueWords = 0;
    }

    current.push(shot);
    currentDuration += shotDuration;
    currentDialogueWords += shotWords;
  }

  if (current.length > 0) groups.push(current);
  return mergeShortWorkflowClipGroups(groups).map((group, index) => buildWorkflowClip(group, index, context));
}

function mergeShortWorkflowClipGroups(groups: NormalizedStoryboardShot[][]): NormalizedStoryboardShot[][] {
  const output: NormalizedStoryboardShot[][] = [];
  for (const sourceGroup of groups) {
    let group = [...sourceGroup];
    if (isShortWorkflowClipGroup(group) && output.length > 0) {
      const previous = output[output.length - 1];
      if (canMergeAdjacentWorkflowClipGroups(previous, group)) {
        output[output.length - 1] = compactWorkflowClipGroupDuration([...previous, ...group]);
        continue;
      }
    }
    output.push(compactWorkflowClipGroupDuration(group));
  }

  for (let index = 0; index < output.length; index += 1) {
    if (!isShortWorkflowClipGroup(output[index])) continue;
    const next = output[index + 1];
    if (!next || !canMergeAdjacentWorkflowClipGroups(output[index], next)) continue;
    output[index] = compactWorkflowClipGroupDuration([...output[index], ...next]);
    output.splice(index + 1, 1);
    index = Math.max(-1, index - 2);
  }

  return output;
}

function isShortWorkflowClipGroup(group: NormalizedStoryboardShot[]): boolean {
  return workflowClipGroupDuration(group) > 0 && workflowClipGroupDuration(group) < MIN_REASONABLE_CLIP_DURATION_SECONDS;
}

function workflowClipGroupDuration(group: NormalizedStoryboardShot[]): number {
  return group.reduce((sum, shot) => sum + clampShotDuration(shot.durationSeconds), 0);
}

function canMergeAdjacentWorkflowClipGroups(left: NormalizedStoryboardShot[], right: NormalizedStoryboardShot[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  if (left.length + right.length > MAX_CLIP_STORYBOARD_PANEL_COUNT) return false;
  const combinedDuration = workflowClipGroupDuration(left) + workflowClipGroupDuration(right);
  if (combinedDuration > MAX_CLIP_DURATION_SECONDS + SHORT_CLIP_MERGE_OVERFLOW_SECONDS) return false;
  if (workflowClipGroupsShareSceneAuthority(left, right)) return true;
  return isTransitionWorkflowClipGroup(left) && isTransitionWorkflowClipGroup(right);
}

function workflowClipGroupsShareSceneAuthority(left: NormalizedStoryboardShot[], right: NormalizedStoryboardShot[]): boolean {
  const leftKeys = workflowClipGroupSceneAuthorityKeys(left);
  const rightKeys = workflowClipGroupSceneAuthorityKeys(right);
  return leftKeys.some((key) => rightKeys.includes(key));
}

function workflowClipGroupSceneAuthorityKeys(group: NormalizedStoryboardShot[]): string[] {
  return uniqueStrings(
    group.flatMap((shot) => [
      shot.canonicalSceneId,
      shot.setting,
    ].map((value) => normalizeCompareText(value)).filter(Boolean)),
  );
}

function isTransitionWorkflowClipGroup(group: NormalizedStoryboardShot[]): boolean {
  const text = normalizeCompareText(
    group
      .map((shot) => [shot.title, shot.description, shot.action, shot.setting, shot.sceneZone, shot.visualPrompt].filter(Boolean).join(" "))
      .join(" "),
  );
  return /(escape|exit|air vent|duct|grate|surface|fresh air|bunker|climb|crawl|storm drain|skyline|travel|road|highway|ring road|motorcycle|motorbike|vehicle|drive|ride|speeds? through|weaves? through|逃|出口|通风|管道|爬|地表|新鲜空气|路上|道路|公路|高速|环线|城市环线|废车|废弃车辆|摩托|机车|车辆|行驶|驶入|驶出|驶向|冲出|冲向|穿梭|飞驰|疾驰|赶路)/.test(text);
}

function compactWorkflowClipGroupDuration(group: NormalizedStoryboardShot[]): NormalizedStoryboardShot[] {
  let overflow = workflowClipGroupDuration(group) - MAX_CLIP_DURATION_SECONDS;
  while (overflow > 0) {
    const candidate =
      group.find((shot) => !cleanVideoDialogue(shot.dialogue) && clampShotDuration(shot.durationSeconds) > 1) ??
      group.find((shot) => clampShotDuration(shot.durationSeconds) > 1);
    if (!candidate) break;
    candidate.durationSeconds = clampShotDuration(candidate.durationSeconds) - 1;
    overflow -= 1;
  }
  return group;
}

function shouldSplitClipForSceneEventBoundary(current: NormalizedStoryboardShot[], next: NormalizedStoryboardShot): boolean {
  const first = current[0];
  const previous = current[current.length - 1];
  if (!first || !previous) return false;
  const firstScene = normalizeSceneBoundaryKey(first);
  const nextScene = normalizeSceneBoundaryKey(next);
  if (firstScene && nextScene && firstScene !== nextScene) return true;
  const previousEvent = inferStoryboardEventBoundaryKey(previous);
  const nextEvent = inferStoryboardEventBoundaryKey(next);
  return Boolean(previousEvent && nextEvent && previousEvent !== nextEvent);
}

function normalizeSceneBoundaryKey(shot: NormalizedStoryboardShot): string {
  return [
    shot.canonicalSceneId || shot.setting,
    shot.sceneZone,
  ].map((part) => normalizeCompareText(String(part || ""))).filter(Boolean).join("|");
}

function inferStoryboardEventBoundaryKey(shot: NormalizedStoryboardShot): string {
  const text = normalizeCompareText([shot.title, shot.description, shot.action, shot.visualPrompt, shot.references].filter(Boolean).join(" "));
  if (!text) return "";
  if (/(trial|judgment|judge|审判|裁决)/.test(text)) return "trial";
  if (/(ritual|harvest|announce|announcement|pa speaker|sermon|仪式|广播|宣告|布道)/.test(text)) return "ritual-announcement";
  if (/(freezer|frozen meat|fungus|wall whisper|冷冻|冻肉|真菌|墙)/.test(text)) return "freezer-discovery";
  if (/(escape|run away|chase|pursuit|逃|追逐)/.test(text)) return "escape";
  if (/(door gap|shutter|gunshot|shotgun|zombie|门缝|卷帘门|枪响|霰弹|丧尸)/.test(text)) return "door-gunshot";
  return "";
}

function expandSparseClipGroup(group: NormalizedStoryboardShot[]): NormalizedStoryboardShot[] {
  const duration = group.reduce((sum, shot) => sum + clampShotDuration(shot.durationSeconds), 0);
  const targetCount = Math.min(
    MAX_CLIP_STORYBOARD_PANEL_COUNT,
    Math.max(
      duration >= MAX_CLIP_TARGET_SECONDS ? MIN_CLIP_SHOTS_AT_FULL_DURATION : 0,
      Math.ceil(duration / TARGET_SECONDS_PER_STORYBOARD_BEAT),
      group.length,
    ),
  );
  if (group.length >= targetCount || group.length === 0) return group;

  const output = group.map((shot) => ({ ...shot, durationSeconds: clampShotDuration(shot.durationSeconds) }));
  let cursor = 0;
  while (output.length < targetCount) {
    const candidates = output
      .map((shot, index) => ({ shot, index }))
      .filter(({ shot }) => clampShotDuration(shot.durationSeconds) >= 3);
    const candidate = candidates[cursor % Math.max(1, candidates.length)];
    if (!candidate) break;
    cursor += 1;
    const first = {
      ...candidate.shot,
      durationSeconds: 2,
      title: `${candidate.shot.title} setup`,
      action: candidate.shot.action || candidate.shot.description || candidate.shot.visualPrompt,
    };
    const second = refreshShotProfessionalFields({
              ...candidate.shot,
              durationSeconds: 1,
              title: `${candidate.shot.title} reaction`,
              description: `${shotReactionSubject(candidate.shot)} reacts to the previous moment with a visible change in expression or posture.`,
              action: followupShotAction(candidate.shot),
              dialogue: "",
              subtitle: "",
      visualPrompt: followupShotVisualPrompt(candidate.shot),
    }, candidate.index + 1);
    output.splice(candidate.index, 1, first, second);
  }

  return output.map((shot, index) => refreshShotProfessionalFields({
    ...shot,
    durationSeconds: clampShotDuration(shot.durationSeconds),
    status: index < 2 ? "ready" : "draft",
  }, index));
}

function followupShotAction(shot: NormalizedStoryboardShot): string {
  const text = normalizeCompareText(`${shot.title} ${shot.description} ${shot.action}`);
  if (/(fire|shoot|shotgun|gun|射|枪|开火|霰弹)/.test(text)) return `${shot.action || shot.description} Show the impact, recoil, smoke, or target reaction.`;
  if (/(dialogue|argue|say|speak|shout|对话|对白|说|喊)/.test(text) || shot.dialogue) {
    return dialogueCoverageShotAction(shot);
  }
  return `${shotReactionSubject(shot)} continues the motion through a tighter expression, hand, prop, or posture detail.`;
}

function dialogueCoverageShotAction(shot: NormalizedStoryboardShot): string {
  const speakers = extractAllocatedDialogueSpeakerNames(shot.dialogue || "");
  const visible = uniqueStrings(shot.characters || []);
  const listeners = visible.filter((name) => !speakers.some((speaker) => normalizeCompareText(speaker) === normalizeCompareText(name)));
  const subject = listeners[0] || visible[0] || "Visible subject";
  const baseAction = compactPromptText(shot.action || shot.description || shot.visualPrompt);
  const lower = normalizeCompareText(`${shot.title} ${shot.description} ${shot.action} ${shot.dialogue}`);
  if (/(needle|tubing|fluid|tendril|vine|restraint|bone|针|管|藤|束缚|液体)/.test(lower)) {
    return `${subject} reacts through the existing restraint setup; hold on the vine pressure, tubing, hands, eyes, or breath while the same dialogue turn continues.`;
  }
  if (/(lecture|sermon|ritual|announce|trial|judgment|仪式|宣告|审判|布道)/.test(lower)) {
    return `${subject} holds a tense listening reaction while the speaker's ritual authority dominates the room.`;
  }
  if (/(insult|mock|sarcastic|joke|wisecrack|讽刺|吐槽|冷笑)/.test(lower)) {
    return `${subject} lands the comedy beat with a dry look, small recoil, or restrained glare while the line finishes.`;
  }
  return baseAction
    ? `${subject} shows a specific reaction to the preceding action: ${baseAction}`
    : `${subject} gives a concise reaction cutaway tied to the previous spoken beat.`;
}

function followupShotVisualPrompt(shot: NormalizedStoryboardShot): string {
  return [
    shot.visualPrompt || shot.description || shot.action,
    `${shotReactionSubject(shot)} keeps the established blocking while changing gaze, posture, hand position, or prop contact`,
  ].filter(Boolean).join("; ");
}

function shotReactionSubject(shot: NormalizedStoryboardShot): string {
  const characters = (shot.characters || []).filter(Boolean);
  if (characters.length === 0) return "Visible subject";
  if (characters.length === 1) return characters[0];
  return characters.slice(0, 2).join(" and ");
}

function isDialogueContinuationAcrossShotBoundary(previous: NormalizedStoryboardShot | undefined, next: NormalizedStoryboardShot): boolean {
  const previousDialogue = cleanVideoDialogue(previous?.dialogue || "");
  const nextDialogue = cleanVideoDialogue(next.dialogue || "");
  if (!previousDialogue || !nextDialogue) return false;
  if (/[.!?。！？…]["'”’」』)]*$/.test(previousDialogue)) return false;
  const previousSpeaker = dialogueSpeakerName(previousDialogue);
  const nextSpeaker = dialogueSpeakerName(nextDialogue);
  if (nextSpeaker && previousSpeaker && normalizeCompareText(nextSpeaker) !== normalizeCompareText(previousSpeaker)) return false;
  if (nextSpeaker && previousSpeaker) return true;
  if (!nextSpeaker && previousSpeaker) return true;
  if (!nextSpeaker && !previousSpeaker && previous?.characters.length === 1 && next.characters.length === 1) {
    return normalizeCompareText(previous.characters[0]) === normalizeCompareText(next.characters[0]);
  }
  return false;
}

function dialogueSpeakerName(dialogue: string): string {
  return extractAllocatedDialogueSpeakerNames(dialogue)[0] ?? "";
}

function buildWorkflowClip(group: NormalizedStoryboardShot[], index: number, context: WorkflowClipContext): NormalizedWorkflowClip {
  const estimatedDuration = group.reduce((sum, shot) => sum + clampShotDuration(shot.durationSeconds), 0);
  const targetDuration = clampClipTarget(estimatedDuration);
  const maxDuration = MAX_CLIP_DURATION_SECONDS;
  const dialogueWordCount = group.reduce((sum, shot) => sum + countEnglishWords(shot.dialogue), 0);
  const dialogueWordsPerSecond = estimatedDuration > 0 ? roundOne(dialogueWordCount / estimatedDuration) : 0;
  const characters = uniqueStrings(group.flatMap((shot) => shot.characters)).slice(0, 12);
  const setting = mostCommonString(group.map((shot) => shot.setting).filter(Boolean));
  const sceneType = classifyClipSceneType(group, dialogueWordCount, estimatedDuration);
  const storyboardControlLevel = chooseClipControlLevel(group, sceneType, dialogueWordsPerSecond, characters.length);
  const storyboardType = chooseStoryboardType(storyboardControlLevel, sceneType);
  const panelCount = choosePanelCount(storyboardType, group.length);
  const title = `Clip ${String(index + 1).padStart(2, "0")} · ${group[0].title}`;
  const startState = describeClipEndpoint(group[0], "start", context.textLanguage);
  const endState = describeClipEndpoint(group[group.length - 1], "end", context.textLanguage);
  const emotionArc = inferClipEmotionArc(group);
  const plotGoal = inferClipPlotGoal(group);
  const shotIds = group.map((shot) => shot.id);
  const dialogueDensity = normalizeDialogueDensity(undefined, dialogueWordsPerSecond);
  const characterPropContinuity = personalPropContinuityText(context.assets, characters, context.textLanguage);
  const layoutMemory = composeLayoutMemory(group, startState, endState, setting, characters, characterPropContinuity, context.textLanguage);
  const directorFreedom = composeDirectorFreedom(storyboardControlLevel, sceneType);
  const preflight = buildClipPreflight({
    estimatedDuration,
    targetDuration,
    maxDuration,
    dialogueWordCount,
    dialogueWordsPerSecond,
    shotCount: group.length,
    panelCount,
    hasStartState: Boolean(startState),
    hasEndState: Boolean(endState),
  });

  return {
    id: `clip-${String(index + 1).padStart(3, "0")}`,
    title,
    plotGoal,
    targetDuration,
    maxDuration,
    estimatedDuration,
    sceneType,
    storyboardControlLevel,
    storyboardType,
    panelCount,
    startState,
    endState,
    emotionArc,
    dialogueWordCount,
    dialogueDensity,
    characters,
    setting,
    shotIds,
    layoutMemory,
    directorFreedom,
    seedancePrompt: "",
    storyboardPrompt: "",
    storyboardPanelCount: panelCount,
    storyboardNotes: "",
    preflight,
  };
}

function regenerateWorkflowClipSeedancePrompt(
  project: any,
  workflow: ReturnType<typeof getWorkflowState>,
  clip: NormalizedWorkflowClip,
  group: NormalizedStoryboardShot[],
): Pick<
  NormalizedWorkflowClip,
  | "plotGoal"
  | "targetDuration"
  | "maxDuration"
  | "estimatedDuration"
  | "sceneType"
  | "storyboardControlLevel"
  | "storyboardType"
  | "panelCount"
  | "startState"
  | "endState"
  | "emotionArc"
  | "dialogueWordCount"
  | "dialogueDensity"
  | "characters"
  | "setting"
  | "layoutMemory"
  | "directorFreedom"
  | "seedancePrompt"
  | "preflight"
> {
  const estimatedDuration = group.reduce((sum, shot) => sum + clampShotDuration(shot.durationSeconds), 0) || clip.estimatedDuration;
  const targetDuration = clampClipTarget(estimatedDuration);
  const maxDuration = MAX_CLIP_DURATION_SECONDS;
  const dialogueWordCount = group.reduce((sum, shot) => sum + countEnglishWords(shot.dialogue), 0);
  const dialogueWordsPerSecond = estimatedDuration > 0 ? roundOne(dialogueWordCount / estimatedDuration) : 0;
  const characters = uniqueStrings([...(clip.characters ?? []), ...group.flatMap((shot) => shot.characters)]).slice(0, 12);
  const setting = chooseClipPromptSetting(clip, group);
  const sceneVisualLock = chooseClipSceneVisualLock(group, setting);
  const sceneType = clip.sceneType || classifyClipSceneType(group, dialogueWordCount, estimatedDuration);
  const storyboardControlLevel = normalizeControlLevel(clip.storyboardControlLevel);
  const storyboardType = normalizeStoryboardType(clip.storyboardType || chooseStoryboardType(storyboardControlLevel, sceneType));
  const panelCount = clip.panelCount || choosePanelCount(storyboardType, group.length);
  const context = workflowClipContext(project, workflowAssetCharacters(workflow.assets), workflow.assets, workflow.sourceText);
  const startState = clipEndpointState(clip.startState || "", group[0], "start", context.textLanguage);
  const endState = clipEndpointState(clip.endState || "", group[group.length - 1], "end", context.textLanguage);
  const emotionArc = clip.emotionArc || inferClipEmotionArc(group);
  const plotGoal = clip.plotGoal || inferClipPlotGoal(group);
  const characterPropContinuity = personalPropContinuityText(context.assets, characters, context.textLanguage);
  const layoutMemory = composeLayoutMemory(group, startState, endState, setting, characters, characterPropContinuity, context.textLanguage);
  const directorFreedom = composeDirectorFreedom(storyboardControlLevel, sceneType);
  const preflight = buildClipPreflight({
    estimatedDuration,
    targetDuration,
    maxDuration,
    dialogueWordCount,
    dialogueWordsPerSecond,
    shotCount: group.length,
    panelCount,
    hasStartState: Boolean(startState),
    hasEndState: Boolean(endState),
  });
  const storyboardBeats = buildClipVideoStoryboardBeats(clip, group, workflow);
  const seedancePrompt = composeSeedancePrompt({
    estimatedDuration,
    targetDuration,
    aspectRatio: context.aspectRatio,
    visualStyle: context.visualStyle,
    characterIdentities: context.characterIdentities,
    setting,
    sceneVisualLock,
    characters,
    plotGoal,
    startState,
    endState,
    actions: group.map((shot) => shot.action || shot.description).filter(Boolean),
    dialogue: group.map((shot) => shot.dialogue).filter(Boolean),
    storyboardBeats,
    layoutMemory,
    characterPropContinuity,
    storyboardControlLevel,
    storyboardType,
    directorFreedom,
  });

  return {
    plotGoal,
    targetDuration,
    maxDuration,
    estimatedDuration,
    sceneType,
    storyboardControlLevel,
    storyboardType,
    panelCount,
    startState,
    endState,
    emotionArc,
    dialogueWordCount,
    dialogueDensity: normalizeDialogueDensity(clip.dialogueDensity, dialogueWordsPerSecond),
    characters,
    setting,
    layoutMemory,
    directorFreedom,
    seedancePrompt,
    preflight,
  };
}

function chooseClipPromptSetting(clip: NormalizedWorkflowClip, group: NormalizedStoryboardShot[]): string {
  const settings = group.map((shot) => cleanWorkflowPublicText(shot.setting)).filter(Boolean);
  if (settings.length === 0) return cleanWorkflowPublicText(clip.setting || "");
  const first = settings[0];
  const last = [...settings].reverse().find(Boolean) || first;
  const uniqueSettings = uniqueStrings(settings);
  if (uniqueSettings.length <= 1) return first;

  const clipSettingKey = normalizeCompareText(clip.setting || "");
  const firstKey = normalizeCompareText(first);
  const lastKey = normalizeCompareText(last);
  const lastCount = settings.filter((item) => normalizeCompareText(item) === lastKey).length;
  const transitionText = normalizeCompareText(
    group.map((shot) => `${shot.title} ${shot.description} ${shot.action} ${shot.references} ${shot.visualPrompt}`).join(" "),
  );
  const hasExplicitTransition =
    /(drag|pulled|pulls?|toward|into|through|escape|climb|enter|exit|move|shove|carry|fall|drop|duct|door|wall|drywall|drain|拖|拉|拽|推|进入|离开|逃|墙|通风管|下水道)/.test(
      transitionText,
    );

  if (lastKey && lastKey !== firstKey && (lastCount >= 2 || hasExplicitTransition || clipSettingKey === firstKey)) {
    return last;
  }

  return mostCommonString(settings) || first;
}

function chooseClipSceneVisualLock(group: NormalizedStoryboardShot[], setting: string): string {
  const settingKey = normalizeCompareText(setting);
  if (settingKey) {
    const matching = [...group]
      .reverse()
      .find((shot) => normalizeCompareText(shot.setting) === settingKey && cleanWorkflowPublicText(shot.sceneVisualLock || ""));
    if (matching?.sceneVisualLock) return matching.sceneVisualLock;
  }
  return mostCommonString(group.map((shot) => shot.sceneVisualLock).filter(Boolean));
}

async function refineWorkflowClipSeedancePrompt(input: {
  project: any;
  workflow: ReturnType<typeof getWorkflowState>;
  clip: NormalizedWorkflowClip;
  shots: NormalizedStoryboardShot[];
  prompt: string;
  aiModelId: string;
  authority: WorkflowAuthorityContext;
}): Promise<string> {
  const result = await callWorkflowTextModel(
    "Clip视频提示词推理",
    [
      {
        role: "system",
        content:
          "You refine clip-level AI video prompts. Return only the final prompt text. No markdown, no JSON, no arrays, no surrounding brackets or quotes, no explanation.",
      },
      {
        role: "user",
        content: buildClipSeedancePromptRefinementPrompt(input),
      },
    ],
    input.aiModelId,
  );
  const refined = unwrapJsonWrappedPromptText(
    cleanWorkflowPromptText(result.rawText)
      .replace(/^```(?:text|markdown)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim(),
  );
  const candidate = refined || input.prompt;
  const safePrompt = preservesVideoBeatLabels(candidate, input.prompt) ? candidate : input.prompt;
  const cameraSafePrompt = enforceShotCameraPlansInVideoPrompt(safePrompt, input.shots);
  return finalizeWorkflowVideoPrompt(cameraSafePrompt, enforceShotCameraPlansInVideoPrompt(input.prompt, input.shots));
}

function preservesVideoBeatLabels(candidate: string, source: string): boolean {
  const sourceLabels = extractVideoBeatLabels(source);
  if (sourceLabels.length === 0) return true;
  const candidateLabels = new Set(extractVideoBeatLabels(candidate));
  return sourceLabels.every((label) => candidateLabels.has(label));
}

/** 模型偶尔无视指令把提示词包成 JSON 数组/字符串/对象返回，这里解包；非 JSON 原样返回。 */
function unwrapJsonWrappedPromptText(value: string): string {
  const text = value.trim();
  if (!/^[\[{"]/.test(text)) return text;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") return parsed.trim();
    if (Array.isArray(parsed)) {
      const strings = parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      if (strings.length > 0) return strings.join("\n").trim();
    }
    if (isRecord(parsed)) {
      const fromRecord = stringFrom(parsed.prompt ?? parsed.optimizedPrompt ?? parsed.result ?? parsed.content, "");
      if (fromRecord) return fromRecord.trim();
    }
  } catch {
    if (text.startsWith("[") && text.endsWith("]")) {
      return text.slice(1, -1).trim().replace(/^["']|["']$/g, "").trim();
    }
  }
  return text;
}

function extractVideoBeatLabels(value: string): string[] {
  return Array.from(value.matchAll(/\b([PS])(\d{1,2})\s*:/g))
    .map((match) => `${match[1]}${Number(match[2])}`)
    .filter((label, index, labels) => labels.indexOf(label) === index);
}

function enforceShotCameraPlansInVideoPrompt(prompt: string, shots: NormalizedStoryboardShot[]): string {
  if (!prompt || shots.length === 0) return prompt;
  const cameraPlans = new Map(
    shots
      .slice(0, MAX_CLIP_STORYBOARD_PANEL_COUNT)
      .map((shot, index) => [`S${index + 1}`, shotVideoCameraPlan(shot, index)]),
  );
  return normalizePromptTextWithoutCompression(prompt)
    .split("\n")
    .map((line) => {
      const match = line.match(/^(S(\d{1,2})\s*[:：]\s*)([\s\S]*)$/i);
      if (!match) return line;
      const label = `S${Number(match[2])}`;
      const cameraPlan = cameraPlans.get(label);
      if (!cameraPlan) return line;
      const body = match[3] ?? "";
      if (videoBeatHasCompleteCameraPlan(body)) return line;
      const cleanedBody = body
        .replace(/\bcamera\s+([^;]+;\s*)?/i, "")
        .replace(/\bCamera plan\s*[:：]\s*/i, "")
        .replace(/\bShot\s*[:：]\s*/i, "")
        .trim();
      return `${match[1]}Shot: ${cameraPlan}; ${cleanedBody}`.trim();
    })
    .join("\n");
}

function videoBeatHasCompleteCameraPlan(value: string): boolean {
  const normalized = normalizeCompareText(value);
  return (
    /shot size|shot:|wide|medium|close|景别/.test(normalized) &&
    /angle|view|视角|机位/.test(normalized) &&
    /movement|camera move|运镜|推|拉|摇|移|跟/.test(normalized) &&
    /composition|blocking|block:|构图|调度|站位/.test(normalized) &&
    /lens|focal|mm|焦段|镜头/.test(normalized)
  );
}

async function recoverWorkflowClipStoryboardPrompt(
  projectId: string,
  metadata: unknown,
  episodeId: string,
  workflow: ReturnType<typeof getWorkflowState>,
  clip: NormalizedWorkflowClip,
): Promise<string> {
  if (extractStoryboardPanelVideoBeats(clip.storyboardPrompt).length > 0) return clip.storyboardPrompt;

  const records = await prisma.generation.findMany({
    where: {
      projectId,
      status: "SUCCEEDED",
    },
    include: { assets: true },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const metadataRecord = isRecord(metadata) ? metadata : {};
  const refs = storyboardReferencesFromGenerationRecords(records, { ...metadataRecord, workflowCenter: { clips: workflow.clips } }, episodeId);
  const ref = refs.find((item) => item.clipId === clip.id && item.prompt);
  return cleanWorkflowPromptText(ref?.prompt || clip.storyboardPrompt || "");
}

function buildClipSeedancePromptRefinementPrompt(input: {
  project: any;
  workflow: ReturnType<typeof getWorkflowState>;
  clip: NormalizedWorkflowClip;
  shots: NormalizedStoryboardShot[];
  prompt: string;
  authority: WorkflowAuthorityContext;
}): string {
  const storyboardBeats = buildClipVideoStoryboardBeats(input.clip, input.shots, input.workflow);
  const stateLedger = buildClipStateLedgerText(input.workflow, input.clip, input.shots);
  const shots = input.shots.map((shot, index) => ({
    index: index + 1,
    title: shot.title,
    action: shot.action || shot.description,
    dialogue: shot.dialogue,
    camera: [shot.shotSize, shot.cameraAngle, shot.cameraMove, shot.lens].filter(Boolean).join(", "),
    characters: shot.characters,
    setting: shot.setting,
    references: shot.references,
  }));
  return [
    `Project: ${input.project.name}`,
    `Aspect ratio: ${input.project.aspectRatio}`,
    projectAuthorityPromptBlock(input.authority),
    input.authority.existingCharacters.length ? "Existing Character records are authoritative:" : "",
    input.authority.existingCharacters.length ? summarizeAuthorityCharactersForStoryboard(input.authority.existingCharacters) : "",
    existingAssetNameLanguageRules(input.authority),
    "",
    "Task: refine the following Seedance/video-generation prompt for this exact Clip.",
    "Keep it practical for an AI video model, but do not compress, omit, or truncate required beat lines or spoken dialogue.",
    "Use connected storyboard and character reference images for visual identity.",
    "Do not describe character clothing or exact appearance when reference images exist.",
    ...VIDEO_STATE_AND_ASSET_RULES,
    "Preserve every beat line (P1/P2... or S1/S2...) in order. Do not skip, merge, or reorder them.",
    "Keep dialogue lines attached to the matching beat when present.",
    "If storyboard panels conflict with ordered shots, the storyboard panels are the authority.",
    "Do not repeat the whole Clip cast in every S beat. Each S beat should name only visible speakers/actors and their carried-forward state.",
    "Move repeated constraints into the prompt header. Do not repeat scene-continuity rules, screen-direction rules, visible-subject rules, or foreground/midground/background rules inside every S beat.",
    "If all beats share the same scene blocking or composition, state it once as a 'Clip blocking' line before the beats, not inside every S beat.",
    "Each S beat should contain specific professional shot design only: shot size, camera angle, camera movement, lens, visible action, spoken dialogue when present, and carried-forward state only when it affects the shot. Do not repeat clip-level blocking in every beat.",
    "Mention who is who, style, scene, and how the motion should unfold from the storyboard.",
    "Do not add subtitles, speech bubbles, UI, panel borders, watermarks, or explanatory text.",
    "",
    "Current asset constraints:",
    summarizeAssetsForStoryboardPrompt(input.workflow.assets),
    "",
    "State ledger:",
    stateLedger,
    "",
    "Clip:",
    JSON.stringify({
      title: input.clip.title,
      setting: input.clip.setting,
      characters: input.clip.characters,
      plotGoal: input.clip.plotGoal,
      startState: input.clip.startState,
      endState: input.clip.endState,
      duration: input.clip.estimatedDuration,
    }, null, 2),
    "",
    "Ordered shots:",
    JSON.stringify(shots, null, 2),
    "",
    storyboardBeats.length ? "Storyboard panel beats to preserve:" : "",
    storyboardBeats.length ? formatStoryboardVideoBeats(storyboardBeats).lines.join("\n") : "",
    storyboardBeats.length ? "" : "",
    input.clip.storyboardPrompt ? "Current storyboard prompt:" : "",
    input.clip.storyboardPrompt ? normalizePromptTextWithoutCompression(input.clip.storyboardPrompt) : "",
    input.clip.storyboardPrompt ? "" : "",
    "Current prompt to refine:",
    input.prompt,
  ].join("\n");
}

function buildClipStateLedgerText(workflow: ReturnType<typeof getWorkflowState>, clip: NormalizedWorkflowClip, shots: NormalizedStoryboardShot[]): string {
  const clipIndex = workflow.clips.findIndex((item) => item.id === clip.id);
  const previousClips = clipIndex > 0 ? workflow.clips.slice(Math.max(0, clipIndex - 2), clipIndex) : [];
  const previous = previousClips
    .map((item) => `${item.title}: start=${item.startState || "unknown"}; end=${item.endState || "unknown"}; continuity=${item.layoutMemory || ""}`)
    .join("\n");
  const current = shots
    .map((shot, index) => `S${index + 1}: characters=${shot.characters.join(", ") || "unknown"}; action=${shot.action || shot.description || ""}; references=${shot.references || ""}; visual=${shot.visualPrompt || ""}`)
    .join("\n");
  return [
    previous ? `Previous clip state memory:\n${previous}` : "",
    `Current ordered state evidence:\n${current || "No current shot evidence."}`,
  ].filter(Boolean).join("\n\n");
}

function normalizeClipPreflight(value: unknown, fallback: Omit<ClipPreflight, "pass" | "status" | "warnings">): ClipPreflight {
  if (!isRecord(value)) return buildClipPreflight(fallback);
  const warnings = arrayFrom(value.warnings ?? value.risks ?? value.issues).map(String).filter(Boolean);
  const pass = typeof value.pass === "boolean" ? value.pass : typeof value.ok === "boolean" ? value.ok : warnings.length === 0;
  return {
    pass,
    status: stringFrom(value.status, pass ? "通过" : "需检查"),
    warnings,
    estimatedDuration: normalizeClipNumber(value.estimatedDuration, fallback.estimatedDuration, 0, 999),
    targetDuration: normalizeClipNumber(value.targetDuration, fallback.targetDuration, 0, 999),
    maxDuration: normalizeClipNumber(value.maxDuration, fallback.maxDuration, 0, 999),
    dialogueWordCount: normalizeClipNumber(value.dialogueWordCount, fallback.dialogueWordCount, 0, 9999),
    dialogueWordsPerSecond: normalizeClipNumber(value.dialogueWordsPerSecond, fallback.dialogueWordsPerSecond, 0, 999),
    shotCount: normalizeClipNumber(value.shotCount, fallback.shotCount, 0, 999),
    panelCount: normalizeClipNumber(value.panelCount, fallback.panelCount, 0, 999),
    hasStartState: typeof value.hasStartState === "boolean" ? value.hasStartState : fallback.hasStartState,
    hasEndState: typeof value.hasEndState === "boolean" ? value.hasEndState : fallback.hasEndState,
  };
}

function buildClipPreflight(input: Omit<ClipPreflight, "pass" | "status" | "warnings">): ClipPreflight {
  const warnings: string[] = [];
  const dialogueSeconds = input.dialogueWordCount / TARGET_DIALOGUE_WORDS_PER_SECOND;
  const dialogueBudget = input.estimatedDuration < 9 ? 6 : input.estimatedDuration < 13 ? 10 : MAX_CLIP_DIALOGUE_SECONDS;

  if (input.estimatedDuration > MAX_CLIP_DURATION_SECONDS) {
    warnings.push(`预计时长 ${input.estimatedDuration}s 超过 ${MAX_CLIP_DURATION_SECONDS}s 上限`);
  }
  if (dialogueSeconds > dialogueBudget) {
    warnings.push(`台词预计 ${roundOne(dialogueSeconds)}s，超过当前 Clip 建议承载 ${dialogueBudget}s`);
  }
  if (input.dialogueWordsPerSecond > MAX_DIALOGUE_WORDS_PER_SECOND) {
    warnings.push(`台词密度 ${input.dialogueWordsPerSecond} w/s 超过 ${MAX_DIALOGUE_WORDS_PER_SECOND} w/s`);
  }
  if (input.shotCount > MAX_CLIP_STORYBOARD_PANEL_COUNT) {
    warnings.push(`镜头数 ${input.shotCount} 超过节拍上限 ${MAX_CLIP_STORYBOARD_PANEL_COUNT}，超出部分不会进入视频提示词，请拆分 Clip`);
  }
  if (input.panelCount > MAX_CLIP_STORYBOARD_PANEL_COUNT) warnings.push(`故事板超过 ${MAX_CLIP_STORYBOARD_PANEL_COUNT} 格，建议拆分或降复杂度`);
  if (!input.hasStartState) warnings.push("缺少开始状态");
  if (!input.hasEndState) warnings.push("缺少结束状态");

  const pass = warnings.length === 0;
  return {
    ...input,
    pass,
    status: pass ? "通过" : "需检查",
    warnings,
  };
}

function classifyClipSceneType(group: NormalizedStoryboardShot[], dialogueWordCount: number, estimatedDuration: number): string {
  const text = group.map((shot) => `${shot.title} ${shot.description} ${shot.action} ${shot.visualPrompt}`).join(" ").toLowerCase();
  const characters = uniqueStrings(group.flatMap((shot) => shot.characters));
  const hasDialogue = dialogueWordCount > 0;
  const dialogueWps = estimatedDuration > 0 ? dialogueWordCount / estimatedDuration : 0;
  if (!hasDialogue && /(empty|mood|atmosphere|establish|city|sky|street|空镜|氛围|远景|城市)/.test(text)) return "atmosphere";
  if (/(fight|battle|attack|shoot|explode|slam|laser|dodge|打斗|攻击|爆炸|射击)/.test(text)) return "action_fight";
  if (/(chase|run|rush|escape|pursuit|追逐|逃|奔跑)/.test(text)) return "running_transition";
  if (hasDialogue && (dialogueWps > 2.4 || characters.length >= 2)) return "dialogue_conflict";
  if (/(cry|fear|angry|realize|decision|stare|smirk|沉默|决定|情绪|表情)/.test(text)) return "emotional_beat";
  return hasDialogue ? "dialogue_beat" : "action_beat";
}

function chooseClipControlLevel(
  group: NormalizedStoryboardShot[],
  sceneType: string,
  dialogueWordsPerSecond: number,
  characterCount: number,
): StoryboardControlLevel {
  const text = group.map((shot) => `${shot.setting} ${shot.description} ${shot.action}`).join(" ").toLowerCase();
  const indoorOrLayoutSensitive = /(room|lab|office|bunker|interior|door|table|screen|室内|房间|实验室|门|桌)/.test(text);
  if (sceneType === "atmosphere") return "none";
  if (sceneType === "action_fight" || sceneType === "running_transition") {
    return dialogueWordsPerSecond < 1.4 ? "soft" : "medium";
  }
  if (dialogueWordsPerSecond >= 2.4 || characterCount >= 2 || indoorOrLayoutSensitive) return "hard";
  return "medium";
}

function chooseStoryboardType(level: StoryboardControlLevel, sceneType: string): StoryboardType {
  if (level === "hard") return "multi_panel";
  if (level === "medium") return sceneType.includes("action") || sceneType.includes("running") ? "start_end_keyframes" : "multi_panel";
  if (level === "soft") return "start_end_keyframes";
  return sceneType === "atmosphere" ? "mood_reference" : "none";
}

function choosePanelCount(type: StoryboardType, shotCount: number): number {
  if (type === "multi_panel") return Math.max(8, Math.min(MAX_CLIP_STORYBOARD_PANEL_COUNT, shotCount + 5));
  if (type === "start_end_keyframes") return Math.max(MIN_CLIP_STORYBOARD_PANEL_COUNT, Math.min(8, shotCount + 3));
  if (type === "mood_reference") return 1;
  return 0;
}

function describeClipEndpoint(
  shot: NormalizedStoryboardShot,
  kind: "start" | "end",
  textLanguage: WorkflowClipContext["textLanguage"] = "Mixed",
): string {
  if (textLanguage === "Chinese") {
    const prefix = kind === "start" ? "开始于" : "结束于";
    const endpoint = concreteShotEndpointText(shot);
    return [prefix, shot.setting ? `${shot.setting}${endpoint ? "，" : ""}` : "", endpoint].filter(Boolean).join(" ");
  }
  const prefix = kind === "start" ? "Starts with" : "Ends with";
  return [prefix, shot.setting ? `in ${shot.setting}` : "", concreteShotEndpointText(shot)].filter(Boolean).join(" ");
}

function clipEndpointState(
  value: string,
  fallbackShot: NormalizedStoryboardShot,
  kind: "start" | "end",
  textLanguage: WorkflowClipContext["textLanguage"] = "Mixed",
): string {
  const cleaned = cleanWorkflowPublicText(cleanVideoBeat(value || ""));
  if (!cleaned || genericReactionBoilerplateLooksDominant(cleaned)) return describeClipEndpoint(fallbackShot, kind, textLanguage);
  if (textLanguage === "Chinese") return localizeLayoutEndpointText(cleaned, kind);
  return cleaned;
}

function concreteShotEndpointText(shot: NormalizedStoryboardShot): string {
  const candidates = [
    shot.action,
    shot.description,
    shot.visualPrompt,
    shot.references,
    shot.title,
  ].map((value) => cleanWorkflowPublicText(cleanVideoBeat(value || ""))).filter(Boolean);
  return candidates.find((value) => !genericReactionBoilerplateLooksDominant(value)) || candidates[0] || shot.title;
}

function genericReactionBoilerplateLooksDominant(value: string): boolean {
  const text = normalizeCompareText(value);
  if (!text) return false;
  return (
    /absorbs? the spoken line with a changed expression gesture or posture/.test(text) ||
    /holds? a concrete reaction tied to the visible action with readable expression and body language/.test(text) ||
    /hold a specific visible reaction tied to this shot/.test(text) ||
    /reacts? to the previous moment with a visible change in expression or posture/.test(text)
  );
}

function inferClipPlotGoal(group: NormalizedStoryboardShot[]): string {
  if (group.length === 1) return group[0].description || group[0].action || group[0].title;
  const first = cleanVideoBeat(group[0].description || group[0].action || group[0].title);
  const last = cleanVideoBeat(group[group.length - 1].description || group[group.length - 1].action || group[group.length - 1].title);
  return first === last ? first : `${first} Then ${last}`;
}

function inferClipEmotionArc(group: NormalizedStoryboardShot[]): string {
  const text = group.map((shot) => `${shot.description} ${shot.action}`).join(" ").toLowerCase();
  if (/(fear|panic|tense|hesitat)/.test(text) && /(decide|resolve|attack|fire|fight back)/.test(text)) return "fear or tension -> decisive action";
  if (/(angry|roast|sarcastic|mock)/.test(text)) return "sarcasm -> escalation";
  if (/(surprise|reveal|turns around|appears)/.test(text)) return "uncertainty -> reveal";
  return "fast setup -> punchy payoff";
}

function composeLayoutMemory(
  group: NormalizedStoryboardShot[],
  startState: string,
  endState: string,
  setting: string,
  characters: string[],
  characterPropContinuity = "",
  textLanguage: WorkflowClipContext["textLanguage"] = "Mixed",
): string {
  const propsAndReferences = uniqueStrings(
    group
      .map((shot) => shot.references)
      .filter((value): value is string => Boolean(value))
      .map(stripTemporaryStateFromClipMemory)
      .filter(Boolean),
  ).slice(0, 4);
  if (textLanguage === "Chinese") {
    return [
      `位置：${setting || "当前场景"}`,
      `角色：${characters.join(", ") || "本 Clip 出现的角色"}`,
      `开始：${localizeLayoutEndpointText(startState, "start")}`,
      `结束：${localizeLayoutEndpointText(endState, "end")}`,
      propsAndReferences.length ? `连续性参考：${propsAndReferences.join(" | ")}` : "",
      characterPropContinuity,
      "保持屏幕方向、角色所在侧、重要道具以及入场/退场位置连续到下一个 Clip。",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `Location: ${setting || "current scene"}`,
    `Characters: ${characters.join(", ") || "characters from this clip"}`,
    `Start: ${startState}`,
    `End: ${endState}`,
    propsAndReferences.length ? `Continuity references: ${propsAndReferences.join(" | ")}` : "",
    characterPropContinuity,
    "Keep screen direction, character side, important props, and entry/exit positions continuous into the next clip.",
  ]
    .filter(Boolean)
    .join("\n");
}

function localizeLayoutEndpointText(value: string, kind: "start" | "end"): string {
  let output = cleanWorkflowPublicText(cleanVideoBeat(value || ""));
  if (!output) return "";
  output = output
    .replace(/^Starts?\s+with\s+in\s+/i, "开始于 ")
    .replace(/^Starts?\s+with\s+/i, "开始于 ")
    .replace(/^Ends?\s+with\s+in\s+/i, "结束于 ")
    .replace(/^Ends?\s+with\s+/i, "结束于 ")
    .replace(/\bin\s+([\u3400-\u9fffA-Za-z0-9][^;。!?]{0,80})\s+(?=[\u3400-\u9fffA-Za-z])/i, "在 $1，")
    .replace(/\s+([\u3400-\u9fff])/g, "$1")
    .replace(/([\u3400-\u9fff])\s+([\u3400-\u9fff])/g, "$1$2")
    .trim();
  const prefix = kind === "start" ? "开始于" : "结束于";
  if (!new RegExp(`^${prefix}`).test(output)) output = `${prefix} ${output}`;
  return output;
}

function stripTemporaryStateFromClipMemory(value: string): string {
  return value
    .split(/\s*\|\s*|(?<=\.)\s+|;\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => cleanVideoBeat(part))
    .filter((part) => !genericReactionBoilerplateLooksDominant(part))
    .filter((part) => !/\b(?:still wet|wet clothing|green stain|stain still|earlier .*stain|sludge still|soaked with|spill residue|splashed|splash|slime|soot|temporary wound|fresh wound)\b/i.test(part))
    .filter((part) => !/(仍然湿|污渍|污泥仍|飞溅残留|临时伤口|刚溅上|还粘着)/i.test(part))
    .join("; ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function composeDirectorFreedom(level: StoryboardControlLevel, sceneType: string): string {
  if (level === "hard") return "camera 0.3, blocking 0.1, action_details 0.3, dialogue_timing 0.1, visual_effects 0.2, composition 0.3";
  if (level === "medium") return "camera 0.6, blocking 0.35, action_details 0.55, dialogue_timing 0.25, visual_effects 0.5, composition 0.45";
  if (level === "soft") return "camera 0.9, blocking 0.45, action_details 0.85, dialogue_timing 0.3, visual_effects 0.9, composition 0.65";
  return sceneType === "atmosphere"
    ? "camera 0.9, blocking 1.0, action_details 0.8, dialogue_timing 1.0, visual_effects 0.9, composition 0.8"
    : "camera 0.8, blocking 0.8, action_details 0.8, dialogue_timing 0.8, visual_effects 0.8, composition 0.8";
}

function composeSeedancePrompt(input: {
  estimatedDuration: number;
  targetDuration?: number;
  aspectRatio: string;
  visualStyle: string;
  characterIdentities: Record<string, string>;
  setting: string;
  sceneVisualLock?: string;
  characters: string[];
  plotGoal: string;
  startState: string;
  endState: string;
  actions: string[];
  dialogue: string[];
  storyboardBeats?: ClipVideoStoryboardBeat[];
  layoutMemory: string;
  characterPropContinuity?: string;
  storyboardControlLevel: StoryboardControlLevel;
  storyboardType: StoryboardType;
  directorFreedom: string;
}): string {
  const characterLine = formatClipVideoCharacters(input.characters, input.characterIdentities);
  const formatted = input.storyboardBeats?.length ? formatStoryboardVideoBeats(input.storyboardBeats) : { lines: [], clipBlocking: "" };
  const orderedStoryboardBeats = formatted.lines;
  const initialStateAndPositions = summarizeInitialCharacterStateAndPositions(input.storyboardBeats ?? [], input.startState, input.layoutMemory);
  const panelBeatMode = (input.storyboardBeats ?? []).some((beat) => /^P\d+$/i.test(beat.label || ""));
  const beats = orderedStoryboardBeats.length ? orderedStoryboardBeats : buildClipVideoBeats(input.actions, input.dialogue);
  const beatBlock = orderedStoryboardBeats.length
    ? `${panelBeatMode ? "Storyboard beats" : "Shot beats"}, follow in this exact order:\n${orderedStoryboardBeats.join("\n")}`
    : beats.length
      ? `Shot beats, follow in this exact order:\n${beats.join("\n")}`
      : "";
  const continuity = summarizeVideoContinuity(input.startState, input.endState);
  const videoDuration = clampClipTarget(input.targetDuration || input.estimatedDuration || TARGET_CLIP_DURATION_SECONDS);
  const prompt = [
    `Generate one continuous ${videoDuration}s cinematic video, ${input.aspectRatio || "16:9"}.`,
    `Style: ${shortVideoStyle(input.visualStyle)}`,
    `Scene: ${cleanVideoLine(input.setting || "current scene")}`,
    input.sceneVisualLock ? `Scene visual continuity lock: ${cleanVideoLine(input.sceneVisualLock)}` : "",
    characterLine ? `Characters: ${characterLine}` : "Characters: use the connected character reference images for identity.",
    initialStateAndPositions ? `Initial character state and positions: ${initialStateAndPositions}` : "",
    "Global shot rules: maintain continuous scene geography, readable screen direction, visible-subject framing, and clear foreground/midground/background separation. Do not repeat these rules inside every beat.",
    formatted.clipBlocking ? `Clip blocking: ${formatted.clipBlocking}` : "",
    "In each beat, write only specific shot design, visible action, spoken dialogue when present, and carried-forward physical state only when it affects that shot. Do not repeat the clip blocking in every beat.",
    panelBeatMode
      ? "Use the connected storyboard image as the main visual reference; turn its story beats into natural motion, not comic panels."
      : "Turn the shot beats into natural continuous motion, using the connected character and scene reference images for identity.",
    input.plotGoal ? `Story goal: ${cleanVideoLine(cleanVideoPlotGoal(input.plotGoal))}` : "",
    beatBlock,
    orderedStoryboardBeats.length
      ? panelBeatMode
        ? "Do not skip, merge, or reorder the P beats; animate P1 first, then P2, then P3, continuing through the listed storyboard panels."
        : "Do not skip, merge, or reorder the shot beats; play S1 first, then S2, continuing in order."
      : "",
    continuity ? `Continuity: ${continuity}` : "",
    seedanceVideoDirection(input.storyboardControlLevel),
    "Do not add subtitles, speech bubbles, UI, panel borders, panel numbers, watermarks, or explanatory text. Keep the generated motion focused on the storyboard plot.",
  ]
    .filter(Boolean)
    .join("\n");
  return finalizeWorkflowVideoPrompt(prompt);
}

function finalizeWorkflowVideoPrompt(value: string, fallback = ""): string {
  const normalized = normalizeWorkflowVideoBeatBlock(
    normalizeExactDialogueQuoteStyle(
      hoistRepeatedShotRules(normalizePromptTextWithoutCompression(value)),
    ),
  );
  if (normalized.length <= DREAMINA_WEB_VIDEO_PROMPT_TARGET_CHARS) return normalized;
  const compact = compactWorkflowVideoPrompt(normalized);
  if (compact.length <= DREAMINA_WEB_VIDEO_PROMPT_TARGET_CHARS) return compact;
  if (fallback && normalized !== fallback) {
    const compactFallback = compactWorkflowVideoPrompt(
      normalizeExactDialogueQuoteStyle(hoistRepeatedShotRules(normalizePromptTextWithoutCompression(fallback))),
    );
    if (compactFallback.length <= DREAMINA_WEB_VIDEO_PROMPT_TARGET_CHARS) return compactFallback;
  }
  return trimWorkflowVideoPromptToLimit(compact, DREAMINA_WEB_VIDEO_PROMPT_TARGET_CHARS);
}

function normalizeExactDialogueQuoteStyle(prompt: string): string {
  return String(prompt || "")
    .split("\n")
    .map((line) => line
      .replace(
        /\bExact dialogue:\s*([^:：;\n]{1,40})\s*[:：]\s*([^;\n]+?)(?=;|$)/g,
        (_match, speaker, dialogue) => `Dialogue: ${String(speaker).trim()} says “${trimDialogueQuotes(String(dialogue))}”`,
      )
      .replace(
        /\bDialogue:\s*([^:：;\n]{1,40})\s*[:：]\s*([^;\n]+?)(?=;|$)/g,
        (_match, speaker, dialogue) => `Dialogue: ${String(speaker).trim()} says “${trimDialogueQuotes(String(dialogue))}”`,
      ))
    .join("\n");
}

function compactWorkflowVideoPrompt(prompt: string): string {
  const sections = splitWorkflowVideoPromptSections(prompt);
  const beatLines = sections.filter((section) => section.kind === "beat").map((section) => section.text);
  const headerLines = sections.filter((section) => section.kind === "header").map((section) => section.text);
  // 上限 12：composeSeedancePrompt 的 header（含场景视觉锁、初始站位、节拍后指令行）压缩后最多约 11 行，过低会截掉 Direction 行。
  const compactHeader = compactWorkflowVideoHeaderLines(headerLines);
  const promptFromBudget = (header: string[], minBeatChars: number) => {
    const footerChars = COMPACT_WORKFLOW_VIDEO_FOOTER.length + 1;
    const headerChars = joinedLineLength(header) + (header.length ? 1 : 0);
    const beatSeparatorChars = Math.max(0, beatLines.length - 1);
    const beatBudget = DREAMINA_WEB_VIDEO_PROMPT_TARGET_CHARS - headerChars - footerChars - beatSeparatorChars;
    const perBeatLimit = beatLines.length
      ? Math.max(minBeatChars, Math.min(COMPACT_WORKFLOW_VIDEO_MAX_BEAT_CHARS, Math.floor(beatBudget / beatLines.length)))
      : COMPACT_WORKFLOW_VIDEO_MAX_BEAT_CHARS;
    const compactBeats = beatLines.map((line) => compactWorkflowVideoBeatLine(line, perBeatLimit)).filter(Boolean);
    return normalizePromptTextWithoutCompression([
      ...header,
      ...compactBeats,
      COMPACT_WORKFLOW_VIDEO_FOOTER,
    ].join("\n"));
  };

  const firstPass = promptFromBudget(compactHeader, COMPACT_WORKFLOW_VIDEO_MIN_BEAT_CHARS);
  if (firstPass.length <= DREAMINA_WEB_VIDEO_PROMPT_TARGET_CHARS) return firstPass;

  const tighterHeader = compactWorkflowVideoHeaderForBeatRetention(compactHeader);
  const secondPass = promptFromBudget(tighterHeader, COMPACT_WORKFLOW_VIDEO_SECOND_PASS_MIN_BEAT_CHARS);
  if (secondPass.length <= DREAMINA_WEB_VIDEO_PROMPT_TARGET_CHARS) return secondPass;

  return trimWorkflowVideoPromptToLimit(secondPass, DREAMINA_WEB_VIDEO_PROMPT_TARGET_CHARS);
}

function compactWorkflowVideoHeaderLines(headerLines: string[]): string[] {
  const lines = headerLines
    .map(compactWorkflowVideoPromptLine)
    .filter(Boolean)
    .filter((line) => !/^In each beat, write only/i.test(line))
    .filter((line) => !/^Global shot rules:/i.test(line));
  const required = lines.filter((line) => /^(?:Generate |Style:|Scene:|Characters:|Initial character state and positions:|Story goal:)/i.test(line));
  const optional = lines.filter((line) => !required.includes(line) && /^(?:Scene visual continuity lock:|Use the connected storyboard|Turn the shot beats|Follow shot beats|Follow P beats|Direction:)/i.test(line));
  return [...required, ...optional].slice(0, 9);
}

function compactWorkflowVideoHeaderForBeatRetention(headerLines: string[]): string[] {
  return headerLines
    .map((line) => {
      if (/^Scene visual continuity lock:/i.test(line)) return compactSentence(line, 120);
      if (/^Initial character state and positions:/i.test(line)) return compactSentence(line, 180);
      if (/^Scene:/i.test(line)) return compactSentence(line, 120);
      if (/^Story goal:/i.test(line)) return compactSentence(line, 160);
      if (/^Continuity:/i.test(line)) return compactSentence(line, 140);
      if (/^For every listed beat/i.test(line)) return "Each beat must keep blocking, facing, props, clothing, and visible state when relevant.";
      return line;
    })
    .filter((line) => !/^Global shot rules:/i.test(line))
    .filter((line) => !/^In each beat, write only/i.test(line))
    .filter(Boolean);
}

function joinedLineLength(lines: string[]): number {
  return lines.reduce((sum, line) => sum + line.length, 0) + Math.max(0, lines.length - 1);
}

function compactWorkflowVideoPromptLine(line: string): string {
  const trimmed = cleanVideoLine(line);
  if (!trimmed) return "";
  if (isWorkflowVideoBeatLine(trimmed)) return compactWorkflowVideoBeatLine(trimmed, 260);
  if (/^Style:/i.test(trimmed)) return "Style: saturated 3D American animated dark-comedy, cinematic lighting, exaggerated fast reactions, polished render.";
  if (/^Characters:/i.test(trimmed)) return compactVideoCharactersLine(trimmed);
  if (/^Initial character state and positions:/i.test(trimmed)) return compactSentence(trimmed, 220);
  if (/^Use the connected storyboard/i.test(trimmed)) return "Use the connected storyboard as shot-order authority and connected character images as identity authority.";
  if (/^Direction:/i.test(trimmed)) return "Direction: follow storyboard order and scene geography; add only natural motion, acting, and controlled camera movement.";
  if (/^Continuity:/i.test(trimmed)) return "";
  if (/^Scene visual continuity lock:/i.test(trimmed)) return compactSentence(trimmed, 150);
  if (/^Story goal:/i.test(trimmed)) return compactSentence(trimmed, 180);
  if (/^Scene:/i.test(trimmed)) return compactSentence(trimmed, 140);
  if (/^Global shot rules:/i.test(trimmed)) return "";
  if (/^In each beat, write only/i.test(trimmed)) return "";
  if (/^Do not skip/i.test(trimmed)) {
    return /shot beats/i.test(trimmed)
      ? "Follow shot beats S1, S2… in exact order; do not skip, merge, or reorder them."
      : "Follow P beats in exact order; do not skip, merge, or reorder them.";
  }
  if (/^Do not add/i.test(trimmed)) return "";
  if (/^(Storyboard|Shot) beats/i.test(trimmed)) return "";
  return compactSentence(trimmed, 260);
}

function compactVideoCharactersLine(line: string): string {
  const names = Array.from(line.matchAll(/\b([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2})\s*=/g))
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);
  if (names.length === 0) {
    const body = line
      .replace(/^Characters:\s*/i, "")
      .replace(/\.\s*Use (?:their )?connected character reference images[\s\S]*$/i, "");
    names.push(...body.split(",").map((item) => item.trim()).filter(Boolean));
  }
  const compactNames = compactWorkflowCharacterNames(names);
  return compactNames.length
    ? `Characters: ${compactNames.join(", ")}. Use their connected character reference images; do not redesign.`
    : "Characters: use connected character reference images; do not redesign.";
}

function compactWorkflowVideoBeatLine(line: string, maxChars = COMPACT_WORKFLOW_VIDEO_MAX_BEAT_CHARS): string {
  const labelMatch = line.match(/^((?:P|S)\d{1,2})\s*(?:\/\s*(?:P|S)?\d{1,2})?\s*(?:[:：\-—]|\s+-\s+)\s*([\s\S]*)$/i);
  if (!labelMatch) return compactSentence(line, maxChars);
  const label = labelMatch[1].toUpperCase();
  const body = labelMatch[2] ?? "";
  const dialogue = cleanVideoDialogue(extractDialogueFromVideoBeatLine(body));
  const withoutDialogue = removeVideoDialogueFragments(body, dialogue);
  const dialogueSentence = formatExactVideoDialogue(dialogue);
  const prefix = `${label}: ${dialogueSentence ? `Dialogue: ${dialogueSentence}; ` : ""}`;
  const minimumForDialogueBeat = dialogueSentence ? prefix.length + 80 : maxChars;
  const effectiveMaxChars = Math.max(maxChars, minimumForDialogueBeat);
  const actionLimit = Math.max(0, effectiveMaxChars - prefix.length);
  const action = compactSentence(compactWorkflowVideoBeatBody(withoutDialogue)
    .replace(/\b(?:Exact dialogue|dialogue\/reaction|dialogue)\s*[:;]\s*/i, "")
    .replace(/\bCamera plan\s*[:：]\s*/i, "")
    .replace(/^camera\s+[^;]+;\s*/i, "")
    .replace(/\bdialogue\/reaction\s*[:;]?\s*/i, "")
    .replace(/\bdialogue\b\s*[^;]*;\s*/i, ""), actionLimit);
  const compacted = cleanVideoLine(`${prefix}${action}`)
    .replace(/\s+;/g, ";")
    .replace(/;{2,}/g, ";")
    .replace(/\s*;\s*$/g, "");
  if (compacted.length <= effectiveMaxChars) return compacted;
  if (dialogue) return cleanVideoLine(`${label}: Dialogue: ${dialogueSentence}`);
  return cleanVideoLine(`${label}: ${compactSentence(action, Math.max(0, effectiveMaxChars - `${label}: `.length))}`);
}

function compactWorkflowVideoBeatBody(value: string): string {
  const body = cleanVideoBeat(value);
  if (!body) return "";
  const rawParts = body.split(";").map((part) => cleanVideoLine(part)).filter(Boolean);
  if (rawParts.length <= 2) return body;
  const cameraParts: string[] = [];
  const blockingParts: string[] = [];
  const stateParts: string[] = [];
  const performanceParts: string[] = [];
  const actionParts: string[] = [];
  let inState = false;
  let inCamera = false;

  for (const part of rawParts) {
    const cleaned = part.replace(/\bCamera plan\s*[:：]\s*/i, "").trim();
    if (/^(?:frame only visible subject|separate foreground|current scene layout|clear character blocking)\b/i.test(cleaned)) {
      continue;
    }
    const shotMatch = cleaned.match(/^Shot\s*[:：]\s*([\s\S]+)$/i);
    if (shotMatch) {
      cameraParts.push(`Shot: ${shotMatch[1].trim()}`);
      inCamera = true;
      inState = false;
      continue;
    }
    if (inCamera && isCompactCameraAtom(cleaned)) {
      cameraParts.push(cleaned);
      inState = false;
      continue;
    }
    if (/^(shot size|angle|movement|lens)\b/i.test(cleaned)) {
      cameraParts.push(cleaned);
      inCamera = true;
      inState = false;
      continue;
    }
    if (/^(?:composition|blocking)\s*[:：]/i.test(cleaned)) {
      blockingParts.push(compactSentence(cleaned, 160));
      inCamera = false;
      inState = false;
      continue;
    }
    if (/^State\s*[:：]/i.test(cleaned)) {
      stateParts.push(cleaned);
      inCamera = false;
      inState = true;
      continue;
    }
    if (/^Performance\s*[:：]/i.test(cleaned)) {
      performanceParts.push(compactSentence(cleaned, 140));
      inCamera = false;
      inState = false;
      continue;
    }
    if (inState && /\b(hands bound|movement restricted|wearing|holding|clutching|still)\b/i.test(cleaned)) {
      stateParts.push(cleaned);
      continue;
    }
    actionParts.push(cleaned);
    inCamera = false;
    inState = false;
  }

  const action = actionParts.join("; ");
  const state = stateParts.join("; ");
  const camera = cameraParts.slice(0, 5).join("; ");
  const performance = performanceParts.join("; ");
  const blocking = blockingParts.join("; ");
  return [state, camera, action, performance, blocking]
    .filter(Boolean)
    .join("; ")
    .replace(/;{2,}/g, ";");
}

function isCompactCameraAtom(value: string): boolean {
  return /^(?:wide shot|medium shot|medium close-up|close-up|extreme close-up|establishing shot|eye-level|low angle|high angle|slight low angle|over-shoulder|static hold|slow push-in|controlled push-in|small lateral slide|slow pan|handheld tracking|tracking|dolly|fast dolly-in|24mm|35mm|50mm|85mm)$/i.test(value.trim());
}

function splitWorkflowVideoPromptSections(prompt: string): Array<{ kind: "header" | "beat"; text: string }> {
  const lines = normalizePromptTextWithoutCompression(prompt).split("\n");
  const sections: Array<{ kind: "header" | "beat"; lines: string[] }> = [];
  for (const line of lines) {
    if (isWorkflowVideoBeatLine(line)) {
      sections.push({ kind: "beat", lines: [line] });
      continue;
    }
    const current = sections.at(-1);
    if (current?.kind === "beat" && !isWorkflowVideoPostBeatHeaderLine(line)) {
      current.lines.push(line);
    } else {
      sections.push({ kind: "header", lines: [line] });
    }
  }
  return sections
    .map((section) => ({
      kind: section.kind,
      text: section.lines.join(" "),
    }))
    .filter((section) => section.text.trim());
}

function normalizeWorkflowVideoBeatBlock(prompt: string): string {
  const lines = normalizePromptTextWithoutCompression(prompt).split("\n").map((line) => line.trim()).filter(Boolean);
  const beatLines: string[] = [];
  const preBeatLines: string[] = [];
  const postBeatLines: string[] = [];
  let sawBeatHeader = false;
  let sawBeat = false;

  for (const line of lines) {
    if (/^(?:Storyboard|Shot) beats\b/i.test(line)) {
      sawBeatHeader = true;
      continue;
    }
    if (isWorkflowVideoBeatLine(line)) {
      beatLines.push(line);
      sawBeat = true;
      continue;
    }
    if (!sawBeat) preBeatLines.push(line);
    else postBeatLines.push(line);
  }

  if (beatLines.length === 0) return lines.join("\n");
  const beatKind = beatLines.some((line) => /^P\d+/i.test(line.trim())) ? "P" : "S";
  const header = sawBeatHeader
    ? (beatKind === "P" ? "Storyboard beats, follow in this exact order:" : "Shot beats, follow in this exact order:")
    : "";
  const renumbered = beatLines.map((line, index) =>
    line.replace(/^(?:P|S)\d{1,2}(\s*(?:\/\s*(?:P|S)?\d{1,2})?\s*(?:[:：\-—]|\s+-\s+)\s*)/i, `${beatKind}${index + 1}: `),
  );
  const uniquePost = uniqueStrings(postBeatLines);
  return [
    ...preBeatLines,
    header,
    ...renumbered,
    ...uniquePost,
  ].filter(Boolean).join("\n");
}

function extractDialogueFromVideoBeatLine(value: string): string {
  const labelledParts = value
    .split(";")
    .map((part) => cleanVideoLine(part))
    .filter(Boolean)
    .map((part) => part.match(/^(?:Exact dialogue|dialogue\/reaction|dialogue)\s*[:：]\s*([\s\S]+)$/i)?.[1]?.trim() ?? "")
    .filter(Boolean);
  if (labelledParts.length > 0) {
    const extracted = labelledParts
      .map((part) => {
        const speakerMatches = extractSpeakerDialogueFragments(part);
        return speakerMatches.length > 0 ? speakerMatches.join(" ") : part;
      })
      .join(" ");
    if (extracted) return extracted;
  }
  const labelled = value.match(/\b(?:Exact dialogue|dialogue\/reaction|dialogue)\s*[:;]\s*([\s\S]*?)(?=;\s*(?:Camera plan|Shot|State|Performance|shot size|angle|movement|composition|blocking|lens)\s*[:：]?\s*|$)/i)?.[1] ?? "";
  if (labelled) {
    const speakerMatches = extractSpeakerDialogueFragments(labelled);
    if (speakerMatches.length > 0) return speakerMatches.join(" ");
    return labelled.split(";")[0]?.trim() ?? labelled.trim();
  }
  const speakerMatches = extractSpeakerDialogueFragments(value);
  return speakerMatches.length > 0 ? speakerMatches.join(" ") : "";
}

function extractSpeakerDialogueFragments(value: string): string[] {
  const speakerPattern = String.raw`(?:[A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}|[一-龥·]{1,12})`;
  const saysMatches = Array.from(value.matchAll(new RegExp(String.raw`(?:^|\s)(${speakerPattern})\s+says\s+[“"]([\s\S]*?)[”"](?=\s*${speakerPattern}\s+says\s+[“"]|;|\n|$)`, "g")))
    .map((match) => {
      const speaker = (match[1] ?? "").trim();
      const line = cleanVideoDialogue((match[2] ?? "").trim());
      if (!speaker || !line || isNonDialogueSpeakerLabel(speaker, line)) return "";
      return `${speaker}: ${line}`.trim();
    })
    .filter((item) => item.length > 4);
  if (saysMatches.length > 0) return saysMatches;
  const speakerMatches = Array.from(value.matchAll(new RegExp(String.raw`(?:^|\s)(${speakerPattern})\s*[:：]\s*([\s\S]*?)(?=\s*${speakerPattern}\s*[:：]|;|\n|$)`, "g")))
    .map((match) => {
      const speaker = (match[1] ?? "").trim();
      const line = cleanVideoDialogue((match[2] ?? "").trim());
      if (!speaker || !line || isNonDialogueSpeakerLabel(speaker, line)) return "";
      return `${speaker}: ${line}`.trim();
    })
    .filter((item) => item.length > 4);
  return speakerMatches;
}

function formatExactVideoDialogue(value: string): string {
  const cleaned = cleanVideoDialogue(value || "");
  if (!cleaned) return "";
  const alreadyFormatted = cleaned.match(/^([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}|[一-龥·]{1,12})\s+says\s+[“"]([\s\S]+)[”"]$/);
  if (alreadyFormatted) {
    const speaker = (alreadyFormatted[1] ?? "").trim();
    const line = trimDialogueQuotes((alreadyFormatted[2] ?? "").trim());
    return `${speaker} says “${line}”`;
  }
  const speakerMatch = cleaned.match(/^([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}|[一-龥·]{1,12})\s*[:：]\s*([\s\S]+)$/);
  if (speakerMatch) {
    const speaker = (speakerMatch[1] ?? "").trim();
    const line = trimDialogueQuotes((speakerMatch[2] ?? "").trim());
    return `${speaker} says “${line}”`;
  }
  return `“${trimDialogueQuotes(cleaned)}”`;
}

function trimDialogueQuotes(value: string): string {
  return value
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
}

function isNonDialogueSpeakerLabel(speaker: string, line: string): boolean {
  const key = normalizeCompareText(speaker);
  if (/(camera|scene|shot|panel|action|dialogue|state|performance|composition|blocking|block|movement|lens|angle|shot size|visual|reference|references|setting|style|physics hack|poster ruined|face cracks open|exact dialogue)/.test(key)) return true;
  if (/^(camera|composition|blocking|block|movement|lens|angle|shot size|performance|medium|close-up|wide|eye-level|static|handheld|tracking|slow push|cut|whip-pan)\b/i.test(line)) return true;
  return false;
}

function isWorkflowVideoBeatLine(line: string): boolean {
  return /^(?:P|S)\d{1,2}\s*(?:\/\s*(?:P|S)?\d{1,2})?\s*(?:[:：\-—]|\s+-\s+)/i.test(line.trim());
}

// composeSeedancePrompt 在节拍块之后还会输出顺序/连续性/导演/负面指令行；
// 这些行必须归为 header section，否则会被吞进最后一个节拍而在压缩时整行丢失。
function isWorkflowVideoPostBeatHeaderLine(line: string): boolean {
  const trimmed = line.trim();
  if (isWorkflowVideoBeatLine(trimmed)) return false;
  return /^(?:Do not skip|Do not add|Continuity:|Direction:|No subtitles)/i.test(trimmed);
}

function trimWorkflowVideoPromptToLimit(prompt: string, maxChars: number): string {
  if (prompt.length <= maxChars) return prompt;
  const lines = prompt.split("\n");
  const beatLines = lines.filter((line) => isWorkflowVideoBeatLine(line));
  if (beatLines.length > 0) {
    const footerLine = lines.find((line) => line === COMPACT_WORKFLOW_VIDEO_FOOTER) ?? COMPACT_WORKFLOW_VIDEO_FOOTER;
    let headerLines = compactWorkflowVideoHeaderForBeatRetention(
      lines.filter((line) => line && !isWorkflowVideoBeatLine(line) && line !== footerLine),
    );
    const buildPrompt = (headers: string[], beats: string[], footer: string) => normalizePromptTextWithoutCompression([
      ...headers,
      ...beats,
      footer,
    ].filter(Boolean).join("\n"));
    const compactBeatsForBudget = (headers: string[], footer: string) => {
      const fixedChars = joinedLineLength(headers) + (headers.length ? 1 : 0) + footer.length + 1 + Math.max(0, beatLines.length - 1);
      const perBeatLimit = Math.max(
        24,
        Math.min(COMPACT_WORKFLOW_VIDEO_SECOND_PASS_MIN_BEAT_CHARS, Math.floor((maxChars - fixedChars) / beatLines.length)),
      );
      return beatLines.map((line) => compactWorkflowVideoBeatLine(line, perBeatLimit)).filter(Boolean);
    };

    let footer: string = footerLine;
    let compactBeats = compactBeatsForBudget(headerLines, footer);
    let rebuilt = buildPrompt(headerLines, compactBeats, footer);
    if (rebuilt.length <= maxChars) return rebuilt;

    headerLines = headerLines.map((line) => {
      if (/^Scene visual continuity lock:/i.test(line)) return compactSentence(line, 80);
      if (/^Initial character state and positions:/i.test(line)) return compactSentence(line, 100);
      if (/^Scene:|^Style:|^Characters:|^Story goal:|^Direction:/i.test(line)) return compactSentence(line, 90);
      if (/^Continuity:/i.test(line)) return "";
      return compactSentence(line, 70);
    });
    compactBeats = compactBeatsForBudget(headerLines, footer);
    rebuilt = buildPrompt(headerLines, compactBeats, footer);
    if (rebuilt.length <= maxChars) return rebuilt;

    const requiredHeader = headerLines.filter((line) => /^Generate |^Scene:|^Characters:|^Follow (?:shot|P) beats/i.test(line));
    headerLines = requiredHeader.length ? requiredHeader : headerLines.slice(0, 1);
    compactBeats = compactBeatsForBudget(headerLines, footer);
    rebuilt = buildPrompt(headerLines, compactBeats, footer);
    if (rebuilt.length <= maxChars) return rebuilt;

    footer = "";
    compactBeats = compactBeatsForBudget(headerLines, footer);
    rebuilt = buildPrompt(headerLines, compactBeats, footer);
    if (rebuilt.length <= maxChars) return rebuilt;
  }
  const output: string[] = [];
  for (const line of lines) {
    const remaining = maxChars - output.join("\n").length - (output.length ? 1 : 0);
    if (remaining <= 0) break;
    if (line.length <= remaining) {
      output.push(line);
      continue;
    }
    if (isWorkflowVideoBeatLine(line)) output.push(compactWorkflowVideoBeatLine(line, remaining));
    break;
  }
  return normalizePromptTextWithoutCompression(output.join("\n"));
}

function compactSentence(value: string, maxChars: number): string {
  const cleaned = cleanVideoLine(value);
  if (cleaned.length <= maxChars) return cleaned;
  if (maxChars <= 0) return "";
  if (maxChars <= 8) return cleaned.slice(0, maxChars).trim();
  const candidate = cleaned.slice(0, maxChars).trim();
  const sentenceMatches = Array.from(candidate.matchAll(/[.!?。！？；;](?=\s|$)/g));
  const sentenceBoundary = sentenceMatches
    .reverse()
    .find((match) => {
      const index = match.index ?? -1;
      const punctuation = match[0] ?? "";
      const trailing = candidate.slice(index + punctuation.length).trim();
      return !/[;；]/.test(punctuation) || trailing.length < 24;
    });
  const sentenceEnd = sentenceBoundary?.index;
  if (sentenceEnd !== undefined && sentenceEnd + 1 >= Math.floor(maxChars * 0.45)) {
    return stripDanglingVideoFragment(candidate.slice(0, sentenceEnd + (sentenceBoundary?.[0]?.length ?? 1)));
  }
  const commaBoundary = Math.max(candidate.lastIndexOf(", "), candidate.lastIndexOf("，"));
  if (commaBoundary >= Math.floor(maxChars * 0.55)) {
    return stripDanglingVideoFragment(candidate.slice(0, commaBoundary));
  }
  const wordBoundary = candidate.replace(/\s+\S*$/, "").trim();
  return stripDanglingVideoFragment(wordBoundary || candidate);
}

function stripDanglingVideoFragment(value: string): string {
  return cleanVideoLine(value)
    .replace(/(?<!-)\b(?:as if|and|or|with|to|from|of|for|by|in|on|at|the|a|an)\.?$/i, "")
    .replace(/\b(?:as if addre|addre|del|Cultists s|Cultists sit r)\.?$/i, "")
    .replace(/\s*[;,，；:：-]\s*$/g, "")
    .trim();
}

function formatClipCharacters(characters: string[], identities: Record<string, string>): string {
  return characters
    .map((name) => {
      const identity = identities[normalizeCompareText(name)];
      return identity && normalizeCompareText(identity) !== normalizeCompareText(name) ? `${name} (${identity})` : name;
    })
    .join(", ");
}

function formatClipVideoCharacters(characters: string[], identities: Record<string, string>): string {
  void identities;
  const names = compactWorkflowCharacterNames(characters).slice(0, 8);
  return names.length ? `${names.join(", ")}. Use connected character reference images for identity; do not redesign.` : "";
}

function compactWorkflowCharacterNames(values: string[]): string[] {
  const names = uniqueStrings(values.map((value) => cleanVideoLine(value))).filter(Boolean);
  return names.filter((name) => {
    const key = normalizeCompareText(name);
    if (!key) return false;
    return !names.some((other) => {
      const otherKey = normalizeCompareText(other);
      if (otherKey === key || otherKey.length <= key.length) return false;
      return new RegExp(`(^|\\s)${escapeRegExp(key)}($|\\s)`, "i").test(otherKey);
    });
  });
}

function compactVideoIdentity(value: string): string {
  return cleanVideoLine(
    value
      .replace(/\bwith\b[^.;,]*(?:clothing|clothes|shirt|pants|shorts|boots|sneakers|helmet|vest|uniform|mask|shotgun|pillow)[^.;,]*/gi, "")
      .replace(/\bwearing\b[^.;,]*/gi, "")
      .replace(/，/g, ","),
  );
}

function shortVideoStyle(value: string): string {
  const normalized = value
    .replace(/\bGlobal prompt:\s*[\s\S]*$/i, "")
    .replace(/\bScript rules:\s*[\s\S]*$/i, "")
    .replace(/\bDirector guidance:\s*/gi, "Director guidance: ")
    .replace(/\s+/g, " ")
    .trim();
  return cleanVideoLine(normalized || "cinematic 3D animated short-drama, fast pacing");
}

function buildClipVideoStoryboardBeats(clip: NormalizedWorkflowClip, shots: NormalizedStoryboardShot[], workflow?: ReturnType<typeof getWorkflowState>): ClipVideoStoryboardBeat[] {
  const panelBeats = extractStoryboardPanelVideoBeats(clip.storyboardPrompt);
  if (panelBeats.length > 0) return attachStoryboardBeatDialogues(panelBeats, shots);
  return buildShotOrderVideoBeats(shots, clip, workflow);
}

function extractStoryboardPanelVideoBeats(storyboardPrompt: string): ClipVideoStoryboardBeat[] {
  const prompt = normalizePromptTextWithoutCompression(storyboardPrompt || "");
  if (!prompt) return [];
  const panelMarker = String.raw`(?:Panel|panel|Storyboard\s*panel|P|p|分镜|镜头|格|画面|Shot|shot)`;
  const panelPattern = new RegExp(
    String.raw`(?:^|\n)[ \t]*(?:[-*]\s*)?${panelMarker}\s*#?\s*(\d{1,2})\s*(?:[:：.\-]|[)\]]|\s+-\s+)\s*([\s\S]*?)(?=(?:^|\n)[ \t]*(?:[-*]\s*)?${panelMarker}\s*#?\s*\d{1,2}\s*(?:[:：.\-]|[)\]]|\s+-\s+)|(?:^|\n)[ \t]*(?:Make panels|Panel planning rules|Technical labels|Avoid|Negative prompt|Board style|Reference image map|Dialogue lock)\b|$)`,
    "gi",
  );
  const matches = Array.from(prompt.matchAll(panelPattern));
  if (matches.length === 0) return [];
  return matches
    .map((match) => ({
      order: Number(match[1]),
      text: cleanStoryboardPanelText(match[2] ?? ""),
    }))
    .filter((item) => Number.isFinite(item.order) && item.order > 0 && item.text)
    .sort((a, b) => a.order - b.order)
    .slice(0, MAX_CLIP_STORYBOARD_PANEL_COUNT)
    .map((item) => ({
      label: `P${item.order}`,
      text: item.text,
    }));
}

function cleanStoryboardPanelText(value: string): string {
  return cleanVideoBeat(value)
    .replace(/\bdialogue\s*\/\s*reaction\b/gi, "")
    .replace(/\b(?:shot size|angle|camera angle|camera movement|move|lens|focal length|action|key prop|dialogue)\s*[:=]/gi, "")
    .replace(/\b(?:image area|technical label strip|label strip)\b/gi, "")
    .replace(/\s*[|/]\s*/g, "; ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildShotOrderVideoBeats(shots: NormalizedStoryboardShot[], clip?: NormalizedWorkflowClip, workflow?: ReturnType<typeof getWorkflowState>): ClipVideoStoryboardBeat[] {
  const allocation = allocateClipDialogueToBeats(
    shots.map((shot) => ({
      dialogue: shot.dialogue || "",
      characters: shot.characters || [],
      title: shot.title,
      action: shot.action,
      description: shot.description,
      visualPrompt: shot.visualPrompt,
      references: shot.references,
    })),
  );
  const stateMemory = buildClipCharacterStateMemory(clip, workflow);
  return shots
    .map((shot, index) => {
      const camera = shotVideoCameraPlan(shot, index);
      const action = cleanVideoBeat(shot.action || shot.description || shot.visualPrompt || fallbackBeatActionFromDialogue(shot, allocation.beats[index]?.join(" ") ?? ""));
      const dialogue = cleanVideoDialogue(allocation.beats[index]?.join(" ") ?? "");
      const visibleCharacters = visibleCharactersForShot(shot, dialogue);
      const state = stateLineForVisibleCharacters(visibleCharacters, action, shot, stateMemory);
      const performance = performanceLineForVideoBeat(shot, action, dialogue, visibleCharacters, clip);
      return {
        label: `S${index + 1}`,
        camera,
        composition: cleanVideoBeat(shot.composition || ""),
        action,
        sourceTitle: cleanVideoBeat(shot.title || ""),
        sourceDescription: cleanVideoBeat(shot.description || ""),
        sourceReferences: cleanVideoBeat(shot.references || ""),
        sourceVisualPrompt: cleanVideoBeat(shot.visualPrompt || ""),
        text: [camera ? `Shot: ${camera}` : "", action].filter(Boolean).join("; "),
        dialogue,
        visibleCharacters,
        state,
        performance,
      };
    })
    .filter((beat) => beat.text || beat.dialogue)
    .slice(0, MAX_CLIP_STORYBOARD_PANEL_COUNT);
}

function performanceLineForVideoBeat(
  shot: NormalizedStoryboardShot,
  action: string,
  dialogue: string,
  visibleCharacters: string[],
  clip?: NormalizedWorkflowClip,
): string {
  const localText = normalizeCompareText([
    shot.title,
    shot.description,
    shot.action,
    shot.references,
    shot.visualPrompt,
    action,
    dialogue,
  ].join(" "));
  const closeOrReaction = /(close|close-up|reaction|face|eyes|stare|look|expression|whisper|smirk|特写|反应|表情|眼神)/.test(localText);
  const hasDialogue = Boolean(cleanVideoDialogue(dialogue || shot.dialogue || ""));
  const hasLocalEmotionCue = hasBeatEmotionCue(localText);
  if (!hasDialogue && (!closeOrReaction || !hasLocalEmotionCue)) return "";

  const subjects = visibleCharacters.length
    ? visibleCharacters.slice(0, 2).join(" and ")
    : extractAllocatedDialogueSpeakerNames(dialogue || shot.dialogue || "").slice(0, 2).join(" and ");
  const subject = subjects || "visible performer(s)";
  const emotion = inferBeatEmotionDescriptor(localText, hasLocalEmotionCue || hasDialogue ? clip : undefined);
  const delivery = hasDialogue ? inferDialogueDeliveryDescriptor(localText, dialogue || shot.dialogue || "", clip) : "";
  const parts = [
    `${subject} ${subject.includes(" and ") ? "show" : "shows"} ${emotion}`,
    delivery ? `delivery ${delivery}` : "",
  ].filter(Boolean);
  return parts.length ? `Performance: ${parts.join("; ")}` : "";
}

function hasBeatEmotionCue(text: string): boolean {
  return /(panic|fear|afraid|terrified|tense|hesitat|nervous|worried|angry|rage|furious|scold|accuse|yell|shout|snap|glares|sarcastic|mock|dry|deadpan|joke|wisecrack|snark|surprise|reveal|shock|realize|sudden|startled|\bconfess(?:es|ed|ing)?\b|guilty|ashamed|plead|beg|ritual|trial|announce|ceremony|sermon|judgment|惊恐|害怕|紧张|犹豫|怒|训斥|指责|吼|瞪|讽刺|吐槽|冷笑|黑色幽默|惊讶|震惊|发现|意识到|忏悔|内疚|羞愧|求饶|审判|仪式|宣告|布道)/.test(text);
}

function inferBeatEmotionDescriptor(text: string, clip?: NormalizedWorkflowClip): string {
  const arc = normalizeCompareText(clip?.emotionArc || "");
  const combined = `${text} ${arc}`;
  if (/(panic|fear|afraid|terrified|tense|hesitat|nervous|worried|惊恐|害怕|紧张|犹豫)/.test(combined)) return "tense, alert expression with small anxious micro-reactions";
  if (/(angry|rage|furious|scold|accuse|yell|shout|snap|glares|怒|训斥|指责|吼|瞪)/.test(combined)) return "sharp anger or righteous outrage in the face and posture";
  if (/(sarcastic|mock|dry|deadpan|joke|wisecrack|snark|讽刺|吐槽|冷笑|黑色幽默)/.test(combined)) return "dry comic timing, restrained sarcasm, and a readable deadpan face";
  if (/(surprise|reveal|shock|realize|sudden|startled|惊讶|震惊|发现|意识到)/.test(combined)) return "surprised recognition that quickly turns into a reaction";
  if (/\b(confess(?:es|ed|ing)?|guilty|ashamed|plead|beg)\b|忏悔|内疚|羞愧|求饶/.test(combined)) return "uneasy guilt or pleading vulnerability";
  if (/(ritual|trial|announce|ceremony|sermon|judgment|审判|仪式|宣告|布道)/.test(combined)) return "heightened ritual seriousness with theatrical conviction";
  return "story-specific emotion matching the current beat, readable through face and body language";
}

function inferDialogueDeliveryDescriptor(text: string, dialogue: string, clip?: NormalizedWorkflowClip): string {
  const combined = normalizeCompareText(`${text} ${dialogue} ${clip?.emotionArc || ""}`);
  if (/(deadpan|dry|sarcastic|mock|joke|wisecrack|crap|kidding|讽刺|吐槽|冷笑)/.test(combined)) return "dry, quick, sarcastic, with comic pause timing";
  if (/(angry|furious|scold|accuse|yell|shout|snap|murder|trial|审判|指责|训斥|怒吼)/.test(combined)) return "forceful and theatrical, rising with controlled outrage";
  if (/(whisper|secret|quiet|low|低声|耳语|悄声)/.test(combined)) return "lower and controlled, with guarded tension";
  if (/(panic|fear|please|beg|help|惊恐|求饶|拜托)/.test(combined)) return "urgent and breathy, pushed by fear";
  if (/(announce|ritual|ceremony|sermon|宣告|仪式|布道)/.test(combined)) return "ceremonial, declarative, and aimed at the hall";
  return "natural to the line's intent, not monotone, with clear emotional subtext";
}

function shotVideoCameraPlan(shot: NormalizedStoryboardShot, index = 0): string {
  const fallback = inferProfessionalShotFields(
    {
      title: shot.title,
      description: shot.description,
      action: shot.action,
      dialogue: shot.dialogue,
      durationSeconds: shot.durationSeconds,
      characters: shot.characters,
      setting: shot.setting,
      references: shot.references,
      visualPrompt: shot.visualPrompt,
    },
    index,
  );
  const shotSize = cleanVideoBeat(shot.shotSize || fallback.shotSize || "medium shot");
  const angle = cleanVideoBeat(shot.cameraAngle || fallback.cameraAngle || "eye-level");
  const movement = cleanVideoBeat(shot.cameraMove || fallback.cameraMove || "controlled camera move");
  const lens = cleanVideoBeat(shot.lens || fallback.lens || "50mm");
  const composition = cleanShotBlocking(shot.composition || fallback.composition || shot.references || shot.visualPrompt || "");
  return [
    shotSize,
    angle,
    movement,
    lens,
    composition ? `blocking: ${composition}` : "",
  ].filter(Boolean).join("; ");
}

function cleanShotBlocking(value: string): string {
  return stripShotStyleBoilerplate(cleanVideoBeat(value || ""))
    .replace(/\bSet in [^;。.!?]+[;。.!?]?\s*/gi, "")
    .replace(/\bUse the current scene layout[;。.!?]?\s*/gi, "")
    .replace(/\bframe only the visible subject\(s\) for this shot[;。.!?]?\s*/gi, "")
    .replace(/\bkeep screen direction readable[;。.!?]?\s*/gi, "")
    .replace(/\bseparate foreground, midground, and background(?: for continuity)?[;。.!?]?\s*/gi, "")
    .replace(/\bclear character blocking[;。.!?]?\s*/gi, "")
    .replace(/\bcurrent scene layout[;。.!?]?\s*/gi, "")
    .replace(/\b[A-Z][A-Za-z'’.-]+(?:\s+and\s+[A-Z][A-Za-z'’.-]+)?\s+in the same established scene position[;。.!?]?\s*/gi, "")
    .replace(/\bin the same established scene position[;。.!?]?\s*/gi, "")
    .replace(/\bSame setting and character blocking,?\s*natural reaction or angle change\.?\s*/gi, "")
    .replace(/\s*;\s*;\s*/g, "; ")
    .replace(/^;\s*|\s*;$/g, "")
    .trim();
}

function stripShotStyleBoilerplate(value: string): string {
  return cleanVideoBeat(value || "")
    .replace(/\b(?:masterpiece|best quality|highly detailed|cinematic lighting|consistent character design|polished render|saturated colors|clean 3D render)\b,?\s*/gi, "")
    .replace(/\b(?:saturated\s+)?3D\s+(?:American\s+)?(?:animated\s+)?(?:dark[- ]comedy\s+)?comic style\b,?\s*/gi, "")
    .replace(/\b(?:3D style|American comic style|dark humor|dark-comedy comic look)\b,?\s*/gi, "")
    .replace(/^(?:[,;]\s*)+/g, "")
    .replace(/\s*;\s*;\s*/g, "; ")
    .trim();
}

function summarizeInitialCharacterStateAndPositions(
  beats: ClipVideoStoryboardBeat[],
  startState = "",
  layoutMemory = "",
): string {
  const sources = beats
    .filter((beat) => (beat.visibleCharacters?.length ?? 0) > 0 || beat.camera || beat.composition || beat.action || beat.text)
    .slice(0, 3);
  const fallbackText = cleanVideoBeat([startState, layoutMemory].filter(Boolean).join("; "));
  const output: string[] = [];
  const seen = new Set<string>();
  for (const beat of sources) {
    const names = uniqueStrings([...(beat.visibleCharacters ?? []), ...extractAllocatedDialogueSpeakerNames(beat.dialogue || "")]).slice(0, 4);
    if (names.length === 0) continue;
    const evidence = cleanInitialStateEvidence([
      beat.composition,
      extractBlockingFromCameraLine(beat.camera || ""),
      beat.state,
      beat.sourceReferences,
      beat.sourceDescription,
      beat.sourceVisualPrompt,
      beat.action,
      beat.text,
    ].filter(Boolean).join("; "));
    for (const name of names) {
      const key = normalizeCompareText(name);
      if (!key || seen.has(key)) continue;
      const phrase = summarizeInitialStateForCharacter(name, evidence, fallbackText);
      if (!phrase) continue;
      output.push(phrase);
      seen.add(key);
      if (output.length >= 5) break;
    }
    if (output.length >= 5) break;
  }
  if (output.length === 0 && fallbackText) return compactSentence(fallbackText, 360);
  return compactSentence(output.join("; "), 520);
}

function summarizeInitialStateForCharacter(character: string, evidence: string, fallbackText: string): string {
  const clauses = reduceInitialStateClauses(uniqueStrings([
    ...initialStateClausesForCharacter(character, fallbackText),
    ...initialStateClausesForCharacter(character, evidence),
  ]).sort((a, b) => initialStateClausePriority(b) - initialStateClausePriority(a)));
  if (clauses.length === 0) return "";
  return `${character} ${uniqueStrings(clauses).slice(0, 3).join(", ")}`;
}

function initialStateClausesForCharacter(character: string, value: string): string[] {
  const source = cleanInitialStateEvidence(value);
  if (!source) return [];
  const name = escapeRegExp(character);
  const clauses: string[] = [];
  const carriedBedState = livingVineBedStateForCharacter(source, character);
  if (carriedBedState) clauses.push(carriedBedState);
  const localSource = initialStateLocalTextForCharacter(source, character);
  const screenSideMatch = localSource.match(new RegExp(String.raw`\b${name}\b[^.;。!?]{0,90}\b(screen[- ]?(?:left|right|center)|center[- ]?(?:left|right)|foreground|midground|background|left side|right side|front row|rear|elevated|below|above|at the head|head of (?:the )?bed|bed head)\b[^.;。!?]{0,70}`, "i"));
  if (screenSideMatch) clauses.push(cleanInitialStateClause(screenSideMatch[0].replace(new RegExp(String.raw`^\b${name}\b\s*`, "i"), "")));
  const facingMatch = localSource.match(new RegExp(String.raw`\b${name}\b[^.;。!?]{0,90}\b(?:facing|faces|looks toward|turned toward|toward|面向|看向)\b[^.;。!?]{0,70}`, "i"));
  if (facingMatch) clauses.push(cleanInitialStateClause(facingMatch[0].replace(new RegExp(String.raw`^\b${name}\b\s*`, "i"), "")));
  const heldMatch = localSource.match(new RegExp(String.raw`\b${name}\b[^.;。!?]{0,100}\b(?:holding|holds|held|clutching|clutches|carrying|carries|with|手持|拿着|抱着)\b[^.;。!?]{0,70}`, "i"));
  if (heldMatch) clauses.push(cleanInitialStateClause(heldMatch[0].replace(new RegExp(String.raw`^\b${name}\b\s*`, "i"), "")));
  const stateMatch = localSource.match(new RegExp(String.raw`\b${name}\b[^.;。!?]{0,110}\b(?:bound|tied|restrained|wearing|wears|splattered|stained|injured|lowered|raised|嵌在|长在|被绑|受限|穿着|戴着|污渍|溅到)\b[^.;。!?]{0,80}`, "i"));
  if (stateMatch) clauses.push(cleanInitialStateClause(stateMatch[0].replace(new RegExp(String.raw`^\b${name}\b\s*`, "i"), "")));
  const compactSentenceWithName = localSource.match(new RegExp(String.raw`\b${name}\b[^.;。!?]{0,140}`, "i"));
  if (clauses.length === 0 && compactSentenceWithName) {
    const fallbackClause = cleanInitialStateClause(compactSentenceWithName[0].replace(new RegExp(String.raw`^\b${name}\b\s*`, "i"), ""));
    if (isUsefulInitialStateClause(fallbackClause)) clauses.push(fallbackClause);
  }
  return clauses.filter(Boolean);
}

function initialStateClausePriority(value: string): number {
  const text = normalizeCompareText(value);
  let score = 0;
  if (/living vine hospital bed|vine bed|ritual bed|hospital bed|altar|bed/.test(text)) score += 5;
  if (/bound|restrained|strapped|tied|root restraint|vine restraint|藤蔓|根须|被绑|束缚/.test(text)) score += 4;
  if (/screen|center|left|right|foreground|background|at the head|head of/.test(text)) score += 2;
  if (/facing|toward|looks toward|面向|看向/.test(text)) score += 1;
  return score;
}

function reduceInitialStateClauses(values: string[]): string[] {
  const cleaned = uniqueStrings(values.map(cleanInitialStateClause).filter(Boolean))
    .filter((item) => !/^Start\s*[:：]/i.test(item))
    .filter((item) => !/^开始\s*[:：]/i.test(item))
    .filter((item) => !/^Ends?\s+with\b/i.test(item))
    .filter((item) => !/^结束\s*[:：]/i.test(item))
    .filter((item) => !/^['’]s\b/i.test(item))
    .filter((item) => !/^(?:Location|Characters|Continuity references|Character personal prop continuity|Rule|位置|角色|连续性参考|角色个人道具连续性|规则)\s*[:：]/i.test(item))
    .filter((item) => !/^\s*,\s*$/.test(item));
  const bestLivingBedState = cleaned.find((item) => /Living Vine Hospital Bed.*wrist connected to needle\/tubing/i.test(item))
    ?? cleaned.find((item) => /lying on the Living Vine Hospital Bed, restrained by living vines\/root restraints/i.test(item))
    ?? cleaned.find((item) => /Living Vine Hospital Bed.*restrained by living vines\/root restraints/i.test(item));
  return cleaned.filter((item) => {
    if (bestLivingBedState && /\bhands bound with rope\b|\bbound with rope\b|\bmovement restricted\b/i.test(item)) return false;
    if (
      bestLivingBedState &&
      item !== bestLivingBedState &&
      /Living Vine Hospital Bed.*restrained by living vines\/root restraints/i.test(item)
    ) return false;
    return true;
  });
}

function livingVineBedStateForCharacter(value: string, character: string): string {
  const source = cleanVideoBeat(value || "");
  if (!source) return "";
  const name = escapeRegExp(character);
  const hasName = new RegExp(String.raw`\b${name}\b`, "i").test(source);
  if (!hasName) return "";
  const hasLivingBed = /\b(?:Living Vine Hospital Bed|vine hospital bed|living vine bed|vine bed|ritual bed|hospital bed|altar)\b|藤蔓病床|藤蔓床|仪式病床|仪式床/.test(source);
  const local = initialStateLocalTextForCharacter(source, character);
  const hasVineRestraint = /\b(?:living vines?|vine restraints?|root restraints?|restrained by vines?|bound by vines?|tendrils?|fungal neck threads?|bound|restrained|strapped|tied)\b|藤蔓|根须|触须|菌丝|被绑|束缚/.test(local);
  const characterOnBed = /\b(?:lies?|lying|bound|restrained|strapped|twists?|glares?|strains?)\b/i.test(local) ||
    /\bon\s+(?:the\s+)?(?:Living Vine Hospital Bed|vine hospital bed|living vine bed|vine bed|ritual bed|hospital bed|altar)\b/i.test(local);
  if (!hasLivingBed || !hasVineRestraint || !characterOnBed) return "";
  if (/\b(?:wrist|needle|tube|tubing|injection)\b/i.test(local)) {
    return "on the Living Vine Hospital Bed, still restrained by living vines/root restraints, wrist connected to needle/tubing";
  }
  if (/\b(?:lies?|lying|twists?|tilts?|glares?|strains?)\b/i.test(local)) {
    return "lying on the Living Vine Hospital Bed, restrained by living vines/root restraints";
  }
  return "on the Living Vine Hospital Bed, restrained by living vines/root restraints";
}

function initialStateLocalTextForCharacter(value: string, character: string): string {
  const name = escapeRegExp(character);
  return initialStateEvidenceClauses(value)
    .map((item) => {
      const match = item.match(new RegExp(String.raw`\b${name}\b[\s\S]*`, "i"));
      const local = match?.[0]?.trim() ?? "";
      return local.split(/(?:[;,]|[.!?。！？])\s*(?=(?:[A-Z][A-Za-z'’.-]+\b|Location|Characters|Start|End|Continuity references|Rule|位置|角色|开始|结束|连续性参考|规则)\b)/)[0]?.trim() ?? "";
    })
    .filter(Boolean)
    .join("; ");
}

function splitStateAtoms(value: string): string[] {
  return value
    .split(/\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanInitialStateEvidence(value: string): string {
  const structured = initialStateEvidenceClauses(value).join("; ");
  return cleanVideoBeat(structured)
    .replace(/\bShot:\s*/gi, "")
    .replace(/\bState:\s*/gi, "")
    .replace(/\bPerformance:\s*[^;。!?]+[;。!?]?\s*/gi, "")
    .replace(/\bExact dialogue:\s*[^;。!?]+[;。!?]?\s*/gi, "")
    .replace(/\b(?:medium shot|close-up|wide shot|eye-level|over-shoulder|static hold|slow push-in|controlled camera move|handheld tracking|24mm|35mm|50mm|85mm)\b;?\s*/gi, "")
    .replace(/\s*;\s*;\s*/g, "; ")
    .replace(/^;\s*|\s*;$/g, "")
    .trim();
}

function initialStateEvidenceClauses(value: string): string[] {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/(?:Character personal prop continuity|角色个人道具连续性)\s*[:：][\s\S]*?(?=\b(?:Rule|Start|End|Location|Characters|Continuity references)\s*[:：]|(?:规则|开始|结束|位置|角色|连续性参考)\s*[:：]|$)/gi, "\n")
    .replace(/\s*\|\s*/g, "\n")
    .replace(/\b(Location|Characters|Start|End|Continuity references|Character personal prop continuity|Rule)\s*[:：]/gi, "\n$1: ")
    .replace(/(角色个人道具连续性|连续性参考|位置|角色|开始|结束|规则)\s*[:：]/g, "\n$1：")
    .split(/\n+|;\s*/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean)
    .map((line) => {
      if (/^(?:Location|Characters|Character personal prop continuity|Rule|位置|角色|角色个人道具连续性|规则)\s*[:：]/i.test(line)) return "";
      if (/^Continuity references\s*[:：]\s*/i.test(line)) return line.replace(/^Continuity references\s*[:：]\s*/i, "").trim();
      if (/^连续性参考\s*[:：]\s*/i.test(line)) return line.replace(/^连续性参考\s*[:：]\s*/i, "").trim();
      return line
        .replace(/^Start\s*[:：]\s*(?:Starts?\s+with\s*)?/i, "")
        .replace(/^End\s*[:：]\s*(?:Ends?\s+with\s*)?/i, "")
        .replace(/^开始\s*[:：]\s*(?:开始于\s*)?/i, "")
        .replace(/^结束\s*[:：]\s*(?:结束于\s*)?/i, "")
        .replace(/^Continuity\s*[:：]\s*/i, "")
        .replace(/^Starts?\s+with\s+/i, "")
        .replace(/^Ends?\s+with\s+/i, "")
        .replace(/^开始于\s+/i, "")
        .replace(/^结束于\s+/i, "")
        .trim();
    })
    .filter((line) => line && !/^Keep screen direction, character side, important props\b/i.test(line))
    .filter((line) => line && !/^保持屏幕方向、角色所在侧、重要道具以及入场\/退场位置连续到下一个 Clip。?$/.test(line))
    .filter((line) => line && !/^these props belong to the listed characters\b/i.test(line))
    .filter((line) => line && !/^这些道具属于列出的角色\b/i.test(line));
}

function cleanInitialStateClause(value: string): string {
  return cleanVideoBeat(value || "")
    .replace(/\b(?:blocking|composition)\s*[:：]\s*/gi, "")
    .replace(/\b(?:Location|Characters|Continuity references)\s*[:：][^;。!?]*[;。!?]?\s*/gi, "")
    .replace(/(?:位置|角色|连续性参考)\s*[:：][^;。!?]*[;。!?]?\s*/g, "")
    .replace(/\bStart\s*[:：]\s*(?:Starts?\s+with\s*)?/gi, "")
    .replace(/\bEnd\s*[:：]\s*(?:Ends?\s+with\s*)?/gi, "")
    .replace(/开始\s*[:：]\s*(?:开始于\s*)?/g, "")
    .replace(/结束\s*[:：]\s*(?:结束于\s*)?/g, "")
    .replace(/^开始于\s+/g, "")
    .replace(/^结束于\s+/g, "")
    .replace(/^(?:is|are|stands?|remains?|still|with)\s+/i, "")
    .replace(/^[,;:：\s]+/g, "")
    .replace(/\s*;\s*$/g, "")
    .trim();
}

function isUsefulInitialStateClause(value: string): boolean {
  return /\b(?:screen[- ]?(?:left|right|center)|center[- ]?(?:left|right)?|foreground|midground|background|left side|right side|front row|rear|elevated|below|above|at the head|head of (?:the )?bed|bed head|facing|faces|looks toward|turned toward|toward|holding|holds|held|clutching|clutches|carrying|carries|with|bound|tied|restrained|wearing|wears|splattered|stained|injured|lowered|raised|lies?|lying|on the|upon|bed|altar)\b|面向|看向|手持|拿着|抱着|嵌在|长在|被绑|受限|穿着|戴着|污渍|溅到/.test(value);
}

function extractBlockingFromCameraLine(camera: string): string {
  const match = camera.match(/;\s*blocking:\s*([\s\S]*)$/i);
  return match ? match[1].trim() : "";
}

function removeBlockingFromCameraLine(camera: string): string {
  return camera.replace(/;\s*blocking:\s*[\s\S]*$/i, "").trim().replace(/;\s*$/, "");
}

function fallbackBeatActionFromDialogue(shot: NormalizedStoryboardShot, dialogue: string): string {
  const speakers = extractAllocatedDialogueSpeakerNames(dialogue || shot.dialogue || "");
  if (speakers.length > 0) return `${speakers.join(" and ")} speak in ${shot.setting || "the scene"} with clear expression and readable body language.`;
  const cast = (shot.characters || []).filter(Boolean).slice(0, 3);
  if (cast.length > 0) return `${cast.join(" and ")} react in ${shot.setting || "the scene"} with clear story intent.`;
  return "Continue the current story beat with visible character action.";
}

function visibleCharactersForShot(shot: NormalizedStoryboardShot, dialogue: string): string[] {
  const text = normalizeCompareText([
    shot.title,
    shot.description,
    shot.action,
    dialogue,
  ].join(" "));
  const speakers = extractAllocatedDialogueSpeakerNames(dialogue || shot.dialogue || "");
  const explicit = (shot.characters || []).filter((name) => text.includes(normalizeCompareText(name)));
  return uniqueStrings([...speakers, ...explicit]).slice(0, 3);
}

function buildClipCharacterStateMemory(clip?: NormalizedWorkflowClip, workflow?: ReturnType<typeof getWorkflowState>): Map<string, string[]> {
  const memory = new Map<string, string[]>();
  const push = (character: string, state: string) => {
    const key = normalizeCompareText(character);
    if (!key || !state) return;
    const states = memory.get(key) ?? [];
    if (!states.some((item) => normalizeCompareText(item) === normalizeCompareText(state))) states.push(state);
    memory.set(key, states.slice(-4));
  };
  const texts: string[] = [];
  if (workflow && clip) {
    const workflowClips = Array.isArray(workflow.clips) ? workflow.clips : [];
    const clipIndex = workflowClips.findIndex((item) => item.id === clip.id);
    const previousClips = clipIndex > 0 ? workflowClips.slice(Math.max(0, clipIndex - 3), clipIndex) : [];
    for (const item of previousClips) {
      texts.push(item.startState, item.endState, item.layoutMemory, item.storyboardNotes);
    }
  }
  if (clip) texts.push(clip.startState, clip.endState, clip.layoutMemory, clip.storyboardNotes);
  const joined = texts.filter(Boolean).join("\n");
  if (/\bBound\s+Chloe,\s*Bob,\s*and\s*Leo\b/i.test(joined) || /\bChloe,\s*Bob,\s*and\s*Leo[^.\n;]*\b(?:bound|tied|restrained|captives)\b/i.test(joined)) {
    for (const name of ["Chloe", "Bob", "Leo"]) push(name, "hands bound with rope, movement restricted");
  }
  const workflowCharacters = Array.isArray(workflow?.clips) ? workflow.clips.flatMap((item) => item.characters) : [];
  for (const character of uniqueStrings([...(clip?.characters ?? []), ...workflowCharacters]).slice(0, 40)) {
    const name = escapeRegExp(character);
    const livingVineBedState = livingVineBedStateForCharacter(joined, character);
    const explicitBound = new RegExp(String.raw`\b${name}\b\s+(?:is|are|stands?|remains?|still)?\s*(?:hands bound|hands tied|wrists bound|wrists tied|bound with rope|tied with rope|restrained)\b`, "i").test(joined);
    const explicitPizza = new RegExp(String.raw`\b${name}\b[^.\n;:]{0,80}\b(?:clutch|clutches|holding|holds)\b[^.\n;:]{0,80}\bpizza box\b`, "i").test(joined);
    const explicitHelmet = new RegExp(String.raw`\b${name}\b[^.\n;:]{0,80}\b(?:wearing|wears)\b[^.\n;:]{0,80}\bhelmet\b`, "i").test(joined);
    if (livingVineBedState) push(character, livingVineBedState);
    else if (explicitBound) push(character, "hands bound with rope, movement restricted");
    if (explicitPizza) push(character, "clutching the pizza box despite restraints");
    if (explicitHelmet) push(character, "still wearing the helmet");
  }
  return memory;
}

function statePhraseFromText(value: string, character: string): string {
  const text = normalizeCompareText(value);
  const name = escapeRegExp(character);
  const states: string[] = [];
  const raw = value;
  const livingVineBedState = livingVineBedStateForCharacter(raw, character);
  if (livingVineBedState) states.push(livingVineBedState);
  if (!livingVineBedState && (
    new RegExp(String.raw`\b${name}\b[^.\n;:]{0,80}\b(?:hands bound|hands tied|wrists bound|wrists tied|bound with rope|tied with rope|restrained|still bound)\b`, "i").test(raw) ||
    new RegExp(String.raw`\b(?:Bound|Tied|Restrained)\s+${name}\b`, "i").test(raw)
  )) {
    states.push("hands bound with rope, movement restricted");
  }
  if (new RegExp(String.raw`\b${name}\b[^.\n;:]{0,80}\b(?:clutch|clutches|holding|holds|held)\b[^.\n;:]{0,80}\bpizza box\b`, "i").test(raw)) {
    states.push("clutching the pizza box despite restraints");
  }
  if (new RegExp(String.raw`\b${name}\b[^.\n;:]{0,80}\b(?:wearing|wears)\b[^.\n;:]{0,80}\bhelmet\b`, "i").test(raw)) {
    states.push("still wearing the helmet");
  }
  if (states.length === 0) return "";
  return `${character}: ${uniqueStrings(states).join(", ")}`;
}

function stateLineForVisibleCharacters(visibleCharacters: string[], action: string, shot: NormalizedStoryboardShot, memory: Map<string, string[]>): string {
  if (visibleCharacters.length === 0) return "";
  const localText = [shot.title, shot.description, shot.action, shot.references, shot.visualPrompt, action].filter(Boolean).join(" ");
  const output: string[] = [];
  for (const character of visibleCharacters) {
    const localState = statePhraseFromText(localText, character);
    const remembered = memory.get(normalizeCompareText(character)) ?? [];
    let states = uniqueStrings([
      ...(localState ? localState.replace(new RegExp(`^${escapeRegExp(character)}\\s*[:：]\\s*`, "i"), "").split(/\s*,\s*/) : []),
      ...remembered.flatMap((item) => splitStateAtoms(item.replace(new RegExp(`^${escapeRegExp(character)}\\s*[:：]\\s*`, "i"), ""))),
    ].map((item) => item.trim()).filter(Boolean));
    const hasBoundState = states.some((item) => /hands bound|tied|restrained|movement restricted/i.test(item));
    const hasLivingVineBedState = states.some((item) => /Living Vine Hospital Bed|living vines\/root restraints|root restraints/i.test(item));
    if (hasLivingVineBedState) {
      states = states.filter((item) => !/\bhands bound with rope\b|\bbound with rope\b|\bmovement restricted\b|\bhands bound\b|\btied with rope\b/i.test(item));
    }
    const localShotgunState = new RegExp(String.raw`\b${escapeRegExp(character)}\b[^.\n;]*\b(?:holding|holds|held|lowered)\b[^.\n;]*\bshotgun\b`, "i").test(localText);
    if (hasBoundState && !localShotgunState) {
      states = states.filter((item) => !/holding the shotgun/i.test(item));
    }
    if (states.length > 0) output.push(`${character} ${states.slice(0, 2).join(", ")}`);
  }
  return output.length ? `State: ${output.join("; ")}` : "";
}

function formatStoryboardVideoBeats(beats: ClipVideoStoryboardBeat[]): { lines: string[]; clipBlocking: string } {
  const builderBeats = beats.filter((beat) => beat.camera !== undefined);
  const blockingTexts = builderBeats.map((beat) => extractBlockingFromCameraLine(beat.camera || ""));
  const nonEmptyBlockings = blockingTexts.filter(Boolean);
  const uniqueBlockings = new Set(nonEmptyBlockings.map((b) => normalizeCompareText(b)));
  const clipBlocking = nonEmptyBlockings.length > 1 && uniqueBlockings.size === 1 ? nonEmptyBlockings[0] : "";

  let previousActionKey = "";
  const seenPerformanceKeys = new Set<string>();
  const lines = beats
    .map((beat, index) => {
      const label = beat.label || "Beat";
      const dialogue = cleanVideoDialogue(beat.dialogue || "");
      const dialoguePrefix = dialogue ? `Dialogue: ${formatExactVideoDialogue(dialogue)}; ` : "";
      let core: string;
      if (beat.camera !== undefined || beat.action !== undefined) {
        const camera = clipBlocking ? removeBlockingFromCameraLine(beat.camera || "") : (beat.camera || "");
        const actionKey = videoBeatActionRepeatKey(beat.action || "");
        const repeatedAction = Boolean(actionKey) && actionKey === previousActionKey;
        if (actionKey) previousActionKey = actionKey;
        const performance = cleanVideoBeat(beat.performance || "");
        const performanceKey = normalizeCompareText(performance);
        const omitPerformance = Boolean(performance) && (
          isGenericVideoPerformanceLine(performance) ||
          seenPerformanceKeys.has(performanceKey)
        );
        if (performance && !omitPerformance) seenPerformanceKeys.add(performanceKey);
        const actionText = repeatedAction
          ? repeatedBeatActionFallback(beat, index)
          : stripShotStyleBoilerplate(cleanVideoBeat(beat.action || ""));
        core = [camera ? `Shot: ${camera}` : "", cleanVideoBeat(beat.state || ""), omitPerformance ? "" : performance, actionText]
          .filter(Boolean)
          .join("; ");
      } else {
        previousActionKey = "";
        core = cleanVideoLine(cleanStoryboardPanelText(removeVideoDialogueFragments(beat.text, dialogue)));
      }
      const text = cleanVideoLine(`${dialoguePrefix}${core}`.trim());
      return text ? `${label}: ${text}` : "";
    })
    .filter(Boolean);

  return { lines, clipBlocking };
}

function isGenericVideoPerformanceLine(value: string): boolean {
  const text = normalizeCompareText(value);
  if (!text) return false;
  if (/story specific emotion matching the current beat/.test(text)) return true;
  if (/heightened ritual seriousness with theatrical conviction/.test(text)) return true;
  if (/ceremonial and performative as if addressing the room/.test(text)) return true;
  if (/show the listener s reaction speaker s expression/.test(text)) return true;
  return false;
}

function repeatedBeatActionFallback(beat: ClipVideoStoryboardBeat, index: number): string {
  const concrete = concreteRepeatedBeatAction(beat);
  if (concrete) return concrete;
  const characters = (beat.visibleCharacters ?? []).filter(Boolean).slice(0, 2);
  const subject = characters.length ? characters.join(" and ") : "visible character(s)";
  if (beat.dialogue) return `${subject} speak while the listener's visible posture or expression changes.`;
  return `${subject} remain in the shot with a specific visible change in gaze, posture, hand position, or prop contact.`;
}

function concreteRepeatedBeatAction(beat: ClipVideoStoryboardBeat): string {
  const repeatedKey = videoBeatActionRepeatKey(beat.action || "");
  const candidates = [
    beat.sourceVisualPrompt,
    beat.composition,
    beat.sourceReferences,
    beat.sourceDescription,
    beat.sourceTitle,
  ]
    .flatMap((value) => splitConcreteBeatCandidateText(value || ""))
    .map((value) => stripShotStyleBoilerplate(cleanVideoBeat(value)))
    .filter(Boolean);
  for (const candidate of candidates) {
    const key = videoBeatActionRepeatKey(candidate);
    if (!key || key === repeatedKey || isGenericRepeatedBeatFallbackText(candidate)) continue;
    return candidate;
  }
  return "";
}

function splitConcreteBeatCandidateText(value: string): string[] {
  const cleaned = cleanVideoBeat(value || "");
  if (!cleaned) return [];
  const parts = cleaned
    .split(/\s*;\s*|(?<=[.!?。！？])\s+/)
    .map((part) => cleanVideoBeat(part))
    .filter(Boolean);
  return parts.length ? parts : [cleaned];
}

function isGenericRepeatedBeatFallbackText(value: string): boolean {
  const text = normalizeCompareText(value);
  if (!text || text.length < 8) return true;
  if (/^(?:use linked images|linked images|use connected references|same scene|same setting|reaction|setup)$/i.test(value.trim())) return true;
  return /(previous action|reaction angle|consequence of the previous action|without repeating|continue the exchange|clean reaction beat|natural reaction|show the listener|same scene geography|same character positions|same setting and character blocking|same established scene position|frame only visible subject|screen direction readable|foreground midground background|masterpiece best quality|3d style dark humor|3d american comic style)/.test(text);
}

function videoBeatActionRepeatKey(action: string): string {
  const cleaned = cleanVideoBeat(action || "")
    .replace(/\bShow the listener's reaction, speaker's expression, and body language as the line lands\.?/gi, "")
    .replace(/\bHold the same scene geography and shift to a natural reaction or angle change\.?/gi, "")
    .replace(/\bContinue the exchange with a clean reaction beat\.?/gi, "")
    .replace(/\breaction\/cutaway detail\b/gi, "")
    .trim();
  const firstSentence = cleaned.match(/^[\s\S]*?[.!?。！？](?=\s|$)/)?.[0] ?? cleaned;
  return normalizeCompareText(firstSentence || cleaned);
}

function attachStoryboardBeatDialogues(beats: ClipVideoStoryboardBeat[], shots: NormalizedStoryboardShot[]): ClipVideoStoryboardBeat[] {
  const speakerNames = storyboardDialogueSpeakers(shots);
  const shotDialogueTargets = storyboardShotDialogueTargets(shots, beats.length);
  return beats.map((beat, index) => {
    const panelDialogues = extractPanelDialogueLines(beat.text, speakerNames);
    const exactShotDialogues = shotDialogueTargets
      .filter((target) => target.dialogue && panelTextContainsDialogue(beat.text, target.dialogue))
      .map((target) => target.dialogue);
    const fallbackShotDialogues =
      panelDialogues.length === 0
        ? shotDialogueTargets.filter((target) => target.panelIndex === index).map((target) => target.dialogue)
        : [];
    const dialogue = uniqueStrings([...panelDialogues, ...exactShotDialogues, ...fallbackShotDialogues].map(cleanVideoDialogue).filter(Boolean)).join(" ");
    return {
      ...beat,
      dialogue: dialogue || undefined,
    };
  });
}

function storyboardDialogueSpeakers(shots: NormalizedStoryboardShot[]): string[] {
  const explicitSpeakers = shots.flatMap((shot) => extractDialogueSpeakerNames(shot.dialogue));
  return uniqueStrings([...shots.flatMap((shot) => shot.characters), ...explicitSpeakers]).slice(0, 20);
}

function extractDialogueSpeakerNames(value: string): string[] {
  return extractAllocatedDialogueSpeakerNames(value);
}

function storyboardShotDialogueTargets(shots: NormalizedStoryboardShot[], beatCount: number): Array<{ panelIndex: number; dialogue: string }> {
  if (beatCount <= 0) return [];
  return shots
    .map((shot, index) => {
      const dialogue = cleanVideoDialogue(shot.dialogue || "");
      const panelIndex = Math.min(beatCount - 1, Math.floor((index * beatCount) / Math.max(1, shots.length)));
      return { panelIndex, dialogue };
    })
    .filter((target) => target.dialogue);
}

function extractPanelDialogueLines(value: string, speakerNames: string[]): string[] {
  const speakers = speakerNames.map((name) => name.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  if (speakers.length === 0) return [];
  const speakerPattern = speakers.map(escapeRegExp).join("|");
  const pattern = new RegExp(
    String.raw`\b(${speakerPattern})\s*[:：]\s*([\s\S]*?)(?=\b(?:${speakerPattern})\s*[:：]|\b(?:Label|Panel|Shot|Camera|Action|Dialogue|Technical labels|Avoid|Negative prompt|Board style)\s*[:：]|$)`,
    "gi",
  );
  return Array.from(value.matchAll(pattern))
    .map((match) => {
      const speaker = match[1]?.trim() ?? "";
      const line = cleanExtractedPanelDialogue(match[2] ?? "");
      return speaker && line ? `${speaker}: ${line}` : "";
    })
    .filter(Boolean);
}

function cleanExtractedPanelDialogue(value: string): string {
  return value
    .replace(/\b(?:No speech bubbles|No subtitles|No watermarks|No UI|Avoid|Negative prompt)\b[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/['"“”‘’]+([.!?。！？])/g, "$1")
    .trim()
    .replace(/^['"“”‘’]+|['"“”‘’]+$/g, "");
}

function panelTextContainsDialogue(panelText: string, dialogue: string): boolean {
  const panelKey = normalizeDialogueCompareText(panelText);
  const dialogueKey = normalizeDialogueCompareText(dialogue);
  return Boolean(dialogueKey) && panelKey.includes(dialogueKey);
}

function removeVideoDialogueFragments(value: string, dialogue: string): string {
  if (!dialogue) return value;
  return dialogue
    .split(/\s+(?=(?:[A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}|[一-龥·]{1,12})\s*[:：])/)
    .reduce((text, fragment) => {
      const cleaned = cleanVideoDialogue(fragment).trim();
      if (cleaned.length < 6) return text;
      return text.replace(new RegExp(escapeRegExp(cleaned), "gi"), "");
    }, value);
}

function normalizeDialogueCompareText(value: string): string {
  return value
    .toLowerCase()
    .replace(/['"“”‘’]/g, "")
    .replace(/[\s.,!?;:，。！？；：/\\-]+/g, " ")
    .trim();
}

function buildClipVideoBeats(actions: string[], dialogue: string[]): string[] {
  const actionBeats = uniqueVideoBeats(actions)
    .map((item) => cleanVideoLine(item))
    .filter(Boolean)
    .slice(0, 4);
  const dialogueBeat = cleanVideoLine(cleanVideoDialogue(dialogue.filter(Boolean).join(" ")));
  return dialogueBeat ? [...actionBeats, `S${actionBeats.length + 1}: Dialogue: ${formatExactVideoDialogue(dialogueBeat)}; reaction beat tied to the spoken line.`] : actionBeats;
}

function uniqueVideoBeats(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const cleaned = cleanVideoBeat(value);
    const key = normalizeCompareText(cleaned);
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
  }
  return output;
}

function cleanVideoBeat(value: string): string {
  return stripDanglingVideoFragment(value
    .replace(/\b([A-Z][A-Za-z'’.-]+(?:\s+and\s+[A-Z][A-Za-z'’.-]+)?)\s+absorbs\s+the\s+spoken\s+line\s+with\s+a\s+changed\s+expression,\s+gesture,\s+or\s+posture\.?/gi, "$1 hold a specific visible reaction tied to this shot.")
    .replace(/\b([A-Z][A-Za-z'’.-]+(?:\s+and\s+[A-Z][A-Za-z'’.-]+)?)\s+absorb\s+the\s+spoken\s+line\s+with\s+a\s+changed\s+expression,\s+gesture,\s+or\s+posture\.?/gi, "$1 hold a specific visible reaction tied to this shot.")
    .replace(/\bShow the listener's reaction, speaker's expression, and body language as the line lands\.?/gi, "")
    .replace(/\bHold the same scene geography and shift to a natural reaction or angle change\.?/gi, "")
    .replace(/\bSame setting and character blocking, natural reaction or angle change\.?/gi, "")
    .replace(/\bSame setting and character blocking,?\s*natural reaction or angle change\.?/gi, "")
    .replace(/\breaction\/cutaway detail, same scene geography, same character positions\.?/gi, "")
    .replace(/\bSame dialogue turn continues over this silent reaction\/cutaway shot\.?/gi, "")
    .replace(/\bContinue the exchange with a clean reaction beat\.?/gi, "")
    .replace(/\bReaction beat\.?/gi, "")
    .replace(/\b([A-Z][A-Za-z'’.-]+(?:\s+and\s+[A-Z][A-Za-z'’.-]+)?)\s+in the same established scene position\.?/gi, "")
    .replace(/\bin the same established scene position\.?/gi, "")
    .replace(/;\s*block\s+[^;]+?\s+with clear screen direction/gi, "; frame only visible subject(s) with clear screen direction")
    .replace(/\bblock\s+[^;]+?\s+with clear screen direction;?\s*/gi, "frame only visible subject(s) with clear screen direction; ")
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*;\s*/g, "; ")
    .replace(/^;\s*|\s*;$/g, "")
    .trim());
}

function cleanVideoPlotGoal(value: string): string {
  const parts = cleanVideoBeat(value)
    .split(/\s+Then\s+/i)
    .map((item) => cleanVideoBeat(item))
    .filter(Boolean);
  const uniqueParts = uniqueVideoBeats(parts);
  return uniqueParts.length > 0 ? uniqueParts.join(" Then ") : cleanVideoBeat(value);
}

function cleanVideoDialogue(value: string): string {
  const cleaned = value
    .replace(/\s*\/\s*(?=(?:[A-Z][A-Za-z0-9_-]*|[一-龥·]{1,12})[:：])/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(?:Composition|Camera|Shot|Blocking|Block|Movement|Lens|Angle|Shot size|State|Setting|Scene|Visual|References?)\s*[:：]/i.test(cleaned)) return "";
  return cleaned;
}

function summarizeVideoContinuity(startState: string, endState: string): string {
  return [
    startState ? `start ${cleanVideoLine(cleanVideoBeat(startState))}` : "",
    endState ? `end ${cleanVideoLine(cleanVideoBeat(endState))}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function cleanVideoLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizePromptTextWithoutCompression(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function seedanceVideoDirection(level: StoryboardControlLevel): string {
  if (level === "hard") {
    return "Direction: follow the storyboard order, blocking, camera direction, and start/end states closely; add only natural motion, acting details, and slight camera movement.";
  }
  if (level === "medium") {
    return "Direction: follow the storyboard action order and spatial relationship; add natural camera movement, transitions, facial acting, and motion details.";
  }
  if (level === "soft") {
    return "Direction: use the storyboard for identity, setting, motion direction, and key result; improve the camera movement and action rhythm cinematically.";
  }
  return "Direction: freely design cinematic movement and pacing while preserving the plot goal, characters, scene, and final result.";
}

function seedanceControlInstruction(level: StoryboardControlLevel): string {
  if (level === "hard") {
    return "Control level: hard. Strictly follow storyboard blocking, action order, prop positions, scene layout, start state, and end state. Allow only natural micro-actions, acting details, and slight camera movement.";
  }
  if (level === "medium") {
    return "Control level: medium. Follow action order, character direction, and spatial relationship. You may add natural camera movement, transitions, facial acting, and motion details while preserving start and end states.";
  }
  if (level === "soft") {
    return "Control level: soft. Use references only for characters, setting, motion direction, and key result. Do not mechanically copy storyboard frames; design stronger camera movement, action rhythm, and cinematic transitions.";
  }
  return "Control level: none. Freely design cinematic movement, atmosphere, and pacing from the text while preserving the plot goal, characters, and end state.";
}

function normalizeControlLevel(value: string): StoryboardControlLevel {
  if (value === "hard" || value === "medium" || value === "soft" || value === "none") return value;
  return "medium";
}

function normalizeStoryboardType(value: string): StoryboardType {
  if (value === "multi_panel" || value === "start_end_keyframes" || value === "mood_reference" || value === "none") return value;
  return "multi_panel";
}

function normalizeDialogueDensity(value: unknown, wordsPerSecond: number): ClipDialogueDensity {
  if (value === "low" || value === "medium" || value === "high") return value;
  if (wordsPerSecond >= 2.4) return "high";
  if (wordsPerSecond >= 1) return "medium";
  return "low";
}

function normalizeClipNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number * 10) / 10));
}

function clampClipTarget(estimatedDuration: number): number {
  return Math.max(MIN_CLIP_TARGET_SECONDS, Math.min(MAX_CLIP_TARGET_SECONDS, Math.round(estimatedDuration || TARGET_CLIP_DURATION_SECONDS)));
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) return uniqueStrings(value.map((item) => String(item).trim()).filter(Boolean));
  if (typeof value === "string") {
    return uniqueStrings(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }
  return [];
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function mostCommonString(values: string[]): string {
  const counts = new Map<string, { value: string; count: number }>();
  for (const value of values) {
    const key = normalizeCompareText(value);
    const current = counts.get(key);
    counts.set(key, { value, count: (current?.count ?? 0) + 1 });
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count)[0]?.value ?? "";
}

function normalizeCompareText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizedWorkflowAssetAliases(value: unknown): string[] {
  if (typeof value === "string") return uniqueStrings([value].map((item) => normalizeCompareText(item))).filter(Boolean);
  if (!isRecord(value)) return [];
  return uniqueStrings(workflowAssetAliasValues(value).map((item) => normalizeCompareText(item))).filter(Boolean);
}

function workflowAssetAliasValues(value: Record<string, unknown>): string[] {
  return uniqueStrings([
    stringFrom(value.name, ""),
    stringFrom(value.title, ""),
    ...arrayFrom(value.aliases).map((item) => stringFrom(item, "")),
    stringFrom(value.canonicalName, ""),
  ]).filter(Boolean);
}

function propCanonicalSignature(value: string): string {
  const text = normalizeCompareText(value).replace(/[-_]+/g, " ");
  if (!text) return "";
  const hasPanWord = /\b(pan|skillet)\b/.test(text);
  const isIronPan = hasPanWord && (
    /\bcast\s+iron\b/.test(text) ||
    /\biron\s+(?:frying\s+)?pan\b/.test(text) ||
    /\biron\s+skillet\b/.test(text) ||
    /^skillet$/.test(text)
  );
  if (isIronPan) return "prop:iron-pan";
  return "";
}

function workflowAssetNameKeys(kind: WorkflowAssetKind, value: unknown): string[] {
  const aliases = normalizedWorkflowAssetAliases(value);
  const keys = [...aliases];
  if (kind === "props") {
    for (const alias of aliases) {
      const signature = propCanonicalSignature(alias);
      if (signature) keys.push(signature);
    }
  }
  return uniqueStrings(keys).filter(Boolean);
}

function workflowAssetNamesMatch(kind: WorkflowAssetKind, left: unknown, right: unknown): boolean {
  const leftKeys = workflowAssetNameKeys(kind, left);
  const rightKeys = new Set(workflowAssetNameKeys(kind, right));
  return leftKeys.some((key) => rightKeys.has(key));
}

function workflowAssetItemMatchesName(item: Record<string, unknown>, kind: WorkflowAssetKind, name: string): boolean {
  return workflowAssetNamesMatch(kind, item, name);
}

function workflowAssetHasReusableImageRecord(item: Record<string, unknown>): boolean {
  return Boolean(
    stringFrom(item.referenceImageUrl, "") ||
      stringFrom(item.generatedImageUrl, "") ||
      stringFrom(item.referenceImageAssetId, "") ||
      stringFrom(item.generatedImageAssetId, ""),
  );
}

function copyReusableAssetImageFields(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const next = { ...target };
  for (const key of REUSABLE_ASSET_IMAGE_KEYS) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") next[key] = source[key];
  }
  return next;
}

function mergeAssetTextField(existing: unknown, incoming: unknown, maxLength = 320): string {
  const current = stringFrom(existing, "");
  const next = stringFrom(incoming, "");
  if (!current) return next.slice(0, maxLength);
  if (!next || normalizeCompareText(current).includes(normalizeCompareText(next))) return current.slice(0, maxLength);
  if (normalizeCompareText(next).includes(normalizeCompareText(current))) return next.slice(0, maxLength);
  return `${current}; ${next}`.slice(0, maxLength);
}

function mergeWorkflowAssetRecords(
  kind: WorkflowAssetKind,
  canonical: Record<string, unknown>,
  incoming: Record<string, unknown>,
  index = 0,
): Record<string, unknown> {
  const canonicalName = workflowAssetNameFromRecord(canonical);
  const incomingName = workflowAssetNameFromRecord(incoming);
  const name = canonicalName || incomingName;
  const preferredImageSource = workflowAssetHasReusableImageRecord(canonical) ? canonical : incoming;
  const merged: Record<string, unknown> = {
    ...incoming,
    ...canonical,
    id: stringFrom(canonical.id, stringFrom(incoming.id, slugId(kind === "props" ? "prop" : kind === "scenes" ? "loc" : "char", name, index))),
    name,
    title: stringFrom(canonical.title, stringFrom(incoming.title, name)),
    description: mergeAssetTextField(canonical.description, incoming.description),
    aliases: uniqueStrings([
      ...workflowAssetAliasValues(canonical),
      ...workflowAssetAliasValues(incoming),
      incomingName,
    ].filter((alias) => alias && normalizeCompareText(alias) !== normalizeCompareText(name))),
  };
  if (kind === "props") {
    merged.function = mergeAssetTextField(canonical.function, incoming.function, 240);
    merged.visualPrompt = stringFrom(canonical.visualPrompt, stringFrom(incoming.visualPrompt, ""));
  }
  return copyReusableAssetImageFields(merged, preferredImageSource);
}

function mergeWorkflowAssetListWithMemory(
  kind: WorkflowAssetKind,
  extractedItems: Record<string, unknown>[],
  memoryItems: Record<string, unknown>[],
): Record<string, unknown>[] {
  const output: Record<string, unknown>[] = [];
  const findMatch = (items: Record<string, unknown>[], target: Record<string, unknown>) =>
    items.find((item) => workflowAssetNamesMatch(kind, item, target));

  extractedItems.forEach((item, index) => {
    const memoryMatch = findMatch(memoryItems, item);
    const mergedWithMemory = memoryMatch ? mergeWorkflowAssetRecords(kind, memoryMatch, item, index) : item;
    const existingIndex = output.findIndex((existing) => workflowAssetNamesMatch(kind, existing, mergedWithMemory));
    if (existingIndex >= 0) {
      output[existingIndex] = mergeWorkflowAssetRecords(kind, output[existingIndex], mergedWithMemory, existingIndex);
    } else {
      output.push(mergedWithMemory);
    }
  });

  return output.map(stripWorkflowMemoryFields);
}

function stripWorkflowMemoryFields(item: Record<string, unknown>): Record<string, unknown> {
  const {
    workflowMemoryEpisodeId: _workflowMemoryEpisodeId,
    workflowMemoryEpisodeTitle: _workflowMemoryEpisodeTitle,
    workflowMemoryIsCurrentEpisode: _workflowMemoryIsCurrentEpisode,
    ...rest
  } = item;
  return rest;
}

function mergeExtractedAssetsWithProjectMemory(
  metadata: unknown,
  episodeId: string | undefined,
  assets: WorkflowAssetsRecord,
): WorkflowAssetsRecord {
  const memory = collectProjectAssetMemory(metadata, episodeId);
  return {
    characters: mergeWorkflowAssetListWithMemory("characters", assets.characters, memory.characters),
    locations: mergeWorkflowAssetListWithMemory("scenes", assets.locations, memory.locations),
    props: mergeWorkflowAssetListWithMemory("props", assets.props, memory.props),
  };
}

function collectProjectAssetMemory(metadata: unknown, currentEpisodeId?: string): WorkflowAssetsRecord {
  const memory: WorkflowAssetsRecord = { characters: [], locations: [], props: [] };
  const episodes = Object.entries(getWorkflowEpisodes(metadata))
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }));
  const appendAssets = (workflow: ReturnType<typeof normalizeWorkflowStateRecord>, episodeId: string, title: string) => {
    const assets: Record<string, unknown> = isRecord(workflow.assets) ? workflow.assets : defaultAssets();
    const push = (kind: WorkflowAssetKind, target: Record<string, unknown>[], value: unknown, index: number) => {
      if (!isRecord(value)) return;
      const name = workflowAssetNameFromRecord(value);
      if (!name) return;
      const item = {
        ...value,
        workflowMemoryEpisodeId: episodeId,
        workflowMemoryEpisodeTitle: title,
        workflowMemoryIsCurrentEpisode: Boolean(currentEpisodeId && episodeId === currentEpisodeId),
      };
      const existingIndex = target.findIndex((existing) => workflowAssetNamesMatch(kind, existing, item));
      if (existingIndex >= 0) {
        target[existingIndex] = mergeWorkflowAssetRecords(kind, target[existingIndex], item, existingIndex);
      } else {
        target.push(item);
      }
      void index;
    };
    arrayFrom(assets.characters).forEach((item, index) => push("characters", memory.characters, item, index));
    arrayFrom(assets.locations ?? assets.scenes).forEach((item, index) => push("scenes", memory.locations, item, index));
    arrayFrom(assets.props).forEach((item, index) => push("props", memory.props, item, index));
  };

  for (const [episodeId, episode] of episodes) {
    if (!isRecord(episode.workflowCenter)) continue;
    appendAssets(normalizeWorkflowStateRecord(episode.workflowCenter, stringFrom(episode.title, "第 1 集")), episodeId, stringFrom(episode.title, episodeId));
  }

  if (episodes.length === 0 && isRecord(metadata) && isRecord(metadata.workflowCenter)) {
    const workflow = normalizeWorkflowStateRecord(metadata.workflowCenter);
    appendAssets(workflow, currentEpisodeId || workflowEpisodeIdForTitle(workflow.selectedEpisode, "episode-001"), workflow.selectedEpisode);
  }

  return memory;
}

function summarizeProjectAssetMemoryForPrompt(memory: WorkflowAssetsRecord): string {
  const summarize = (items: Record<string, unknown>[], limit: number) => items
    .slice(0, limit)
    .map((item) => ({
      name: workflowAssetNameFromRecord(item),
      aliases: workflowAssetAliasValues(item)
        .filter((alias) => normalizeCompareText(alias) !== normalizeCompareText(workflowAssetNameFromRecord(item)))
        .slice(0, 8),
      description: stringFrom(item.description, ""),
      hasReferenceImage: workflowAssetHasReusableImageRecord(item),
      episode: stringFrom(item.workflowMemoryEpisodeTitle, ""),
    }));
  const compact = {
    characters: summarize(memory.characters, 30),
    locations: summarize(memory.locations, 30),
    props: summarize(memory.props, 60),
  };
  const hasAny = compact.characters.length > 0 || compact.locations.length > 0 || compact.props.length > 0;
  return hasAny ? JSON.stringify(compact).slice(0, 9000) : "";
}

function stringifyWorkflowText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function inferProfessionalShotFields(
  shot: {
    title: string;
    description: string;
    action: string;
    dialogue: string;
    durationSeconds: number;
    characters: string[];
    setting: string;
    references: string;
    visualPrompt: string;
  },
  index: number,
) {
  const text = `${shot.title} ${shot.description} ${shot.action}`.toLowerCase();
  const isClose = /(close|face|eyes|reaction|whisper|smirk|stare|特写|表情)/.test(text);
  const isWide = /(enter|open|lab|room|space|crowd|screen|world|establish|全景|空间|进入)/.test(text);
  const isAction = /(run|attack|fire|shoot|dodge|explode|slam|grab|fight|chase|冲|打|射|爆|躲)/.test(text);
  const shotSize = isClose ? "close-up" : isWide ? "wide" : "medium";
  const cameraAngle = isAction && index % 3 === 1 ? "low angle" : index % 4 === 2 ? "over-shoulder" : "eye-level";
  const cameraMove = isAction ? "handheld tracking" : isWide ? "slow push-in" : "static hold";
  const lens = shotSize === "wide" ? "24mm" : shotSize === "close-up" ? "85mm" : "50mm";
  const aperture = shotSize === "wide" ? "f/4" : "f/2.8";
  const shutter = "1/48";
  const iso = /night|dark|地下|黑|暗/.test(text) ? "ISO 1000" : "ISO 800";
  const composition = [
    shot.setting ? `Set in ${shot.setting}` : "Use the current scene layout",
    "frame only the visible subject(s) for this shot; keep screen direction readable",
    "separate foreground, midground, and background for continuity",
  ].join("; ");
  const sound = shot.dialogue ? "preserve dialogue clarity with light room tone" : "use scene-appropriate sound effects and room tone";
  const music = isAction ? "fast dark-comedy tension beat" : "subtle dark-comedy underscoring";
  const directorBoardPrompt = [
    "Create a vertical 9-panel director storyboard for this shot.",
    `Shot title: ${shot.title}`,
    `Setting: ${shot.setting || "current scene"}`,
    `Characters: ${shot.characters.join(", ") || "characters from this shot"}`,
    `Action: ${shot.action || shot.description}`,
    shot.dialogue ? `Dialogue to preserve exactly: ${shot.dialogue}` : "Dialogue: none.",
    `Camera: ${shotSize}, ${cameraAngle}, ${cameraMove}, ${lens}, ${aperture}, ${shutter}, ${iso}.`,
    `Composition: ${composition}`,
    `Visual prompt: ${shot.visualPrompt || shot.description}`,
    `References: ${shot.references || "use current project assets and continuity"}`,
    "Requirements: no explanatory paragraphs, clear action continuity, consistent character positions, readable blocking, professional previsualization storyboard, keep dialogue language unchanged.",
  ].join("\n");
  return {
    shotSize,
    cameraAngle,
    cameraMove,
    composition,
    lens,
    aperture,
    shutter,
    iso,
    sound,
    music,
    directorBoardPrompt,
  };
}

async function persistWorkflowAssetsProgress(
  project: any,
  input: z.infer<typeof runWorkflowSchema>,
  assetsJson: unknown,
  authority?: WorkflowAuthorityContext,
) {
  const metadata = isRecord(project.metadata) ? project.metadata : {};
  const currentWorkflow = getWorkflowState(metadata, input.episodeId);
  const normalizedAssets = isWorkflowAssetsRecord(assetsJson)
    ? assetsJson
    : canonicalizeWorkflowAssetsWithAuthority(normalizeWorkflowAssets(assetsJson), authority);
  const assets = mergeExtractedAssetsWithProjectMemory(metadata, input.episodeId, normalizedAssets);
  const workflowCenter = {
    ...currentWorkflow,
    sourceText: input.sourceText,
    sourceName: input.sourceName ?? currentWorkflow.sourceName,
    selectedEpisode: input.selectedEpisode,
    activeStage: "storyboard",
    assets: {
      characters: assets.characters,
      scenes: assets.locations,
      props: assets.props,
    },
    stageStatuses: {
      ...currentWorkflow.stageStatuses,
      source: "done",
      assets: "done",
      storyboard: "running",
    },
    lastRun: {
      status: "assets-succeeded",
      stage: input.stage,
      sourceLength: input.sourceText.length,
      assetsCompletedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };

  const episodeId = input.episodeId || workflowEpisodeIdForWorkflow(metadata, workflowCenter);
  const nextMetadata = writeWorkflowEpisode(metadata, episodeId, workflowCenter, true);
  await prisma.project.update({
    where: { id: project.id },
    data: { metadata: nextMetadata },
  });

  project.metadata = nextMetadata;
}

async function persistWorkflowRunStarted(project: any, input: z.infer<typeof runWorkflowSchema>, episodeId?: string) {
  const metadata = isRecord(project.metadata) ? project.metadata : {};
  const currentWorkflow = getWorkflowState(metadata, episodeId || input.episodeId);
  const now = new Date().toISOString();
  const selectedModel = await selectedWorkflowModelSummary(input.aiModelId);
  const workflowCenter = {
    ...currentWorkflow,
    sourceText: input.sourceText,
    sourceName: input.sourceName ?? currentWorkflow.sourceName,
    selectedEpisode: input.selectedEpisode,
    activeStage: input.stage === "assets" ? "assets" : "storyboard",
    ...(input.stage === "assets"
      ? {
          breakdownScenes: [],
          clips: [],
          sceneVisualBibles: [],
        }
      : {}),
    stageStatuses: {
      ...currentWorkflow.stageStatuses,
      source: "done",
      assets: input.stage === "storyboard" ? currentWorkflow.stageStatuses.assets ?? "idle" : "running",
      storyboard: input.stage === "assets" ? "idle" : "running",
      video: input.stage === "assets" ? "idle" : currentWorkflow.stageStatuses.video ?? "idle",
    },
    lastRun: {
      status: "running",
      stage: input.stage,
      model: selectedModel,
      sourceLength: input.sourceText.length,
      startedAt: now,
    },
    updatedAt: now,
  };

  const targetEpisodeId = episodeId || input.episodeId || workflowEpisodeIdForWorkflow(metadata, workflowCenter);
  const nextMetadata = writeWorkflowEpisode(metadata, targetEpisodeId, workflowCenter, true);
  await prisma.project.update({
    where: { id: project.id },
    data: { metadata: nextMetadata },
  });

  project.metadata = nextMetadata;
}

async function persistWorkflowRunProgress(
  project: any,
  input: z.infer<typeof runWorkflowSchema>,
  progress: {
    phase: string;
    message: string;
    currentPart?: number;
    totalParts?: number;
    generatedShots?: number;
  },
) {
  const metadata = isRecord(project.metadata) ? project.metadata : {};
  const currentWorkflow = getWorkflowState(metadata, input.episodeId);
  const now = new Date().toISOString();
  const workflowCenter = {
    ...currentWorkflow,
    stageStatuses: {
      ...currentWorkflow.stageStatuses,
      source: "done",
      assets: input.stage === "storyboard" ? currentWorkflow.stageStatuses.assets ?? "idle" : currentWorkflow.stageStatuses.assets ?? "running",
      storyboard: input.stage === "assets" ? currentWorkflow.stageStatuses.storyboard ?? "idle" : "running",
    },
    lastRun: {
      ...(isRecord(currentWorkflow.lastRun) ? currentWorkflow.lastRun : {}),
      status: "running",
      stage: input.stage,
      sourceLength: input.sourceText.length,
      progress: {
        ...progress,
        updatedAt: now,
      },
    },
    updatedAt: now,
  };

  const targetEpisodeId = input.episodeId || workflowEpisodeIdForWorkflow(metadata, workflowCenter);
  const nextMetadata = writeWorkflowEpisode(metadata, targetEpisodeId, workflowCenter, true);
  await prisma.project.update({
    where: { id: project.id },
    data: { metadata: nextMetadata },
  });

  project.metadata = nextMetadata;
}

async function persistWorkflowRunFailed(project: any, input: z.infer<typeof runWorkflowSchema>, error: unknown, episodeId?: string) {
  const metadata = isRecord(project.metadata) ? project.metadata : {};
  const currentWorkflow = getWorkflowState(metadata, episodeId || input.episodeId);
  const now = new Date().toISOString();
  const message = error instanceof Error ? error.message : "AI 智能拆解失败";
  const selectedModel = await selectedWorkflowModelSummary(input.aiModelId);
  const workflowCenter = {
    ...currentWorkflow,
    sourceText: input.sourceText,
    sourceName: input.sourceName ?? currentWorkflow.sourceName,
    selectedEpisode: input.selectedEpisode,
    activeStage: input.stage === "assets" ? "assets" : "storyboard",
    stageStatuses: {
      ...currentWorkflow.stageStatuses,
      source: "done",
      assets:
        input.stage === "storyboard"
          ? currentWorkflow.stageStatuses.assets ?? "idle"
          : currentWorkflow.stageStatuses.assets === "done"
            ? "done"
            : "failed",
      storyboard: input.stage === "assets" ? currentWorkflow.stageStatuses.storyboard ?? "idle" : "failed",
    },
    lastRun: {
      status: "failed",
      stage: input.stage,
      model: selectedModel,
      sourceLength: input.sourceText.length,
      error: message,
      failedAt: now,
    },
    updatedAt: now,
  };

  const targetEpisodeId = episodeId || input.episodeId || workflowEpisodeIdForWorkflow(metadata, workflowCenter);
  const nextMetadata = writeWorkflowEpisode(metadata, targetEpisodeId, workflowCenter, true);
  await prisma.project.update({
    where: { id: project.id },
    data: { metadata: nextMetadata },
  });

  project.metadata = nextMetadata;
}

function normalizeWorkflowAssets(value: unknown): WorkflowAssetsRecord {
  const record = isRecord(value) ? value : {};
  const characters = arrayFrom(record.characters).slice(0, 80).map((item, index) => {
    const character = isRecord(item) ? item : {};
    const name = stringFrom(character.name, `角色 ${index + 1}`).slice(0, 120);
    const fruitIdentity = stringFrom(character.fruitIdentity, "");
    const lockedVisualIdentity = stringFrom(character.lockedVisualIdentity, fruitIdentity ? `${name}, ${fruitIdentity}` : "");
    return {
      id: slugId("char", name, index),
      name,
      aliases: arrayFrom(character.aliases).map((alias) => stringFrom(alias, "")).filter(Boolean).slice(0, 12),
      role: normalizeRole(stringFrom(character.role, "SUPPORTING")),
      description: stringFrom(character.description, ""),
      visualPrompt: stringFrom(character.visualPrompt, stringFrom(character.prompt, "")),
      fruitIdentity,
      personality: stringFrom(character.personality, ""),
      height: stringFrom(character.height, ""),
      primaryLook: stringFrom(character.primaryLook, ""),
      expressionNotes: stringFrom(character.expressionNotes, ""),
      habitualActions: stringFrom(character.habitualActions, ""),
      variantNotes: stringFrom(character.variantNotes, ""),
      signatureProps: stringFrom(character.signatureProps, ""),
      boundPropNames: boundPropNamesFromRecord(character),
      colorPalette: stringFrom(character.colorPalette, ""),
      lockedVisualIdentity,
      referencePolicy: stringFrom(
        character.referencePolicy,
        lockedVisualIdentity
          ? `Use only ${name} + ${lockedVisualIdentity} for visual continuity; do not add unconfirmed appearance details.`
          : "",
      ),
    };
  });

	  const locations = arrayFrom(record.locations ?? record.scenes).slice(0, 80).map((item, index) => {
	    const location = isRecord(item) ? item : {};
	    const name = stringFrom(location.name ?? location.title, `场景 ${index + 1}`);
	    return {
	      id: slugId("loc", name, index),
	      name,
	      title: stringFrom(location.title, name),
	      description: stringFrom(location.description, ""),
	      timeOfDay: stringFrom(location.timeOfDay, ""),
	      aliases: arrayFrom(location.aliases).map((alias) => stringFrom(alias, "")).filter(Boolean).slice(0, 12),
	      visualPrompt: stringFrom(location.visualPrompt ?? location.prompt, ""),
	      canonicalSceneId: stringFrom(location.canonicalSceneId, ""),
	      sceneVisualLock: stringFrom(location.sceneVisualLock, ""),
	      sceneZone: stringFrom(location.sceneZone, ""),
	      sceneAnchors: arrayFrom(location.sceneAnchors).map((anchor) => stringFrom(anchor, "")).filter(Boolean).slice(0, 12),
	      referenceImageUrl: stringFrom(location.referenceImageUrl, ""),
	      referenceImageAssetId: stringFrom(location.referenceImageAssetId, ""),
	      generatedImageUrl: stringFrom(location.generatedImageUrl, ""),
	      generatedImageAssetId: stringFrom(location.generatedImageAssetId, ""),
	    };
	  });

	  const props = arrayFrom(record.props).slice(0, 120).map((item, index) => {
	    const prop = isRecord(item) ? item : {};
	    const name = stringFrom(prop.name ?? prop.title, `道具 ${index + 1}`);
	    return {
	      id: slugId("prop", name, index),
	      name,
	      title: stringFrom(prop.title, name),
	      description: stringFrom(prop.description, ""),
	      aliases: arrayFrom(prop.aliases).map((alias) => stringFrom(alias, "")).filter(Boolean).slice(0, 20),
	      function: stringFrom(prop.function, ""),
	      visualPrompt: stringFrom(prop.visualPrompt ?? prop.prompt, ""),
	      lockedVisualIdentity: stringFrom(prop.lockedVisualIdentity, ""),
	      referencePolicy: stringFrom(prop.referencePolicy, ""),
	      referenceImageUrl: stringFrom(prop.referenceImageUrl, ""),
	      referenceImageAssetId: stringFrom(prop.referenceImageAssetId, ""),
	      generatedImageUrl: stringFrom(prop.generatedImageUrl, ""),
	      generatedImageAssetId: stringFrom(prop.generatedImageAssetId, ""),
	      generatedImagePrompt: stringFrom(prop.generatedImagePrompt, ""),
	      generatedImageRevisedPrompt: stringFrom(prop.generatedImageRevisedPrompt, ""),
	      generatedImageAt: stringFrom(prop.generatedImageAt, ""),
	      generationId: stringFrom(prop.generationId, ""),
	      imageGenerationModel: isRecord(prop.imageGenerationModel) ? prop.imageGenerationModel : stringFrom(prop.imageGenerationModel, ""),
	      visualAuthority: stringFrom(prop.visualAuthority, ""),
	      referenceAnalysisStatus: stringFrom(prop.referenceAnalysisStatus, ""),
	    };
	  });

  return { characters, locations, props };
}

function buildLockedVisualIdentity(
  name: string,
  record: Record<string, unknown>,
  existing: WorkflowAuthorityCharacter | undefined,
  fruitRequired: boolean,
): string {
  const fruitIdentity = stringFrom(existing?.traits.fruitIdentity, stringFrom(record.fruitIdentity, ""));
  const explicit = stringFrom(existing?.traits.lockedVisualIdentity, stringFrom(record.lockedVisualIdentity, ""));
  if (explicit) return cleanWorkflowPublicText(explicit);
  const visual = stringFrom(record.visualPrompt, stringFrom(record.prompt, stringFrom(existing?.prompt, "")));
  const parts = [name, fruitIdentity, visual].filter(Boolean);
  if (parts.length > 1) return cleanWorkflowPublicText(parts.join(", ")).slice(0, 260);
  return fruitRequired ? `${name}, concrete fruit identity required` : "";
}

function workflowCharacterTraits(existingTraits: unknown, character: any, episode: string): Record<string, unknown> {
  const traits = compactCharacterTraits(existingTraits);
  return {
    ...traits,
    workflowSource: "script-import",
    episode,
    ...(character.fruitIdentity ? { fruitIdentity: character.fruitIdentity } : {}),
    ...(character.personality ? { personality: character.personality } : {}),
    ...(character.height ? { height: character.height } : {}),
    ...(character.primaryLook ? { primaryLook: character.primaryLook } : {}),
    ...(character.expressionNotes ? { expressionNotes: character.expressionNotes } : {}),
    ...(character.habitualActions ? { habitualActions: character.habitualActions } : {}),
    ...(character.variantNotes ? { variantNotes: character.variantNotes } : {}),
    ...(character.signatureProps ? { signatureProps: character.signatureProps } : {}),
    ...(character.colorPalette ? { colorPalette: character.colorPalette } : {}),
    ...(character.lockedVisualIdentity ? { lockedVisualIdentity: character.lockedVisualIdentity } : {}),
    ...(character.referencePolicy ? { referencePolicy: character.referencePolicy } : {}),
  };
}

function compactCharacterTraits(value: unknown): Record<string, unknown> {
  const traits = isRecord(value) ? value : {};
  return {
    ...compactExtraTraits(traits),
    ...(compactPromptText(stringFrom(traits.visualAuthority, "")) ? { visualAuthority: compactPromptText(stringFrom(traits.visualAuthority, "")) } : {}),
    ...(compactPromptText(stringFrom(traits.referenceImageAssetId, "")) ? { referenceImageAssetId: compactPromptText(stringFrom(traits.referenceImageAssetId, "")) } : {}),
    ...(compactUrlForStorage(stringFrom(traits.referenceImageUrl, "")) ? { referenceImageUrl: compactUrlForStorage(stringFrom(traits.referenceImageUrl, "")) } : {}),
    ...(compactPromptText(stringFrom(traits.referenceImageUploadedAt, "")) ? { referenceImageUploadedAt: compactPromptText(stringFrom(traits.referenceImageUploadedAt, "")) } : {}),
    ...(compactPromptText(stringFrom(traits.generatedImageAssetId, "")) ? { generatedImageAssetId: compactPromptText(stringFrom(traits.generatedImageAssetId, "")) } : {}),
    ...(compactUrlForStorage(stringFrom(traits.generatedImageUrl, "")) ? { generatedImageUrl: compactUrlForStorage(stringFrom(traits.generatedImageUrl, "")) } : {}),
    ...(compactPromptText(stringFrom(traits.workflowSource, "")) ? { workflowSource: compactPromptText(stringFrom(traits.workflowSource, "")) } : {}),
    ...(compactPromptText(stringFrom(traits.episode, "")) ? { episode: compactPromptText(stringFrom(traits.episode, "")) } : {}),
    ...(compactPromptText(stringFrom(traits.fruitIdentity, "")) ? { fruitIdentity: compactPromptText(stringFrom(traits.fruitIdentity, "")) } : {}),
    ...(compactPromptText(stringFrom(traits.personality, "")) ? { personality: compactPromptText(stringFrom(traits.personality, "")) } : {}),
    ...(compactPromptText(stringFrom(traits.height, "")) ? { height: compactPromptText(stringFrom(traits.height, "")) } : {}),
    ...(compactPromptText(stringFrom(traits.primaryLook, "")) ? { primaryLook: compactPromptText(stringFrom(traits.primaryLook, "")) } : {}),
    ...(compactPromptText(stringFrom(traits.expressionNotes, "")) ? { expressionNotes: compactPromptText(stringFrom(traits.expressionNotes, "")) } : {}),
    ...(compactPromptText(stringFrom(traits.habitualActions, "")) ? { habitualActions: compactPromptText(stringFrom(traits.habitualActions, "")) } : {}),
    ...(compactPromptText(stringFrom(traits.variantNotes, "")) ? { variantNotes: compactPromptText(stringFrom(traits.variantNotes, "")) } : {}),
    ...(compactPromptText(stringFrom(traits.signatureProps, "")) ? { signatureProps: compactPromptText(stringFrom(traits.signatureProps, "")) } : {}),
    ...(compactPromptText(stringFrom(traits.colorPalette, "")) ? { colorPalette: compactPromptText(stringFrom(traits.colorPalette, "")) } : {}),
    ...(compactPromptText(stringFrom(traits.lockedVisualIdentity, "")) ? { lockedVisualIdentity: compactPromptText(stringFrom(traits.lockedVisualIdentity, "")) } : {}),
    ...(compactPromptText(stringFrom(traits.referencePolicy, "")) ? { referencePolicy: compactPromptText(stringFrom(traits.referencePolicy, "")) } : {}),
    ...(compactImageAnalysis(traits.imageAnalysis) ? { imageAnalysis: compactImageAnalysis(traits.imageAnalysis) } : {}),
    ...(compactPromptText(stringFrom(traits.imageAnalysisError, "")) ? { imageAnalysisError: compactPromptText(stringFrom(traits.imageAnalysisError, "")) } : {}),
  };
}

function compactExtraTraits(traits: Record<string, unknown>): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(traits)) {
    if (COMPACT_CHARACTER_TRAIT_KEYS.has(key)) continue;
    if (typeof value === "string") {
      const text = compactPromptText(value);
      if (text) extras[key] = text;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      extras[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      const items = value
        .filter((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
        .map((item) => (typeof item === "string" ? compactPromptText(item) : item))
        .filter((item) => typeof item !== "string" || item.length > 0)
        .slice(0, 20);
      if (items.length) extras[key] = items;
    }
  }
  return extras;
}

function compactImageAnalysis(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const facts = arrayFrom(value.facts).map(String).map(compactPromptText).filter(Boolean).slice(0, 12);
  const analysis = {
    ...(compactPromptText(stringFrom(value.description, "")) ? { description: compactPromptText(stringFrom(value.description, "")) } : {}),
    ...(compactPromptText(stringFrom(value.visualPrompt, "")) ? { visualPrompt: compactPromptText(stringFrom(value.visualPrompt, "")) } : {}),
    ...(compactPromptText(stringFrom(value.fruitIdentity, "")) ? { fruitIdentity: compactPromptText(stringFrom(value.fruitIdentity, "")) } : {}),
    ...(compactPromptText(stringFrom(value.lockedVisualIdentity, "")) ? { lockedVisualIdentity: compactPromptText(stringFrom(value.lockedVisualIdentity, "")) } : {}),
    ...(compactPromptText(stringFrom(value.referencePolicy, "")) ? { referencePolicy: compactPromptText(stringFrom(value.referencePolicy, "")) } : {}),
    ...(facts.length ? { facts } : {}),
  };
  return Object.keys(analysis).length ? analysis : undefined;
}

function compactUrlForStorage(value: string): string {
  if (!value) return "";
  if (/^data:/i.test(value)) return "";
  return value.slice(0, 12000);
}

function compactPromptText(value: string): string {
  return value
    .replace(/^data:[^,\s]+,[A-Za-z0-9+/=_-]+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, WORKFLOW_PROMPT_FIELD_MAX_CHARS);
}

function cleanWorkflowPublicText(value: string): string {
  return value
    .replace(/\b([A-Z][A-Za-z'’.-]+(?:\s+and\s+[A-Z][A-Za-z'’.-]+)?)\s+absorbs\s+the\s+spoken\s+line\s+with\s+a\s+changed\s+expression,\s+gesture,\s+or\s+posture\.?/gi, "$1 hold a specific visible reaction tied to this shot.")
    .replace(/\b([A-Z][A-Za-z'’.-]+(?:\s+and\s+[A-Z][A-Za-z'’.-]+)?)\s+absorb\s+the\s+spoken\s+line\s+with\s+a\s+changed\s+expression,\s+gesture,\s+or\s+posture\.?/gi, "$1 hold a specific visible reaction tied to this shot.")
    .replace(/\bFast reaction\/cutaway continuation\.?\s*/gi, "")
    .replace(/\bDialogue beat\s+\d+\s*\/\s*\d+\s*;?\s*/gi, "")
    .replace(/\bContinue the exchange as a separate fast-paced reaction beat\.?\s*/gi, "Continue the exchange with a clean reaction beat. ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanWorkflowPromptText(value: string): string {
  return value
    .replace(/\b([A-Z][A-Za-z'’.-]+(?:\s+and\s+[A-Z][A-Za-z'’.-]+)?)\s+absorbs\s+the\s+spoken\s+line\s+with\s+a\s+changed\s+expression,\s+gesture,\s+or\s+posture\.?/gi, "$1 hold a specific visible reaction tied to this shot.")
    .replace(/\b([A-Z][A-Za-z'’.-]+(?:\s+and\s+[A-Z][A-Za-z'’.-]+)?)\s+absorb\s+the\s+spoken\s+line\s+with\s+a\s+changed\s+expression,\s+gesture,\s+or\s+posture\.?/gi, "$1 hold a specific visible reaction tied to this shot.")
    .replace(/\bFast reaction\/cutaway continuation\.?\s*/gi, "")
    .replace(/\bDialogue beat\s+\d+\s*\/\s*\d+\s*;?\s*/gi, "")
    .replace(/\bContinue the exchange as a separate fast-paced reaction beat\.?\s*/gi, "Continue the exchange with a clean reaction beat. ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanTranslatedPrompt(value: string): string {
  const text = String(value || "")
    .trim()
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = tryParseModelJson(text);
  if (parsed.ok && isRecord(parsed.value)) {
    return stringFrom(parsed.value.translatedPrompt ?? parsed.value.translation ?? parsed.value.prompt, "").trim();
  }
  return text;
}

function cleanOptimizedPrompt(value: string): string {
  const text = String(value || "")
    .trim()
    .replace(/^```(?:json|text|markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = tryParseModelJson(text);
  if (parsed.ok && isRecord(parsed.value)) {
    return stringFrom(
      parsed.value.optimizedPrompt
        ?? parsed.value.optimized_prompt
        ?? parsed.value.prompt
        ?? parsed.value.result
        ?? parsed.value.content,
      "",
    ).trim();
  }
  return text;
}

function cleanPlainModelAnswer(value: string): string {
  const text = String(value || "")
    .trim()
    .replace(/^```(?:json|text|markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = tryParseModelJson(text);
  if (parsed.ok && isRecord(parsed.value)) {
    return stringFrom(parsed.value.answer ?? parsed.value.result ?? parsed.value.response ?? parsed.value.content, "").trim();
  }
  return text;
}

function isTranslationPlaceholder(value: string): boolean {
  return /^(translated prompt only|translation|translatedPrompt|译文|翻译结果)$/i.test(value.trim());
}

function isPromptOptimizationPlaceholder(value: string): boolean {
  return /^(optimized prompt only|optimized prompt|optimization|optimizedPrompt|优化后提示词|提示词优化结果)$/i.test(value.trim());
}

function isPromptOptimizationModelRefusal(value: string): boolean {
  return /(?:ai safety check violation detected|safety check violation|policy violation|content policy|cannot comply|can't comply|unable to comply|i'?m sorry|我无法|不能协助|安全检查|安全策略|违反政策)/i.test(value.trim());
}

function missingPreservedDialogueFragments(source: string, optimized: string): string[] {
  const fragments = extractPreservedDialogueFragments(source);
  if (fragments.length === 0) return [];
  const optimizedText = normalizeOptimizationDialogueCompareText(optimized);
  return fragments.filter((fragment) => !optimizedText.includes(normalizeOptimizationDialogueCompareText(fragment)));
}

function extractPreservedDialogueFragments(value: string): string[] {
  const fragments: string[] = [];
  const seen = new Set<string>();
  const add = (fragment: string) => {
    const clean = fragment.replace(/\s+/g, " ").trim();
    if (clean.length < 2) return;
    const key = normalizeOptimizationDialogueCompareText(clean);
    if (!key || seen.has(key)) return;
    seen.add(key);
    fragments.push(clean);
  };

  for (const match of value.matchAll(/["“]([^"“”]{2,400})["”]/g)) {
    add(match[1] ?? "");
  }
  for (const lineText of value.split(/\r?\n/)) {
    for (const fragment of explicitDialogueFragmentsFromLine(lineText)) add(fragment);
  }
  return fragments;
}

function explicitDialogueFragmentsFromLine(lineText: string): string[] {
  const trimmed = lineText.trim();
  if (!trimmed) return [];
  const prefixed = trimmed.match(/^(?:Exact\s+dialogue|Dialogue|dialogue|Dialog|Line|Spoken\s+line|台词|对白)\s*[:：]\s*(.+)$/i);
  const inline = prefixed ? null : trimmed.match(/\b(?:Exact\s+dialogue|Dialogue|dialogue|Dialog|Line|Spoken\s+line|台词|对白)\s*[:：]\s*(.+)$/i);
  const dialogueText = (prefixed?.[1] ?? inline?.[1] ?? "").trim();
  if (!dialogueText) return [];
  if (!prefixed && !inline && !/^\s*(?:S\d+|P\d+|Shot\s*\d+|Panel\s*\d+)\b/i.test(trimmed)) return [];
  const matches = Array.from(dialogueText.matchAll(/\b([A-Z][A-Za-z0-9_' -]{0,40})\s*:/g));
  const output: string[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const speaker = (match[1] ?? "").trim();
    if (isProductionLabelSpeaker(speaker)) continue;
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? dialogueText.length;
    const fragment = dialogueText.slice(start, end).replace(/[;；]\s*$/g, "").trim();
    if (fragment) output.push(fragment);
  }
  return output;
}

function isProductionLabelSpeaker(value: string): boolean {
  return /^(P\d+|S\d+|Panel\s*\d+|Shot\s*\d+|Image|Action|Camera|Style|Scene|Setting|Characters?|Reference|References|Duration|Ratio|Lens|Move|Angle|Prompt|Exact\s+dialogue|Dialogue|Dialog|Line|Spoken\s+line|Performance|Continuity|State|Blocking|Composition|Important spatial\/prop cue)$/i.test(value.trim());
}

function normalizeOptimizationDialogueCompareText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function optimizeWorkflowClipShots(shots: NormalizedStoryboardShot[], clipId: string): NormalizedStoryboardShot[] {
  const optimized = rebalanceStoryboardPacing(shots.map((shot) => ({ ...shot, dialogue: cleanWorkflowPublicText(shot.dialogue) })));
  return optimized.map((shot, index) => ({
    ...shot,
    id: `${clipId}-shot-${String(index + 1).padStart(3, "0")}`,
    title: cleanWorkflowPublicText(shot.title),
    description: cleanWorkflowPublicText(shot.description),
    action: cleanWorkflowPublicText(shot.action),
    dialogue: cleanWorkflowPublicText(shot.dialogue),
    subtitle: cleanWorkflowPublicText(shot.subtitle),
    references: cleanWorkflowPublicText(shot.references),
    visualPrompt: cleanWorkflowPublicText(shot.visualPrompt),
    directorBoardPrompt: cleanWorkflowPromptText(shot.directorBoardPrompt),
  }));
}

async function persistWorkflowRun(args: {
  project: any;
  userId: string;
  parentMessageId: string;
  input: z.infer<typeof runWorkflowSchema>;
  normalized: ReturnType<typeof normalizeBreakdown>;
  model: { id: string; provider: string; model: string; displayName: string };
  rawText: string;
}) {
  const { project, userId, parentMessageId, input, normalized, model, rawText } = args;
  const metadata = isRecord(project.metadata) ? project.metadata : {};
  const currentWorkflow = getWorkflowState(metadata, input.episodeId);
  const now = new Date().toISOString();
  const breakdownScenes = workflowBreakdownScenesFromNormalizedStoryboard(normalized.storyboard);
  const clips = normalized.clips;
  const shotClipIds = new Map<string, string>();
  for (const clip of clips) {
    for (const shotId of clip.shotIds) {
      shotClipIds.set(shotId, clip.id);
    }
  }
  const workflowCenter = {
    ...currentWorkflow,
    sourceText: input.sourceText,
    sourceName: input.sourceName ?? currentWorkflow.sourceName,
    selectedEpisode: input.selectedEpisode,
    activeStage: input.stage === "assets" ? "assets" : "storyboard",
    breakdownScenes: input.stage === "assets" ? [] : breakdownScenes,
    clips: input.stage === "assets" ? [] : clips,
    sceneVisualBibles: input.stage === "assets" ? [] : normalized.sceneVisualBibles,
    assets:
      input.stage === "storyboard"
        ? currentWorkflow.assets
        : {
            characters: normalized.characters,
            scenes: normalized.locations,
            props: normalized.props,
          },
    stageStatuses: {
      ...(input.stage === "storyboard" ? currentWorkflow.stageStatuses : defaultStageStatuses()),
      source: "done",
      assets: input.stage === "storyboard" ? currentWorkflow.stageStatuses.assets ?? "idle" : "done",
      storyboard: input.stage === "assets" ? "idle" : "done",
      video: "idle",
      voice: "idle",
      preview: "idle",
      edit: "idle",
    },
    lastRun: {
      status: "succeeded",
      stage: input.stage,
      model,
      summary: normalized.summary,
      sourceLength: input.sourceText.length,
      completedAt: now,
    },
    updatedAt: now,
  };

  const result = await prisma.$transaction(async (tx: any) => {
    const generation = await tx.generation.create({
      data: {
        projectId: project.id,
        userId,
        aiModelId: model.id,
        prompt: `Workflow breakdown: ${input.selectedEpisode}`,
        input: {
          kind: "workflow-breakdown",
          sourceName: input.sourceName,
          selectedEpisode: input.selectedEpisode,
          sourceLength: input.sourceText.length,
        },
        parameters: { stage: input.stage },
        status: "SUCCEEDED",
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });

    const savedCharacters = new Map<string, any>();
    const existingCharacters = await tx.character.findMany({
      where: { projectId: project.id, deletedAt: null },
      select: { id: true, name: true, traits: true },
    });
    if (input.stage === "storyboard") {
      for (const character of existingCharacters) {
        savedCharacters.set(character.name.toLowerCase(), character);
      }
    } else {
      const characterMap = new Map<string, { id: string; name: string; traits: unknown }>(
        existingCharacters.map((character: any) => [character.name.toLowerCase(), character]),
      );
      for (const character of normalized.characters) {
        const existing = characterMap.get(character.name.toLowerCase());
        const saved = existing
          ? await tx.character.update({
              where: { id: existing.id },
              data: {
                role: character.role,
                bio: character.description,
                prompt: character.visualPrompt,
                traits: workflowCharacterTraits(existing.traits, character, input.selectedEpisode),
              },
            })
          : await tx.character.create({
              data: {
                projectId: project.id,
                createdById: userId,
                name: character.name,
                role: character.role,
                bio: character.description,
                prompt: character.visualPrompt,
                traits: workflowCharacterTraits({}, character, input.selectedEpisode),
              },
            });
        savedCharacters.set(character.name.toLowerCase(), saved);
      }
    }

    const existingScenes = await tx.scene.findMany({
      where: { projectId: project.id, deletedAt: null },
      select: { id: true, metadata: true },
    });
    const previousWorkflowSceneIds = existingScenes
      .filter((scene: any) => {
        const sceneMetadata = isRecord(scene.metadata) ? scene.metadata : {};
        return sceneMetadata.workflowSource === "script-import" && sceneMetadata.episode === input.selectedEpisode;
      })
      .map((scene: any) => scene.id);
    if (previousWorkflowSceneIds.length > 0) {
      await tx.scene.updateMany({
        where: { id: { in: previousWorkflowSceneIds } },
        data: { deletedAt: new Date() },
      });
    }

    const sceneCharacterRows: Array<{ sceneId: string; characterId: string; notes?: string }> = [];
    for (const [index, shot] of normalized.storyboard.entries()) {
      const scene = await tx.scene.create({
        data: {
          projectId: project.id,
          createdById: userId,
          title: shot.title,
          summary: shot.description,
          prompt: shot.visualPrompt,
          orderIndex: index,
          metadata: {
            workflowSource: "script-import",
            episode: input.selectedEpisode,
            action: shot.action,
            dialogue: shot.dialogue,
            durationSeconds: shot.durationSeconds,
            shotSize: shot.shotSize,
            cameraAngle: shot.cameraAngle,
            cameraMove: shot.cameraMove,
            composition: shot.composition,
            lens: shot.lens,
            aperture: shot.aperture,
            shutter: shot.shutter,
            iso: shot.iso,
            sound: shot.sound,
            music: shot.music,
            subtitle: shot.subtitle,
            setting: shot.setting,
            references: shot.references,
            clipId: shotClipIds.get(shot.id),
            directorBoardPrompt: shot.directorBoardPrompt,
          },
        },
      });

      for (const name of shot.characters) {
        const character = savedCharacters.get(name.toLowerCase());
        if (character) {
          sceneCharacterRows.push({ sceneId: scene.id, characterId: character.id, notes: shot.action });
        }
      }
    }
    if (sceneCharacterRows.length > 0) {
      await tx.sceneCharacter.createMany({ data: sceneCharacterRows, skipDuplicates: true });
    }

    await tx.agentMessage.create({
      data: {
        projectId: project.id,
        userId,
        generationId: generation.id,
        parentId: parentMessageId,
        role: "ASSISTANT",
        content: `已完成 ${input.selectedEpisode} 的结构化拆解：${normalized.characters.length} 个角色，${normalized.locations.length} 个场景，${clips.length} 个 Clip，${normalized.storyboard.length} 个分镜草案。`,
        payload: {
          kind: "workflow-breakdown",
          model,
          rawText,
          normalized,
        },
      },
    });

    const episodeId = input.episodeId || workflowEpisodeIdForWorkflow(metadata, workflowCenter);
    const nextMetadata = writeWorkflowEpisode(metadata, episodeId, workflowCenter, true);
    const updatedProject = await tx.project.update({
      where: { id: project.id },
      data: { metadata: nextMetadata },
    });

    return { generation, updatedProject, episodeId, nextMetadata };
  }, { timeout: 30000 });

  return {
    workflow: { ...workflowCenter, episodeId: result.episodeId, episodes: getWorkflowEpisodeList(result.nextMetadata) },
    run: {
      id: result.generation.id,
      status: "succeeded",
      model,
      scenesCreated: normalized.storyboard.length,
      clipsCreated: clips.length,
      charactersUpserted: input.stage === "storyboard" ? 0 : normalized.characters.length,
      assets: workflowCenter.assets,
      completedAt: now,
    },
  };
}

function workflowBreakdownScenesFromNormalizedStoryboard(storyboard: NormalizedStoryboardShot[]) {
  return storyboard.map((shot) => ({
    id: shot.id,
    title: shot.title,
    description: shot.description || shot.action || shot.visualPrompt,
    references: shot.references || [shot.setting, shot.characters.join(", ")].filter(Boolean).join(" · "),
    action: shot.action,
    dialogue: shot.dialogue,
    durationSeconds: shot.durationSeconds,
    shotSize: shot.shotSize,
    cameraAngle: shot.cameraAngle,
    cameraMove: shot.cameraMove,
    composition: shot.composition,
    lens: shot.lens,
    aperture: shot.aperture,
    shutter: shot.shutter,
    iso: shot.iso,
    sound: shot.sound,
    music: shot.music,
    subtitle: shot.subtitle,
    characters: shot.characters,
    setting: shot.setting,
    canonicalSceneId: shot.canonicalSceneId,
    sceneVisualLock: shot.sceneVisualLock,
    sceneZone: shot.sceneZone,
    sceneAnchors: shot.sceneAnchors,
    visualPrompt: shot.visualPrompt,
    directorBoardPrompt: shot.directorBoardPrompt,
    status: shot.status,
  }));
}

function defaultAssets() {
  return { characters: [], scenes: [], props: [] };
}

function imageGenerationLockKey(payload: unknown): string {
  return stableStringify(payload);
}

function acquireActiveImageGeneration(key: string): boolean {
  const now = Date.now();
  for (const [activeKey, startedAt] of activeImageGenerations) {
    if (now - startedAt > ACTIVE_IMAGE_GENERATION_LOCK_TTL_MS) {
      activeImageGenerations.delete(activeKey);
    }
  }
  if (activeImageGenerations.has(key)) return false;
  activeImageGenerations.set(key, now);
  return true;
}

function releaseActiveImageGeneration(key: string) {
  activeImageGenerations.delete(key);
}

function runCanvasImageGenerationJob(input: {
  req: { get(name: string): string | undefined; protocol: string };
  userId: string;
  projectId: string;
  generationId: string;
  prompt: string;
  aiModelId?: string;
  size?: string;
  referenceImageUrls: string[];
  requestParameters: Record<string, unknown>;
  requestMetadata: Record<string, unknown>;
  count: number;
  generationLockKey: string;
}) {
  void (async () => {
    try {
      await completeCanvasImageGenerationJob(input);
    } catch (error) {
      const message = formatImageGenerationFailure(error, "Canvas image generation failed.");
      await prisma.generation.update({
        where: { id: input.generationId },
        data: {
          status: "FAILED",
          errorMessage: message,
          completedAt: new Date(),
        },
      }).catch((updateError: unknown) => {
        console.warn(`[image-generation] generation=${input.generationId} failed_to_persist_failure ${rawImageGenerationMessage(updateError)}`);
      });
      logRawImageGenerationFailure(input.generationId, error, message);
    } finally {
      releaseActiveImageGeneration(input.generationLockKey);
    }
  })();
}

async function completeCanvasImageGenerationJob(input: {
  req: { get(name: string): string | undefined; protocol: string };
  userId: string;
  projectId: string;
  generationId: string;
  prompt: string;
  aiModelId?: string;
  size?: string;
  referenceImageUrls: string[];
  requestParameters: Record<string, unknown>;
  requestMetadata: Record<string, unknown>;
  count: number;
}) {
  const result = await callConfiguredImageModel({
    prompt: input.prompt,
    aiModelId: input.aiModelId,
    count: input.count,
    size: input.size,
    parameters: input.requestParameters,
  });
  const image = result.images[0];
  if (!image) badRequest("Image model returned no image.");
  const assets = [];
  const persistedImages = [];
  const requestedCount = countFromImageGenerationRequest(input.count, input.requestParameters);
  const imagesToPersist = result.images.slice(0, Math.max(1, Math.min(requestedCount || result.images.length || 1, 4)));
  for (let index = 0; index < imagesToPersist.length; index += 1) {
    const currentImage = imagesToPersist[index];
    const storedImage = await persistGeneratedImageOutput(input.req, currentImage.url, {
      userId: input.userId,
      projectId: input.projectId,
      generationId: input.generationId,
      prefix: index === 0 ? "canvas" : `canvas-${index + 1}`,
    });
    persistedImages.push({ ...currentImage, url: storedImage.url });
    const asset = await prisma.asset.create({
      data: {
        projectId: input.projectId,
        uploadedById: input.userId,
        generationId: input.generationId,
        type: "IMAGE",
        title: imagesToPersist.length > 1 ? `Canvas generated image ${index + 1}` : "Canvas generated image",
        url: storedImage.url,
        mimeType: storedImage.mimeType,
        metadata: {
          source: "canvas-image-generation",
          prompt: input.prompt,
          size: input.size,
          referenceImageUrls: input.referenceImageUrls,
          parameters: input.requestParameters,
          ...input.requestMetadata,
          model: result.model,
          revisedPrompt: currentImage.revisedPrompt,
          durationMs: result.durationMs,
          variantIndex: index,
          variantCount: imagesToPersist.length,
          ...(storedImage.originalUrl ? { originalProviderImageUrl: storedImage.originalUrl } : {}),
        },
      },
    });
    assets.push(asset);
  }
  const generation = await prisma.generation.update({
    where: { id: input.generationId },
    data: {
      aiModelId: result.model.id,
      status: "SUCCEEDED",
      completedAt: new Date(),
      parameters: {
        ...input.requestParameters,
        model: result.model,
        durationMs: result.durationMs,
        outputCount: persistedImages.length,
      },
    },
  });

  return { generation, asset: assets[0], assets, image: persistedImages[0], images: persistedImages };
}

function countFromImageGenerationRequest(count: number | undefined, parameters: Record<string, unknown>): number {
  const candidates = [count, parameters.n, parameters.count];
  for (const candidate of candidates) {
    const number = Number(candidate);
    if (Number.isFinite(number) && number > 0) return Math.floor(number);
  }
  return 0;
}

async function persistGeneratedImageOutput(
  req: { get(name: string): string | undefined; protocol: string },
  imageUrl: string,
  options: {
    userId: string;
    projectId: string;
    generationId: string;
    prefix: string;
  },
): Promise<{ url: string; mimeType?: string; originalUrl?: string }> {
  const parsed = parseGeneratedImageDataUrl(imageUrl);
  if (parsed) {
    return persistGeneratedImageBuffer(req, parsed.buffer, {
      ...options,
      extension: imageExtensionForContentType(parsed.contentType),
      mimeType: parsed.contentType,
    });
  }

  const imageHttpUrl = parseGeneratedImageHttpUrl(imageUrl);
  if (!imageHttpUrl) badRequest("Image model returned an unsupported image URL.");
  const downloaded = await downloadGeneratedImageOutput(imageHttpUrl);
  return persistGeneratedImageBuffer(req, downloaded.buffer, {
    ...options,
    extension: imageExtensionForContentType(downloaded.contentType),
    mimeType: downloaded.contentType,
    originalUrl: imageHttpUrl.href,
  });
}

async function persistGeneratedImageBuffer(
  req: { get(name: string): string | undefined; protocol: string },
  buffer: Buffer,
  options: {
    userId: string;
    projectId: string;
    generationId: string;
    prefix: string;
    extension: string;
    mimeType: string;
    originalUrl?: string;
  },
): Promise<{ url: string; mimeType?: string; originalUrl?: string }> {
  if (buffer.length === 0) badRequest("Image model returned empty image data.");
  if (buffer.length > 60 * 1024 * 1024) badRequest("Image model returned an image larger than 60MB.");
  const key = safeLocalUploadKey([
    options.userId,
    "generated",
    options.projectId,
    `${options.prefix}-${options.generationId}.${options.extension || "png"}`,
  ].join("/"));
  const filePath = path.join(LOCAL_UPLOAD_ROOT, key);
  const rootPath = path.resolve(LOCAL_UPLOAD_ROOT);
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(`${rootPath}${path.sep}`)) {
    badRequest("Invalid generated image path");
  }

  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, buffer);

  return {
    url: localPublicUploadUrl(req, key),
    mimeType: options.mimeType,
    originalUrl: options.originalUrl,
  };
}

function parseGeneratedImageHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url;
  } catch {
    return null;
  }
  return null;
}

async function downloadGeneratedImageOutput(url: URL): Promise<{ buffer: Buffer; contentType: string }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= GENERATED_IMAGE_DOWNLOAD_RETRY_COUNT; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GENERATED_IMAGE_DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: generatedImageDownloadHeaders(),
      });
      if (!response.ok) {
        if (response.body) await response.body.cancel().catch(() => undefined);
        if (shouldRetryGeneratedImageDownloadStatus(response.status) && attempt < GENERATED_IMAGE_DOWNLOAD_RETRY_COUNT) {
          await delay(500 * attempt);
          continue;
        }
        badRequest(`生成图片下载失败，源站返回 ${response.status}。`);
      }
      const contentType = normalizeGeneratedImageDownloadContentType(response.headers.get("content-type") || "", url.pathname);
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > 60 * 1024 * 1024) badRequest("生成图片超过 60MB，无法保存到本地。");
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) badRequest("生成图片内容为空。");
      if (buffer.length > 60 * 1024 * 1024) badRequest("生成图片超过 60MB，无法保存到本地。");
      return { buffer, contentType };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      lastError = error;
      if (attempt >= GENERATED_IMAGE_DOWNLOAD_RETRY_COUNT) break;
      await delay(500 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError || "unknown error");
  badRequest(`生成图片下载失败，无法保存到本地：${message}`);
}

function generatedImageDownloadHeaders(): HeadersInit {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36 Loohii/1.0",
    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Referer: "https://loohii.com/",
  };
}

function shouldRetryGeneratedImageDownloadStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeGeneratedImageDownloadContentType(value: string, pathname: string): string {
  const contentType = value.split(";")[0]?.trim().toLowerCase() || "";
  if (contentType.startsWith("image/") || contentType === "application/octet-stream") {
    return contentType === "application/octet-stream" ? imageContentTypeFromPath(pathname) : normalizeGeneratedImageContentType(contentType);
  }
  badRequest("生成图片源地址返回的不是图片文件。");
}

function imageContentTypeFromPath(pathname: string): string {
  const extension = path.extname(pathname).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/png";
}

function parseGeneratedImageDataUrl(value: string): { contentType: string; buffer: Buffer } | null {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) return null;
  const contentType = normalizeGeneratedImageContentType(match[1]);
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (buffer.length === 0) badRequest("Image model returned empty image data.");
  if (buffer.length > 60 * 1024 * 1024) badRequest("Image model returned an image larger than 60MB.");
  return { contentType, buffer };
}

function normalizeGeneratedImageContentType(value: string): string {
  const contentType = value.toLowerCase();
  if (["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"].includes(contentType)) {
    return contentType === "image/jpg" ? "image/jpeg" : contentType;
  }
  return "image/png";
}

function imageExtensionForContentType(contentType: string): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  return "png";
}

function safeLocalUploadKey(value: string): string {
  const cleaned = value
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("/");
  if (!cleaned || cleaned.includes("..")) badRequest("Invalid generated image key");
  return cleaned.slice(0, 700);
}

function localPublicUploadUrl(req: { get(name: string): string | undefined; protocol: string }, key: string): string {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = req.get("x-forwarded-host")?.split(",")[0]?.trim() || req.get("host");
  if (!host) badRequest("Missing request host");
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) {
    return `https://loohii.com/api/uploads/public/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  const proto = forwardedProto || (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host) ? req.protocol : "https");
  return `${proto}://${host}/api/uploads/public/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function persistWorkflowAssetReferenceImageInput(
  req: { get(name: string): string | undefined; protocol: string },
  imageUrl: string,
  options: {
    userId: string;
    projectId: string;
    assetKind: "characters" | "scenes" | "props";
    assetName: string;
    fileName?: string;
    mimeType?: string;
  },
): Promise<{ url: string; mimeType?: string; storageKey?: string; sizeBytes?: number; originalUrl?: string }> {
  if (isLocalPublicUploadUrl(imageUrl)) {
    return { url: imageUrl, mimeType: options.mimeType };
  }

  const dataImage = parseGeneratedImageDataUrl(imageUrl);
  if (dataImage) {
    return persistWorkflowAssetReferenceImageBuffer(req, dataImage.buffer, {
      ...options,
      mimeType: dataImage.contentType,
      originalUrl: undefined,
    });
  }

  const httpUrl = parseGeneratedImageHttpUrl(imageUrl);
  if (!httpUrl) badRequest("Unsupported reference image URL.");
  const downloaded = await downloadGeneratedImageOutput(httpUrl);
  return persistWorkflowAssetReferenceImageBuffer(req, downloaded.buffer, {
    ...options,
    mimeType: downloaded.contentType,
    originalUrl: httpUrl.href,
  });
}

async function persistWorkflowAssetReferenceImageBuffer(
  req: { get(name: string): string | undefined; protocol: string },
  buffer: Buffer,
  options: {
    userId: string;
    projectId: string;
    assetKind: "characters" | "scenes" | "props";
    assetName: string;
    fileName?: string;
    mimeType: string;
    originalUrl?: string;
  },
): Promise<{ url: string; mimeType: string; storageKey: string; sizeBytes: number; originalUrl?: string }> {
  if (buffer.length === 0) badRequest("参考图内容为空。");
  if (buffer.length > 60 * 1024 * 1024) badRequest("参考图超过 60MB，无法保存到本地。");
  const extension = imageExtensionForContentType(options.mimeType);
  const rawBaseName = options.fileName
    ? path.basename(options.fileName, path.extname(options.fileName))
    : `${Date.now()}-${options.assetName}`;
  const baseName = `${Date.now()}-${rawBaseName || options.assetName || "reference-image"}`;
  const key = safeLocalUploadKey([
    options.userId,
    "asset-references",
    options.projectId,
    options.assetKind,
    `${baseName}.${extension}`,
  ].join("/"));
  const filePath = path.join(LOCAL_UPLOAD_ROOT, key);
  const rootPath = path.resolve(LOCAL_UPLOAD_ROOT);
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(`${rootPath}${path.sep}`)) {
    badRequest("Invalid reference image path");
  }

  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, buffer);

  return {
    url: localPublicUploadUrl(req, key),
    mimeType: options.mimeType,
    storageKey: key,
    sizeBytes: buffer.length,
    originalUrl: options.originalUrl,
  };
}

function isLocalPublicUploadUrl(value: string): boolean {
  return /\/api\/uploads\/public\//.test(value);
}

type DreaminaVideoResult = {
  submitId?: string;
  genStatus?: string;
  raw: unknown;
  video?: { url: string; mimeType?: string };
};

type CanvasVideoProviderContext = {
  provider: "jimeng-api" | "dreamina-cli" | "dreamina-web";
  model?: {
    id: string;
    provider: string;
    model: string;
    displayName: string;
    defaultParams: unknown;
    apiKeyEncrypted: string | null;
    providerConfig?: {
      id: string;
      providerType: string;
      displayName: string;
      baseUrl: string | null;
      apiKeyEncrypted: string | null;
    } | null;
  } | null;
  baseUrl?: string;
  sessionToken?: string;
  videoModel: string;
  functionMode: "first_last_frames" | "omni_reference";
};

async function resolveCanvasVideoProviderContext(aiModelId?: string): Promise<CanvasVideoProviderContext> {
  const defaultVideoModel = aiModelId ? null : await findDefaultCanvasVideoModel();
  if (!aiModelId && !defaultVideoModel) {
    return {
      provider: "dreamina-cli",
      videoModel: "seedance2.0",
      functionMode: "first_last_frames",
    };
  }

  const model = defaultVideoModel ?? await prisma.aiModel.findFirst({
    where: { id: aiModelId, isActive: true },
    include: { providerConfig: true },
  });
  if (!model) badRequest("Selected video model was not found or is disabled.");

  const providerType = model.providerConfig?.providerType || model.provider;
  if (isJimengApiProvider(providerType, model.model)) {
    const sessionToken = resolveCanvasVideoModelSecret(model);
    if (!sessionToken) badRequest("Jimeng/Dreamina session is required. Add it as the video model API Key in Settings.");
    return {
      provider: "jimeng-api",
      model,
      baseUrl: normalizeJimengApiBaseUrl(model.providerConfig?.baseUrl || config.jimengApi.baseUrl),
      sessionToken,
      videoModel: model.model || "jimeng-video-seedance-2.0",
      functionMode: resolveJimengVideoFunctionMode(model),
    };
  }
  if (isDreaminaWebVideoProvider(providerType, model.model)) {
    return {
      provider: "dreamina-web",
      model,
      videoModel: "seedance2.0",
      functionMode: "first_last_frames",
    };
  }

  return {
    provider: "dreamina-cli",
    model,
    videoModel: model.model || "seedance2.0",
    functionMode: "first_last_frames",
  };
}

async function findDefaultCanvasVideoModel() {
  const models = await prisma.aiModel.findMany({
    where: {
      isActive: true,
      providerConfigId: { not: null },
      providerConfig: { isActive: true },
    },
    include: { providerConfig: true },
    orderBy: [{ updatedAt: "desc" }, { displayName: "asc" }],
  });
  return models.find((model: { modality: string; capabilities: unknown; model: string; displayName: string; provider: string; providerConfig?: { providerType: string; displayName: string } | null }) => isCanvasVideoModel(model)) ?? null;
}

function isCanvasVideoModel(model: { modality: string; capabilities: unknown; model: string; displayName: string; provider: string; providerConfig?: { providerType: string; displayName: string } | null }): boolean {
  const modality = model.modality.trim().toLowerCase();
  const capabilities = capabilitiesToStringArray(model.capabilities).map((item) => item.toLowerCase());
  const searchable = `${modality} ${capabilities.join(" ")} ${model.model} ${model.displayName} ${model.provider} ${model.providerConfig?.providerType || ""} ${model.providerConfig?.displayName || ""}`.toLowerCase();
  if (modality === "video" || capabilities.some((item) => item.includes("video"))) return true;
  return /(seedance|jimeng-video|kling|runway|luma|video)/.test(searchable);
}

function capabilitiesToStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (isRecord(value)) return Object.entries(value).filter(([, enabled]) => Boolean(enabled)).map(([key]) => key);
  return [];
}

function isJimengApiProvider(providerType: string, modelName = ""): boolean {
  const value = `${providerType} ${modelName}`.toLowerCase();
  return /\b(jimeng-api|jimeng|dreamina-api|dreamina-rest)\b/.test(value) || value.includes("jimeng-video-");
}

function isDreaminaWebVideoProvider(providerType: string, modelName = ""): boolean {
  const value = `${providerType} ${modelName}`.toLowerCase();
  return value.includes("dreamina-web");
}

function resolveCanvasVideoModelSecret(model: CanvasVideoProviderContext["model"]): string {
  const encrypted = model?.apiKeyEncrypted || model?.providerConfig?.apiKeyEncrypted;
  if (!encrypted) return "";
  try {
    return decryptModelConfigSecret(encrypted).trim();
  } catch {
    return "";
  }
}

function normalizeJimengApiBaseUrl(value: string | null | undefined): string {
  const raw = (value || config.jimengApi.baseUrl || "http://127.0.0.1:5100").trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    badRequest("Jimeng API Base URL must be a valid URL, for example http://127.0.0.1:5100.");
  }
  if (!/^https?:$/i.test(url.protocol)) badRequest("Jimeng API Base URL must use http or https.");
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function resolveJimengVideoFunctionMode(model: NonNullable<CanvasVideoProviderContext["model"]>): "first_last_frames" | "omni_reference" {
  const params = isRecord(model.defaultParams) ? model.defaultParams : {};
  const configured = String(params.functionMode || params.function_mode || "").trim();
  if (configured === "first_last_frames" || configured === "omni_reference") return configured;
  return /seedance-2\.0/i.test(model.model) ? "omni_reference" : "first_last_frames";
}

function canvasVideoProviderParameters(context: CanvasVideoProviderContext): Record<string, unknown> {
  if (context.provider === "jimeng-api") {
    return {
      provider: "jimeng-api",
      modelVersion: context.videoModel,
      functionMode: context.functionMode,
      endpoint: context.baseUrl,
    };
  }
  if (context.provider === "dreamina-web") {
    return {
      provider: "dreamina-web",
      bridge: "dreamina-web",
      mode: "multimodal2video",
      modelVersion: "seedance2.0fast",
    };
  }
  return {
    provider: "dreamina-cli",
    modelVersion: "seedance2.0",
  };
}

async function runCanvasVideoGeneration(
  req: { get(name: string): string | undefined; protocol: string },
  context: CanvasVideoProviderContext,
  input: {
    userId: string;
    projectId: string;
    generationId: string;
    prompt: string;
    referenceImageUrls: string[];
    referenceAudioUrls: string[];
    durationSeconds: number;
    resolution: string;
    ratio: string;
    submitId?: string;
    existingRaw?: unknown;
  },
): Promise<DreaminaVideoResult> {
  if (context.provider === "jimeng-api") {
    if (input.submitId) badRequest("Jimeng API adapter does not support submit_id query in Loohii yet. Regenerate without submit_id.");
    return submitJimengApiVideoTask(req, context, input);
  }

  if (context.provider === "dreamina-web") {
    return input.submitId
      ? queryDreaminaWebVideoTask(req, {
          userId: input.userId,
          projectId: input.projectId,
          generationId: input.generationId,
          submitId: input.submitId,
          existingVideoUrls: dreaminaExistingVideoUrlsFromRaw(input.existingRaw),
        })
      : submitDreaminaWebVideoTask(req, input);
  }

  return input.submitId
    ? queryDreaminaVideoTask(req, {
        userId: input.userId,
        projectId: input.projectId,
        generationId: input.generationId,
        submitId: input.submitId,
      })
    : submitDreaminaImageToVideoTask(req, {
        userId: input.userId,
          projectId: input.projectId,
          generationId: input.generationId,
          prompt: input.prompt,
          referenceImageUrls: input.referenceImageUrls,
          referenceAudioUrls: input.referenceAudioUrls,
          durationSeconds: input.durationSeconds,
        resolution: input.resolution,
        ratio: input.ratio,
      });
}

async function submitDreaminaWebVideoTask(
  req: { get(name: string): string | undefined; protocol: string },
  input: {
    userId: string;
    projectId: string;
    generationId: string;
    prompt: string;
    referenceImageUrls: string[];
    referenceAudioUrls: string[];
    durationSeconds: number;
    resolution: string;
    ratio: string;
  },
): Promise<DreaminaVideoResult> {
  const referenceImageUrls = input.referenceImageUrls.filter((url) => /^https?:\/\//i.test(url)).slice(0, DREAMINA_WEB_VIDEO_MAX_IMAGE_REFERENCES);
  if (referenceImageUrls.length === 0) badRequest("Dreamina Web 全能参考视频需要至少连接 1 张公网参考图。");
  const result = await callDreaminaWebVideoModel({
    prompt: input.prompt,
    referenceImageUrls,
    referenceAudioUrls: input.referenceAudioUrls.filter((url) => /^https?:\/\//i.test(url)).slice(0, DREAMINA_WEB_VIDEO_MAX_AUDIO_REFERENCES),
    durationSeconds: input.durationSeconds,
    ratio: input.ratio,
    resolution: input.resolution,
  });
  const video = result.videoUrl
    ? await persistGeneratedVideoOutput(req, result.videoUrl, {
        userId: input.userId,
        projectId: input.projectId,
        generationId: input.generationId,
        prefix: "dreamina-web",
      })
    : undefined;
  return {
    submitId: result.submitId,
    genStatus: video ? "succeeded" : result.genStatus,
    raw: result.raw,
    video,
  };
}

async function queryDreaminaWebVideoTask(
  req: { get(name: string): string | undefined; protocol: string },
  input: {
    userId: string;
    projectId: string;
    generationId: string;
    submitId: string;
    existingVideoUrls?: string[];
  },
): Promise<DreaminaVideoResult> {
  const result = await queryDreaminaWebVideoModel(input.submitId, { existingVideoUrls: input.existingVideoUrls ?? [] });
  const video = result.videoUrl
    ? await persistGeneratedVideoOutput(req, result.videoUrl, {
        userId: input.userId,
        projectId: input.projectId,
        generationId: input.generationId,
        prefix: "dreamina-web",
      })
    : undefined;
  return {
    submitId: result.submitId,
    genStatus: video ? "succeeded" : result.genStatus,
    raw: result.raw,
    video,
  };
}

async function submitJimengApiVideoTask(
  req: { get(name: string): string | undefined; protocol: string },
  context: CanvasVideoProviderContext,
  input: {
    userId: string;
    projectId: string;
    generationId: string;
    prompt: string;
    referenceImageUrls: string[];
    referenceAudioUrls: string[];
    durationSeconds: number;
    resolution: string;
    ratio: string;
  },
): Promise<DreaminaVideoResult> {
  if (!context.baseUrl || !context.sessionToken) badRequest("Jimeng API Base URL or session token is missing.");
  const imageUrls = input.referenceImageUrls.filter((url) => /^https?:\/\//i.test(url)).slice(0, context.functionMode === "omni_reference" ? 9 : 2);
  if (imageUrls.length === 0) badRequest("Jimeng/Dreamina video generation requires at least 1 public storyboard or image URL.");

  const body =
    context.functionMode === "omni_reference"
      ? buildJimengOmniReferenceBody(context.videoModel, input, imageUrls)
      : {
          model: context.videoModel,
          prompt: input.prompt,
          ratio: input.ratio,
          resolution: input.resolution,
          duration: input.durationSeconds,
          filePaths: imageUrls.slice(0, 2),
          response_format: "url",
        };

  const raw = await postJimengApiJson(context.baseUrl, "/v1/videos/generations", context.sessionToken, body);
  const directVideoUrl = jimengApiVideoUrl(raw);
  const video = directVideoUrl
    ? await persistGeneratedVideoOutput(req, directVideoUrl, {
        userId: input.userId,
        projectId: input.projectId,
        generationId: input.generationId,
        prefix: "jimeng",
      })
    : undefined;
  return {
    submitId: jimengApiSubmitId(raw),
    genStatus: video ? "succeeded" : jimengApiStatus(raw),
    raw,
    video,
  };
}

function buildJimengOmniReferenceBody(
  model: string,
  input: { prompt: string; ratio: string; resolution: string; durationSeconds: number; referenceAudioUrls?: string[] },
  imageUrls: string[],
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    prompt: input.prompt,
    ratio: input.ratio,
    resolution: input.resolution,
    duration: input.durationSeconds,
    functionMode: "omni_reference",
    response_format: "url",
  };
  const audioUrls = Array.isArray(input.referenceAudioUrls)
    ? input.referenceAudioUrls.filter((url) => /^https?:\/\//i.test(url)).slice(0, 16)
    : [];
  if (audioUrls.length > 0) {
    body.referenceAudioUrls = audioUrls;
  }
  imageUrls.forEach((url, index) => {
    body[`image_file_${index + 1}`] = url;
  });
  return body;
}

async function postJimengApiJson(baseUrl: string, pathname: string, sessionToken: string, body: Record<string, unknown>): Promise<unknown> {
  const endpoint = new URL(pathname, `${baseUrl}/`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(30000, config.jimengApi.timeoutMs));
  try {
    const response = await fetch(endpoint.href, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const rawText = await response.text();
    const parsed = parseJsonMaybe(rawText);
    if (!response.ok) {
      throw new Error(`Jimeng API returned HTTP ${response.status}: ${summarizeRemoteResponse(parsed ?? rawText)}`);
    }
    return parsed ?? rawText;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Jimeng API request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function jimengApiVideoUrl(payload: unknown): string | undefined {
  if (isRecord(payload)) {
    const data = payload.data;
    if (Array.isArray(data)) {
      for (const item of data) {
        if (isRecord(item) && typeof item.url === "string" && /^https?:\/\//i.test(item.url)) return item.url;
      }
    }
  }
  return dreaminaVideoUrl(payload);
}

function jimengApiSubmitId(payload: unknown): string | undefined {
  return findDeepStringValue(payload, ["submit_id", "submitId", "history_id", "historyId", "task_id", "taskId", "id"]);
}

function jimengApiStatus(payload: unknown): string | undefined {
  return findDeepStringValue(payload, ["status", "gen_status", "genStatus", "message"]);
}

function normalizeJimengVideoRatio(value: unknown): string {
  const ratio = String(value || "16:9").trim();
  return /^(1:1|4:3|3:4|16:9|9:16|21:9)$/i.test(ratio) ? ratio : "16:9";
}

function normalizeCanvasVideoRatio(value: unknown, prompt = "", projectAspectRatio = ""): string {
  const raw = String(value || "").trim();
  if (/^(1:1|4:3|3:4|16:9|9:16|21:9)$/i.test(raw)) return raw;
  const promptRatio = prompt.match(/\b(?:aspect\s*ratio|ratio)\s*[:=]?\s*(1:1|4:3|3:4|16:9|9:16|21:9)\b/i)?.[1];
  if (promptRatio) return promptRatio;
  return normalizeJimengVideoRatio(projectAspectRatio);
}

async function submitDreaminaImageToVideoTask(
  req: { get(name: string): string | undefined; protocol: string },
  input: {
    userId: string;
    projectId: string;
    generationId: string;
    prompt: string;
    referenceImageUrls: string[];
    referenceAudioUrls?: string[];
    durationSeconds?: number;
    resolution?: string;
    ratio?: string;
  },
): Promise<DreaminaVideoResult> {
  const imageUrls = input.referenceImageUrls.filter((url) => /^https?:\/\//i.test(url)).slice(0, 9);
  if (imageUrls.length === 0) {
    badRequest("即梦全能参考视频需要至少连接 1 张公网参考图。");
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "loohii-dreamina-"));
  try {
    const imageArgs: string[] = [];
    for (let index = 0; index < imageUrls.length; index += 1) {
      const imagePath = path.join(tempDir, `reference-${index + 1}.png`);
      await downloadReferenceImageForDreamina(imageUrls[index], imagePath);
      imageArgs.push("--image", imagePath);
    }
    const output = await runDreaminaCli([
      "multimodal2video",
      ...imageArgs,
      `--prompt=${input.prompt}`,
      "--model_version=seedance2.0",
      `--duration=${normalizeDreaminaVideoDuration(input.durationSeconds)}`,
      `--ratio=${normalizeJimengVideoRatio(input.ratio)}`,
      `--video_resolution=${normalizeDreaminaVideoResolution(input.resolution)}`,
      "--poll=30",
    ], DREAMINA_CLI_TIMEOUT_MS);
    const parsed = parseDreaminaOutput(output);
    const submitId = dreaminaSubmitId(parsed, output);
    const genStatus = dreaminaGenStatus(parsed, output);
    const directVideoUrl = dreaminaVideoUrl(parsed);
    const video = directVideoUrl
      ? await persistGeneratedVideoOutput(req, directVideoUrl, {
          userId: input.userId,
          projectId: input.projectId,
          generationId: input.generationId,
          prefix: "dreamina",
        })
      : undefined;
    return { submitId, genStatus, raw: parsed ?? output, video };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function queryDreaminaVideoTask(
  req: { get(name: string): string | undefined; protocol: string },
  input: {
    userId: string;
    projectId: string;
    generationId: string;
    submitId: string;
  },
): Promise<DreaminaVideoResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "loohii-dreamina-query-"));
  try {
    const output = await runDreaminaCli([
      "query_result",
      `--submit_id=${input.submitId}`,
      `--download_dir=${tempDir}`,
    ], DREAMINA_QUERY_TIMEOUT_MS);
    const parsed = parseDreaminaOutput(output);
    const downloadedVideo = await findDownloadedDreaminaVideo(tempDir);
    const video = downloadedVideo
      ? await persistLocalGeneratedVideoOutput(req, downloadedVideo, {
          userId: input.userId,
          projectId: input.projectId,
          generationId: input.generationId,
          prefix: "dreamina",
        })
      : dreaminaVideoUrl(parsed)
        ? await persistGeneratedVideoOutput(req, dreaminaVideoUrl(parsed)!, {
            userId: input.userId,
            projectId: input.projectId,
            generationId: input.generationId,
            prefix: "dreamina",
          })
        : undefined;
    return {
      submitId: dreaminaSubmitId(parsed, output) || input.submitId,
      genStatus: dreaminaGenStatus(parsed, output),
      raw: parsed ?? output,
      video,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function downloadReferenceImageForDreamina(url: string, outputPath: string) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 Loohii/1.0",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      Referer: "https://loohii.com/",
    },
  });
  if (!response.ok) badRequest(`首帧参考图下载失败（${response.status}）。`);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length === 0) badRequest("首帧参考图为空。");
  if (buffer.length > 30 * 1024 * 1024) badRequest("首帧参考图超过 30MB，无法提交即梦。");
  await writeFile(outputPath, buffer);
}

function runDreaminaCli(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(DREAMINA_CLI_PATH, args, {
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: `${process.env.HOME || "/root"}/.local/bin:${process.env.PATH || ""}`,
      },
    }, (error, stdout, stderr) => {
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      if (error) {
        reject(new Error(output || error.message));
        return;
      }
      resolve(output);
    });
    child.stdin?.end();
  });
}

function parseDreaminaOutput(output: string): unknown {
  const trimmed = output.trim();
  if (!trimmed) return null;
  return parseJsonMaybe(trimmed);
}

function parseJsonMaybe(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }
}

function summarizeRemoteResponse(value: unknown): string {
  if (typeof value === "string") {
    return value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);
  }
  if (isRecord(value)) {
    const message = findDeepStringValue(value, ["message", "errmsg", "error", "detail"]);
    if (message) return message.slice(0, 500);
    return JSON.stringify(value).slice(0, 500);
  }
  return String(value ?? "").slice(0, 500);
}

function dreaminaSubmitId(parsed: unknown, output: string): string | undefined {
  for (const value of deepObjectValues(parsed)) {
    if (typeof value === "string" && /^[a-zA-Z0-9_-]{10,}$/.test(value) && /submit/i.test(String(findObjectKeyForValue(parsed, value) || ""))) {
      return value;
    }
  }
  const match = output.match(/submit[_-]?id["'\s:=]+([a-zA-Z0-9_-]{10,})/i);
  return match?.[1];
}

function dreaminaGenStatus(parsed: unknown, output: string): string | undefined {
  const status = findDeepStringValue(parsed, ["gen_status", "genStatus", "status"]);
  if (status) return status;
  const match = output.match(/gen[_-]?status["'\s:=]+([a-zA-Z0-9_-]+)/i) || output.match(/status["'\s:=]+([a-zA-Z0-9_-]+)/i);
  return match?.[1];
}

function dreaminaVideoUrl(parsed: unknown): string | undefined {
  for (const value of deepObjectValues(parsed)) {
    if (typeof value === "string" && /^https?:\/\//i.test(value) && /\.(mp4|mov|webm)(\?|#|$)/i.test(value)) return value;
  }
  return undefined;
}

function deepObjectValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(deepObjectValues);
  if (isRecord(value)) return Object.values(value).flatMap(deepObjectValues);
  return [value];
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
  for (const key of keys) {
    const found = value[key];
    if (typeof found === "string" && found.trim()) return found.trim();
  }
  for (const item of Object.values(value)) {
    const found = findDeepStringValue(item, keys);
    if (found) return found;
  }
  return undefined;
}

function findObjectKeyForValue(value: unknown, target: string): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findObjectKeyForValue(item, target);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const [key, item] of Object.entries(value)) {
    if (item === target) return key;
    const found = findObjectKeyForValue(item, target);
    if (found) return found;
  }
  return undefined;
}

async function findDownloadedDreaminaVideo(dir: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findDownloadedDreaminaVideo(fullPath);
      if (nested) return nested;
    } else if (/\.(mp4|mov|webm)$/i.test(entry.name)) {
      return fullPath;
    }
  }
  return null;
}

async function persistGeneratedVideoOutput(
  req: { get(name: string): string | undefined; protocol: string },
  videoUrl: string,
  options: { userId: string; projectId: string; generationId: string; prefix: string },
): Promise<{ url: string; mimeType?: string }> {
  const response = await fetch(videoUrl, { redirect: "follow" });
  if (!response.ok) badRequest(`即梦视频下载失败（${response.status}）。`);
  const contentType = response.headers.get("content-type") || "";
  if (!isGeneratedVideoResponse(contentType, videoUrl)) {
    badRequest(`即梦返回的不是视频文件（${contentType || "unknown content-type"}）。任务可能仍在生成中，请稍后查询结果。`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) badRequest("即梦返回的视频为空。");
  return persistGeneratedVideoBuffer(req, buffer, {
    ...options,
    extension: videoExtensionForContentType(contentType, videoUrl),
    mimeType: normalizeVideoContentType(contentType),
  });
}

async function persistLocalGeneratedVideoOutput(
  req: { get(name: string): string | undefined; protocol: string },
  filePath: string,
  options: { userId: string; projectId: string; generationId: string; prefix: string },
): Promise<{ url: string; mimeType?: string }> {
  const buffer = await readFile(filePath);
  if (buffer.length === 0) badRequest("即梦下载的视频为空。");
  const extension = path.extname(filePath).replace(/^\./, "") || "mp4";
  return persistGeneratedVideoBuffer(req, buffer, {
    ...options,
    extension,
    mimeType: videoMimeTypeForExtension(extension),
  });
}

async function persistGeneratedVideoBuffer(
  req: { get(name: string): string | undefined; protocol: string },
  buffer: Buffer,
  options: { userId: string; projectId: string; generationId: string; prefix: string; extension: string; mimeType?: string },
): Promise<{ url: string; mimeType?: string }> {
  if (buffer.length > 500 * 1024 * 1024) badRequest("即梦返回的视频超过 500MB。");
  const key = safeLocalUploadKey([
    options.userId,
    "generated",
    options.projectId,
    `${options.prefix}-${options.generationId}.${options.extension || "mp4"}`,
  ].join("/"));
  const filePath = path.join(LOCAL_UPLOAD_ROOT, key);
  const rootPath = path.resolve(LOCAL_UPLOAD_ROOT);
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(`${rootPath}${path.sep}`)) badRequest("Invalid generated video path");
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, buffer);
  const converted = await convertGeneratedVideoToBrowserWebm(req, resolvedPath, {
    userId: options.userId,
    projectId: options.projectId,
    generationId: options.generationId,
    prefix: options.prefix,
  });
  return converted ?? { url: localPublicUploadUrl(req, key), mimeType: options.mimeType || videoMimeTypeForExtension(options.extension) };
}

async function convertGeneratedVideoToBrowserWebm(
  req: { get(name: string): string | undefined; protocol: string },
  inputPath: string,
  options: { userId: string; projectId: string; generationId: string; prefix: string },
): Promise<{ url: string; mimeType: string } | null> {
  const key = safeLocalUploadKey([
    options.userId,
    "generated",
    options.projectId,
    `${options.prefix}-${options.generationId}.webm`,
  ].join("/"));
  const outputPath = path.join(LOCAL_UPLOAD_ROOT, key);
  const rootPath = path.resolve(LOCAL_UPLOAD_ROOT);
  const resolvedOutputPath = path.resolve(outputPath);
  if (!resolvedOutputPath.startsWith(`${rootPath}${path.sep}`)) return null;
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  try {
    await execFilePromise("ffmpeg", [
      "-y",
      "-hide_banner",
      "-i",
      inputPath,
      "-an",
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "2500k",
      "-pix_fmt",
      "yuv420p",
      "-row-mt",
      "1",
      "-deadline",
      "good",
      "-cpu-used",
      "4",
      resolvedOutputPath,
    ], 180_000);
    const output = await readFile(resolvedOutputPath);
    if (output.length === 0) return null;
    return { url: localPublicUploadUrl(req, key), mimeType: "video/webm" };
  } catch (error) {
    console.warn("[workflow-video] webm conversion failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

function execFilePromise(command: string, args: string[], timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve();
    });
  });
}

function normalizeDreaminaVideoDuration(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 15;
  return Math.max(4, Math.min(15, Math.round(number)));
}

function normalizeDreaminaVideoResolution(value: unknown): string {
  return String(value || "").toLowerCase() === "1080p" ? "1080p" : "720p";
}

function normalizeVideoContentType(value: string): string | undefined {
  const contentType = value.split(";")[0]?.trim().toLowerCase();
  if (contentType === "video/mp4" || contentType === "video/quicktime" || contentType === "video/webm") return contentType;
  return undefined;
}

function isGeneratedVideoResponse(contentType: string, videoUrl: string): boolean {
  if (normalizeVideoContentType(contentType)) return true;
  const decodedUrl = decodeURIComponent(videoUrl).toLowerCase();
  if (/mime_type=(audio|image)[_/]/i.test(decodedUrl)) return false;
  if (/\.(wav|mp3|m4a|aac|ogg|oga|flac|aiff?|png|jpe?g|webp|gif|bmp|heic|avif)(?:[?#]|$)/i.test(decodedUrl)) return false;
  return /\.(mp4|mov|webm)(?:[?#]|$)/i.test(decodedUrl) || /mime_type=video[_/]/i.test(decodedUrl);
}

function videoExtensionForContentType(contentType: string, fallbackUrl = ""): string {
  const normalized = normalizeVideoContentType(contentType);
  if (normalized === "video/quicktime") return "mov";
  if (normalized === "video/webm") return "webm";
  const match = fallbackUrl.match(/\.([a-z0-9]+)(?:[?#]|$)/i);
  if (match && /^(mp4|mov|webm)$/i.test(match[1])) return match[1].toLowerCase();
  return "mp4";
}

function videoMimeTypeForExtension(extension: string): string {
  if (/^mov$/i.test(extension)) return "video/quicktime";
  if (/^webm$/i.test(extension)) return "video/webm";
  return "video/mp4";
}

function formatCanvasVideoGenerationFailure(context: CanvasVideoProviderContext, error: unknown): string {
  return context.provider === "jimeng-api" ? formatJimengApiGenerationFailure(error) : formatDreaminaGenerationFailure(error);
}

function formatJimengApiGenerationFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/401|403|unauthori[sz]ed|session|token|login|invalid/i.test(message)) {
    return `Jimeng/Dreamina session 无效或已过期：${message}`;
  }
  if (/credit|points|余额|insufficient|quota|limit/i.test(message)) {
    return `Jimeng/Dreamina 账号额度不足或不可用：${message}`;
  }
  if (/timed out|timeout|aborted/i.test(message)) {
    return "Jimeng API 视频生成请求超时。任务可能仍在第三方服务处理中，请稍后检查生成记录或重试。";
  }
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|EHOSTUNREACH/i.test(message)) {
    return `Jimeng API 服务不可用，请确认本机 5100 服务已启动：${message}`;
  }
  return message || "Jimeng API 视频生成失败。";
}

function formatDreaminaGenerationFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/参考素材上传到页面超时|素材上传(?:预检|校验)失败|参考素材下载失败/i.test(message)) {
    return message;
  }
  if (/missing-submit-id-timeout/i.test(message)) {
    return dreaminaWebMissingSubmitIdFailureMessage();
  }
  if (/未检测到有效登录态|login/i.test(message)) {
    return "即梦 CLI 未登录。请先在服务器执行 dreamina login 完成登录后再生成视频。";
  }
  if (/AigcComplianceConfirmationRequired/i.test(message)) {
    return "即梦模型需要先在 Dreamina Web 端完成授权确认，确认后再重试。";
  }
  if (/credit|余额|insufficient/i.test(message)) {
    return `即梦账号余额不足或额度不可用：${message}`;
  }
  if (/timeout|timed out/i.test(message)) {
    return "即梦视频任务提交/查询超时，任务可能仍在后台处理中；请稍后用 submit_id 查询。";
  }
  return message || "即梦视频生成失败。";
}

function isFailedCanvasVideoStatus(status: unknown): boolean {
  return /^(failed|fail|error|rejected|checkfailed|missing-submit-id-timeout)$/i.test(String(status || "").trim());
}

function isTerminalGenerationStatus(status: unknown): boolean {
  return /^(SUCCEEDED|FAILED|CANCELED)$/i.test(String(status || "").trim());
}

function canvasVideoGenerationStatusToProviderStatus(status: unknown, parameters: unknown): string {
  const existing = isRecord(parameters) ? stringFrom(parameters.genStatus, "") : "";
  if (existing) return existing;
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "SUCCEEDED") return "succeeded";
  if (normalized === "FAILED") return "failed";
  if (normalized === "CANCELED") return "cancelled";
  return "running";
}

function withCanvasVideoStatusRaw(raw: unknown, genStatus: unknown): unknown {
  const status = typeof genStatus === "string" && genStatus.trim() ? genStatus.trim() : "";
  if (!status) return raw;
  if (isRecord(raw)) return { ...raw, genStatus: status };
  return { genStatus: status, raw };
}

function canvasVideoResultFailureMessage(raw: unknown): string {
  if (!isRecord(raw)) return "";
  const direct = stringFrom(raw.errorMessage, "");
  const providerFailure = canvasVideoProviderFailureMessage(raw);
  if (providerFailure) return providerFailure;
  if (direct) return direct;
  const rawStatus = stringFrom(raw.genStatus, "") || stringFrom(raw.status, "");
  if (/missing-submit-id-timeout/i.test(rawStatus)) return dreaminaWebMissingSubmitIdFailureMessage();
  const result = isRecord(raw.result) ? raw.result : {};
  const resultStatus = stringFrom(result.genStatus, "") || stringFrom(result.status, "");
  if (/missing-submit-id-timeout/i.test(resultStatus)) return dreaminaWebMissingSubmitIdFailureMessage();
  const resultError = stringFrom(result.errorMessage, "");
  if (resultError) return resultError;
  const resultProviderFailure = canvasVideoProviderFailureMessage(result);
  if (resultProviderFailure) return resultProviderFailure;
  const dom = isRecord(raw.dom) ? raw.dom : {};
  const bodyTail = stringFrom(dom.bodyTail, "");
  if (/may contain inappropriate content|内容违规|审核失败|敏感内容|不适宜/i.test(bodyTail)) {
    return `Dreamina Web 视频任务审核失败：${bodyTail.slice(-500)}`;
  }
  return "";
}

function canvasVideoProviderFailureMessage(raw: unknown): string {
  const expandedRaw = expandCanvasVideoRawSummaries(raw);
  const textFailure = extractCanvasVideoProviderFailureFromText(raw);
  const errorMsg = findDeepStringValue(expandedRaw, ["errorMsg", "error_msg"]) || textFailure.errorMsg;
  const failStarlingMessage = findDeepStringValue(expandedRaw, ["failStarlingMessage", "fail_starling_message"]) || textFailure.failStarlingMessage;
  const errorCode = findDeepScalarStringValue(expandedRaw, ["errorCode", "error_code", "statusCode", "status_code"]) || textFailure.errorCode;
  const parts = [errorMsg, failStarlingMessage].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index);
  if (parts.length === 0) return "";
  const codeSuffix = errorCode ? `（code ${errorCode}）` : "";
  return `Dreamina Web 视频任务失败：${parts.join(" / ")}${codeSuffix}`;
}

function extractCanvasVideoProviderFailureFromText(raw: unknown): { errorMsg?: string; failStarlingMessage?: string; errorCode?: string } {
  const strings = deepObjectValues(raw).filter((value): value is string => typeof value === "string");
  for (const text of strings) {
    if (!/errorMsg|error_msg|failStarlingMessage|fail_starling_message|statusCode|status_code|errorCode|error_code/.test(text)) continue;
    const errorMsg = extractJsonStringField(text, "errorMsg") || extractJsonStringField(text, "error_msg");
    const failStarlingMessage = extractJsonStringField(text, "failStarlingMessage") || extractJsonStringField(text, "fail_starling_message");
    const errorCode = extractJsonScalarField(text, "errorCode") || extractJsonScalarField(text, "error_code") || extractJsonScalarField(text, "statusCode") || extractJsonScalarField(text, "status_code");
    if (errorMsg || failStarlingMessage) return { errorMsg, failStarlingMessage, errorCode };
  }
  return {};
}

function extractJsonStringField(text: string, field: string): string | undefined {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`"${escapedField}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i"));
  if (!match?.[1]) return undefined;
  return match[1].replace(/\\"/g, "\"").replace(/\\\\/g, "\\").trim() || undefined;
}

function extractJsonScalarField(text: string, field: string): string | undefined {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`"${escapedField}"\\s*:\\s*("?)(-?\\d+|[A-Za-z0-9_-]+)\\1`, "i"));
  return match?.[2]?.trim() || undefined;
}

function expandCanvasVideoRawSummaries(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const summary = stringFrom(raw.summary, "");
  const parsedSummary = summary ? parseJsonObject(summary) : null;
  const result = isRecord(raw.result) ? raw.result : null;
  const resultSummary = stringFrom(result?.summary, "");
  const parsedResultSummary = resultSummary ? parseJsonObject(resultSummary) : null;
  return {
    ...raw,
    ...(parsedSummary ? { parsedSummary } : {}),
    ...(result ? {
      result: {
        ...result,
        ...(parsedResultSummary ? { parsedSummary: parsedResultSummary } : {}),
      },
    } : {}),
  };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function findDeepScalarStringValue(value: unknown, keys: string[]): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDeepScalarStringValue(item, keys);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    const found = value[key];
    if (typeof found === "string" && found.trim()) return found.trim();
    if (typeof found === "number" && Number.isFinite(found)) return String(found);
  }
  for (const item of Object.values(value)) {
    const found = findDeepScalarStringValue(item, keys);
    if (found) return found;
  }
  return undefined;
}

function dreaminaWebMissingSubmitIdFailureMessage(): string {
  return "Dreamina Web 视频任务未成功提交：上传/提交/查询超时，未拿到 submit_id；Dreamina 后台没有可查询任务，请重新预检后再生成。";
}

async function expireStaleImageGenerations(projectId: string, userId: string) {
  const cutoff = new Date(Date.now() - IMAGE_GENERATION_RUNNING_TTL_MS);
  await prisma.generation.updateMany({
    where: {
      projectId,
      userId,
      status: "RUNNING",
      startedAt: { lt: cutoff },
      OR: [
        { input: { path: ["kind"], equals: "canvas-image-generation" } },
        { input: { path: ["kind"], equals: "workflow-asset-image" } },
        { input: { path: ["kind"], equals: "workflow-asset-image-generation" } },
      ],
    },
    data: {
      status: "FAILED",
      errorMessage: "图片生成请求已超过后台等待时间，已自动清理。若稍后生成记录里出现成功图片，画布会自动恢复结果。",
      completedAt: new Date(),
    },
  });
}

async function expireStaleVideoGenerations(projectId: string, userId: string) {
  const cutoff = new Date(Date.now() - dreaminaVideoRunningTtlMs());
  await prisma.generation.updateMany({
    where: {
      projectId,
      userId,
      status: "RUNNING",
      startedAt: { lt: cutoff },
      input: { path: ["kind"], equals: "canvas-video-generation" },
    },
    data: {
      status: "FAILED",
      errorMessage: "视频生成请求已超过后台等待时间，已自动清理。若第三方稍后完成，请使用 submit_id 查询；没有 submit_id 的任务通常未成功提交。",
      completedAt: new Date(),
    },
  });
}

function dreaminaVideoRunningTtlMs(): number {
  const configured = Number(process.env.DREAMINA_WEB_VIDEO_RUNNING_TTL_MS);
  if (Number.isFinite(configured) && configured >= 60_000) return Math.floor(configured);
  return 8 * 60 * 1000;
}

function formatImageGenerationFailure(error: unknown, fallback: string): string {
  const rawMessage = rawImageGenerationMessage(error);
  const lower = rawMessage.toLowerCase();

  if (lower.includes("failed to acquire user concurrency slot")) {
    return "图片上游并发额度占用中，请等待当前生成完成后再重试。";
  }
  if (lower.includes("upstream failover exhausted") || (lower.includes("502") && lower.includes("failover"))) {
    return "图片上游服务临时失败（502/failover）。请稍后重试；如果是导演板，建议缩短提示词或减少参考图数量。";
  }
  if (
    lower.includes("bad gateway") ||
    lower.includes("<!doctype html") ||
    lower.includes("<html") ||
    lower.includes("cloudflare") ||
    lower.includes("502")
  ) {
    return "图片上游服务临时失败（502/Bad Gateway）。请稍后重试；如果是多参考图或 2K 导演板，建议缩短提示词或减少参考图数量。";
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return "图片生成等待超时。请缩短提示词、减少参考图，或稍后重试。";
  }
  if (lower === "terminated" || lower.includes("terminated")) {
    return "图片上游连接被中途断开。通常是中转站或上游在长时间 2K/多参考图生成时关闭了响应流；请求已到后端，请稍后重试，或先减少参考图/降低分辨率确认通道稳定性。";
  }
  if (lower.includes("failed to fetch") || lower.includes("fetch failed") || lower.includes("network")) {
    return "图片上游连接失败，请稍后重试。";
  }

  return rawMessage || fallback;
}

function rawImageGenerationMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

function normalizeCanvasImageGenerationPrompt(prompt: string, metadata: unknown): string {
  const text = prompt.trim();
  const record = isRecord(metadata) ? metadata : {};
  const clipNodeKind = stringFrom(record.clipNodeKind, "");
  const isPositioningBoardRequest =
    record.positioningBoardFlow === true ||
    record.positioningBoardForClip === true ||
    clipNodeKind === "positioning-board" ||
    clipNodeKind === "positioning-board-reference" ||
    stringFrom(record.assetKind, "") === "positioning-board";
  const positioningBoardMode = stringFrom(record.positioningBoardMode, "");
  const isStoryboardRequest =
    positioningBoardMode === "storyboard" ||
    record.storyboardForClip === true ||
    clipNodeKind === "storyboard" ||
    /storyboard|director board|production board|分镜|故事板|导演板|technical label strip|Technical labels under each panel/i.test(text);
  if (!isStoryboardRequest) {
    if (isPositioningBoardRequest) return normalizePositioningBoardImagePrompt(text);
    return text;
  }
  const panelCount = numberFrom(record.storyboardPanelCount, numberFrom(record.panelCount, 0));
  return finalizeClipStoryboardImagePrompt(text, panelCount || undefined);
}

function normalizePositioningBoardImagePrompt(prompt: string): string {
  return stripComicStoryboardLayoutPrompt(stripLegacyClipStoryboardImageLayoutPrompt(prompt))
    .replace(/\bShow spoken dialogue as clean white comic speech bubbles[^.\n]*[.\n]?/gi, "")
    .replace(/\bPlace each exact dialogue line in one speech bubble[^.\n]*[.\n]?/gi, "")
    .replace(/\bVisible text stays to panel labels and speech bubbles\.[ \t]*/gi, "")
    .replace(/\bPlace a small readable panel number label[^.\n]*[.\n]?/gi, "")
    .replace(/\bUse a full-page comic grid[^.\n]*[.\n]?/gi, "")
    .replace(/\bEach panel should contain[^.\n]*[.\n]?/gi, "")
    .replace(/\bFavor medium close-ups[^.\n]*[.\n]?/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function logRawImageGenerationFailure(generationId: string, error: unknown, userMessage: string) {
  const rawMessage = rawImageGenerationMessage(error);
  if (rawMessage && rawMessage !== userMessage) {
    console.warn(`[image-generation] generation=${generationId || "uncreated"} raw_error=${rawMessage}`);
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function defaultStageStatuses() {
  return {
    source: "idle",
    assets: "idle",
    storyboard: "idle",
    video: "idle",
    voice: "idle",
    preview: "idle",
    edit: "idle",
  };
}

function generationReferenceUrls(input: unknown, parameters: unknown, key: "referenceImageUrls" | "referenceAudioUrls", fallback: string[]): string[] {
  const inputRecord = isRecord(input) ? input : {};
  const parameterRecord = isRecord(parameters) ? parameters : {};
  const candidates = [inputRecord[key], parameterRecord[key]];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const urls = candidate
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => /^https?:\/\//i.test(item));
    if (urls.length > 0) return Array.from(new Set(urls));
  }
  return fallback;
}

function mergeCanvasVideoQueryRaw(parameters: unknown, queryRaw: unknown): unknown {
  const existingParameters = isRecord(parameters) ? parameters : {};
  const existingRaw = isRecord(existingParameters.raw) ? existingParameters.raw : {};
  if (Object.keys(existingRaw).length === 0) return queryRaw;
  return {
    ...existingRaw,
    latestQueryRaw: queryRaw,
  };
}

function dreaminaExistingVideoUrlsFromRaw(raw: unknown): string[] {
  const urls = new Set<string>();
  const visit = (value: unknown, depth = 0) => {
    if (depth > 8 || value === null || value === undefined) return;
    if (typeof value === "string") {
      for (const match of value.matchAll(/https?:\/\/[^\s"'\\]+/g)) {
        const url = match[0];
        if (isDreaminaGeneratedVideoUrlString(url)) urls.add(url);
      }
      if ((value.trim().startsWith("{") || value.trim().startsWith("[")) && value.length < 120_000) {
        try {
          visit(JSON.parse(value), depth + 1);
        } catch {
          // Keep scanning the raw string.
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (isRecord(value)) {
      for (const item of Object.values(value)) visit(item, depth + 1);
    }
  };
  visit(raw);
  return Array.from(urls);
}

function isDreaminaGeneratedVideoUrlString(value: string): boolean {
  const decoded = decodeURIComponent(value).toLowerCase();
  if (/mime_type=(audio|image)[_/]/i.test(decoded)) return false;
  if (/\.(wav|mp3|m4a|aac|ogg|png|jpe?g|webp|gif)(?:[?#]|$)/i.test(decoded)) return false;
  return /\.(mp4|mov|webm)(?:[?#]|$)/i.test(decoded) || /mime_type=video|\/video\/|tos|capcut|byte/i.test(decoded);
}

function arrayFrom(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringFrom(value: unknown, fallback: string): string;
function stringFrom(value: unknown, fallback: undefined): string | undefined;
function stringFrom(value: unknown, fallback: string | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberFrom(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(15, number)) : fallback;
}

function normalizeRole(value: string) {
  const upper = value.toUpperCase();
  if (upper === "PROTAGONIST" || upper === "SUPPORTING" || upper === "BACKGROUND") return upper;
  return "SUPPORTING";
}

function slugId(prefix: string, value: string, index: number) {
  return `${prefix}-${index + 1}-${value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "item"}`;
}

export const workflowsRouter = router;

export const workflowsTestInternals = {
  buildBreakdownPrompt,
  buildClipSeedancePromptRefinementPrompt,
  buildClipPreflight,
  buildWorkflowAssetImagePromptForTest: buildWorkflowAssetImagePrompt,
  sceneVisualConflictWarningForTest: sceneVisualConflictWarning,
  buildStoryboardOnlyPrompt,
  buildClipStateLedgerText,
  buildShotOrderVideoBeats,
  cleanOptimizedPrompt,
  canvasVideoResultFailureMessage,
  clampShotDuration,
  clipStoryboardDialogueLockLines,
  compactWorkflowVideoPromptLine,
  composeSeedancePrompt,
  deriveWorkflowClipsFromShots,
  dreaminaExistingVideoUrlsFromRaw,
  enforceShotCameraPlansInVideoPrompt,
  extractVideoBeatLabels,
  finalizeWorkflowVideoPrompt,
  formatDreaminaGenerationFailure,
  formatStoryboardVideoBeats,
  getWorkflowState,
  missingPreservedDialogueFragments,
  mergeExtractedAssetsWithProjectMemory,
  normalizeBreakdown,
  normalizeFragmentedStoryboardDialogue,
  normalizeWorkflowAssets,
  normalizeCanvasVideoRatio,
  rebalanceStoryboardPacing,
  regenerateWorkflowClipSeedancePrompt,
  resolveWorkflowEpisodeId,
  sourceDialogueLockLines,
  unwrapJsonWrappedPromptText,
  workflowClipContext,
  workflowAssetHistoryRecordsForAsset,
  workflowAssetCurrentRecordFilters,
  mergeAssetRecordsById,
  workflowAssetsWithSceneVisualBiblesForStoryboard,
  workflowBreakdownScenesFromNormalizedStoryboard,
  writeWorkflowEpisode,
};

export const workflowMaintenanceInternals = {
  deriveWorkflowClipsFromShots,
  getWorkflowState,
  regenerateWorkflowClipSeedancePrompt,
  writeWorkflowEpisode,
};
