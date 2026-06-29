import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = process.argv[3] || "episode-010";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const stalePattern = /green stain|still wet|earlier green stain|green sludge still|still sticky|绿色污渍|污渍依然|依然粘着|仍然湿/i;

const project = await prisma.project.findUnique({
  where: { id: projectId },
  select: { metadata: true },
});

if (!project) {
  console.error(`Project not found: ${projectId}`);
  process.exit(1);
}

const metadata = isRecord(project.metadata) ? project.metadata : {};
const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
const scene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : null;
if (!scene) {
  console.error(`Canvas scene not found: ${episodeId}`);
  process.exit(1);
}

const nodes = Array.isArray(scene.nodes) ? scene.nodes.filter(isRecord) : [];
let cleaned = 0;
let markedWaiting = 0;
const nextNodes = nodes.map((node) => {
  const data = isRecord(node.data) ? node.data : {};
  if (node.type !== "generation" || data.positioningBoardFlow !== true) return node;
  const currentPrompt = String(data.finalPrompt || data.prompt || "");
  const historicalText = [
    data.submittedPrompt,
    data.stoppedSubmittedPrompt,
    data.revisedPrompt,
    data.outputImage ? "hasOutput" : "",
  ].map(String).join("\n");
  const currentHasStale = stalePattern.test(currentPrompt);
  const historyHasStale = stalePattern.test(historicalText);
  if (!currentHasStale && !historyHasStale) return node;
  cleaned += 1;
  const hasOutput = Boolean(data.outputImage || (Array.isArray(data.outputImages) && data.outputImages.length > 0));
  if (hasOutput) markedWaiting += 1;
  return {
    ...node,
    data: {
      ...data,
      submittedPrompt: "",
      stoppedSubmittedPrompt: "",
      revisedPrompt: "",
      status: currentHasStale ? "waiting" : data.status,
      error: currentHasStale ? "定位板提示词已清理，请重新生成。" : data.error,
      ...(currentHasStale
        ? {
            outputImage: "",
            outputImageAssetId: "",
            outputImages: [],
            generationId: "",
          }
        : {}),
    },
  };
});

const nextScene = {
  ...scene,
  nodes: nextNodes,
  updatedAt: new Date().toISOString(),
};

await prisma.project.update({
  where: { id: projectId },
  data: {
    metadata: {
      ...metadata,
      canvasScenes: {
        ...canvasScenes,
        [episodeId]: nextScene,
      },
    },
  },
});

console.log(JSON.stringify({
  projectId,
  episodeId,
  cleaned,
  markedWaiting,
  nodes: nextNodes.length,
}, null, 2));

await prisma.$disconnect();
