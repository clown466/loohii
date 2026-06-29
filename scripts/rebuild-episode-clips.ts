import { prisma } from "../server/src/lib/prisma";
import { buildEpisodeCanvasSyncScene } from "../server/src/lib/episodeCanvasSync";
import { workflowMaintenanceInternals } from "../server/src/routes/workflows";
import { metadataWithProjectSettings, projectGenerationStrategyFromMetadata } from "../server/src/lib/projectGenerationStrategy";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = process.argv[3] || "episode-013";

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

const baseMetadata = project.metadata;
const metadata = metadataWithProjectSettings(baseMetadata, project.settings);
const workflow = workflowMaintenanceInternals.getWorkflowState(metadata, episodeId);
if (workflow.breakdownScenes.length === 0) {
  console.error(`Episode has no breakdownScenes: ${episodeId}`);
  process.exit(1);
}

const oldClips = workflow.clips.map((clip) => ({
  id: clip.id,
  title: clip.title,
  estimatedDuration: clip.estimatedDuration,
  shotCount: clip.shotIds.length,
}));
const nextClips = workflowMaintenanceInternals.deriveWorkflowClipsFromShots(workflow.breakdownScenes, {
  aspectRatio: project.aspectRatio,
  visualStyle: "",
  characterIdentities: {},
  assets: workflow.assets,
});
const regeneratedClips = nextClips.map((clip) => {
  const shots = clip.shotIds
    .map((shotId) => workflow.breakdownScenes.find((shot) => shot.id === shotId))
    .filter((shot): shot is NonNullable<typeof shot> => Boolean(shot));
  const generated = workflowMaintenanceInternals.regenerateWorkflowClipSeedancePrompt(project, {
    ...workflow,
    clips: nextClips,
  }, clip, shots);
  return { ...clip, ...generated };
});

let nextMetadata = workflowMaintenanceInternals.writeWorkflowEpisode(baseMetadata, episodeId, {
  ...workflow,
  clips: regeneratedClips,
  stageStatuses: {
    ...workflow.stageStatuses,
    storyboard: "done",
    video: "done",
  },
  lastRun: {
    ...(isRecord(workflow.lastRun) ? workflow.lastRun : {}),
    status: "episode-clips-rebuilt",
    stage: "storyboard",
    rebuiltAt: new Date().toISOString(),
  },
  updatedAt: new Date().toISOString(),
}, true);

const canvasScenes = isRecord(nextMetadata.canvasScenes) ? nextMetadata.canvasScenes : {};
const existingScene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : undefined;
const sync = buildEpisodeCanvasSyncScene({
  metadata: metadataWithProjectSettings(nextMetadata, project.settings),
  episodeId,
  generationStrategy: projectGenerationStrategyFromMetadata(metadataWithProjectSettings(nextMetadata, project.settings)),
  existingScene,
});
const nextCanvasScenes = isRecord(nextMetadata.canvasScenes) ? nextMetadata.canvasScenes : {};
nextMetadata = {
  ...nextMetadata,
  canvasScenes: {
    ...nextCanvasScenes,
    [sync.sceneId]: {
      nodes: sync.nodes,
      edges: sync.edges,
      updatedAt: sync.updatedAt,
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
  before: {
    clipCount: oldClips.length,
    durations: oldClips.map((clip) => clip.estimatedDuration),
    shortClips: oldClips.filter((clip) => clip.estimatedDuration < 5),
  },
  after: {
    clipCount: regeneratedClips.length,
    durations: regeneratedClips.map((clip) => clip.estimatedDuration),
    shortClips: regeneratedClips
      .map((clip) => ({
        id: clip.id,
        title: clip.title,
        estimatedDuration: clip.estimatedDuration,
        shotCount: clip.shotIds.length,
      }))
      .filter((clip) => clip.estimatedDuration < 5),
  },
  canvas: {
    sceneId: sync.sceneId,
    nodes: sync.nodes.length,
    edges: sync.edges.length,
    storyboardCount: sync.storyboardCount,
    videoCount: sync.videoCount,
  },
}, null, 2));

await prisma.$disconnect();
