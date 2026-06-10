import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../lib/asyncRoute";
import { badRequest, notFound, routeParam } from "../lib/httpErrors";
import { prisma } from "../lib/prisma";
import { created, ok } from "../lib/response";
import { requireAuth } from "../middleware/auth";

const router = Router();

const generationSchema = z.object({
  projectId: z.string(),
  sceneId: z.string().optional(),
  characterId: z.string().optional(),
  aiModelId: z.string().optional(),
  prompt: z.string().min(1).max(20000),
  negativePrompt: z.string().max(12000).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  creditCost: z.number().int().min(0).optional(),
});

router.use(requireAuth);

router.get(
  "/",
  asyncRoute(async (req, res) => {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
    const requestedLimit = Number(req.query.limit);
    const take = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(300, Math.floor(requestedLimit))) : 100;
    const compact = req.query.compact === "1" || req.query.compact === "true";
    const generations = await prisma.generation.findMany({
      where: {
        userId: req.user!.id,
        ...(projectId ? { projectId } : {}),
      },
      include: generationIncludeActiveAssets(),
      orderBy: { createdAt: "desc" },
      take,
    });
    ok(res, generations.map(compact ? serializeCompactGeneration : serializeGeneration));
  }),
);

router.post(
  "/",
  asyncRoute(async (req, res) => {
    const input = generationSchema.parse(req.body);
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, ownerId: req.user!.id, deletedAt: null },
    });
    if (!project) notFound("Project not found");

    const aiModel = input.aiModelId
      ? await prisma.aiModel.findFirst({
          where: { id: input.aiModelId, isActive: true },
          include: { providerConfig: true },
        })
      : null;
    if (input.aiModelId && !aiModel) {
      badRequest("AI model not found or disabled");
    }

    if (input.sceneId) {
      const scene = await prisma.scene.findFirst({
        where: { id: input.sceneId, projectId: project.id, deletedAt: null },
        select: { id: true },
      });
      if (!scene) badRequest("Scene does not belong to this project");
    }

    if (input.characterId) {
      const character = await prisma.character.findFirst({
        where: { id: input.characterId, projectId: project.id, deletedAt: null },
        select: { id: true },
      });
      if (!character) badRequest("Character does not belong to this project");
    }

    const generationInput = {
      ...(input.input ?? {}),
      ...(aiModel ? { modelSnapshot: toModelSnapshot(aiModel) } : {}),
    };

    const generation = await prisma.generation.create({
      data: {
        projectId: input.projectId,
        userId: req.user!.id,
        sceneId: input.sceneId,
        characterId: input.characterId,
        aiModelId: input.aiModelId,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        input: generationInput,
        parameters: input.parameters ?? {},
        creditCost: input.creditCost ?? aiModel?.costCredits ?? 0,
        status: "QUEUED",
      },
      include: generationIncludeActiveAssets(),
    });
    created(res, serializeGeneration(generation));
  }),
);

router.get(
  "/:generationId",
  asyncRoute(async (req, res) => {
    const generation = await prisma.generation.findFirst({
      where: { id: routeParam(req.params.generationId, "generationId"), userId: req.user!.id },
      include: generationIncludeActiveAssets(),
    });
    if (!generation) notFound("Generation not found");
    ok(res, serializeGeneration(generation));
  }),
);

router.patch(
  "/:generationId",
  asyncRoute(async (req, res) => {
    const generationId = routeParam(req.params.generationId, "generationId");
    const generation = await prisma.generation.findFirst({
      where: { id: generationId, userId: req.user!.id },
    });
    if (!generation) notFound("Generation not found");

    const input = z
      .object({
        status: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]).optional(),
        providerJobId: z.string().optional().nullable(),
        errorMessage: z.string().optional().nullable(),
        input: z.record(z.string(), z.unknown()).optional(),
        parameters: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(req.body);

    const updated = await prisma.generation.update({
      where: { id: generationId },
      data: input,
      include: generationIncludeActiveAssets(),
    });
    ok(res, serializeGeneration(updated));
  }),
);

