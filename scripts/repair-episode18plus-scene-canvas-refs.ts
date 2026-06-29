import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value: unknown): string {
  return stringValue(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function assetImage(asset: Record<string, unknown>): { url: string; assetId: string } {
  return {
    url: stringValue(asset.referenceImageUrl) || stringValue(asset.generatedImageUrl) || stringValue(asset.imageUrl),
    assetId: stringValue(asset.referenceImageAssetId) || stringValue(asset.generatedImageAssetId) || stringValue(asset.assetId),
  };
}

function boardNode(node: Record<string, unknown>): boolean {
  if (node.type !== "generation" || !isRecord(node.data)) return false;
  return node.data.positioningBoardFlow === true && stringValue(node.data.positioningBoardMode || "storyboard") === "storyboard";
}

function resetBoard(node: Record<string, unknown>): Record<string, unknown> {
  const data = isRecord(node.data) ? node.data : {};
  return {
    ...node,
    data: {
      ...data,
      status: "idle",
      error: "",
      outputImage: "",
      outputImageAssetId: "",
      outputImages: [],
      revisedPrompt: "",
      generationStartedAt: "",
    },
  };
}

async function main() {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
  if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);
  const metadata = project.metadata as Record<string, unknown>;
  const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
  const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
  const nextCanvasScenes: Record<string, unknown> = { ...canvasScenes };
  const report: unknown[] = [];
  let changed = false;

  for (const [episodeId, episode] of Object.entries(episodes)) {
    if (!/^episode-\d+/.test(episodeId) || Number(episodeId.match(/\d+/)?.[0] || 0) < 18) continue;
    if (!isRecord(episode) || !isRecord(episode.workflowCenter)) continue;
    const workflow = episode.workflowCenter;
    const assets = isRecord(workflow.assets) ? workflow.assets : {};
    const sceneAssets = Array.isArray(assets.scenes) ? assets.scenes.filter(isRecord) : [];
    const sceneByName = new Map(sceneAssets.map((asset) => [normalize(asset.name || asset.title), assetImage(asset)]));
    const canvas = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] as Record<string, unknown> : null;
    if (!canvas) continue;
    const nodes = Array.isArray(canvas.nodes) ? canvas.nodes.filter(isRecord) : [];
    let sceneRefsPatched = 0;
    let boardsReset = 0;
    const nextNodes = nodes.map((node) => {
      if (boardNode(node)) {
        boardsReset += 1;
        return resetBoard(node);
      }
      if (node.type !== "imageInput" || !isRecord(node.data)) return node;
      const data = node.data;
      if (stringValue(data.assetKind) !== "scenes") return node;
      const image = sceneByName.get(normalize(data.assetName || data.label));
      if (!image?.url) return node;
      const patch = {
        imageUrl: image.url,
        clipSyncUrl: image.url,
        assetId: image.assetId,
        clipSyncAssetId: image.assetId,
        uploadStatus: "linked",
        uploadError: "",
        imageLoadError: false,
        sourceEpisodeId: episodeId,
      };
      const same = Object.entries(patch).every(([key, value]) => data[key] === value);
      if (same) return node;
      sceneRefsPatched += 1;
      return { ...node, data: { ...data, ...patch } };
    });
    if (sceneRefsPatched || boardsReset) {
      nextCanvasScenes[episodeId] = { ...canvas, nodes: nextNodes, updatedAt: new Date().toISOString() };
      changed = true;
    }
    report.push({ episodeId, sceneRefsPatched, boardsReset });
  }

  if (changed) {
    await prisma.project.update({
      where: { id: projectId },
      data: { metadata: { ...metadata, canvasScenes: nextCanvasScenes, updatedAt: new Date().toISOString() } },
    });
  }
  console.log(JSON.stringify({ projectId, changed, report }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
