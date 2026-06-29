import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../server/src/lib/prisma";
import { callConfiguredImageModel } from "../server/src/ai/imageModel";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const startEpisode = Number(process.argv[3] || 18);
const endEpisode = Number(process.argv[4] || 25);
const concurrency = Math.max(1, Math.min(6, Number(process.argv[5] || 3)));
const maxAttempts = Math.max(1, Number(process.argv[6] || 3));

type CanvasNode = { id: string; type?: string; data?: Record<string, unknown>; [key: string]: unknown };
type CanvasEdge = { source?: string; target?: string; [key: string]: unknown };
type Job = { episodeId: string; nodeId: string };

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
  return { buffer: Buffer.from(match[2].replace(/\s+/g, ""), "base64"), mimeType, extension: extensionForContentType(mimeType) };
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
      headers: { "User-Agent": "Mozilla/5.0 Loohii/1.0", Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" },
    });
    if (!response.ok) throw new Error(`download image failed: HTTP ${response.status}`);
    mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "image/png";
    extension = extensionForContentType(mimeType);
    buffer = Buffer.from(await response.arrayBuffer());
  }
  if (!buffer.length) throw new Error("image output is empty");
  const key = [
    options.userId,
    "generated",
    options.projectId,
    `storyboard-board-${safePart(options.nodeId, "node")}-${options.generationId}.${extension}`,
  ].join("/");
  const uploadRoot = process.env.LOCAL_UPLOAD_ROOT || "/var/lib/loohii/uploads";
  await mkdir(path.dirname(path.join(uploadRoot, key)), { recursive: true });
  await writeFile(path.join(uploadRoot, key), buffer);
  return { url: `https://loohii.com/api/uploads/public/${key.split("/").map(encodeURIComponent).join("/")}`, mimeType };
}

function referenceUrlsForNode(nodes: CanvasNode[], edges: CanvasEdge[], targetId: string): string[] {
  const incoming = edges.filter((edge) => edge.target === targetId).map((edge) => stringValue(edge.source));
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const nodeId of incoming) {
    const node = nodes.find((item) => item.id === nodeId);
    const data = isRecord(node?.data) ? node.data : {};
    const url = publicImageLike(data.imageUrl || data.outputImage || data.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= 12) break;
  }
  return urls;
}

function episodeNumber(episodeId: string): number {
  return Number(episodeId.match(/(\d+)/)?.[1] || 0);
}

async function collectJobs(): Promise<Job[]> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
  if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);
  const canvasScenes = isRecord(project.metadata.canvasScenes) ? project.metadata.canvasScenes : {};
  const jobs: Job[] = [];
  for (const [episodeId, scene] of Object.entries(canvasScenes)) {
    const number = episodeNumber(episodeId);
    if (number < startEpisode || number > endEpisode || !isRecord(scene)) continue;
    const nodes = Array.isArray(scene.nodes) ? scene.nodes.filter(isRecord) as CanvasNode[] : [];
    for (const node of nodes) {
      const data = isRecord(node.data) ? node.data : {};
      if (
        node.type === "generation" &&
        data.positioningBoardFlow === true &&
        stringValue(data.positioningBoardMode || "storyboard") === "storyboard" &&
        !hasOutput(data)
      ) {
        jobs.push({ episodeId, nodeId: node.id });
      }
    }
  }
  jobs.sort((a, b) => a.episodeId.localeCompare(b.episodeId) || a.nodeId.localeCompare(b.nodeId));
  return jobs;
}

async function loadJob(job: Job) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, ownerId: true, metadata: true } });
  if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);
  const canvasScenes = isRecord(project.metadata.canvasScenes) ? project.metadata.canvasScenes : {};
  const scene = isRecord(canvasScenes[job.episodeId]) ? canvasScenes[job.episodeId] : null;
  if (!scene) throw new Error(`Canvas scene not found: ${job.episodeId}`);
  const nodes = Array.isArray(scene.nodes) ? scene.nodes.filter(isRecord) as CanvasNode[] : [];
  const edges = Array.isArray(scene.edges) ? scene.edges.filter(isRecord) as CanvasEdge[] : [];
  const node = nodes.find((item) => item.id === job.nodeId);
  if (!node || !isRecord(node.data)) throw new Error(`Node not found: ${job.episodeId}/${job.nodeId}`);
  return { project, metadata: project.metadata, canvasScenes, scene, nodes, edges, node, data: node.data };
}

async function patchNode(job: Job, patch: Record<string, unknown>) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
    if (!project || !isRecord(project.metadata)) throw new Error(`Project not found while patching: ${projectId}`);
    const metadata = project.metadata as Record<string, unknown>;
    const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
    const scene = isRecord(canvasScenes[job.episodeId]) ? canvasScenes[job.episodeId] as Record<string, unknown> : null;
    if (!scene) throw new Error(`Canvas scene not found while patching: ${job.episodeId}`);
    const nodes = Array.isArray(scene.nodes) ? scene.nodes.filter(isRecord) as CanvasNode[] : [];
    const nextNodes = nodes.map((node) => node.id === job.nodeId ? { ...node, data: { ...(isRecord(node.data) ? node.data : {}), ...patch } } : node);
    await tx.project.update({
      where: { id: projectId },
      data: {
        metadata: {
          ...metadata,
          canvasScenes: {
            ...canvasScenes,
            [job.episodeId]: { ...scene, nodes: nextNodes, updatedAt: new Date().toISOString() },
          },
        },
      },
    });
  }, { timeout: 30000, maxWait: 30000 });
}