router.post(
  "/:generationId/retry",
  asyncRoute(async (req, res) => {
    const generation = await prisma.generation.findFirst({
      where: { id: routeParam(req.params.generationId, "generationId"), userId: req.user!.id },
    });
    if (!generation) notFound("Generation not found");
    const updated = await prisma.generation.update({
      where: { id: generation.id },
      data: { status: "QUEUED", errorMessage: null, queuedAt: new Date(), startedAt: null, completedAt: null },
      include: generationIncludeActiveAssets(),
    });
    ok(res, serializeGeneration(updated));
  }),
);

router.delete(
  "/:generationId",
  asyncRoute(async (req, res) => {
    const generation = await prisma.generation.findFirst({
      where: { id: routeParam(req.params.generationId, "generationId"), userId: req.user!.id },
    });
    if (!generation) notFound("Generation not found");
    await prisma.generation.update({
      where: { id: generation.id },
      data: { status: "CANCELED" },
    });
    ok(res, { deleted: true });
  }),
);

export const generationsRouter = router;

function generationIncludeActiveAssets() {
  return {
    assets: { where: { deletedAt: null } },
    aiModel: { include: { providerConfig: true } },
  } as const;
}

function serializeGeneration(generation: GenerationWithRelations) {
  return {
    id: generation.id,
    projectId: generation.projectId,
    userId: generation.userId,
    aiModelId: generation.aiModelId,
    stylePresetId: generation.stylePresetId,
    sceneId: generation.sceneId,
    characterId: generation.characterId,
    prompt: generation.prompt,
    negativePrompt: generation.negativePrompt,
    input: generation.input,
    parameters: generation.parameters,
    status: generation.status,
    providerJobId: generation.providerJobId,
    errorMessage: generation.errorMessage,
    creditCost: generation.creditCost,
    queuedAt: generation.queuedAt,
    startedAt: generation.startedAt,
    completedAt: generation.completedAt,
    createdAt: generation.createdAt,
    updatedAt: generation.updatedAt,
    assets: generation.assets,
    aiModel: generation.aiModel ? serializeGenerationModel(generation.aiModel) : null,
  };
}

function serializeCompactGeneration(generation: GenerationWithRelations) {
  const input = isRecord(generation.input) ? generation.input : {};
  const parameters = isRecord(generation.parameters) ? generation.parameters : {};
  return {
    id: generation.id,
    projectId: generation.projectId,
    aiModelId: generation.aiModelId,
    prompt: generation.prompt,
    input: compactGenerationPayload(input),
    parameters: compactGenerationPayload(parameters),
    status: generation.status,
    errorMessage: generation.errorMessage,
    creditCost: generation.creditCost,
    queuedAt: generation.queuedAt,
    startedAt: generation.startedAt,
    completedAt: generation.completedAt,
    createdAt: generation.createdAt,
    updatedAt: generation.updatedAt,
    assets: Array.isArray(generation.assets) ? generation.assets.map(serializeCompactGenerationAsset) : [],
    aiModel: generation.aiModel ? serializeCompactGenerationModel(generation.aiModel) : null,
  };
}

function serializeCompactGenerationAsset(asset: unknown) {
  if (!isRecord(asset)) return asset;
  const url = typeof asset.url === "string" && shouldIncludeCompactAssetUrl(asset.url) ? asset.url : undefined;
  return {
    id: asset.id,
    type: asset.type,
    title: asset.title,
    url,
    mimeType: asset.mimeType,
    metadata: compactAssetMetadata(asset.metadata),
    createdAt: asset.createdAt,
  };
}

