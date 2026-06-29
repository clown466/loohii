import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { callConfiguredVisionTextModel } from "../ai/textModel";
import { asyncRoute } from "../lib/asyncRoute";
import { applyWorkflowAssetImageToCanvasScenes, canvasSyncableImageUrl, fillMissingAssetImageAcrossEpisodes } from "../lib/canvasAssetImageSync";
import { badRequest, notFound, routeParam } from "../lib/httpErrors";
import { isRecord } from "../lib/mappers";
import { prisma } from "../lib/prisma";
import { created, ok } from "../lib/response";
import { requireAuth } from "../middleware/auth";

const router = Router();
const CHARACTER_TRAIT_TEXT_MAX_CHARS = 600;
const COMPACT_CHARACTER_TRAIT_KEYS = new Set([
  "visualAuthority",
  "referenceImageAssetId",
  "referenceImageUrl",
  "referenceImageUploadedAt",
  "referenceAudioAssetId",
  "referenceAudioUrl",
  "referenceAudioUploadedAt",
  "voiceReferenceStatus",
  "voiceReferenceFileName",
  "voiceReferenceMimeType",
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
  "colorPalette",
  "lockedVisualIdentity",
  "referencePolicy",
  "imageAnalysis",
  "imageAnalysisError",
]);

const characterSchema = z.object({
  name: z.string().min(1).max(120),
  role: z.enum(["PROTAGONIST", "SUPPORTING", "BACKGROUND"]).optional(),
  bio: z.string().max(4000).optional(),
  prompt: z.string().max(12000).optional(),
  traits: z.record(z.string(), z.unknown()).optional(),
  position: z.record(z.string(), z.unknown()).optional(),
});

const characterReferenceImageSchema = z
  .object({
    episodeId: z.string().max(180).optional(),
    characterName: z.string().min(1).max(120),
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

const characterReferenceAudioSchema = z.object({
  episodeId: z.string().max(180).optional(),
  characterName: z.string().min(1).max(120),
  audioUrl: z.string().min(8).max(12000),
  fileName: z.string().max(240).optional(),
  mimeType: z.string().max(120).optional(),
  sizeBytes: z.number().int().min(0).max(60_000_000).optional(),
});

const clearCharacterReferenceAudioSchema = z.object({
  episodeId: z.string().max(180).optional(),
  characterName: z.string().min(1).max(120),
});

const episodeQuerySchema = z.object({
  episodeId: z.string().max(180).optional(),
});

router.use(requireAuth);

router.get(
  "/projects/:projectId/characters",
  asyncRoute(async (req, res) => {
    const projectId = routeParam(req.params.projectId, "projectId");
    await assertProjectExists(projectId, req.user!.id);
    const characters = await prisma.character.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      include: { assets: { where: { deletedAt: null }, take: 8, orderBy: { createdAt: "desc" } } },
    });
    ok(res, characters);
  }),
);

router.post(
  "/projects/:projectId/characters",
  asyncRoute(async (req, res) => {
    const projectId = routeParam(req.params.projectId, "projectId");
    await assertProjectExists(projectId, req.user!.id);
    const input = characterSchema.parse(req.body);
    const character = await prisma.character.create({
      data: {
        projectId,
        createdById: req.user!.id,
        name: input.name,
        role: input.role ?? "SUPPORTING",
        bio: input.bio,
        prompt: input.prompt,
        traits: input.traits ?? {},
        position: input.position ?? {},
      },
    });
    created(res, character);
  }),
);

