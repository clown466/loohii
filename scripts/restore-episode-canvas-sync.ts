import { prisma } from "../server/src/lib/prisma";
import { buildEpisodeCanvasSyncScene, writeEpisodeCanvasSyncMetadata } from "../server/src/lib/episodeCanvasSync";
import { metadataWithProjectSettings } from "../server/src/lib/projectGenerationStrategy";

const projectId = process.argv[2];
const episodeId = process.argv[3] || "episode-001";

if (!projectId) {
  console.error("Usage: tsx scripts/restore-episode-canvas-sync.ts <projectId> [episodeId]");
  process.exit(1);
}

const project = await prisma.project.findUnique({
  where: { id: projectId },
  select: { metadata: true, settings: true },
});

if (!project) {
  console.error(`Project not found: ${projectId}`);
  process.exit(1);
}

const metadata = project.metadata && typeof project.metadata === "object" && !Array.isArray(project.metadata)
  ? project.metadata as Record<string, unknown>
  : {};
const syncMetadata = metadataWithProjectSettings(metadata, project.settings);
const canvasScenes = metadata.canvasScenes && typeof metadata.canvasScenes === "object" && !Array.isArray(metadata.canvasScenes)
  ? metadata.canvasScenes as Record<string, { nodes?: unknown[]; edges?: unknown[] }>
  : {};
const existingScene = canvasScenes[episodeId];
const records = await prisma.generation.findMany({
  where: { projectId },
  orderBy: { createdAt: "desc" },
  take: 300,
  include: { assets: true },
});

const sync = buildEpisodeCanvasSyncScene({
  metadata: syncMetadata,
  episodeId,
  existingScene,
  records,
});
const nextMetadata = writeEpisodeCanvasSyncMetadata({ metadata, sync, makeActive: true });

await prisma.project.update({
  where: { id: projectId },
  data: { metadata: nextMetadata },
});

console.log(JSON.stringify({
  projectId,
  episodeId,
  sceneId: sync.sceneId,
  nodes: sync.nodes.length,
  edges: sync.edges.length,
  videoCount: sync.videoCount,
  storyboardCount: sync.storyboardCount,
}, null, 2));

await prisma.$disconnect();