function shouldIncludeCompactAssetUrl(url: string): boolean {
  if (!url) return false;
  if (/^data:image\//i.test(url)) return url.length <= 12000;
  return true;
}

function compactCanvasMetadata(value: unknown) {
  if (!isRecord(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const key of [
    "source",
    "workflowAssetKind",
    "assetKind",
    "assetName",
    "variant",
    "size",
    "resolution",
    "quality",
    "revisedPrompt",
    "clipId",
    "clipTitle",
    "clipNodeKind",
    "storyboardForClip",
    "previousStoryboardAssetId",
    "nodeId",
    "requestId",
    "sourceEpisode",
    "sourceEpisodeId",
  ]) {
    if (key in value) result[key] = value[key];
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function compactAssetMetadata(value: unknown) {
  return compactCanvasMetadata(value);
}

function compactGenerationPayload(value: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const key of ["kind", "assetKind", "assetName", "variant", "size", "referenceImageUrls", "referenceAssetIds", "modelSnapshot"]) {
    if (key in value) result[key] = value[key];
  }
  if (typeof value.resolution === "string") result.resolution = value.resolution;
  if (typeof value.quality === "string") result.quality = value.quality;
  if (typeof value.format === "string") result.format = value.format;
  if (Array.isArray(value.image_urls)) result.image_urls = value.image_urls;
  if (isRecord(value.parameters)) {
    result.parameters = compactGenerationPayload(value.parameters);
  }
  const metadata = compactCanvasMetadata(value.metadata);
  if (metadata) result.metadata = metadata;
  return result;
}

function serializeCompactGenerationModel(model: GenerationModelWithProvider) {
  return {
    id: model.id,
    provider: model.providerConfig?.providerType ?? model.provider,
    model: model.model,
    displayName: model.displayName,
    modality: model.modality,
    costCredits: model.costCredits,
    providerConfig: model.providerConfig
      ? {
          displayName: model.providerConfig.displayName,
          providerType: model.providerConfig.providerType,
        }
      : null,
  };
}

function serializeGenerationModel(model: GenerationModelWithProvider) {
  return {
    id: model.id,
    providerConfigId: model.providerConfigId,
    provider: model.providerConfig?.providerType ?? model.provider,
    model: model.model,
    displayName: model.displayName,
    modality: model.modality,
    capabilities: model.capabilities,
    defaultParams: model.defaultParams,
    costCredits: model.costCredits,
    isActive: model.isActive,
    providerConfig: model.providerConfig
      ? {
          id: model.providerConfig.id,
          displayName: model.providerConfig.displayName,
          providerType: model.providerConfig.providerType,
          baseUrl: model.providerConfig.baseUrl,
          isActive: model.providerConfig.isActive,
        }
      : null,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toModelSnapshot(model: {
  id: string;
  providerConfigId: string | null;
  provider: string;
  model: string;
  displayName: string;
  modality: string;
  defaultParams: unknown;
  costCredits: number;
  providerConfig?: {
    id: string;
    displayName: string;
    providerType: string;
    baseUrl: string | null;
  } | null;
}) {
  return {
    id: model.id,
    providerConfigId: model.providerConfigId,
    provider: model.providerConfig?.providerType ?? model.provider,
    model: model.model,
    displayName: model.displayName,
    modality: model.modality,
    defaultParams: model.defaultParams,
    costCredits: model.costCredits,
    providerConfig: model.providerConfig
      ? {
          id: model.providerConfig.id,
          displayName: model.providerConfig.displayName,
          providerType: model.providerConfig.providerType,
          baseUrl: model.providerConfig.baseUrl,
        }
      : null,
  };
}

interface GenerationWithRelations {
  id: string;
  projectId: string;
  userId: string;
  aiModelId: string | null;
  stylePresetId: string | null;
  sceneId: string | null;
  characterId: string | null;
  prompt: string;
  negativePrompt: string | null;
  input: unknown;
  parameters: unknown;
  status: string;
  providerJobId: string | null;
  errorMessage: string | null;
  creditCost: number;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  assets: unknown[];
  aiModel?: GenerationModelWithProvider | null;
}

interface GenerationModelWithProvider {
  id: string;
  providerConfigId: string | null;
  provider: string;
  model: string;
  displayName: string;
  modality: string;
  capabilities: unknown;
  defaultParams: unknown;
  costCredits: number;
  isActive: boolean;
  providerConfig?: {
    id: string;
    displayName: string;
    providerType: string;
    baseUrl: string | null;
    isActive: boolean;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}
