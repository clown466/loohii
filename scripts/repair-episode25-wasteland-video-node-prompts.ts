import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = "episode-025";
const targetClipIds = new Set(["clip-007", "clip-008", "clip-009"]);
const nightLock = "Scene visual authority: Wasteland Highway. Maintain cold night/pre-dawn wasteland highway after Black Spire events: cracked dark asphalt, dead roadside gravel, cold moonlit shadows, black-blue horizon, distant tower aftermath palette, and static infected-produce roadside silhouettes. No warm sunrise, no golden daylight, no orange dusk.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return String(value || "").trim();
}

function sanitize(value: unknown): string {
  return stringValue(value)
    .replace(/Scene visual continuity lock:\s*Scene visual authority:\s*Wasteland Highway\.[^\n]*/gi, `Scene visual continuity lock: ${nightLock}`)
    .replace(/Maintain:\s*Morning exterior[^.\n]*(?:\.[^\n]*)?/gi, "Maintain cold night/pre-dawn exterior; consistent cold moonlit palette from the canonical scene reference; no warm sunrise, no golden daylight, no orange dusk.")
    .replace(/Keep the same canonical scene identity for Wasteland Highway:\s*Morning exterior[^.\n]*(?:\.[^\n]*)?/gi, "Keep the same canonical scene identity for Wasteland Highway: cold night/pre-dawn exterior, black-blue horizon, cracked dark asphalt, cold moonlit palette, no warm sunrise or orange dusk.")
    .replace(/\bMorning exterior\b/gi, "cold night/pre-dawn exterior")
    .replace(/\bdawn variants? add pale gold\b/gi, "no warm dawn or pale gold")
    .replace(/\bgolden dawn light\b/gi, "cold moonlit night light")
    .replace(/\bdawn light\b/gi, "cold moonlit night light")
    .replace(/\bwarm morning light\b/gi, "cold black-blue night light")
    .replace(/\bmorning light\b/gi, "cold moonlit light")
    .replace(/\bmorning sky\b/gi, "black-blue night sky")
    .replace(/\bgolden light\b/gi, "cold moonlit light")
    .trim();
}

const project = await prisma.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);

const metadata = project.metadata;
const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
const episode = isRecord(episodes[episodeId]) ? episodes[episodeId] : {};
const workflow = isRecord(episode.workflowCenter) ? episode.workflowCenter : {};
const clips = Array.isArray(workflow.clips) ? workflow.clips.filter(isRecord) : [];

let clipsPatched = 0;
const nextClips = clips.map((clip) => {
  if (!targetClipIds.has(stringValue(clip.id))) return clip;
  let changed = false;
  const next = { ...clip };
  for (const key of ["seedancePrompt", "videoPrompt", "prompt", "startState", "endState", "plotGoal"]) {
    if (!(key in next)) continue;
    const before = stringValue(next[key]);
    const after = sanitize(before);
    if (after !== before) {
      next[key] = after;
      changed = true;
    }
  }
  if (changed) clipsPatched += 1;
  return next;
});

const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
const canvasScene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : {};
const nodes = Array.isArray(canvasScene.nodes) ? canvasScene.nodes.filter(isRecord) : [];

let nodesPatched = 0;
const nextNodes = nodes.map((node) => {
  const data = isRecord(node.data) ? node.data : {};
  const clipId = stringValue(data.clipId || data.targetClipId || data.sourceClipId);
  const text = JSON.stringify(data);
  const isTarget =
    targetClipIds.has(clipId) ||
    ([...targetClipIds].some((id) => text.includes(id)) && /Wasteland Highway|Morning exterior|warm morning|dawn light|golden/i.test(text));
  if (!isTarget) return node;
  let changed = false;
  const nextData = { ...data };
  for (const key of ["prompt", "finalPrompt", "submittedPrompt", "seedancePrompt", "videoPrompt", "sourcePrompt", "targetPrompt", "translatedPrompt", "result", "text", "label"]) {
    if (!(key in nextData)) continue;
    const before = stringValue(nextData[key]);
    const after = sanitize(before);
    if (after !== before) {
      nextData[key] = after;
      changed = true;
    }
  }
  if (!changed) return node;
  nodesPatched += 1;
  return { ...node, data: nextData };
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
          workflowCenter: { ...workflow, clips: nextClips, updatedAt: new Date().toISOString() },
          updatedAt: new Date().toISOString(),
        },
      },
      canvasScenes: {
        ...canvasScenes,
        [episodeId]: { ...canvasScene, nodes: nextNodes, updatedAt: new Date().toISOString() },
      },
      updatedAt: new Date().toISOString(),
    },
  },
});

console.log(JSON.stringify({ projectId, episodeId, clipsPatched, nodesPatched }, null, 2));
await prisma.$disconnect();
