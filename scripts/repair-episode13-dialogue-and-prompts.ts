import { prisma } from "../server/src/lib/prisma";
import { workflowMaintenanceInternals } from "../server/src/routes/workflows";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = process.argv[3] || "episode-013";

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

if (!project || !isRecord(project.metadata)) {
  console.error(`Project not found or invalid metadata: ${projectId}`);
  process.exit(1);
}

const metadata = project.metadata;
const workflow = workflowMaintenanceInternals.getWorkflowState(metadata, episodeId);
const breakdownScenes = workflow.breakdownScenes.map((shot) => {
  if (shot.id === "shot-026") {
    return {
      ...shot,
      dialogue: 'Flora: No! This is impossible! This is the will of the Earth! I am your Mother!',
      action: "Flora backs away in absolute terror, rejecting the hive's turn against her.",
      description:
        "Flora backs away in absolute terror as her own worshippers lock onto her like prey; Warning Girl leads the infected pack toward Flora.",
      characters: Array.from(new Set([...(shot.characters ?? []), "Flora", "Warning Girl", "Children of the Earth"])),
      subtitle: 'Flora: No! This is impossible! This is the will of the Earth! I am your Mother!',
    };
  }
  if (shot.id === "shot-031") {
    return {
      ...shot,
      dialogue: "Girl: Return to the earth... become one... The Earth Mother is hungry... Mother feeds us first.",
      action: "Warning Girl parrots Flora's doctrine mechanically while advancing toward her.",
      description:
        "Warning Girl stares blankly, half her face consumed by white mycelium, repeating the cult doctrine before the attack.",
      characters: Array.from(new Set([...(shot.characters ?? []), "Warning Girl", "Girl"])),
      subtitle: "Girl: Return to the earth... become one... The Earth Mother is hungry... Mother feeds us first.",
    };
  }
  return shot;
});

const workflowForGeneration = { ...workflow, breakdownScenes };
const shotsById = new Map(breakdownScenes.map((shot) => [shot.id, shot]));
const regenerated: Array<{ clipId: string; title: string; shotCount: number; promptLength: number }> = [];
const nextClips = workflow.clips.map((clip, index) => {
  const shots = clip.shotIds
    .map((shotId) => shotsById.get(shotId))
    .filter((shot): shot is NonNullable<typeof shot> => Boolean(shot));
  if (shots.length === 0) return clip;
  const previousClip = index > 0 ? workflow.clips[index - 1] : null;
  const sameSettingPreviousClip = previousClip && normalizeText(previousClip.setting) === normalizeText(clip.setting) ? previousClip : null;
  const generated = workflowMaintenanceInternals.regenerateWorkflowClipSeedancePrompt(project, workflowForGeneration, {
    ...clip,
    startState: sameSettingPreviousClip
      ? [sameSettingPreviousClip.startState, sameSettingPreviousClip.endState, sameSettingPreviousClip.layoutMemory, clip.startState].filter(Boolean).join("; ")
      : clip.startState,
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
  breakdownScenes,
  clips: nextClips,
  stageStatuses: {
    ...workflow.stageStatuses,
    storyboard: "done",
    video: "done",
  },
  lastRun: {
    status: "episode-13-dialogue-repaired",
    stage: "video",
    completedAt: new Date().toISOString(),
  },
  updatedAt: new Date().toISOString(),
};

let nextMetadata = workflowMaintenanceInternals.writeWorkflowEpisode(metadata, episodeId, nextWorkflow, true);
const promptByClipId = new Map(nextClips.map((clip) => [clip.id, clip.seedancePrompt]));
const canvasScenes = isRecord(nextMetadata.canvasScenes) ? nextMetadata.canvasScenes : {};
const scene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : null;
let updatedCanvasNodes = 0;
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
  repairedShots: ["shot-026", "shot-031"],
  regeneratedCount: regenerated.length,
  updatedCanvasNodes,
  regenerated,
}, null, 2));

await prisma.$disconnect();

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}
