import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";

type NodeRecord = {
  id: string;
  type?: string;
  parentId?: string;
  position?: { x?: number; y?: number };
  style?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function box(node: NodeRecord) {
  return {
    x: numberValue(node.position?.x),
    y: numberValue(node.position?.y),
    w: numberValue(node.style?.width, node.type === "generation" ? 420 : 220),
    h: numberValue(node.style?.height, node.type === "generation" ? 560 : 180),
  };
}

function overlaps(a: NodeRecord, b: NodeRecord) {
  const A = box(a);
  const B = box(b);
  return A.x < B.x + B.w && A.x + A.w > B.x && A.y < B.y + B.h && A.y + A.h > B.y;
}

const project = await prisma.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);

const canvasScenes = isRecord(project.metadata.canvasScenes) ? project.metadata.canvasScenes : {};
const summary = [];

for (const [episodeId, scene] of Object.entries(canvasScenes)) {
  if (!isRecord(scene) || !Array.isArray(scene.nodes)) continue;
  const nodes = scene.nodes.filter(isRecord) as NodeRecord[];
  const sections = nodes.filter((node) => node.type === "section" && node.data?.positioningBoardFlow === true);
  if (!sections.length) continue;
  let overlapCount = 0;
  for (const section of sections) {
    const children = nodes.filter((node) => node.parentId === section.id && (node.type === "imageInput" || node.type === "generation"));
    for (let i = 0; i < children.length; i += 1) {
      for (let j = i + 1; j < children.length; j += 1) {
        if (overlaps(children[i], children[j])) overlapCount += 1;
      }
    }
  }
  summary.push({ episodeId, sections: sections.length, overlapCount });
}

console.log(JSON.stringify({
  projectId,
  totalEpisodesWithBoards: summary.length,
  totalOverlaps: summary.reduce((sum, item) => sum + item.overlapCount, 0),
  episodesWithOverlaps: summary.filter((item) => item.overlapCount > 0),
  summary,
}, null, 2));

await prisma.$disconnect();
