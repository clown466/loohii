import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../server/src/lib/prisma";
import { callConfiguredImageModel } from "../server/src/ai/imageModel";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = process.argv[3] || "episode-015";
const maxRounds = Number(process.argv[4] || 5);

type CanvasNode = {
  id: string;
  type?: string;
  parentId?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

type CanvasEdge = {
  source?: string;
  target?: string;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return String(value || "").trim();
}

function publicImageLike(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (isRecord(value)) return stringValue(value.url || value.publicUrl || value.imageUrl);
  return "";
}

function hasOutput(data: Record<string, unknown>): boolean {
  if (publicImageLike(data.outputImage)) return true;
  return Array.isArray(data.outputImages) && data.outputImages.some((item) => publicImageLike(item));
}

function activePrompt(data: Record<string, unknown>): string {
  return stringValue(data.finalPrompt || data.prompt || data.storyboardPrompt || data.positioningPrompt);
}

function safePart(value: unknown, fallback: string): string {
  return stringValue(value || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || fallback;
}

function extensionForContentType(contentType: string): string {
  const clean = contentType.split(";")[0]?.toLowerCase() || "";
  if (clean === "image/jpeg" || clean === "image/jpg") return "jpg";
  if (clean === "image/webp") return "webp";
  if (clean === "image/gif") return "gif";
  return "png";
}

function parseDataImage(url: string): { buffer: Buffer; mimeType: string; extension: string } | null {
  const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) return null;
  const mimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  return {
    buffer: Buffer.from(match[2].replace(/\s+/g, ""), "base64"),
    mimeType,
    extension: extensionForContentType(mimeType),
  };
}

async function imageToLocalPublicUrl(imageUrl: string, options: { userId: string; projectId: string; generationId: string; nodeId: string }) {
  let buffer: Buffer;
  let mimeType = "image/png";
  let extension = "png";
  const dataImage = parseDataImage(imageUrl);
  if (dataImage) {
    buffer = dataImage.buffer;
    mimeType = dataImage.mimeType;
    extension = dataImage.extension;
  } else {
    const response = await fetch(imageUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 Loohii/1.0",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });
    if (!response.ok) throw new Error(`download image failed: HTTP ${response.status}`);
    mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "image/png";
    if (!mimeType.startsWith("image/") && mimeType !== "application/octet-stream") {
      throw new Error(`downloaded response is not an image: ${mimeType}`);
    }
    extension = extensionForContentType(mimeType);
    buffer = Buffer.from(await response.arrayBuffer());
  }
  if (!buffer.length) throw new Error("image output is empty");
  const keyParts = [
    options.userId,
    "generated",
    options.projectId,
    `storyboard-board-${safePart(options.nodeId, "node")}-${options.generationId}.${extension}`,
  ];
  const key = keyParts.join("/");
  const uploadRoot = process.env.LOCAL_UPLOAD_ROOT || "/var/lib/loohii/uploads";
  const filePath = path.join(uploadRoot, key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
  return {
    url: `https://loohii.com/api/uploads/public/${key.split("/").map(encodeURIComponent).join("/")}`,
    mimeType,
  };
}

function referenceUrlsForNode(nodes: CanvasNode[], edges: CanvasEdge[], targetId: string): string[] {
  const incoming = edges.filter((edge) => edge.target === targetId).map((edge) => stringValue(edge.source));
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const nodeId of incoming) {
    const node = nodes.find((item) => item.id === nodeId);
    const url = publicImageLike(node?.data?.imageUrl || node?.data?.outputImage || node?.data?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= 12) break;
  }
  return urls;
}

async function loadProject() {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, ownerId: true, metadata: true },
  });
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const metadata = isRecord(project.metadata) ? project.metadata : {};
  const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
  const scene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : null;
  if (!scene) throw new Error(`Canvas scene not found: ${episodeId}`);
  const nodes = Array.isArray(scene.nodes) ? scene.nodes.filter(isRecord) as CanvasNode[] : [];
  const edges = Array.isArray(scene.edges) ? scene.edges.filter(isRecord) as CanvasEdge[] : [];
  return { project, metadata, canvasScenes, scene, nodes, edges };
}

async function saveNodeOutput(nodeId: string, patch: Record<string, unknown>) {
  const loaded = await loadProject();
  const nextNodes = loaded.nodes.map((node) => node.id === nodeId ? {
    ...node,
    data: {
      ...(node.data ?? {}),
      ...patch,
    },
  } : node);
  await prisma.project.update({
    where: { id: projectId },
    data: {
      metadata: {
        ...loaded.metadata,
        canvasScenes: {
          ...loaded.canvasScenes,
          [episodeId]: {
            ...loaded.scene,
            nodes: nextNodes,
            edges: loaded.edges,
            updatedAt: new Date().toISOString(),
          },
        },
      },
    },
  });
}

