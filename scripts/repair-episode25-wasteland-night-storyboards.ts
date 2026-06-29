import { prisma } from "../server/src/lib/prisma";
import { buildClipPositioningBoardPrompt } from "../server/src/lib/workflowPositioningBoards";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = "episode-025";
const targetClipIds = new Set(["clip-007", "clip-008", "clip-009"]);
const nightLock = "Scene visual authority: Wasteland Highway. Maintain cold night/pre-dawn wasteland highway after Black Spire events: cracked dark asphalt, dead roadside gravel, cold moonlit shadows, black-blue horizon, distant tower aftermath palette, and static infected-produce roadside silhouettes. No warm sunrise, no golden daylight, no orange dusk.";

type CanvasNode = { id: string; type?: string; parentId?: string; data?: Record<string, unknown>; [key: string]: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return String(value || "").trim();
}

function sanitizeWarmHighwayText(value: unknown): string {
  return stringValue(value)
    .replace(/\bMorning exterior\b/gi, "Cold night/pre-dawn exterior")
    .replace(/\bdawn variants? add pale gold\b/gi, "no warm dawn or pale gold")
    .replace(/\bfirst rays of dawn\b/gi, "cold moonlit night light")
    .replace(/\bgolden dawn light\b/gi, "cold moonlit night light")
    .replace(/\bgolden dawn\b/gi, "cold pre-dawn darkness")
    .replace(/\bdawn light\b/gi, "cold moonlit night light")
    .replace(/\bwarm morning light\b/gi, "cold black-blue night light")
    .replace(/\bmorning light\b/gi, "cold moonlit light")
    .replace(/\bmorning sky\b/gi, "black-blue night sky")
    .replace(/\bgolden light\b/gi, "cold moonlit light")
    .replace(/\bdynamic lighting\b/gi, "cold moonlit lighting")
    .trim();
}

function workflowForEpisode(metadata: Record<string, unknown>): Record<string, unknown> {
  const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
  const episode = isRecord(episodes[episodeId]) ? episodes[episodeId] : {};
  return isRecord(episode.workflowCenter) ? episode.workflowCenter : {};
}

function clipShots(clip: Record<string, unknown>, breakdownScenes: Record<string, unknown>[]): Record<string, unknown>[] {
  const ids = new Set(Array.isArray(clip.shotIds) ? clip.shotIds.map((id) => String(id)) : []);
  if (ids.size) return breakdownScenes.filter((shot) => ids.has(String(shot.id || "")));
  return breakdownScenes.filter((shot) => stringValue(shot.clipId) === stringValue(clip.id));
}

function referenceNodesForGeneration(nodes: CanvasNode[], generationNode: CanvasNode): CanvasNode[] {
  return nodes.filter((node) => node.type === "imageInput" && node.parentId === generationNode.parentId && node.data?.positioningBoardFlow === true);
}

function referenceLabels(refs: CanvasNode[]): string[] {
  return refs.map((ref) => stringValue(ref.data?.assetName || ref.data?.label || ref.data?.name)).filter(Boolean);
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

const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, metadata: true } });
if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);

const metadata = project.metadata;
const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
const episode = isRecord(episodes[episodeId]) ? episodes[episodeId] : {};
const workflow = workflowForEpisode(metadata);
const assets = isRecord(workflow.assets) ? workflow.assets : {};
const sceneAssets = Array.isArray(assets.scenes) ? assets.scenes.filter(isRecord) : [];
const clips = Array.isArray(workflow.clips) ? workflow.clips.filter(isRecord) : [];
const breakdownScenes = Array.isArray(workflow.breakdownScenes) ? workflow.breakdownScenes.filter(isRecord) : [];

let sceneAssetsPatched = 0;
const nextSceneAssets = sceneAssets.map((asset) => {
  const name = stringValue(asset.name || asset.canonicalSceneName);
  if (name !== "Wasteland Highway") return asset;
  sceneAssetsPatched += 1;
  return {
    ...asset,
    timeOfDay: "Cold night/pre-dawn exterior",
    colorPalette: "cold moonlit asphalt gray, black-blue horizon, dead roadside gravel, muted green infected-produce silhouettes; no warm sunrise, no golden daylight, no orange dusk",
    sceneVisualLock: nightLock,
    referencePolicy: "Use this episode's Wasteland Highway as the visual authority; do not reuse warm dusk/daylight highway variants.",
    description: sanitizeWarmHighwayText(asset.description) || "Endless ruined cold night highway lined with static infected-produce roadside silhouettes as the chopper rides away.",
  };
});

