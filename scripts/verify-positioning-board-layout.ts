import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeIds = process.argv.slice(3);

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

function nodeBox(node: NodeRecord) {
  return {
    x: numberValue(node.position?.x),
    y: numberValue(node.position?.y),
    w: numberValue(node.style?.width, node.type === "generation" ? 420 : 220),
    h: numberValue(node.style?.height, node.type === "generation" ? 560 : 180),
  };
}

function overlaps(a: NodeRecord, b: NodeRecord) {
  const A = nodeBox(a);
  const B = nodeBox(b);
  return A.x < B.x + B.w && A.x + A.w > B.x && A.y < B.y + B.h && A.y + A.h > B.y;
}

const project = await prisma.project.findUnique({
  where: { id: projectId },
  select: { metadata: true },
});

if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);

const canvasScenes = isRecord(project.metadata.canvasScenes) ? project.metadata.canvasScenes : {};
const targets = episodeIds.length ? episodeIds : Object.keys(canvasScenes);
const results = [];

for (const episodeId of targets) {
  const scene = canvasScenes[episodeId];
  if (!isRecord(scene) || !Array.isArray(scene.nodes)) continue;
  const nodes = scene.nodes.filter(isRecord) as NodeRecord[];
  const sections = nodes.filter((node) => node.type === "section" && node.data?.positioningBoardFlow === true);
  const overlapRecords = [];
  for (const section of sections) {
    const children = nodes.filter((node) => node.parentId === section.id && (node.type === "imageInput" || node.type === "generation"));
    for (let i = 0; i < children.length; i += 1) {
      for (let j = i + 1; j < children.length; j += 1) {
        if (!overlaps(children[i], children[j])) continue;
        overlapRecords.push({
          section: section.id,
          a: children[i].id,
          b: children[j].id,
          aBox: nodeBox(children[i]),
          bBox: nodeBox(children[j]),
        });
      }
    }
  }
  results.push({
    episodeId,
    sections: sections.length,
    overlapCount: overlapRecords.length,
    firstOverlaps: overlapRecords.slice(0, 5),
    sample: sections.slice(0, 2).map((section) => ({
      id: section.id,
      position: section.position,
      style: section.style,
      children: nodes
        .filter((node) => node.parentId === section.id && (node.type === "imageInput" || node.type === "generation"))
        .slice(0, 6)
        .map((node) => ({
          id: node.id,
          type: node.type,
          position: node.position,
          style: node.style,
          assetName: node.data?.assetName,
          clipId: node.data?.clipId,
        })),
    })),
  });
}

console.log(JSON.stringify({ projectId, results }, null, 2));

await prisma.$disconnect();