async function generateOne(node: CanvasNode, nodes: CanvasNode[], edges: CanvasEdge[], userId: string) {
  const data = isRecord(node.data) ? node.data : {};
  const prompt = activePrompt(data);
  if (!prompt) throw new Error("missing prompt");
  const aiModelId = stringValue(data.modelId) || undefined;
  const size = stringValue(data.size) || "16:9";
  const referenceImageUrls = referenceUrlsForNode(nodes, edges, node.id);
  await saveNodeOutput(node.id, {
    status: "generating",
    error: "",
    generationStartedAt: new Date().toISOString(),
    positioningBoardMode: "storyboard",
  });
  const generation = await prisma.generation.create({
    data: {
      projectId,
      userId,
      aiModelId,
      prompt,
      input: {
        kind: "canvas-image-generation",
        size,
        referenceImageUrls,
        metadata: {
          clipId: stringValue(data.clipId),
          clipTitle: stringValue(data.clipTitle || data.title),
          clipNodeKind: "positioning-board",
          positioningBoardFlow: true,
          positioningBoardMode: "storyboard",
          sourceEpisodeId: episodeId,
          canvasNodeId: node.id,
        },
      },
      parameters: {
        image_urls: referenceImageUrls,
      },
      status: "RUNNING",
      startedAt: new Date(),
    },
  });
  try {
    const result = await callConfiguredImageModel({
      prompt,
      aiModelId,
      count: 1,
      size,
      parameters: referenceImageUrls.length ? { image_urls: referenceImageUrls } : {},
    });
    const image = result.images[0];
    if (!image?.url) throw new Error("image model returned no image");
    const stored = await imageToLocalPublicUrl(image.url, {
      userId,
      projectId,
      generationId: generation.id,
      nodeId: node.id,
    });
    const asset = await prisma.asset.create({
      data: {
        projectId,
        uploadedById: userId,
        generationId: generation.id,
        type: "IMAGE",
        title: `${stringValue(data.title || data.clipTitle || node.id)} generated storyboard board`,
        url: stored.url,
        mimeType: stored.mimeType,
        metadata: {
          source: "canvas-image-generation",
          prompt,
          size,
          referenceImageUrls,
          model: result.model,
          revisedPrompt: image.revisedPrompt,
          durationMs: result.durationMs,
          clipId: stringValue(data.clipId),
          sourceEpisodeId: episodeId,
          canvasNodeId: node.id,
          positioningBoardFlow: true,
          positioningBoardMode: "storyboard",
        },
      },
    });
    await prisma.generation.update({
      where: { id: generation.id },
      data: {
        aiModelId: result.model.id,
        status: "SUCCEEDED",
        completedAt: new Date(),
        parameters: {
          image_urls: referenceImageUrls,
          model: result.model,
          durationMs: result.durationMs,
          outputCount: 1,
        },
      },
    });
    await saveNodeOutput(node.id, {
      status: "completed",
      error: "",
      outputImage: stored.url,
      outputImageAssetId: asset.id,
      outputImages: [{
        url: stored.url,
        assetId: asset.id,
        title: stringValue(data.title || data.clipTitle || node.id),
        revisedPrompt: image.revisedPrompt || "",
      }],
      revisedPrompt: image.revisedPrompt || "",
      submittedPrompt: prompt,
      generationStartedAt: "",
      modelId: result.model.id,
      positioningBoardMode: "storyboard",
    });
    return { ok: true, url: stored.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown error");
    await prisma.generation.update({
      where: { id: generation.id },
      data: { status: "FAILED", errorMessage: message, completedAt: new Date() },
    }).catch(() => undefined);
    await saveNodeOutput(node.id, {
      status: "failed",
      error: message,
      generationStartedAt: "",
      positioningBoardMode: "storyboard",
    });
    return { ok: false, error: message };
  }
}

let lastMissing = Number.POSITIVE_INFINITY;
let consecutiveNoProgress = 0;
for (let round = 1; round <= maxRounds; round += 1) {
  const loaded = await loadProject();
  const candidates = loaded.nodes.filter((node) => {
    const data = isRecord(node.data) ? node.data : {};
    return node.type === "generation" &&
      data.positioningBoardFlow === true &&
      stringValue(data.positioningBoardMode || "storyboard") === "storyboard" &&
      !hasOutput(data);
  });
  console.log(JSON.stringify({ round, missing: candidates.length }, null, 2));
  if (!candidates.length) break;
  if (candidates.length >= lastMissing) consecutiveNoProgress += 1;
  else consecutiveNoProgress = 0;
  lastMissing = candidates.length;
  if (consecutiveNoProgress >= 3) {
    console.error("No progress for three rounds; stopping.");
    break;
  }
  for (const node of candidates) {
    const data = isRecord(node.data) ? node.data : {};
    console.log(`Generating ${node.id} ${stringValue(data.title)}`);
    const result = await generateOne(node, loaded.nodes, loaded.edges, loaded.project.ownerId);
    console.log(JSON.stringify({ nodeId: node.id, ...result }, null, 2));
  }
}

const finalState = await loadProject();
const remaining = finalState.nodes.filter((node) => {
  const data = isRecord(node.data) ? node.data : {};
  return node.type === "generation" &&
    data.positioningBoardFlow === true &&
    stringValue(data.positioningBoardMode || "storyboard") === "storyboard" &&
    !hasOutput(data);
});
console.log(JSON.stringify({
  projectId,
  episodeId,
  remaining: remaining.length,
  remainingNodes: remaining.map((node) => ({ id: node.id, title: stringValue(node.data?.title), error: stringValue(node.data?.error) })),
}, null, 2));

await prisma.$disconnect();