router.post(
  "/projects/:projectId/characters/reference-image",
  asyncRoute(async (req, res) => {
    const projectId = routeParam(req.params.projectId, "projectId");
    const project = await assertProject(projectId, req.user!.id);
    const query = episodeQuerySchema.parse(req.query);
    const input = characterReferenceImageSchema.parse(req.body);
    const requestEpisodeId = resolveWorkflowEpisodeId(project.metadata, input.episodeId || query.episodeId || "");
    const characterName = input.characterName.trim();
    const imageUrl = input.imageUrl || input.imageDataUrl;
    if (!imageUrl) badRequest("imageDataUrl or imageUrl is required");

    const existing = await prisma.character.findFirst({
      where: { projectId, deletedAt: null, name: { equals: characterName, mode: "insensitive" } },
    });
    const baseTraits = compactCharacterTraits(existing?.traits);
    const character =
      existing ??
      (await prisma.character.create({
        data: {
          projectId,
          createdById: req.user!.id,
          name: characterName,
          role: "SUPPORTING",
          traits: {},
          position: {},
        },
      }));

    const asset = await prisma.asset.create({
      data: {
        projectId,
        uploadedById: req.user!.id,
        characterId: character.id,
        type: "IMAGE",
        title: input.fileName || `${characterName} reference image`,
        url: imageUrl,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        metadata: {
          source: "character-reference-upload",
          characterName,
          analysisStatus: "pending",
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
              "You analyze uploaded character reference images for an AI animation studio. Return only valid JSON. Keep character facts concise and treat the image as visual authority.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: buildReferenceImageAnalysisPrompt(project, characterName, character, baseTraits),
              },
              {
                type: "image_url",
                image_url: { url: imageUrl },
              },
            ],
          },
        ],
        input.aiModelId,
      );
      analysis = normalizeReferenceImageAnalysis(result.rawText);
    } catch (error) {
      analysisError = error instanceof Error ? error.message : "角色图片识别失败";
    }

    const nextTraits = {
      ...baseTraits,
      visualAuthority: "uploaded-reference-image",
      referenceImageAssetId: asset.id,
      ...(compactUrlForStorage(imageUrl) ? { referenceImageUrl: compactUrlForStorage(imageUrl) } : {}),
      referenceImageUploadedAt: new Date().toISOString(),
      ...(analysis?.fruitIdentity ? { fruitIdentity: analysis.fruitIdentity } : {}),
      ...(analysis?.lockedVisualIdentity ? { lockedVisualIdentity: analysis.lockedVisualIdentity } : {}),
      ...(analysis?.referencePolicy ? { referencePolicy: analysis.referencePolicy } : {}),
      ...(analysis ? { imageAnalysis: analysis } : {}),
      ...(analysisError ? { imageAnalysisError: analysisError } : {}),
    };

    const updatedCharacter = await prisma.character.update({
      where: { id: character.id },
      data: {
        bio: typeof analysis?.description === "string" && analysis.description.trim() ? analysis.description : character.bio,
        prompt:
          typeof analysis?.lockedVisualIdentity === "string" && analysis.lockedVisualIdentity.trim()
            ? analysis.lockedVisualIdentity
            : typeof analysis?.visualPrompt === "string" && analysis.visualPrompt.trim()
              ? analysis.visualPrompt
              : character.prompt,
        traits: nextTraits,
      },
      include: { assets: { where: { deletedAt: null }, take: 8, orderBy: { createdAt: "desc" } } },
    });

    const updatedAsset = await prisma.asset.update({
      where: { id: asset.id },
      data: {
        metadata: {
          source: "character-reference-upload",
          characterName,
          analysisStatus: analysis ? "succeeded" : "failed",
          analysis,
          analysisError,
        },
      },
    });
    const workflow = await syncWorkflowCharacterReference(project, updatedCharacter, updatedAsset, analysis, analysisError, requestEpisodeId);

    ok(res, {
      character: updatedCharacter,
      asset: updatedAsset,
      analysis,
      analysisError,
      workflow,
    });
  }),
);

router.post(
  "/projects/:projectId/characters/reference-audio",
  asyncRoute(async (req, res) => {
    const projectId = routeParam(req.params.projectId, "projectId");
    const project = await assertProject(projectId, req.user!.id);
    const query = episodeQuerySchema.parse(req.query);
    const input = characterReferenceAudioSchema.parse(req.body);
    const requestEpisodeId = resolveWorkflowEpisodeId(project.metadata, input.episodeId || query.episodeId || "");
    const characterName = input.characterName.trim();
    const audioUrl = input.audioUrl.trim();
    if (!/^https?:\/\//i.test(audioUrl) && !/^\/api\/uploads\/public\//i.test(audioUrl)) {
      badRequest("audioUrl must be a public upload URL.");
    }

    const existing = await prisma.character.findFirst({
      where: { projectId, deletedAt: null, name: { equals: characterName, mode: "insensitive" } },
    });
    const baseTraits = compactCharacterTraits(existing?.traits);
    const character =
      existing ??
      (await prisma.character.create({
        data: {
          projectId,
          createdById: req.user!.id,
          name: characterName,
          role: "SUPPORTING",
          traits: {},
          position: {},
        },
      }));

    const asset = await prisma.asset.create({
      data: {
        projectId,
        uploadedById: req.user!.id,
        characterId: character.id,
        type: "AUDIO",
        title: input.fileName || `${characterName} voice reference`,
        url: audioUrl,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        metadata: {
          source: "character-reference-audio-upload",
          characterName,
        },
      },
    });

    const nextTraits = {
      ...baseTraits,
      referenceAudioAssetId: asset.id,
      ...(compactUrlForStorage(audioUrl) ? { referenceAudioUrl: compactUrlForStorage(audioUrl) } : {}),
      referenceAudioUploadedAt: new Date().toISOString(),
      voiceReferenceStatus: "ready",
      ...(input.fileName ? { voiceReferenceFileName: compactTraitText(input.fileName) } : {}),
      ...(input.mimeType ? { voiceReferenceMimeType: compactTraitText(input.mimeType) } : {}),
    };

    const updatedCharacter = await prisma.character.update({
      where: { id: character.id },
      data: { traits: nextTraits },
      include: { assets: { where: { deletedAt: null }, take: 8, orderBy: { createdAt: "desc" } } },
    });
    const workflow = await syncWorkflowCharacterAudioReference(project, updatedCharacter, asset, requestEpisodeId);

    ok(res, {
      character: updatedCharacter,
      asset,
      workflow,
    });
  }),
);

router.delete(
  "/projects/:projectId/characters/reference-audio",
  asyncRoute(async (req, res) => {
    const projectId = routeParam(req.params.projectId, "projectId");
    const project = await assertProject(projectId, req.user!.id);
    const query = episodeQuerySchema.parse(req.query);
    const input = clearCharacterReferenceAudioSchema.parse(req.body);
    const requestEpisodeId = resolveWorkflowEpisodeId(project.metadata, input.episodeId || query.episodeId || "");
    const characterName = input.characterName.trim();

    const existing = await prisma.character.findFirst({
      where: { projectId, deletedAt: null, name: { equals: characterName, mode: "insensitive" } },
    });
    if (!existing) notFound("Character not found");

    const updatedCharacter = await prisma.character.update({
      where: { id: existing.id },
      data: { traits: clearCharacterAudioTraitFields(compactCharacterTraits(existing.traits)) },
      include: { assets: { where: { deletedAt: null }, take: 8, orderBy: { createdAt: "desc" } } },
    });
    const workflow = await clearWorkflowCharacterAudioReference(project, updatedCharacter, requestEpisodeId);

    ok(res, {
      character: updatedCharacter,
      workflow,
      cleared: true,
    });
  }),
);

