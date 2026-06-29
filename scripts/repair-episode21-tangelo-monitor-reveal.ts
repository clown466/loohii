import { prisma } from "../server/src/lib/prisma";
import { buildClipPositioningBoardPrompt } from "../server/src/lib/workflowPositioningBoards";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = "episode-021";
const sourceEpisodeId = "episode-022";
const targetClipIds = new Set(["clip-008", "clip-009"]);
const targetShotIds = new Set([
  "shot-053",
  "shot-054",
  "shot-055",
  "shot-056",
  "shot-057",
  "shot-058",
  "shot-059",
  "shot-060",
  "shot-061",
  "shot-062",
  "shot-063",
  "shot-064",
  "shot-065",
  "shot-066",
]);

type CanvasNode = { id: string; type?: string; parentId?: string; data?: Record<string, unknown>; [key: string]: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return String(value || "").trim();
}

function replaceNameInList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output = value.map((item) => {
    const text = stringValue(item);
    if (/^(?:The Temp|Temp)$/i.test(text)) return "Tangelo";
    return text;
  }).filter(Boolean);
  return [...new Set(output)];
}

function sanitizeMonitorCatText(value: unknown): string {
  return stringValue(value)
    .replace(/\bSecurity feed shows The Temp\b/gi, "Security feed shows Tangelo")
    .replace(/\bThe Temp\b/g, "Tangelo")
    .replace(/\bTemp\b/g, "Tangelo")
    .replace(/\ba white, fluffy, incredibly round lump\b/gi, "a blurred orange, incredibly round catlike lump with a pale white belly")
    .replace(/\ba white fluffy lump\b/gi, "a blurred orange fluffy lump with a pale white belly")
    .replace(/\bwhite fluffy lump\b/gi, "blurred orange fluffy lump with pale white belly")
    .replace(/\bwhite lump\b/gi, "blurred orange lump")
    .replace(/\bwhite furball\b/gi, "blurred orange furball with a pale white belly")
    .replace(/\bwhite Scottish Fold Ragdoll cat\b/gi, "orange tangelo cat blurred by static, with a pale white belly")
    .replace(/\bwhite cat admin\b/gi, "blurred orange cat admin")
    .replace(/\bshowing white fluffy lump\b/gi, "showing Tangelo as a blurred orange shape with pale white belly")
    .replace(/\bon monitor showing white fluffy lump\b/gi, "on monitor showing Tangelo as a blurred orange shape with pale white belly")
    .replace(/\bsmall fluffy white cotton plant silhouette behind CEO\b/gi, "fat orange tangelo cat silhouette, blurred by security-feed static, with pale white belly")
    .replace(/\bfluffy white cotton plant lump\b/gi, "blurred orange tangelo cat with pale white belly")
    .replace(/\bFluffy white silhouette obscured in shadow\b/gi, "Blurred orange catlike silhouette obscured by security-feed static, pale white belly barely visible")
    .replace(/\bWhite, shadow black, cold screen blue\b/gi, "Orange peel, pale white belly, cold screen blue, shadow black")
    .trim();
}

function workflowFor(metadata: Record<string, unknown>, id: string): Record<string, unknown> {
  const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
  const episode = isRecord(episodes[id]) ? episodes[id] : {};
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

function publicImageUrl(asset: Record<string, unknown>): string {
  return stringValue(asset.referenceImageUrl || asset.generatedImageUrl);
}

const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, metadata: true } });
if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);

const metadata = project.metadata;
const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
const episode = isRecord(episodes[episodeId]) ? episodes[episodeId] : {};
const workflow = workflowFor(metadata, episodeId);
const sourceWorkflow = workflowFor(metadata, sourceEpisodeId);
const assets = isRecord(workflow.assets) ? workflow.assets : {};
const sourceAssets = isRecord(sourceWorkflow.assets) ? sourceWorkflow.assets : {};
const sourceTangelo = (Array.isArray(sourceAssets.characters) ? sourceAssets.characters.filter(isRecord) : [])
  .find((asset) => stringValue(asset.name).toLowerCase() === "tangelo");
