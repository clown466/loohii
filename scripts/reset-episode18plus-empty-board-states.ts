import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function episodeNumber(episodeId: string): number {
  return Number(episodeId.match(/(\d+)/)?.[1] || 0);
}

function hasOutput(data: Record<string, unknown>): boolean {
  if (stringValue(data.outputImage)) return true;
  return Array.isArray(data.outputImages) && data.outputImages.some((item) => isRecord(item) && stringValue(item.url));
}

async function main() {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
  if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);
  const metadata = project.metadata as Record<string, unknown>;
  const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
  const nextCanvasScenes: Record<string, unknown> = { ...canvasScenes };
  const report: unknown[] = [];
  let changed = false;

  for (const [episodeId, scene] of Object.entries(canvasScenes)) {
    if (episodeNumber(episodeId) < 18 || !isRecord(scene)) continue;
    const nodes = Array.isArray(scene.nodes) ? scene.nodes.filter(isRecord) : [];
    let reset = 0;
    const nextNodes = nodes.map((node) => {
      if (node.type !== "generation" || !isRecord(node.data)) return node;
      const data = node.data;
      if (data.positioningBoardFlow !== true || stringValue(data.positioningBoardMode || "storyboard") !== "storyboard") return node;
      if (hasOutput(data)) return node;
      const status = stringValue(data.status);
      if (status !== "generating" && status !== "failed") return node;
      reset += 1;
      return { ...node, data: { ...data, status: "idle", error: "", generationStartedAt: "" } };
    });
    if (reset > 0) {
      nextCanvasScenes[episodeId] = { ...scene, nodes: nextNodes, updatedAt: new Date().toISOString() };
      changed = true;
    }
    report.push({ episodeId, reset });
  }
  if (changed) {
    await prisma.project.update({ where: { id: projectId }, data: { metadata: { ...metadata, canvasScenes: nextCanvasScenes } } });
  }
  console.log(JSON.stringify({ projectId, changed, report }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