router.get(
  "/characters/:characterId",
  asyncRoute(async (req, res) => {
    const character = await findOwnedCharacter(routeParam(req.params.characterId, "characterId"), req.user!.id);
    ok(res, character);
  }),
);

router.patch(
  "/characters/:characterId",
  asyncRoute(async (req, res) => {
    const character = await findOwnedCharacter(routeParam(req.params.characterId, "characterId"), req.user!.id);
    const input = characterSchema.partial().parse(req.body);
    const updated = await prisma.character.update({ where: { id: character.id }, data: input });
    ok(res, updated);
  }),
);

router.delete(
  "/characters/:characterId",
  asyncRoute(async (req, res) => {
    const character = await findOwnedCharacter(routeParam(req.params.characterId, "characterId"), req.user!.id);
    await prisma.character.update({ where: { id: character.id }, data: { deletedAt: new Date() } });
    ok(res, { deleted: true });
  }),
);

async function assertProject(projectId: string, ownerId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } });
  if (!project) notFound("Project not found");
  return project;
}

async function assertProjectExists(projectId: string, ownerId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId, deletedAt: null },
    select: { id: true },
  });
  if (!project) notFound("Project not found");
  return project;
}

async function findOwnedCharacter(characterId: string, ownerId: string) {
  const character = await prisma.character.findFirst({
    where: { id: characterId, deletedAt: null, project: { ownerId, deletedAt: null } },
  });
  if (!character) notFound("Character not found");
  return character;
}

export const charactersRouter = router;

