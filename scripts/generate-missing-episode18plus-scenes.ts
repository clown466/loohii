import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../server/src/lib/prisma";
import { callConfiguredImageModel } from "../server/src/ai/imageModel";
import { applyWorkflowAssetImageToCanvasScenes, canvasSyncableImageUrl } from "../server/src/lib/canvasAssetImageSync";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const imageModelId = process.argv[3] || "cmqqg5el0004ml40te39s2edc";
const localUploadRoot = process.env.LOCAL_UPLOAD_ROOT || "/var/lib/loohii/uploads";

const targets = [
  { episodeId: "episode-018", assetName: "Wasteland Highway" },
  { episodeId: "episode-018", assetName: "Ruined Overpass" },
  { episodeId: "episode-025", assetName: "Wasteland Highway" },
];

const targetFilter = (process.env.SCENE_TARGETS || "")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalize(value: unknown): string {
  return stringValue(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function publicUploadUrl(key: string): string {
  return `https://loohii.com/api/uploads/public/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function parseImageDataUrl(value: string): { contentType: string; buffer: Buffer; extension: string } | null {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) return null;
  const contentType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
  return { contentType, extension, buffer: Buffer.from(match[2].replace(/\s+/g, ""), "base64") };
}

async function downloadImage(value: string): Promise<{ contentType: string; buffer: Buffer; extension: string; originalUrl?: string }> {
  const data = parseImageDataUrl(value);
  if (data) return data;
  const url = new URL(value);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`download failed ${response.status} ${url.href}`);
  const contentType = (response.headers.get("content-type") || "image/png").split(";")[0].toLowerCase();
  const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
  return { contentType, extension, buffer: Buffer.from(await response.arrayBuffer()), originalUrl: url.href };
}

function scenePrompt(asset: Record<string, unknown>, episodeId: string): string {
  const name = stringValue(asset.name) || stringValue(asset.title);
  const lock = stringValue(asset.sceneVisualLock);
  const description = stringValue(asset.description) || stringValue(asset.summary);
  const common = [
    "3D American cartoon dark-comedy environment concept art, cinematic, highly detailed, 16:9.",
    `Episode: ${episodeId}. Scene asset: ${name}.`,
    "Empty environment reference image only: no characters, no crowds, no zombies, no produce creatures, no living figures, no vehicles as the main subject, no readable text, no UI, no watermark.",
    "Keep a cold night / pre-dawn wasteland palette unless the scene text explicitly says otherwise.",
    "Hard negative: no warm sunset, no golden sky, no orange dusk desert highway, no generic straight empty sunset road.",
  ];
  if (/overpass|bridge|viaduct/i.test(name)) {
    common.push(
      "Depict a ruined overpass roadway at night: cracked elevated concrete, broken guardrails, exposed rebar, shadowed underpass depth, cold blue-black sky, harsh headlight spill, urban wasteland rubble.",
      "It must be visually distinct from an open desert highway: include overpass structure, concrete supports, height changes, and broken bridge geometry.",
    );
  } else if (/highway|road|interstate/i.test(name)) {
    common.push(
      "Depict a night wasteland highway matching the Black Spire journey: cracked dark asphalt, dead roadside gravel, cold moonlit shadows, black-blue horizon, distant ominous corporate tower silhouette or red signal only if consistent with the episode.",
      "The road may be open, but lighting must be night/cold and compatible with surrounding episode continuity.",
    );
  }
  if (description) common.push(`Scene description: ${description}`);
  if (lock) common.push(`Scene continuity lock: ${lock}`);
  return common.join("\n");
}

function workflowFor(metadata: Record<string, unknown>, episodeId: string): Record<string, unknown> {
  const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
  const episode = isRecord(episodes[episodeId]) ? episodes[episodeId] : {};
  return isRecord(episode.workflowCenter) ? episode.workflowCenter : {};
}

function writeWorkflow(metadata: Record<string, unknown>, episodeId: string, workflow: Record<string, unknown>) {
  const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
  const episode = isRecord(episodes[episodeId]) ? episodes[episodeId] : { id: episodeId };
  episodes[episodeId] = { ...episode, workflowCenter: workflow };
  metadata.episodes = episodes;
  metadata.workflowCenter = workflow;
}

async function main() {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, ownerId: true, metadata: true } });
  if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);

  const results: unknown[] = [];
  for (const target of targets) {
    const targetKey = `${target.episodeId}:${target.assetName}`.toLowerCase();
    if (targetFilter.length > 0 && !targetFilter.includes(targetKey)) continue;
    const freshProject = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, ownerId: true, metadata: true } });
    if (!freshProject || !isRecord(freshProject.metadata)) throw new Error(`Project not found during target ${target.episodeId}/${target.assetName}`);
    const metadata = freshProject.metadata as Record<string, unknown>;
    const workflow = workflowFor(metadata, target.episodeId);
    const assets = isRecord(workflow.assets) ? workflow.assets : {};
    const scenes = Array.isArray(assets.scenes) ? assets.scenes as Record<string, unknown>[] : [];
    const index = scenes.findIndex((item) => normalize(item.name || item.title) === normalize(target.assetName));
    if (index < 0) throw new Error(`Missing scene asset ${target.episodeId}/${target.assetName}`);
    const existing = scenes[index];
    const prompt = scenePrompt(existing, target.episodeId);

    const generation = await prisma.generation.create({
      data: {
        projectId,
        userId: freshProject.ownerId,
        aiModelId: imageModelId,
        prompt,
        input: { kind: "workflow-asset-image", assetKind: "scenes", assetName: target.assetName, episodeId: target.episodeId, size: "16:9" },
        parameters: { size: "16:9" },
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    try {
      const result = await callConfiguredImageModel({
        prompt,
        aiModelId: imageModelId,
        size: "16:9",
        parameters: { size: "16:9" },
      });
      const image = result.images[0];
      if (!image?.url) throw new Error("Image model returned no image URL.");
      const downloaded = await downloadImage(image.url);
      if (downloaded.buffer.length === 0) throw new Error("Image model returned empty image.");
      const key = `${freshProject.ownerId}/generated/${projectId}/asset-${generation.id}.${downloaded.extension}`;
      const filePath = path.join(localUploadRoot, key);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, downloaded.buffer);
      const imageUrl = publicUploadUrl(key);

      const asset = await prisma.asset.create({
        data: {
          projectId,
          uploadedById: freshProject.ownerId,
          generationId: generation.id,
          type: "IMAGE",
          title: `${target.assetName} generated asset image`,
          url: imageUrl,
          mimeType: downloaded.contentType,
          metadata: {
            source: "repair-episode18plus-scene-generation",
            workflowAssetKind: "scenes",
            assetName: target.assetName,
            episodeId: target.episodeId,
            prompt,
            size: "16:9",
            model: result.model,
            revisedPrompt: image.revisedPrompt,
            durationMs: result.durationMs,
            ...(downloaded.originalUrl ? { originalProviderImageUrl: downloaded.originalUrl } : {}),
          },
        },
      });
      await prisma.generation.update({
        where: { id: generation.id },
        data: {
          aiModelId: result.model.id,
          status: "SUCCEEDED",
          completedAt: new Date(),
          parameters: { size: "16:9", model: result.model, durationMs: result.durationMs },
        },
      });

      const nextScenes = scenes.map((item, itemIndex) => itemIndex === index ? {
        ...item,
        referenceImageUrl: imageUrl,
        referenceImageAssetId: asset.id,
        generatedImageUrl: imageUrl,
        generatedImageAssetId: asset.id,
        generatedImagePrompt: prompt,
        generatedImageRevisedPrompt: image.revisedPrompt || "",
        generatedImageAt: new Date().toISOString(),
        generationId: generation.id,
        imageGenerationModel: result.model,
        visualAuthority: "generated-asset-image",
        referenceAnalysisStatus: "generated",
        imageStatus: "ready",
        imageError: "",
      } : item);
      const nextWorkflow = {
        ...workflow,
        assets: { ...assets, scenes: nextScenes },
        activeStage: "assets",
        updatedAt: new Date().toISOString(),
      };
      writeWorkflow(metadata, target.episodeId, nextWorkflow);
      const synced = applyWorkflowAssetImageToCanvasScenes(
        metadata,
        { assetKind: "scenes", assetName: target.assetName, imageUrl: canvasSyncableImageUrl(imageUrl), imageAssetId: asset.id, episodeId: target.episodeId },
        String(nextWorkflow.updatedAt),
      );
      await prisma.project.update({ where: { id: projectId }, data: { metadata: synced.metadata } });
      results.push({ ...target, generationId: generation.id, assetId: asset.id, imageUrl, changedNodeCount: synced.changedNodeCount, promptLength: prompt.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.generation.update({ where: { id: generation.id }, data: { status: "FAILED", errorMessage: message, completedAt: new Date() } });
      throw error;
    }
  }

  console.log(JSON.stringify({ projectId, imageModelId, generated: results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
