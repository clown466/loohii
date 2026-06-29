import { prisma } from "../server/src/lib/prisma";
import { workflowMaintenanceInternals } from "../server/src/routes/workflows";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = process.argv[3] || "episode-011";

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
const shotsById = new Map(workflow.breakdownScenes.map((shot) => [shot.id, shot]));

const regenerated: Array<{ clipId: string; title: string; shotCount: number; promptLength: number }> = [];
const nextClips = workflow.clips.map((clip, index) => {
  const shots = clip.shotIds.map((shotId) => shotsById.get(shotId)).filter((shot): shot is NonNullable<typeof shot> => Boolean(shot));
  if (shots.length === 0) return clip;
  const previousClip = index > 0 ? workflow.clips[index - 1] : null;
  const sameSettingPreviousClip = previousClip && normalizeText(previousClip.setting) === normalizeText(clip.setting) ? previousClip : null;
  const inheritedInitialState = sameSettingPreviousClip
    ? [sameSettingPreviousClip.startState, sameSettingPreviousClip.endState, sameSettingPreviousClip.layoutMemory, clip.startState].filter(Boolean).join("; ")
    : clip.startState;
  const generated = workflowMaintenanceInternals.regenerateWorkflowClipSeedancePrompt(project, workflow, {
    ...clip,
    startState: inheritedInitialState,
    layoutMemory: [sameSettingPreviousClip?.layoutMemory, sameSettingPreviousClip?.endState, clip.layoutMemory].filter(Boolean).join("\n"),
  }, shots);
  const nextClip = { ...clip, ...generated };
  regenerated.push({
    clipId: clip.id,
    title: clip.title,
    shotCount: shots.length,
    promptLength: nextClip.seedancePrompt.length,
  });
  return nextClip;
});

const nextWorkflow = {
  ...workflow,
  clips: nextClips,
  stageStatuses: {
    ...workflow.stageStatuses,
    video: "done",
  },
  lastRun: {
    status: "episode-seedance-prompts-regenerated",
    stage: "video",
    completedAt: new Date().toISOString(),
  },
  updatedAt: new Date().toISOString(),
};

let nextMetadata = workflowMaintenanceInternals.writeWorkflowEpisode(metadata, episodeId, nextWorkflow, true);
const promptByClipId = new Map(nextClips.map((clip) => [clip.id, clip.seedancePrompt]));
let updatedCanvasNodes = 0;
const canvasScenes = isRecord(nextMetadata.canvasScenes) ? nextMetadata.canvasScenes : {};
const scene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : null;
if (scene && Array.isArray(scene.nodes)) {
  const nodes = (scene.nodes as CanvasNode[]).map((node) => {
    const data = isRecord(node.data) ? node.data : {};
    const clipId = typeof data.clipId === "string" ? data.clipId : "";
    const prompt = clipId ? promptByClipId.get(clipId) : "";
    if (node.type !== "video" || !prompt) return node;
    updatedCanvasNodes += 1;
    return {
      ...node,
      data: {
        ...data,
        prompt,
        seedancePrompt: prompt,
        videoPrompt: prompt,
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
  regeneratedCount: regenerated.length,
  updatedCanvasNodes,
  regenerated,
}, null, 2));

await prisma.$disconnect();

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}