if (!sourceTangelo) throw new Error("Could not find Tangelo asset in episode-022");

const tangeloAsset = {
  ...sourceTangelo,
  id: "char-5-tangelo",
  name: "Tangelo",
  aliases: ["The Temp", "Temp", "ultimate System Administrator"],
  description: "Orange tangelo cat administrator first seen on the security feed as a blurred orange round shape with a pale white belly; the same cat later revealed on the core keyboard.",
  primaryLook: "Fat orange tangelo cat with peel-fur, segment lines, green leaf ears, and pale white fluffy belly.",
  colorPalette: "Orange peel, pale white belly, green leaf ears, cold security-feed blue",
  variantNotes: "In episode 21 monitor shots, Tangelo is deliberately blurred by static and screen glare; do not depict a white cat.",
  visualPrompt: "Tangelo, fat orange tangelo cat, blurred by grainy security camera static, pale white belly barely visible, resting on the glowing golden master keyboard.",
  referencePolicy: "Use Tangelo's orange cat reference image as identity authority. Episode 21 monitor shots must show a blurred orange silhouette with pale white belly, never a white cat or white cotton lump.",
};

const characterAssets = Array.isArray(assets.characters) ? assets.characters.filter(isRecord) : [];
let assetsPatched = 0;
const nextCharacters = [
  ...characterAssets
    .filter((asset) => !/^(?:The Temp|Temp|Tangelo)$/i.test(stringValue(asset.name)))
    .map((asset) => {
      let changed = false;
      const next = { ...asset };
      for (const key of ["description", "primaryLook", "colorPalette", "variantNotes", "visualPrompt", "referencePolicy", "lockedVisualIdentity"]) {
        if (!(key in next)) continue;
        const before = stringValue(next[key]);
        const after = sanitizeMonitorCatText(before);
        if (after !== before) {
          next[key] = after;
          changed = true;
        }
      }
      if (changed) assetsPatched += 1;
      return next;
    }),
  tangeloAsset,
];
assetsPatched += 1;

const breakdownScenes = Array.isArray(workflow.breakdownScenes) ? workflow.breakdownScenes.filter(isRecord) : [];
let shotsPatched = 0;
const nextBreakdownScenes = breakdownScenes.map((shot) => {
  if (!targetShotIds.has(stringValue(shot.id))) return shot;
  let changed = false;
  const next = { ...shot };
  for (const key of ["title", "setting", "action", "description", "visualPrompt", "references", "dialogue"]) {
    if (!(key in next)) continue;
    const before = stringValue(next[key]);
    const after = sanitizeMonitorCatText(before);
    if (after !== before) {
      next[key] = after;
      changed = true;
    }
  }
  const nextCharacters = replaceNameInList(next.characters);
  if (JSON.stringify(nextCharacters) !== JSON.stringify(next.characters || [])) {
    next.characters = nextCharacters;
    changed = true;
  }
  if (stringValue(next.id) === "shot-053") {
    next.action = "Static security feed shows Tangelo as a blurred orange shape on the golden master keyboard.";
    next.description = "The primary monitor shows a grainy, static-ridden security feed from the deep server room. Tangelo rests on the glowing golden master keyboard, visible only as a blurred orange round catlike lump with a pale white belly through scanlines and glare.";
    next.visualPrompt = "Grainy security feed, heavy static and scanlines, Tangelo as a deliberately blurred orange fluffy catlike lump with pale white belly on glowing golden keyboard in darkness; surveillance aesthetic; do not depict a white cat.";
    next.references = "Tangelo character reference as orange-cat identity, golden master keyboard prop, security monitor distortion.";
    next.characters = ["Tangelo"];
    changed = true;
  }
  if (stringValue(next.id) === "shot-054") {
    next.action = "Blurred Tangelo rolls over and taps the Global Update key; alarms flare.";
    next.description = "The blurred orange catlike lump lazily rolls over on the keyboard, a pink-toed paw briefly visible through static as it taps the Global Update key. Red alarm lights flare violently in the penthouse.";
    next.visualPrompt = "Close-up on a blurred orange paw and pale belly edge through security-feed static, tapping the glowing key on the golden keyboard, then red alarm lights flare; do not show a white cat.";
    next.references = "Tangelo character reference as orange-cat identity, Global Update key prop, red alarm lights prop.";
    next.characters = ["Tangelo"];
    changed = true;
  }
  if (stringValue(next.id) === "shot-055") {
    next.references = "Tangelo meow over speakers; monitor still shows blurred orange Tangelo silhouette.";
    changed = true;
  }
  if (changed) shotsPatched += 1;
  return next;
});

