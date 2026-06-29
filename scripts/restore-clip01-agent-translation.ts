import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = process.argv[3] || "episode-001";
const sourceNodeId = "episode-sync-video-node-episode-001-clip-001";
const translationNodeId = `batch-translation-node-${sourceNodeId}`;
const agentNodeId = "agent-mqgbtrxl-4";
const agentRequest = "稍微修改这个提示词，把其中可能涉及到不过审的描述修改下，不要修改任何对白内容";
const deepSeek4FlashModelId = "cmpzd56ip00013knm72nkl1o0";

type CanvasNode = {
  id: string;
  type?: string;
  position?: { x?: number; y?: number };
  parentId?: string;
  data?: Record<string, unknown>;
  style?: Record<string, unknown>;
  [key: string]: unknown;
};

type CanvasEdge = {
  id: string;
  source?: string;
  target?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  [key: string]: unknown;
};

const project = await prisma.project.findUnique({
  where: { id: projectId },
  select: { metadata: true },
});

if (!project) {
  console.error(`Project not found: ${projectId}`);
  process.exit(1);
}

const metadata = project.metadata && typeof project.metadata === "object" && !Array.isArray(project.metadata)
  ? project.metadata as Record<string, unknown>
  : {};
const canvasScenes = metadata.canvasScenes && typeof metadata.canvasScenes === "object" && !Array.isArray(metadata.canvasScenes)
  ? metadata.canvasScenes as Record<string, Record<string, unknown>>
  : {};
const scene = canvasScenes[episodeId];

if (!scene) {
  console.error(`Canvas scene not found: ${episodeId}`);
  process.exit(1);
}

const nodes = Array.isArray(scene.nodes) ? scene.nodes as CanvasNode[] : [];
const edges = Array.isArray(scene.edges) ? scene.edges as CanvasEdge[] : [];
const sourceNode = nodes.find((node) => node.id === sourceNodeId);

if (!sourceNode) {
  console.error(`Source node not found: ${sourceNodeId}`);
  process.exit(1);
}

const sourceData = sourceNode.data && typeof sourceNode.data === "object" ? sourceNode.data : {};
const sourcePrompt = String(sourceData.seedancePrompt || sourceData.videoPrompt || sourceData.prompt || "").trim();
const sourceLabel = String(sourceData.title || "Clip 01 · Shotgun at the dock 视频任务");

if (!sourcePrompt) {
  console.error(`Source node has no prompt: ${sourceNodeId}`);
  process.exit(1);
}

const upsertNode = (node: CanvasNode) => {
  const index = nodes.findIndex((item) => item.id === node.id);
  if (index >= 0) {
    nodes[index] = {
      ...nodes[index],
      ...node,
      data: {
        ...(nodes[index].data ?? {}),
        ...(node.data ?? {}),
      },
      style: {
        ...(nodes[index].style ?? {}),
        ...(node.style ?? {}),
      },
    };
    return "updated";
  }
  nodes.push(node);
  return "created";
};

const upsertEdge = (edge: CanvasEdge) => {
  const index = edges.findIndex((item) => item.id === edge.id || (item.source === edge.source && item.target === edge.target));
  if (index >= 0) {
    edges[index] = {
      ...edges[index],
      ...edge,
    };
    return "updated";
  }
  edges.push(edge);
  return "created";
};

const translationResult = upsertNode({
  id: translationNodeId,
  type: "translation",
  position: { x: 1496.990475607917, y: 120 },
  style: { width: 520 },
  data: {
    title: `${sourceLabel} · 中文翻译`,
    sourceLanguage: "auto",
    targetLanguage: "Chinese",
    sourcePrompt,
    translatedPrompt: "",
    status: "waiting",
    error: "",
    modelId: deepSeek4FlashModelId,
    preserveStructure: true,
    sourceNodeId,
    sourceNodeLabel: sourceLabel,
    translationStartedAt: "",
    batchTranslation: true,
    sourceEpisodeId: episodeId,
  },
});

const translationEdgeResult = upsertEdge({
  id: `batch-translation-${sourceNodeId}-${translationNodeId}`,
  source: sourceNodeId,
  sourceHandle: null,
  target: translationNodeId,
  targetHandle: null,
  type: "smoothstep",
});

const agentResult = upsertNode({
  id: agentNodeId,
  type: "agent",
  position: { x: 2700, y: 120 },
  style: { width: 520, height: 430 },
  data: {
    title: "智能体",
    request: agentRequest,
    lastRequest: agentRequest,
    status: "waiting",
    error: "",
    linkedNodeCount: 1,
    linkedNodeLabels: sourceLabel,
  },
});

const agentEdgeResult = upsertEdge({
  id: `restored-agent-${sourceNodeId}-${agentNodeId}`,
  source: sourceNodeId,
  sourceHandle: null,
  target: agentNodeId,
  targetHandle: null,
  type: "smoothstep",
});

const nextMetadata = {
  ...metadata,
  activeCanvasSceneId: episodeId,
  canvasScenes: {
    ...canvasScenes,
    [episodeId]: {
      ...scene,
      nodes,
      edges,
      updatedAt: new Date().toISOString(),
    },
  },
};

await prisma.project.update({
  where: { id: projectId },
  data: { metadata: nextMetadata },
});

console.log(JSON.stringify({
  projectId,
  episodeId,
  sourceNodeId,
  translationNodeId,
  translationResult,
  translationEdgeResult,
  agentNodeId,
  agentResult,
  agentEdgeResult,
  nodes: nodes.length,
  edges: edges.length,
}, null, 2));

await prisma.$disconnect();
