import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = process.argv[3] || "episode-010";

type CanvasNode = {
  id?: unknown;
  type?: unknown;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

type CanvasEdge = {
  source?: unknown;
  target?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nodePrompt(node: CanvasNode | undefined): string {
  const data = isRecord(node?.data) ? node.data : {};
  if (node?.type === "video") return String(data.seedancePrompt || data.videoPrompt || data.prompt || "").trim();
  if (node?.type === "generation") return String(data.finalPrompt || data.prompt || data.submittedPrompt || data.visualPrompt || "").trim();
  return String(data.finalPrompt || data.seedancePrompt || data.videoPrompt || data.prompt || data.sourcePrompt || data.description || "").trim();
}

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

const nodes = Array.isArray(scene.nodes) ? scene.nodes.filter(isRecord) as CanvasNode[] : [];
const edges = Array.isArray(scene.edges) ? scene.edges.filter(isRecord) as CanvasEdge[] : [];
const nodeById = new Map(nodes.map((node) => [String(node.id || ""), node]));

let reset = 0;
const nextNodes = nodes.map((node) => {
  if (node.type !== "translation") return node;
  const data = isRecord(node.data) ? node.data : {};
  const sourceId = String(data.sourceNodeId || edges.find((edge) => String(edge.target || "") === String(node.id || ""))?.source || "");
  const source = sourceId ? nodeById.get(sourceId) : undefined;
  const sourcePrompt = nodePrompt(source);
  const storedSourcePrompt = String(data.sourcePrompt || "").trim();
  if (!sourcePrompt || sourcePrompt === storedSourcePrompt) return node;
  reset += 1;
  return {
    ...node,
    data: {
      ...data,
      sourcePrompt,
      sourceNodeId: sourceId,
      sourceNodeLabel: String(isRecord(source?.data) ? source.data.title || source.data.label || "上游节点" : "上游节点"),
      translatedPrompt: "",
      status: "waiting",
      error: "左侧提示词已更新，旧译文已清空，请重新翻译。",
      translationStartedAt: "",
    },
  };
});

const nextScene = {
  ...scene,
  nodes: nextNodes,
  edges,
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
  reset,
  nodes: nextNodes.length,
  edges: edges.length,
}, null, 2));

await prisma.$disconnect();
