import { prisma } from "../server/src/lib/prisma";

const projectId = "cmq8dw07r0003l00tewomnzwd";
const episodeId = "episode-022";

const project = await prisma.project.findUnique({
  where: { id: projectId },
  select: { metadata: true },
});

if (!project?.metadata) throw new Error(`Project not found: ${projectId}`);

const metadata = project.metadata as any;
const canvas = metadata.canvasScenes?.[episodeId];
if (!canvas || !Array.isArray(canvas.nodes)) throw new Error(`Missing canvas: ${episodeId}`);

const nodes = canvas.nodes as any[];
const nodeById = new Map(nodes.map((node) => [node.id, node]));
let synced = 0;

for (const node of nodes) {
  if (node.type !== "translation") continue;
  const sourceNodeId = String(node.data?.sourceNodeId || "");
  if (!sourceNodeId) continue;
  const sourceNode = nodeById.get(sourceNodeId);
  if (!sourceNode?.data) continue;
  const currentPrompt = String(
    sourceNode.data.prompt ||
    sourceNode.data.videoPrompt ||
    sourceNode.data.finalPrompt ||
    sourceNode.data.storyboardPrompt ||
    "",
  ).trim();
  if (!currentPrompt) continue;
  if (node.data.sourcePrompt !== currentPrompt) {
    node.data.sourcePrompt = currentPrompt;
    synced += 1;
  }
}

if (synced > 0) {
  metadata.updatedAt = new Date().toISOString();
  canvas.updatedAt = metadata.updatedAt;
  await prisma.project.update({ where: { id: projectId }, data: { metadata } });
}

console.log(JSON.stringify({ projectId, episodeId, synced }, null, 2));

await prisma.$disconnect();
