import { prisma } from "../server/src/lib/prisma";
import { workflowMaintenanceInternals } from "../server/src/routes/workflows";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = process.argv[3] || "episode-001";
const clipId = process.argv[4] || "clip-006";

type CanvasNode = {
  id?: string;
  type?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const project = await prisma.project.findUnique({
  where: { id: projectId },
  select: { id: true, name: true, aspectRatio: true, settings: true, metadata: true },
});

if (!project) {
  console.error(`Project not found: ${projectId}`);
  process.exit(1);
}

const metadata = isRecord(project.metadata) ? project.metadata : {};
const workflow = workflowMaintenanceInternals.getWorkflowState(metadata, episodeId);
const clipIndex = workflow.clips.findIndex((clip) => clip.id === clipId);
if (clipIndex < 0) {
  console.error(`Clip not found: ${clipId}`);
  process.exit(1);
}

const clip = workflow.clips[clipIndex];
const shotIds = new Set(clip.shotIds);
const shots = workflow.breakdownScenes.filter((shot) => shotIds.has(shot.id));
if (shots.length === 0) {
  console.error(`Clip has no linked shots: ${clipId}`);
  process.exit(1);
}

const generated = workflowMaintenanceInternals.regenerateWorkflowClipSeedancePrompt(project, workflow, clip, shots);
const nextClip = {
  ...clip,
  ...generated,
};
const nextWorkflow = {
  ...workflow,
  clips: workflow.clips.map((item, index) => (index === clipIndex ? nextClip : item)),
  stageStatuses: {
    ...workflow.stageStatuses,
    video: "done",
  },
  lastRun: {
    ...(isRecord(workflow.lastRun) ? workflow.lastRun : {}),
    status: "seedance-prompt-regenerated",
    stage: "video",
    clipId,
    completedAt: new Date().toISOString(),
  },
  updatedAt: new Date().toISOString(),
};

let nextMetadata = workflowMaintenanceInternals.writeWorkflowEpisode(metadata, episodeId, nextWorkflow, true);
const canvasScenes = isRecord(nextMetadata.canvasScenes) ? nextMetadata.canvasScenes : {};
const scene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : null;
let updatedCanvasNodes = 0;
if (scene && Array.isArray(scene.nodes)) {
  const nodes = (scene.nodes as CanvasNode[]).map((node) => {
    const data = isRecord(node.data) ? node.data : {};
    if (node.type !== "video" || data.clipId !== clipId) return node;
    updatedCanvasNodes += 1;
    return {
      ...node,
      data: {
        ...data,
        prompt: nextClip.seedancePrompt,
        seedancePrompt: nextClip.seedancePrompt,
        videoPrompt: nextClip.seedancePrompt,
      },
    };
  });
  nextMetadata = {
    ...nextMetadata,
    canvasScenes: {
      ...canvasScenes,
      [episodeId]: {
        ...scene,
        nodes,
        updatedAt: new Date().toISOString(),
      },
    },
  };
}

await prisma.project.update({
  where: { id: projectId },
  data: { metadata: nextMetadata },
});

console.log(JSON.stringify({
  projectId,
  episodeId,
  clipId,
  shotCount: shots.length,
  promptLength: nextClip.seedancePrompt.length,
  updatedCanvasNodes,
  prompt: nextClip.seedancePrompt,
}, null, 2));

await prisma.$disconnect();
