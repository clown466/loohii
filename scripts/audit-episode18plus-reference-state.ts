import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const contaminatedUrlNeedle = "asset-cmqpklndm000lmv0ttr9comk4.png";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function episodeNumber(episodeId: string): number {
  return Number(episodeId.match(/(\d+)/)?.[1] || 0);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function assetImage(item: Record<string, unknown>) {
  return stringValue(item.referenceImageUrl) || stringValue(item.generatedImageUrl) || stringValue(item.imageUrl);
}

async function main() {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
  if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);
  const metadata = project.metadata as Record<string, unknown>;
  const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
  const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
  const rows: unknown[] = [];

  for (const episodeId of Object.keys(episodes).filter((id) => episodeNumber(id) >= 18).sort()) {
    const episode = episodes[episodeId];
    const workflow = isRecord(episode) && isRecord(episode.workflowCenter) ? episode.workflowCenter : {};
    const assets = isRecord(workflow.assets) ? workflow.assets : {};
    const byKind = Object.fromEntries(["characters", "scenes", "props"].map((kind) => {
      const list = Array.isArray(assets[kind]) ? assets[kind] as Record<string, unknown>[] : [];
      return [kind, {
        total: list.length,
        missing: list.filter((item) => !assetImage(item)).map((item) => item.name || item.title),
        contaminated: list.filter((item) => JSON.stringify(item).includes(contaminatedUrlNeedle)).map((item) => item.name || item.title),
        items: list.map((item) => ({
          id: item.id,
          name: item.name || item.title,
          hasImage: Boolean(assetImage(item)),
          contaminated: JSON.stringify(item).includes(contaminatedUrlNeedle),
          status: item.referenceAnalysisStatus || item.visualAuthority || item.imageStatus || "",
        })),
      }];
    }));

    const scene = canvasScenes[episodeId];
    const nodes = isRecord(scene) && Array.isArray(scene.nodes) ? scene.nodes as Record<string, unknown>[] : [];
    const imageInputs = nodes.filter((node) => node.type === "imageInput");
    const boards = nodes.filter((node) => node.type === "generation" && String(node.id || "").includes("clip-position-board-gen"));
    rows.push({
      episodeId,
      workflowAssets: byKind,
      canvas: {
        imageInputs: imageInputs.length,
        missingImageInputs: imageInputs.filter((node) => !stringValue(isRecord(node.data) ? node.data.imageUrl : "")).map((node) => {
          const data = isRecord(node.data) ? node.data : {};
          return { id: node.id, kind: data.assetKind, name: data.assetName, label: data.label };
        }).slice(0, 50),
        contaminatedImageInputs: imageInputs.filter((node) => JSON.stringify(node).includes(contaminatedUrlNeedle)).length,
        boards: boards.length,
        idleBoards: boards.filter((node) => isRecord(node.data) && node.data.status === "idle").length,
        boardsWithOutput: boards.filter((node) => isRecord(node.data) && (node.data.outputImage || (Array.isArray(node.data.outputImages) && node.data.outputImages.length))).length,
      },
    });
  }

  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