function buildReferenceImageAnalysisPrompt(project: any, characterName: string, character: any, traits: Record<string, unknown>): string {
  const settings = isRecord(project.settings) ? project.settings : {};
  const setupSettings = isRecord(settings.setupSettings) ? settings.setupSettings : {};
  const characterIdentityRules = stringFrom(setupSettings.characterIdentityRules, firstLineAfterLabel(stringFrom(settings.globalPrompt, ""), "Character identity rules:") ?? "");
  return [
    `Project title: ${project.name}`,
    `Project description: ${project.description ?? ""}`,
    `Project global prompt: ${stringFrom(settings.globalPrompt, "")}`,
    characterIdentityRules ? `Character identity rules: ${characterIdentityRules}` : "",
    `Character name: ${characterName}`,
    `Existing bio: ${character.bio ?? ""}`,
    `Existing prompt: ${character.prompt ?? ""}`,
    `Existing traits: ${JSON.stringify(compactCharacterTraits(traits)).slice(0, 3000)}`,
    "",
    "Return this exact JSON shape:",
    `{"description":"short role/appearance summary","visualPrompt":"short generation prompt","fruitIdentity":"specific fruit/species/type or empty","lockedVisualIdentity":"short immutable image-based identity","referencePolicy":"how future prompts should refer to this character","facts":["short visual facts"]}`,
    "",
    "Rules:",
    "- The uploaded image is the visual authority for this character.",
    "- Do not invent unconfirmed hair, clothing, props, fruit/species, or accessories.",
    "- If the project Character identity rules require a fruit/species/type identity, infer the most likely one from the image and state it in fruitIdentity.",
    "- lockedVisualIdentity must be short: character name + most important image-visible identity facts only.",
    "- referencePolicy must tell later prompts to use the uploaded image and lockedVisualIdentity, and not contradict them.",
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeReferenceImageAnalysis(rawText: string): Record<string, unknown> {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("识图模型没有返回 JSON。");
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  }
  if (!isRecord(parsed)) throw new Error("识图模型返回 JSON 不是对象。");
  return {
    description: stringFrom(parsed.description, ""),
    visualPrompt: stringFrom(parsed.visualPrompt ?? parsed.prompt, ""),
    fruitIdentity: stringFrom(parsed.fruitIdentity, ""),
    lockedVisualIdentity: stringFrom(parsed.lockedVisualIdentity, ""),
    referencePolicy: stringFrom(parsed.referencePolicy, ""),
    facts: Array.isArray(parsed.facts) ? parsed.facts.map(String).slice(0, 20) : [],
  };
}

async function syncWorkflowCharacterReference(
  project: any,
  character: any,
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
    const workflowCenter = getWorkflowEpisodeById(metadata, episodeId || "").workflow;
    const assets = isRecord(workflowCenter.assets) ? workflowCenter.assets : {};
    const rawCharacters: unknown[] = Array.isArray(assets.characters) ? assets.characters : [];
    const currentCharacters = rawCharacters.filter((item: unknown): item is Record<string, unknown> => isRecord(item));
    const characterName = stringFrom(character.name, "");
    const characterKey = normalizeCompareText(characterName);
    const traits = isRecord(character.traits) ? character.traits : {};
    const existingIndex = currentCharacters.findIndex((item) => normalizeCompareText(stringFrom(item.name, "")) === characterKey);
    const existing = existingIndex >= 0 ? currentCharacters[existingIndex] : {};
    const nextCharacter = {
      ...existing,
      id: stringFrom(existing.id, character.id),
      name: characterName,
      role: stringFrom(character.role, stringFrom(existing.role, "SUPPORTING")),
      description: stringFrom(analysis?.description, stringFrom(character.bio, stringFrom(existing.description, ""))),
      visualPrompt: stringFrom(
        analysis?.lockedVisualIdentity,
        stringFrom(analysis?.visualPrompt, stringFrom(character.prompt, stringFrom(existing.visualPrompt, ""))),
      ),
      fruitIdentity: stringFrom(traits.fruitIdentity, stringFrom(existing.fruitIdentity, "")),
      lockedVisualIdentity: stringFrom(traits.lockedVisualIdentity, stringFrom(existing.lockedVisualIdentity, "")),
      referencePolicy: stringFrom(traits.referencePolicy, stringFrom(existing.referencePolicy, "")),
      referenceImageUrl: stringFrom(asset.url, stringFrom(existing.referenceImageUrl, "")),
      referenceImageAssetId: asset.id,
      visualAuthority: "uploaded-reference-image",
      referenceAnalysisStatus: analysis ? "succeeded" : "failed",
      ...(analysisError ? { referenceAnalysisError: analysisError } : {}),
    };
    const nextCharacters =
      existingIndex >= 0
        ? currentCharacters.map((item: Record<string, unknown>, index: number) => (index === existingIndex ? nextCharacter : item))
        : [nextCharacter, ...currentCharacters];
    const nextWorkflowCenter = {
      ...workflowCenter,
      assets: {
        ...assets,
        characters: nextCharacters,
        scenes: Array.isArray(assets.scenes) ? assets.scenes : [],
        props: Array.isArray(assets.props) ? assets.props : [],
      },
      stageStatuses: {
        ...(isRecord(workflowCenter.stageStatuses) ? workflowCenter.stageStatuses : {}),
        assets: "done",
      },
      updatedAt: new Date().toISOString(),
    };

    const targetEpisodeId = episodeId || workflowEpisodeIdForWorkflow(metadata, nextWorkflowCenter);
    const nextMetadata = writeWorkflowEpisode(metadata, targetEpisodeId, nextWorkflowCenter, true);
    const currentImageUrl = stringFrom(nextCharacter.referenceImageUrl, "");
    const canvasImageUrl = canvasSyncableImageUrl(currentImageUrl);
    let finalMetadata = nextMetadata;
    if (canvasImageUrl) {
      const filledMetadata = fillMissingAssetImageAcrossEpisodes(nextMetadata, { assetKind: "characters", assetName: characterName, field: "referenceImageUrl", imageUrl: currentImageUrl, imageAssetId: asset.id }).metadata;
      finalMetadata = applyWorkflowAssetImageToCanvasScenes(filledMetadata, { assetKind: "characters", assetName: characterName, imageUrl: canvasImageUrl, imageAssetId: asset.id }, nextWorkflowCenter.updatedAt).metadata;
    }
    await tx.project.update({
      where: { id: project.id },
      data: { metadata: finalMetadata as Prisma.InputJsonValue },
    });

    return { ...nextWorkflowCenter, episodeId: targetEpisodeId, episodes: getWorkflowEpisodeList(finalMetadata) };
  });
}