const clips = Array.isArray(workflow.clips) ? workflow.clips.filter(isRecord) : [];
let clipsPatched = 0;
const nextClips = clips.map((clip) => {
  if (!targetClipIds.has(stringValue(clip.id))) return clip;
  let changed = false;
  const next = { ...clip };
  for (const key of ["title", "plotGoal", "startState", "endState", "layoutMemory", "seedancePrompt", "videoPrompt", "prompt", "storyboardPrompt"]) {
    if (!(key in next)) continue;
    const before = stringValue(next[key]);
    const after = sanitizeMonitorCatText(before);
    if (after !== before) {
      next[key] = after;
      changed = true;
    }
  }
  if (stringValue(next.id) === "clip-008") {
    next.title = "Clip 08 · Security feed shows blurred Tangelo";
    next.plotGoal = "The primary monitor shows a grainy, static-ridden security feed from the deep server room. Tangelo appears only as a blurred orange round shape with a pale white belly on the glowing golden keyboard. Then Bob responds with confusion.";
    next.characters = ["Tangelo", "Chloe", "Leo", "Bob"];
    changed = true;
  }
  if (stringValue(next.id) === "clip-009") {
    next.title = "Clip 09 · Chloe asks about the blurred cat admin";
    next.plotGoal = "Chloe asks Bob if he ever read about Omega Corp's ultimate System Administrator being a cat, misreading the static-blurred orange Tangelo shape on the monitor. Then the private lift in the center of the penthouse opens, revealing the access down to the deepest sub-level server room.";
    next.characters = ["Chloe", "Bob", "Leo"];
    changed = true;
  }
  const nextCharacters = replaceNameInList(next.characters);
  if (nextCharacters.length && JSON.stringify(nextCharacters) !== JSON.stringify(next.characters || [])) {
    next.characters = nextCharacters;
    changed = true;
  }
  if (changed) clipsPatched += 1;
  return next;
});

const nextWorkflow = {
  ...workflow,
  assets: { ...assets, characters: nextCharacters },
  breakdownScenes: nextBreakdownScenes,
  clips: nextClips,
  updatedAt: new Date().toISOString(),
};

const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
const canvasScene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : {};
const nodes = Array.isArray(canvasScene.nodes) ? canvasScene.nodes.filter(isRecord) as CanvasNode[] : [];
const tangeloImageUrl = publicImageUrl(tangeloAsset);
const tangeloAssetId = stringValue(tangeloAsset.referenceImageAssetId || tangeloAsset.generatedImageAssetId);