let shotsPatched = 0;
const nextBreakdownScenes = breakdownScenes.map((shot) => {
  const setting = stringValue(shot.setting);
  const lock = stringValue(shot.sceneVisualLock);
  if (setting !== "Wasteland Highway" && !/Wasteland Highway/i.test(lock)) return shot;
  shotsPatched += 1;
  return {
    ...shot,
    sceneVisualLock: nightLock,
    description: sanitizeWarmHighwayText(shot.description),
    action: sanitizeWarmHighwayText(shot.action),
    visualPrompt: `${sanitizeWarmHighwayText(shot.visualPrompt)}. Cold night/pre-dawn highway lighting; black-blue horizon; no warm sunrise, no golden daylight, no orange dusk.`,
    references: sanitizeWarmHighwayText(shot.references),
  };
});

let biblesPatched = 0;
const nextSceneVisualBibles = Array.isArray(workflow.sceneVisualBibles)
  ? workflow.sceneVisualBibles.map((bible) => {
      if (!isRecord(bible)) return bible;
      const name = stringValue(bible.canonicalSceneName || bible.name || bible.setting);
      const id = stringValue(bible.canonicalSceneId);
      if (name !== "Wasteland Highway" && !/wasteland-highway/i.test(id)) return bible;
      biblesPatched += 1;
      return {
        ...bible,
        timeOfDay: "Cold night/pre-dawn exterior",
        colorPalette: "cold moonlit asphalt gray, black-blue horizon, dead roadside gravel; no warm sunrise, no golden daylight, no orange dusk",
        sceneVisualLock: nightLock,
      };
    })
  : workflow.sceneVisualBibles;

const nextWorkflow = {
  ...workflow,
  assets: { ...assets, scenes: nextSceneAssets },
  breakdownScenes: nextBreakdownScenes,
  sceneVisualBibles: nextSceneVisualBibles,
  updatedAt: new Date().toISOString(),
};

const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
const canvasScene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : {};
const nodes = Array.isArray(canvasScene.nodes) ? canvasScene.nodes.filter(isRecord) as CanvasNode[] : [];
const nextNodes = nodes.map((node) => {
  if (node.type !== "generation" || node.data?.positioningBoardFlow !== true) return node;
  const data = isRecord(node.data) ? node.data : {};
  const clipId = stringValue(data.clipId);
  if (!targetClipIds.has(clipId)) return node;
  const clip = clips.find((item) => stringValue(item.id) === clipId);
  if (!clip) return node;
  const refs = referenceNodesForGeneration(nodes, node);
  const shots = clipShots(clip, nextBreakdownScenes);
  const positioningPrompt = buildClipPositioningBoardPrompt({
    projectName: project.name,
    clip,
    shots,
    referenceLabels: referenceLabels(refs),
    visibleCharacterNames: visibleCharacterNames(refs),
    sceneLockName: sceneLockName(refs) || "Wasteland Highway",
    sceneVisualLock: nightLock,
    mode: "positioning",
  });
  const storyboardPrompt = buildClipPositioningBoardPrompt({
    projectName: project.name,
    clip,
    shots,
    referenceLabels: referenceLabels(refs),
    visibleCharacterNames: visibleCharacterNames(refs),
    sceneLockName: sceneLockName(refs) || "Wasteland Highway",
    sceneVisualLock: nightLock,
    mode: "storyboard",
  });
  return {
    ...node,
    data: {
      ...data,
      prompt: storyboardPrompt,
      finalPrompt: storyboardPrompt,
      positioningPrompt,
      storyboardPrompt,
      status: "waiting",
      error: "",
      outputImage: "",
      outputImageAssetId: "",
      outputImages: [],
      generationStartedAt: "",
      positioningBoardMode: "storyboard",
      manualFinalPrompt: true,
    },
  };
});

const nextMetadata = {
  ...metadata,
  episodes: {
    ...episodes,
    [episodeId]: {
      ...episode,
      workflowCenter: nextWorkflow,
      updatedAt: new Date().toISOString(),
    },
  },
  canvasScenes: {
    ...canvasScenes,
    [episodeId]: {
      ...canvasScene,
      nodes: nextNodes,
      updatedAt: new Date().toISOString(),
    },
  },
  updatedAt: new Date().toISOString(),
};

await prisma.project.update({ where: { id: project.id }, data: { metadata: nextMetadata } });

console.log(JSON.stringify({
  projectId,
  episodeId,
  sceneAssetsPatched,
  shotsPatched,
  biblesPatched,
  resetStoryboardNodes: [...targetClipIds],
}, null, 2));

await prisma.$disconnect();
