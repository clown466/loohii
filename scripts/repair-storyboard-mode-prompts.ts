import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeIds = process.argv.slice(3);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return String(value || "").trim();
}

function isStoryboardPrompt(value: string): boolean {
  return /comic storyboard board|Storyboard panels:/i.test(value);
}

function isPositioningPrompt(value: string): boolean {
  return /Create ONE static keyframe positioning-board image|single 16:9 still frame used as a spatial layout reference/i.test(value);
}

const project = await prisma.project.findUnique({
  where: { id: projectId },
  select: { metadata: true },
});

if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);

const metadata = project.metadata;
const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
const targets = episodeIds.length ? episodeIds : Object.keys(canvasScenes);

let scenesChanged = 0;
let nodesSwitched = 0;
let outputsCleared = 0;
const repaired: Array<{ episodeId: string; nodeId: string; clipId: string; firstLine: string }> = [];

for (const episodeId of targets) {
  const scene = canvasScenes[episodeId];
  if (!isRecord(scene) || !Array.isArray(scene.nodes)) continue;
  let sceneChanged = false;
  const nodes = scene.nodes.filter(isRecord).map((node) => {
    if (node.type !== "generation") return node;
    const data = isRecord(node.data) ? node.data : {};
    if (data.positioningBoardFlow !== true) return node;
    if (stringValue(data.positioningBoardMode || "storyboard") !== "storyboard") return node;
    const storyboardPrompt = stringValue(data.storyboardPrompt);
    if (!isStoryboardPrompt(storyboardPrompt)) return node;
    const activePrompt = stringValue(data.prompt || data.finalPrompt);
    const needsPromptSwitch = activePrompt !== storyboardPrompt || isPositioningPrompt(activePrompt);
    if (!needsPromptSwitch) return node;

    const nextData = {
      ...data,
      title: stringValue(data.title).replace(/定位板$/, "故事板") || `${stringValue(data.clipId) || "Clip"} 故事板`,
      description: stringValue(data.description).replace(/定位板/g, "故事板") || "生成本 Clip 对应视频镜头的宫格故事板。",
      prompt: storyboardPrompt,
      finalPrompt: storyboardPrompt,
      manualFinalPrompt: true,
      status: "waiting",
      error: "",
      outputImage: "",
      outputImageAssetId: "",
      outputImages: [],
      generationStartedAt: "",
      generationRequestId: "",
      generationId: "",
      revisedPrompt: "",
      submittedPrompt: "",
    };
    nodesSwitched += 1;
    outputsCleared += activePrompt ? 1 : 0;
    sceneChanged = true;
    repaired.push({
      episodeId,
      nodeId: String(node.id),
      clipId: stringValue(data.clipId),
      firstLine: storyboardPrompt.split("\n")[0] || "",
    });
    return {
      ...node,
      data: nextData,
    };
  });

  if (sceneChanged) {
    scene.nodes = nodes;
    scene.updatedAt = new Date().toISOString();
    scenesChanged += 1;
  }
}

if (scenesChanged > 0) {
  metadata.updatedAt = new Date().toISOString();
  await prisma.project.update({ where: { id: projectId }, data: { metadata } });
}

console.log(JSON.stringify({
  projectId,
  targets,
  scenesChanged,
  nodesSwitched,
  outputsCleared,
  repaired,
}, null, 2));

await prisma.$disconnect();