function patchCanvasData(data: Record<string, unknown>, node: CanvasNode, allNodes: CanvasNode[]): Record<string, unknown> {
  let next = { ...data };
  const dataText = JSON.stringify(next);
  const isTargetClip = targetClipIds.has(stringValue(next.clipId || next.targetClipId || next.sourceClipId));
  const isTargetText = /clip-00[89]|The Temp|Temp|white fluffy|white cat|white furball|white lump|Scottish Fold|Ragdoll/i.test(dataText);
  const isTangeloReference = stringValue(next.assetKind) === "characters" && /^(?:The Temp|Temp|Tangelo)$/i.test(stringValue(next.assetName || next.label || next.name));
  if (!isTargetClip && !isTargetText && !isTangeloReference) return data;

  for (const key of ["title", "description", "prompt", "finalPrompt", "storyboardPrompt", "positioningPrompt", "submittedPrompt", "seedancePrompt", "videoPrompt", "sourcePrompt", "targetPrompt", "translatedPrompt", "result", "text", "label", "fileName", "uploadError"]) {
    if (!(key in next)) continue;
    next[key] = sanitizeMonitorCatText(next[key]);
  }

  if (isTangeloReference) {
    next = {
      ...next,
      label: "角色 · Tangelo",
      assetName: "Tangelo",
      assetId: tangeloAssetId,
      imageUrl: tangeloImageUrl,
      url: tangeloImageUrl,
      fileName: "Tangelo.png",
      uploadStatus: tangeloImageUrl ? "linked" : "missing",
      imageLoadError: false,
      sourcePrompt: "Tangelo 橘猫参考图，用于第21集监控画面里的模糊橘色猫影；不要使用白色猫或白色棉花团。",
      uploadError: tangeloImageUrl ? "" : "Tangelo 资产还没有参考图。",
    };
  }

  const clipId = stringValue(next.clipId);
  if (node.type === "generation" && next.positioningBoardFlow === true && targetClipIds.has(clipId)) {
    const clip = nextClips.find((item) => stringValue(item.id) === clipId);
    if (clip) {
      const refs = referenceNodesForGeneration(allNodes.map((candidate) => {
        if (candidate.id === node.id) return { ...candidate, data: next };
        return candidate;
      }), { ...node, data: next });
      const patchedRefs = refs.map((ref) => ({ ...ref, data: patchCanvasData(isRecord(ref.data) ? ref.data : {}, ref, []) }));
      const shots = clipShots(clip, nextBreakdownScenes);
      const positioningPrompt = buildClipPositioningBoardPrompt({
        projectName: project.name,
        clip,
        shots,
        referenceLabels: referenceLabels(patchedRefs),
        visibleCharacterNames: visibleCharacterNames(patchedRefs),
        sceneLockName: sceneLockName(patchedRefs),
        mode: "positioning",
      });
      const storyboardPrompt = buildClipPositioningBoardPrompt({
        projectName: project.name,
        clip,
        shots,
        referenceLabels: referenceLabels(patchedRefs),
        visibleCharacterNames: visibleCharacterNames(patchedRefs),
        sceneLockName: sceneLockName(patchedRefs),
        mode: "storyboard",
      });
      next = {
        ...next,
        title: `${stringValue(clip.title) || clipId} 故事板`,
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
      };
    }
  }

  return next;
}

let nodesPatched = 0;
const firstPassNodes = nodes.map((node) => {
  const data = isRecord(node.data) ? node.data : {};
  const nextData = patchCanvasData(data, node, nodes);
  if (nextData !== data && JSON.stringify(nextData) !== JSON.stringify(data)) {
    nodesPatched += 1;
    return { ...node, data: nextData };
  }
  return node;
});

const nextNodes = firstPassNodes.map((node) => {
  const data = isRecord(node.data) ? node.data : {};
  if (!(node.type === "generation" && data.positioningBoardFlow === true && targetClipIds.has(stringValue(data.clipId)))) return node;
  const nextData = patchCanvasData(data, node, firstPassNodes);
  if (JSON.stringify(nextData) !== JSON.stringify(data)) {
    nodesPatched += 1;
    return { ...node, data: nextData };
  }
  return node;
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
  tangeloImageUrl,
  tangeloAssetId,
  assetsPatched,
  shotsPatched,
  clipsPatched,
  nodesPatched,
  resetStoryboardNodes: [...targetClipIds],
}, null, 2));

await prisma.$disconnect();