async function syncWorkflowCharacterAudioReference(
  project: any,
  character: any,
  asset: any,
  episodeId?: string,
) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${project.id} FOR UPDATE`;
    const currentProject = await tx.project.findUnique({
      where: { id: project.id },
      select: { metadata: true },
    });
    const metadata = isRecord(currentProject?.metadata) ? currentProject.metadata : {};
    const workflowCenter = getWorkflowEpisodeById(metadata, episodeId || "").workflow;
    const assets = isRecord(workflowCenter.assets) ? workflowCenter.assets : {};
    const rawCharacters: unknown[] = Array.isArray(assets.characters) ? assets.characters : [];
    const currentCharacters = rawCharacters.filter((item: unknown): item is Record<string, unknown> => isRecord(item));
    const characterName = stringFrom(character.name, "");
    const characterKey = normalizeCompareText(characterName);
    const traits = isRecord(character.traits) ? character.traits : {};
    const existingIndex = currentCharacters.findIndex((item) => normalizeCompareText(stringFrom(item.name, "")) === characterKey);
    const existing = existingIndex >= 0 ? currentCharacters[existingIndex] : {};
    const nextCharacter = {
      ...existing,
      id: stringFrom(existing.id, character.id),
      name: characterName,
      role: stringFrom(character.role, stringFrom(existing.role, "SUPPORTING")),
      description: stringFrom(character.bio, stringFrom(existing.description, "")),
      visualPrompt: stringFrom(character.prompt, stringFrom(existing.visualPrompt, "")),
      fruitIdentity: stringFrom(traits.fruitIdentity, stringFrom(existing.fruitIdentity, "")),
      lockedVisualIdentity: stringFrom(traits.lockedVisualIdentity, stringFrom(existing.lockedVisualIdentity, "")),
      referencePolicy: stringFrom(traits.referencePolicy, stringFrom(existing.referencePolicy, "")),
      referenceImageUrl: stringFrom(traits.referenceImageUrl, stringFrom(existing.referenceImageUrl, "")),
      referenceImageAssetId: stringFrom(traits.referenceImageAssetId, stringFrom(existing.referenceImageAssetId, "")),
      generatedImageUrl: stringFrom(traits.generatedImageUrl, stringFrom(existing.generatedImageUrl, "")),
      generatedImageAssetId: stringFrom(traits.generatedImageAssetId, stringFrom(existing.generatedImageAssetId, "")),
      referenceAudioUrl: stringFrom(asset.url, stringFrom(existing.referenceAudioUrl, "")),
      referenceAudioAssetId: asset.id,
      voiceReferenceStatus: "ready",
      voiceReferenceFileName: stringFrom(asset.title, stringFrom(existing.voiceReferenceFileName, "")),
      voiceReferenceMimeType: stringFrom(asset.mimeType, stringFrom(existing.voiceReferenceMimeType, "")),
    };
    const nextCharacters =
      existingIndex >= 0
        ? currentCharacters.map((item: Record<string, unknown>, index: number) => (index === existingIndex ? nextCharacter : item))
        : [nextCharacter, ...currentCharacters];
    const nextWorkflowCenter = {
      ...workflowCenter,
      assets: {
        ...assets,
        characters: nextCharacters,
        scenes: Array.isArray(assets.scenes) ? assets.scenes : [],
        props: Array.isArray(assets.props) ? assets.props : [],
      },
      stageStatuses: {
        ...(isRecord(workflowCenter.stageStatuses) ? workflowCenter.stageStatuses : {}),
        assets: "done",
        voice: "done",
      },
      updatedAt: new Date().toISOString(),
    };

    const targetEpisodeId = episodeId || workflowEpisodeIdForWorkflow(metadata, nextWorkflowCenter);
    const nextMetadata = syncCanvasCharacterAudioReference(
      writeWorkflowEpisode(metadata, targetEpisodeId, nextWorkflowCenter, true),
      targetEpisodeId,
      characterName,
      {
        url: stringFrom(asset.url, ""),
        assetId: stringFrom(asset.id, ""),
        fileName: stringFrom(asset.title, ""),
        mimeType: stringFrom(asset.mimeType, ""),
      },
    );
    await tx.project.update({
      where: { id: project.id },
      data: { metadata: nextMetadata as Prisma.InputJsonValue },
    });

    return { ...nextWorkflowCenter, episodeId: targetEpisodeId, episodes: getWorkflowEpisodeList(nextMetadata) };
  });
}

async function clearWorkflowCharacterAudioReference(
  project: any,
  character: any,
  episodeId?: string,
) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${project.id} FOR UPDATE`;
    const currentProject = await tx.project.findUnique({
      where: { id: project.id },
      select: { metadata: true },
    });
    const metadata = isRecord(currentProject?.metadata) ? currentProject.metadata : {};
    const workflowCenter = getWorkflowEpisodeById(metadata, episodeId || "").workflow;
    const assets = isRecord(workflowCenter.assets) ? workflowCenter.assets : {};
    const rawCharacters: unknown[] = Array.isArray(assets.characters) ? assets.characters : [];
    const currentCharacters = rawCharacters.filter((item: unknown): item is Record<string, unknown> => isRecord(item));
    const characterName = stringFrom(character.name, "");
    const characterKey = normalizeCompareText(characterName);
    const traits = isRecord(character.traits) ? character.traits : {};
    const existingIndex = currentCharacters.findIndex((item) => normalizeCompareText(stringFrom(item.name, "")) === characterKey);
    const existing = existingIndex >= 0 ? currentCharacters[existingIndex] : {};
    const nextCharacter = clearWorkflowAssetAudioFields({
      ...existing,
      id: stringFrom(existing.id, character.id),
      name: characterName,
      role: stringFrom(character.role, stringFrom(existing.role, "SUPPORTING")),
      description: stringFrom(character.bio, stringFrom(existing.description, "")),
      visualPrompt: stringFrom(character.prompt, stringFrom(existing.visualPrompt, "")),
      fruitIdentity: stringFrom(traits.fruitIdentity, stringFrom(existing.fruitIdentity, "")),
      lockedVisualIdentity: stringFrom(traits.lockedVisualIdentity, stringFrom(existing.lockedVisualIdentity, "")),
      referencePolicy: stringFrom(traits.referencePolicy, stringFrom(existing.referencePolicy, "")),
      referenceImageUrl: stringFrom(traits.referenceImageUrl, stringFrom(existing.referenceImageUrl, "")),
      referenceImageAssetId: stringFrom(traits.referenceImageAssetId, stringFrom(existing.referenceImageAssetId, "")),
      generatedImageUrl: stringFrom(traits.generatedImageUrl, stringFrom(existing.generatedImageUrl, "")),
      generatedImageAssetId: stringFrom(traits.generatedImageAssetId, stringFrom(existing.generatedImageAssetId, "")),
    });
    const nextCharacters =
      existingIndex >= 0
        ? currentCharacters.map((item: Record<string, unknown>, index: number) => (index === existingIndex ? nextCharacter : item))
        : [nextCharacter, ...currentCharacters];
    const nextWorkflowCenter = {
      ...workflowCenter,
      assets: {
        ...assets,
        characters: nextCharacters,
        scenes: Array.isArray(assets.scenes) ? assets.scenes : [],
        props: Array.isArray(assets.props) ? assets.props : [],
      },
      updatedAt: new Date().toISOString(),
    };

    const targetEpisodeId = episodeId || workflowEpisodeIdForWorkflow(metadata, nextWorkflowCenter);
    const nextMetadata = syncCanvasCharacterAudioReference(
      writeWorkflowEpisode(metadata, targetEpisodeId, nextWorkflowCenter, true),
      targetEpisodeId,
      characterName,
      null,
    );
    await tx.project.update({
      where: { id: project.id },
      data: { metadata: nextMetadata as Prisma.InputJsonValue },
    });

    return { ...nextWorkflowCenter, episodeId: targetEpisodeId, episodes: getWorkflowEpisodeList(nextMetadata) };
  });
}

