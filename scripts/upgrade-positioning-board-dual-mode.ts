import { prisma } from "../server/src/lib/prisma";
import { buildClipPositioningBoardPrompt } from "../server/src/lib/workflowPositioningBoards";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";

type CanvasNode = {
  id: string;
  type?: string;
  parentId?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

type CanvasScene = {
  nodes?: unknown[];
  edges?: unknown[];
  updatedAt?: string;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return String(value || "").trim();
}

function publicImageLike(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (isRecord(value)) return stringValue(value.url || value.publicUrl || value.imageUrl);
  return "";
}

function hasGeneratedOutput(data: Record<string, unknown>): boolean {
  if (publicImageLike(data.outputImage)) return true;
  return Array.isArray(data.outputImages) && data.outputImages.some((item) => publicImageLike(item));
}

function workflowForEpisode(metadata: Record<string, unknown>, episodeId: string): Record<string, unknown> {
  const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
  const episode = isRecord(episodes[episodeId]) ? episodes[episodeId] : {};
  const episodeWorkflow = isRecord(episode.workflowCenter) ? episode.workflowCenter : null;
  if (episodeWorkflow) return episodeWorkflow;
  return isRecord(metadata.workflowCenter) ? metadata.workflowCenter : {};
}

function clipShots(clip: Record<string, unknown>, breakdownScenes: Record<string, unknown>[]): Record<string, unknown>[] {
  const ids = new Set(Array.isArray(clip.shotIds) ? clip.shotIds.map((id) => String(id)) : []);
  if (!ids.size) return breakdownScenes.filter((shot) => stringValue(shot.clipId) === stringValue(clip.id));
  return breakdownScenes.filter((shot) => ids.has(String(shot.id || "")));
}

function clipById(clips: Record<string, unknown>[], clipId: string): Record<string, unknown> | null {
  return clips.find((clip) => stringValue(clip.id) === clipId) ?? null;
}

function sectionForNode(nodes: CanvasNode[], node: CanvasNode): CanvasNode | null {
  if (!node.parentId) return null;
  return nodes.find((item) => item.id === node.parentId && item.type === "section") ?? null;
}

function referenceNodesForGeneration(nodes: CanvasNode[], generationNode: CanvasNode): CanvasNode[] {
  const parentId = generationNode.parentId;
  return nodes.filter((node) => (
    node.type === "imageInput" &&
    node.parentId === parentId &&
    node.data?.positioningBoardFlow === true
  ));
}

function referenceLabels(refs: CanvasNode[]): string[] {
  return refs
    .map((ref) => stringValue(ref.data?.assetName || ref.data?.label || ref.data?.name))
    .filter(Boolean);
}

function visibleCharacterNames(refs: CanvasNode[]): string[] {
  return refs
    .filter((ref) => stringValue(ref.data?.assetKind) === "characters")
    .map((ref) => stringValue(ref.data?.assetName || ref.data?.label || ref.data?.name))
    .filter(Boolean);
}

function sceneLockName(refs: CanvasNode[]): string {
  const sceneRef = refs.find((ref) => stringValue(ref.data?.assetKind) === "scenes");
  return stringValue(sceneRef?.data?.assetName || sceneRef?.data?.label || sceneRef?.data?.name);
}

const project = await prisma.project.findUnique({
  where: { id: projectId },
  select: { id: true, name: true, metadata: true },
});

if (!project) {
  console.error(`Project not found: ${projectId}`);
  process.exit(1);
}

const metadata = isRecord(project.metadata) ? project.metadata : {};
const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
const nextCanvasScenes: Record<string, unknown> = { ...canvasScenes };
let upgradedScenes = 0;
let upgradedGenerationNodes = 0;
let storyboardDefaultNodes = 0;
let preservedPositioningOutputNodes = 0;

for (const [episodeId, rawScene] of Object.entries(canvasScenes)) {
  if (!isRecord(rawScene)) continue;
  const scene = rawScene as CanvasScene;
  const nodes = Array.isArray(scene.nodes) ? scene.nodes.filter(isRecord) as CanvasNode[] : [];
  if (!nodes.length) continue;

  const workflow = workflowForEpisode(metadata, episodeId);
  const clips = Array.isArray(workflow.clips) ? workflow.clips.filter(isRecord) : [];
  const breakdownScenes = Array.isArray(workflow.breakdownScenes) ? workflow.breakdownScenes.filter(isRecord) : [];
  if (!clips.length) continue;

  let sceneChanged = false;
  const nextNodes = nodes.map((node) => {
    if (node.type === "section" && node.data?.positioningBoardFlow === true) {
      sceneChanged = true;
      return {
        ...node,
        data: {
          ...node.data,
          title: stringValue(node.data.title).replace("定位板图片流程", "故事板/定位板图片流程") || "故事板/定位板图片流程",
          description: "可在故事板宫格与单帧定位板之间切换；视频生成时作为镜头构图、站位和连续性参考。",
          positioningBoardMode: node.data.positioningBoardMode || "storyboard",
        },
      };
    }
    if (node.type !== "generation" || node.data?.positioningBoardFlow !== true) return node;
    const data = isRecord(node.data) ? node.data : {};
    const clipId = stringValue(data.clipId);
    const clip = clipById(clips, clipId);
    if (!clip) return node;
    const shots = clipShots(clip, breakdownScenes);
    const refs = referenceNodesForGeneration(nodes, node);
    const labels = referenceLabels(refs);
    const characters = visibleCharacterNames(refs);
    const lockName = sceneLockName(refs);
    const positioningPrompt = buildClipPositioningBoardPrompt({
      projectName: project.name,
      clip,
      shots,
      referenceLabels: labels,
      visibleCharacterNames: characters,
      sceneLockName: lockName,
      mode: "positioning",
    });
    const storyboardPrompt = buildClipPositioningBoardPrompt({
      projectName: project.name,
      clip,
      shots,
      referenceLabels: labels,
      visibleCharacterNames: characters,
      sceneLockName: lockName,
      mode: "storyboard",
    });
    const keepPositioningMode = hasGeneratedOutput(data);
    const mode = keepPositioningMode ? "positioning" : "storyboard";
    const activePrompt = mode === "storyboard" ? storyboardPrompt : positioningPrompt;
    if (keepPositioningMode) preservedPositioningOutputNodes += 1;
    else storyboardDefaultNodes += 1;
    upgradedGenerationNodes += 1;
    sceneChanged = true;
    return {
      ...node,
      data: {
        ...data,
        title: mode === "storyboard"
          ? `${stringValue(clip.title) || clipId} 故事板`
          : `${stringValue(clip.title) || clipId} 定位板`,
        description: mode === "storyboard"
          ? `生成本 Clip 对应视频镜头的宫格故事板，已接入 ${refs.length} 张参考图。`
          : `已有输出保持为单帧定位板；可切换到故事板后重新生成，已接入 ${refs.length} 张参考图。`,
        prompt: activePrompt,
        finalPrompt: activePrompt,
        positioningPrompt,
        storyboardPrompt,
        manualFinalPrompt: true,
        positioningBoardMode: mode,
      },
    };
  });

  if (sceneChanged) {
    upgradedScenes += 1;
    nextCanvasScenes[episodeId] = {
      ...scene,
      nodes: nextNodes,
      updatedAt: new Date().toISOString(),
    };
  }
}

if (upgradedScenes > 0) {
  await prisma.project.update({
    where: { id: project.id },
    data: {
      metadata: {
        ...metadata,
        canvasScenes: nextCanvasScenes,
      },
    },
  });
}

console.log(JSON.stringify({
  projectId: project.id,
  upgradedScenes,
  upgradedGenerationNodes,
  storyboardDefaultNodes,
  preservedPositioningOutputNodes,
}, null, 2));

await prisma.$disconnect();
