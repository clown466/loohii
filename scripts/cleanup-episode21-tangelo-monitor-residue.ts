import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = "episode-021";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return String(value || "").trim();
}

function cleanText(value: unknown): string {
  return stringValue(value)
    .replace(/\bSecurity feed shows The Temp\b/gi, "Security feed shows blurred Tangelo")
    .replace(/\bThe Temp taps\b/gi, "Blurred Tangelo taps")
    .replace(/\bThe Temp:\s*“?Meow~”?/gi, "Tangelo: “Meow~”")
    .replace(/\bThe Temp\b/gi, "Tangelo")
    .replace(/\bTemp\b/gi, "Tangelo")
    .replace(/\bwhite Scottish Fold Ragdoll cat\b/gi, "static-blurred orange Tangelo cat with a pale white belly")
    .replace(/\bwhite\s+cat\b/gi, "blurred orange cat")
    .replace(/\bwhite fluffy lump\b/gi, "blurred orange fluffy lump with pale white belly")
    .replace(/\bwhite fluffy paw\b/gi, "orange paw blurred by static")
    .replace(/\bwhite furball\b/gi, "blurred orange furball with pale white belly")
    .replace(/\bwhite lump\b/gi, "blurred orange lump")
    .replace(/\bwhite cotton lump\b/gi, "blurred orange Tangelo shape")
    .replace(/\bcotton plant\b/gi, "orange tangelo cat")
    .replace(/\bfluffy white\b/gi, "blurred orange")
    .replace(/\bCharacters:\s*Tangelo\b/g, "Characters: Tangelo")
    .replace(/\bdo not depict a blurred orange cat\b/gi, "do not depict a white cat")
    .replace(/\bnever a blurred orange cat\b/gi, "never a white cat")
    .replace(/\baudio:the tangelo\b/gi, "audio:tangelo")
    .trim();
}

function deepClean(value: unknown): unknown {
  if (typeof value === "string") return cleanText(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string" && /^(?:The Temp|Temp)$/i.test(item)) return "Tangelo";
        return deepClean(item);
      })
      .filter((item, index, array) => typeof item !== "string" || array.indexOf(item) === index);
  }
  if (isRecord(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) next[key] = deepClean(child);
    return next;
  }
  return value;
}

const project = await prisma.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);

const metadata = project.metadata;
const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
const episode = isRecord(episodes[episodeId]) ? episodes[episodeId] : {};
const workflow = isRecord(episode.workflowCenter) ? episode.workflowCenter : {};
const assets = isRecord(workflow.assets) ? workflow.assets : {};

let assetsPatched = 0;
const nextAssets: Record<string, unknown> = { ...assets };
for (const kind of ["characters", "props"]) {
  const items = Array.isArray(assets[kind]) ? assets[kind].filter(isRecord) : [];
  nextAssets[kind] = items.map((item) => {
    const relevant = /Tangelo|The Temp|Temp|white|cotton|keyboard|Global Update/i.test(JSON.stringify(item));
    if (!relevant) return item;
    let next = deepClean(item) as Record<string, unknown>;
    if (stringValue(next.name) === "Tangelo") {
      next = {
        ...next,
        aliases: ["ultimate System Administrator", "root admin cat"],
        referencePolicy: "Use Tangelo's orange cat reference image as identity authority. Episode 21 monitor shots must show a blurred orange silhouette with pale white belly, never a white cat or white cotton lump.",
      };
    }
    if (JSON.stringify(next) !== JSON.stringify(item)) assetsPatched += 1;
    return next;
  });
}

let shotsPatched = 0;
const nextBreakdownScenes = (Array.isArray(workflow.breakdownScenes) ? workflow.breakdownScenes.filter(isRecord) : []).map((shot) => {
  if (!targetShotIds.has(stringValue(shot.id))) return shot;
  const next = deepClean(shot) as Record<string, unknown>;
  if (JSON.stringify(next) !== JSON.stringify(shot)) shotsPatched += 1;
  return next;
});

let clipsPatched = 0;
const nextClips = (Array.isArray(workflow.clips) ? workflow.clips.filter(isRecord) : []).map((clip) => {
  if (!/clip-00[89]|The Temp|Temp|white fluffy|white cat|white lump|Scottish Fold|Ragdoll/i.test(JSON.stringify(clip))) return clip;
  const next = deepClean(clip) as Record<string, unknown>;
  if (JSON.stringify(next) !== JSON.stringify(clip)) clipsPatched += 1;
  return next;
});

const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
const canvasScene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : {};
let nodesPatched = 0;
const nextNodes = (Array.isArray(canvasScene.nodes) ? canvasScene.nodes.filter(isRecord) : []).map((node) => {
  if (!/clip-00[89]|Tangelo|The Temp|Temp|white fluffy|white cat|white lump|white furball|Scottish Fold|Ragdoll|cotton plant/i.test(JSON.stringify(node.data || {}))) return node;
  const next = { ...node, data: deepClean(node.data) as Record<string, unknown> };
  if (JSON.stringify(next) !== JSON.stringify(node)) nodesPatched += 1;
  return next;
});

await prisma.project.update({
  where: { id: projectId },
  data: {
    metadata: {
      ...metadata,
      episodes: {
        ...episodes,
        [episodeId]: {
          ...episode,
          workflowCenter: {
            ...workflow,
            assets: nextAssets,
            breakdownScenes: nextBreakdownScenes,
            clips: nextClips,
            updatedAt: new Date().toISOString(),
          },
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
    },
  },
});

console.log(JSON.stringify({ projectId, episodeId, assetsPatched, shotsPatched, clipsPatched, nodesPatched }, null, 2));
await prisma.$disconnect();
