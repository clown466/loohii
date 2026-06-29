import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = process.argv[3] || "episode-010";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanExpiredGreenStain(value: unknown): string {
  return String(value || "")
    .replace(/\bBob guarded;\s*Chloe still wet\b[;,.]?\s*/gi, "Bob guarded")
    .replace(/\bChloe still wet\b[;,.]?\s*/gi, "")
    .replace(/\b;\s*Chloe still wet\b[;,.]?\s*/gi, "")
    .replace(/\bChloe stands,\s*green stain still visible\b[;,.]?\s*/gi, "Chloe stands")
    .replace(/\bChloe['’]s earlier green stain remains\b[;,.]?\s*/gi, "")
    .replace(/\bgreen stain still (?:sticky|visible)\b[;,.]?\s*/gi, "")
    .replace(/\bgreen sludge still (?:sticky|visible|dripping)\b[;,.]?\s*/gi, "")
    .replace(/\bher earlier green stain remains\b[;,.]?\s*/gi, "")
    .replace(/\bshirt visibly soaked with green sludge\b/gi, "the spilled green sludge is visible on Chloe during the fake spill")
    .replace(/\s+([;,.!?])/g, "$1")
    .replace(/;\s*;/g, ";")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function clipAllowsGreenSpillState(clipId: string): boolean {
  return clipId === "clip-001" || clipId === "clip-002";
}

function cleanObject(value: unknown, clipId = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => cleanObject(item, clipId));
  if (!isRecord(value)) return typeof value === "string" ? cleanExpiredGreenStain(value) : value;
  const next: Record<string, unknown> = {};
  const currentClipId = typeof value.id === "string" && /^clip-/i.test(value.id) ? value.id : clipId;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      // Keep the actual fake-spill beat intact; only remove stale carry-forward mentions after clip 02.
      next[key] = currentClipId && !clipAllowsGreenSpillState(currentClipId)
        ? cleanExpiredGreenStain(item)
        : item.replace(/\bshirt visibly soaked with green sludge\b/gi, "the spilled green sludge is visible on Chloe during the fake spill");
    } else {
      next[key] = cleanObject(item, currentClipId);
    }
  }
  return next;
}

const project = await prisma.project.findUnique({
  where: { id: projectId },
  select: { metadata: true },
});

if (!project) {
  console.error(`Project not found: ${projectId}`);
  process.exit(1);
}

const metadata = isRecord(project.metadata) ? project.metadata : {};
const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
const episode = isRecord(episodes[episodeId]) ? episodes[episodeId] : null;
if (!episode) {
  console.error(`Episode not found: ${episodeId}`);
  process.exit(1);
}

const workflowCenter = isRecord(episode.workflowCenter) ? episode.workflowCenter : {};
const before = JSON.stringify(workflowCenter);
const shotToClip = new Map<string, string>();
const clips = Array.isArray(workflowCenter.clips) ? workflowCenter.clips.filter(isRecord) : [];
for (const clip of clips) {
  const clipId = String(clip.id || "");
  for (const shotId of Array.isArray(clip.shotIds) ? clip.shotIds : []) {
    shotToClip.set(String(shotId), clipId);
  }
}
const nextWorkflowCenter = cleanObject(workflowCenter) as Record<string, unknown>;
if (Array.isArray(nextWorkflowCenter.clips)) {
  nextWorkflowCenter.clips = nextWorkflowCenter.clips.map((clip) => {
    if (!isRecord(clip)) return clip;
    const nextClip = { ...clip };
    if (typeof nextClip.layoutMemory === "string") {
      nextClip.layoutMemory = cleanExpiredGreenStain(nextClip.layoutMemory);
    }
    return nextClip;
  });
}
if (Array.isArray(nextWorkflowCenter.breakdownScenes)) {
  nextWorkflowCenter.breakdownScenes = nextWorkflowCenter.breakdownScenes.map((shot) => {
    if (!isRecord(shot)) return shot;
    const clipId = shotToClip.get(String(shot.id || "")) || "";
    if (!clipId || clipAllowsGreenSpillState(clipId)) return shot;
    return cleanObject(shot, clipId);
  });
}
const after = JSON.stringify(nextWorkflowCenter);

const nextMetadata = {
  ...metadata,
  episodes: {
    ...episodes,
    [episodeId]: {
      ...episode,
      workflowCenter: nextWorkflowCenter,
    },
  },
};

await prisma.project.update({
  where: { id: projectId },
  data: { metadata: nextMetadata },
});

console.log(JSON.stringify({
  projectId,
  episodeId,
  changed: before !== after,
  beforeMatches: (before.match(/green stain|still wet|earlier green stain|green sludge still|shirt visibly soaked with green sludge/gi) || []).length,
  afterMatches: (after.match(/green stain|still wet|earlier green stain|green sludge still|shirt visibly soaked with green sludge/gi) || []).length,
}, null, 2));

await prisma.$disconnect();