type CharacterRouteWorkflowState = {
  sourceText: string;
  sourceName: string;
  selectedEpisode: string;
  activeStage: string;
  breakdownScenes: unknown[];
  clips: unknown[];
  assets: Record<string, unknown>;
  stageStatuses: Record<string, string>;
  updatedAt?: string;
  lastRun?: Record<string, unknown>;
};

function optionalStringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeWorkflowStateRecord(value: unknown, fallbackEpisode = "第 1 集"): CharacterRouteWorkflowState {
  const record = isRecord(value) ? value : {};
  return {
    sourceText: stringFrom(record.sourceText, ""),
    sourceName: stringFrom(record.sourceName, ""),
    selectedEpisode: stringFrom(record.selectedEpisode, fallbackEpisode),
    activeStage: stringFrom(record.activeStage, "source"),
    breakdownScenes: Array.isArray(record.breakdownScenes) ? record.breakdownScenes : [],
    clips: Array.isArray(record.clips) ? record.clips : [],
    assets: isRecord(record.assets) ? record.assets : defaultAssets(),
    stageStatuses: isRecord(record.stageStatuses) ? Object.fromEntries(
      Object.entries(record.stageStatuses).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ) : defaultStageStatuses(),
    updatedAt: optionalStringFrom(record.updatedAt),
    lastRun: isRecord(record.lastRun) ? record.lastRun : undefined,
  };
}

function legacyWorkflowState(metadata: unknown) {
  if (isRecord(metadata) && isRecord(metadata.workflowCenter)) {
    return normalizeWorkflowStateRecord(metadata.workflowCenter);
  }
  return defaultWorkflowState();
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

function writeWorkflowEpisode(metadata: Record<string, unknown>, episodeId: string, workflow: any, makeActive = false): Record<string, unknown> {
  const id = episodeId || workflowEpisodeIdForTitle(workflow.selectedEpisode, "episode-001");
  const episodes = getWorkflowEpisodes(metadata);
  return {
    ...metadata,
    workflowCenter: workflow,
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
        title: workflow.selectedEpisode || stringFrom(episodes[id]?.title, "第 1 集"),
        canvasSceneId: workflowEpisodeCanvasSceneId(id),
        workflowCenter: workflow,
        updatedAt: workflow.updatedAt ?? new Date().toISOString(),
      },
    },
  };
}

function getWorkflowEpisodeList(metadata: unknown) {
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
  if (summaries.length === 0 || !summaries.some((item) => item.id === legacyId)) {
    summaries.unshift(workflowEpisodeSummary(legacyId, legacy));
  }
  const activeEpisodeId = stringFrom(record.activeEpisodeId, summaries[0]?.id ?? legacyId);
  return { activeEpisodeId, episodes: summaries };
}

function workflowEpisodeSummary(id: string, workflow: any, episode?: Record<string, unknown>) {
  const updatedAt = optionalStringFrom(episode?.updatedAt) ?? optionalStringFrom(workflow?.updatedAt);
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
  return requested;
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

function workflowEpisodeCanvasSceneId(episodeId: string): string {
  return episodeId || "default";
}

function episodeSortKey(a: { id: string; title: string }, b: { id: string; title: string }): number {
  const aNumber = Number(a.id.match(/episode-(\d+)/)?.[1] ?? Number.NaN);
  const bNumber = Number(b.id.match(/episode-(\d+)/)?.[1] ?? Number.NaN);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) return aNumber - bNumber;
  return a.title.localeCompare(b.title, "zh-Hans-CN");
}

function defaultWorkflowState(selectedEpisode = "第 1 集") {
  return {
    sourceText: "",
    sourceName: "",
    selectedEpisode,
    activeStage: "source",
    breakdownScenes: [],
    clips: [],
    assets: defaultAssets(),
    stageStatuses: defaultStageStatuses(),
    updatedAt: undefined,
    lastRun: undefined,
  };
}