async function generateJob(job: Job, attempt: number) {
  const loaded = await loadJob(job);
  if (hasOutput(loaded.data)) return { skipped: true };
  const prompt = activePrompt(loaded.data);
  if (!prompt) throw new Error("missing prompt");
  const aiModelId = stringValue(loaded.data.modelId) || undefined;
  const size = stringValue(loaded.data.size) || "16:9";
  const referenceImageUrls = referenceUrlsForNode(loaded.nodes, loaded.edges, job.nodeId);
  await patchNode(job, { status: "generating", error: "", generationStartedAt: new Date().toISOString(), positioningBoardMode: "storyboard" }).catch((error) => {
    console.error(JSON.stringify({ event: "start-state-write-failed", ...job, error: error instanceof Error ? error.message : String(error) }));
  });
  const generation = await prisma.generation.create({
    data: {
      projectId,
      userId: loaded.project.ownerId,
      aiModelId,
      prompt,
      input: {
        kind: "canvas-image-generation",
        size,
        referenceImageUrls,
        metadata: {
          clipId: stringValue(loaded.data.clipId),
          clipTitle: stringValue(loaded.data.clipTitle || loaded.data.title),
          clipNodeKind: "positioning-board",
          positioningBoardFlow: true,
          positioningBoardMode: "storyboard",
          sourceEpisodeId: job.episodeId,
          canvasNodeId: job.nodeId,
          attempt,
        },
      },
      parameters: { image_urls: referenceImageUrls },
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
    const stored = await imageToLocalPublicUrl(image.url, { userId: loaded.project.ownerId, projectId, generationId: generation.id, nodeId: job.nodeId });
    const asset = await prisma.asset.create({
      data: {
        projectId,
        uploadedById: loaded.project.ownerId,
        generationId: generation.id,
        type: "IMAGE",
        title: `${stringValue(loaded.data.title || loaded.data.clipTitle || job.nodeId)} generated storyboard board`,
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
          clipId: stringValue(loaded.data.clipId),
          sourceEpisodeId: job.episodeId,
          canvasNodeId: job.nodeId,
          positioningBoardFlow: true,
          positioningBoardMode: "storyboard",
          attempt,
        },
      },
    });
    await prisma.generation.update({
      where: { id: generation.id },
      data: {
        aiModelId: result.model.id,
        status: "SUCCEEDED",
        completedAt: new Date(),
        parameters: { image_urls: referenceImageUrls, model: result.model, durationMs: result.durationMs, outputCount: 1 },
      },
    });
    await patchNode(job, {
      status: "completed",
      error: "",
      outputImage: stored.url,
      outputImageAssetId: asset.id,
      outputImages: [{ url: stored.url, assetId: asset.id, title: stringValue(loaded.data.title || loaded.data.clipTitle || job.nodeId), revisedPrompt: image.revisedPrompt || "" }],
      revisedPrompt: image.revisedPrompt || "",
      submittedPrompt: prompt,
      generationStartedAt: "",
      modelId: result.model.id,
      positioningBoardMode: "storyboard",
    });
    return { ok: true, url: stored.url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "unknown error");
    await prisma.generation.update({ where: { id: generation.id }, data: { status: "FAILED", errorMessage: message, completedAt: new Date() } }).catch(() => undefined);
    await patchNode(job, { status: "failed", error: message, generationStartedAt: "", positioningBoardMode: "storyboard" });
    throw error;
  }
}

async function worker(name: string, queue: Job[], failures: Array<{ job: Job; error: string }>) {
  while (queue.length > 0) {
    const job = queue.shift();
    if (!job) break;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        console.log(JSON.stringify({ worker: name, event: "start", attempt, ...job }));
        const result = await generateJob(job, attempt);
        console.log(JSON.stringify({ worker: name, event: "done", attempt, ...job, ...result }));
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(JSON.stringify({ worker: name, event: "failed", attempt, ...job, error: message }));
        if (attempt === maxAttempts) failures.push({ job, error: message });
      }
    }
  }
}

const jobs = await collectJobs();
console.log(JSON.stringify({ projectId, startEpisode, endEpisode, concurrency, maxAttempts, jobs: jobs.length }, null, 2));
const queue = [...jobs];
const failures: Array<{ job: Job; error: string }> = [];
await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(`w${index + 1}`, queue, failures)));
const remaining = await collectJobs();
console.log(JSON.stringify({ projectId, failures, remaining: remaining.length, remainingNodes: remaining.slice(0, 50) }, null, 2));
await prisma.$disconnect();