function defaultAssets() {
  return { characters: [], scenes: [], props: [] };
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

function firstLineAfterLabel(value: string | undefined, label: string): string | undefined {
  if (!value) return undefined;
  const line = value.split("\n").find((item) => item.trim().startsWith(label));
  return line?.slice(label.length).trim() || undefined;
}

function normalizeCompareText(value: string): string {
  return value.trim().toLowerCase();
}

function stringFrom(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function compactCharacterTraits(value: unknown): Record<string, unknown> {
  const traits = isRecord(value) ? value : {};
  return {
    ...compactExtraTraits(traits),
    ...(compactTraitText(stringFrom(traits.visualAuthority, "")) ? { visualAuthority: compactTraitText(stringFrom(traits.visualAuthority, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.referenceImageAssetId, "")) ? { referenceImageAssetId: compactTraitText(stringFrom(traits.referenceImageAssetId, "")) } : {}),
    ...(compactUrlForStorage(stringFrom(traits.referenceImageUrl, "")) ? { referenceImageUrl: compactUrlForStorage(stringFrom(traits.referenceImageUrl, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.referenceImageUploadedAt, "")) ? { referenceImageUploadedAt: compactTraitText(stringFrom(traits.referenceImageUploadedAt, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.referenceAudioAssetId, "")) ? { referenceAudioAssetId: compactTraitText(stringFrom(traits.referenceAudioAssetId, "")) } : {}),
    ...(compactUrlForStorage(stringFrom(traits.referenceAudioUrl, "")) ? { referenceAudioUrl: compactUrlForStorage(stringFrom(traits.referenceAudioUrl, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.referenceAudioUploadedAt, "")) ? { referenceAudioUploadedAt: compactTraitText(stringFrom(traits.referenceAudioUploadedAt, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.voiceReferenceStatus, "")) ? { voiceReferenceStatus: compactTraitText(stringFrom(traits.voiceReferenceStatus, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.voiceReferenceFileName, "")) ? { voiceReferenceFileName: compactTraitText(stringFrom(traits.voiceReferenceFileName, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.voiceReferenceMimeType, "")) ? { voiceReferenceMimeType: compactTraitText(stringFrom(traits.voiceReferenceMimeType, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.generatedImageAssetId, "")) ? { generatedImageAssetId: compactTraitText(stringFrom(traits.generatedImageAssetId, "")) } : {}),
    ...(compactUrlForStorage(stringFrom(traits.generatedImageUrl, "")) ? { generatedImageUrl: compactUrlForStorage(stringFrom(traits.generatedImageUrl, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.workflowSource, "")) ? { workflowSource: compactTraitText(stringFrom(traits.workflowSource, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.episode, "")) ? { episode: compactTraitText(stringFrom(traits.episode, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.fruitIdentity, "")) ? { fruitIdentity: compactTraitText(stringFrom(traits.fruitIdentity, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.personality, "")) ? { personality: compactTraitText(stringFrom(traits.personality, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.height, "")) ? { height: compactTraitText(stringFrom(traits.height, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.primaryLook, "")) ? { primaryLook: compactTraitText(stringFrom(traits.primaryLook, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.expressionNotes, "")) ? { expressionNotes: compactTraitText(stringFrom(traits.expressionNotes, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.habitualActions, "")) ? { habitualActions: compactTraitText(stringFrom(traits.habitualActions, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.variantNotes, "")) ? { variantNotes: compactTraitText(stringFrom(traits.variantNotes, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.signatureProps, "")) ? { signatureProps: compactTraitText(stringFrom(traits.signatureProps, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.colorPalette, "")) ? { colorPalette: compactTraitText(stringFrom(traits.colorPalette, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.lockedVisualIdentity, "")) ? { lockedVisualIdentity: compactTraitText(stringFrom(traits.lockedVisualIdentity, "")) } : {}),
    ...(compactTraitText(stringFrom(traits.referencePolicy, "")) ? { referencePolicy: compactTraitText(stringFrom(traits.referencePolicy, "")) } : {}),
    ...(compactImageAnalysis(traits.imageAnalysis) ? { imageAnalysis: compactImageAnalysis(traits.imageAnalysis) } : {}),
    ...(compactTraitText(stringFrom(traits.imageAnalysisError, "")) ? { imageAnalysisError: compactTraitText(stringFrom(traits.imageAnalysisError, "")) } : {}),
  };
}

function clearCharacterAudioTraitFields(traits: Record<string, unknown>): Record<string, unknown> {
  const next = { ...traits };
  delete next.referenceAudioAssetId;
  delete next.referenceAudioUrl;
  delete next.referenceAudioUploadedAt;
  delete next.voiceReferenceStatus;
  delete next.voiceReferenceFileName;
  delete next.voiceReferenceMimeType;
  return next;
}

function clearWorkflowAssetAudioFields(asset: Record<string, unknown>): Record<string, unknown> {
  const next = { ...asset };
  delete next.referenceAudioAssetId;
  delete next.referenceAudioUrl;
  delete next.voiceReferenceStatus;
  delete next.voiceReferenceFileName;
  delete next.voiceReferenceMimeType;
  return next;
}

function syncCanvasCharacterAudioReference(
  metadata: Record<string, unknown>,
  episodeId: string,
  characterName: string,
  audio: { url: string; assetId?: string; fileName?: string; mimeType?: string } | null,
): Record<string, unknown> {
  const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
  const scene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : null;
  if (!scene || !Array.isArray(scene.nodes) || !Array.isArray(scene.edges)) return metadata;
  const characterKey = normalizeCompareText(characterName);
  const nextNodes = scene.nodes.map((node: unknown) => syncCanvasAudioNode(node, characterKey, characterName, audio));
  const nextEdges = scene.edges;
  return {
    ...metadata,
    canvasScenes: {
      ...canvasScenes,
      [episodeId]: {
        ...scene,
        nodes: nextNodes,
        edges: nextEdges,
        updatedAt: new Date().toISOString(),
      },
    },
  };
}

function syncCanvasAudioNode(
  node: unknown,
  characterKey: string,
  characterName: string,
  audio: { url: string; assetId?: string; fileName?: string; mimeType?: string } | null,
): unknown {
  if (!isRecord(node)) return node;
  const data = isRecord(node.data) ? node.data : {};
  if (node.type === "audio" || data.kind === "audio" || data.workflowKind === "audio" || data.assetKind === "audio") {
    const nodeCharacterName = stringFrom(data.characterName, stringFrom(data.assetName, stringFrom(data.name, "")));
    if (normalizeCompareText(nodeCharacterName) !== characterKey) return node;
    return {
      ...node,
      data: {
        ...data,
        label: `音频参考: ${characterName}`,
        title: `${characterName} 音频参考`,
        characterName,
        assetName: characterName,
        audioUrl: audio?.url ?? "",
        referenceAudioUrl: audio?.url ?? "",
        referenceAudioAssetId: audio?.assetId ?? "",
        assetId: audio?.assetId ?? "",
        fileName: audio?.fileName || `${characterName}-voice-reference`,
        voiceReferenceMimeType: audio?.mimeType ?? "",
        uploadStatus: audio?.url ? "linked" : "missing",
        uploadError: audio?.url ? "" : "该角色还没有绑定音频参考",
        clipSyncAssetId: audio?.assetId ?? "",
        clipSyncUrl: audio?.url ?? "",
      },
    };
  }
  if (node.type !== "video" && data.workflowKind !== "video" && data.kind !== "video") return node;
  return {
    ...node,
    data: syncCanvasVideoNodeAudioData(data, characterKey, characterName, audio),
  };
}

function syncCanvasVideoNodeAudioData(
  data: Record<string, unknown>,
  characterKey: string,
  characterName: string,
  audio: { url: string; assetId?: string; fileName?: string; mimeType?: string } | null,
): Record<string, unknown> {
  const rawRefs = Array.isArray(data.characterAudioReferences) ? data.characterAudioReferences : [];
  let found = false;
  const refs = rawRefs
    .filter((item: unknown): item is Record<string, unknown> => isRecord(item))
    .map((item) => {
      const name = stringFrom(item.name, stringFrom(item.characterName, ""));
      if (normalizeCompareText(name) !== characterKey) return item;
      found = true;
      return {
        ...item,
        name: characterName,
        url: audio?.url ?? "",
        assetId: audio?.assetId ?? "",
        fileName: audio?.fileName || stringFrom(item.fileName, `${characterName}-voice-reference`),
      };
    });
  if (!found && audio?.url) {
    refs.push({
      name: characterName,
      url: audio.url,
      assetId: audio.assetId ?? "",
      fileName: audio.fileName || `${characterName}-voice-reference`,
      source: "workflow-asset",
    });
  }
  const referenceAudioUrls = refs
    .map((item) => stringFrom(item.url, ""))
    .filter((url, index, urls) => Boolean(url) && urls.indexOf(url) === index);
  const dialogueCharacterNames = Array.isArray(data.dialogueCharacterNames)
    ? data.dialogueCharacterNames.map(String).filter(Boolean)
    : refs.map((item) => stringFrom(item.name, "")).filter(Boolean);
  return {
    ...data,
    dialogueCharacterNames,
    characterAudioReferences: refs,
    referenceAudioUrls,
    referenceAudioCount: referenceAudioUrls.length,
    audioReferenceCount: refs.length,
  };
}

function compactExtraTraits(traits: Record<string, unknown>): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(traits)) {
    if (COMPACT_CHARACTER_TRAIT_KEYS.has(key)) continue;
    if (typeof value === "string") {
      const text = compactTraitText(value);
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
        .map((item) => (typeof item === "string" ? compactTraitText(item) : item))
        .filter((item) => typeof item !== "string" || item.length > 0)
        .slice(0, 20);
      if (items.length) extras[key] = items;
    }
  }
  return extras;
}

function compactImageAnalysis(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const facts = Array.isArray(value.facts) ? value.facts.map(String).map(compactTraitText).filter(Boolean).slice(0, 12) : [];
  const analysis = {
    ...(compactTraitText(stringFrom(value.description, "")) ? { description: compactTraitText(stringFrom(value.description, "")) } : {}),
    ...(compactTraitText(stringFrom(value.visualPrompt, "")) ? { visualPrompt: compactTraitText(stringFrom(value.visualPrompt, "")) } : {}),
    ...(compactTraitText(stringFrom(value.fruitIdentity, "")) ? { fruitIdentity: compactTraitText(stringFrom(value.fruitIdentity, "")) } : {}),
    ...(compactTraitText(stringFrom(value.lockedVisualIdentity, "")) ? { lockedVisualIdentity: compactTraitText(stringFrom(value.lockedVisualIdentity, "")) } : {}),
    ...(compactTraitText(stringFrom(value.referencePolicy, "")) ? { referencePolicy: compactTraitText(stringFrom(value.referencePolicy, "")) } : {}),
    ...(facts.length ? { facts } : {}),
  };
  return Object.keys(analysis).length ? analysis : undefined;
}

function compactUrlForStorage(value: string): string {
  if (!value) return "";
  if (/^data:/i.test(value)) return "";
  return value.slice(0, 12000);
}

function compactTraitText(value: string): string {
  return value
    .replace(/^data:[^,\s]+,[A-Za-z0-9+/=_-]+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CHARACTER_TRAIT_TEXT_MAX_CHARS);
}
