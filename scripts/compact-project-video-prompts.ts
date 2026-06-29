import { prisma } from "../server/src/lib/prisma";
import { workflowsTestInternals } from "../server/src/routes/workflows";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const maxChars = Number(process.argv[3] || 4000);

type ClipRecord = {
  id?: string;
  seedancePrompt?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function main() {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { metadata: true },
  });
  if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);

  const metadata = project.metadata as Record<string, unknown>;
  const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
  let total = 0;
  let changed = 0;
  let overLimitAfter = 0;
  let maxBefore = 0;
  let maxAfter = 0;
  const changedSamples: Array<{ episodeId: string; clipId: string; before: number; after: number }> = [];

  for (const [episodeId, episode] of Object.entries(episodes)) {
    if (!isRecord(episode)) continue;
    const workflowCenter = isRecord(episode.workflowCenter) ? episode.workflowCenter : undefined;
    const clips = Array.isArray(workflowCenter?.clips) ? workflowCenter.clips as ClipRecord[] : [];
    for (const clip of clips) {
      if (typeof clip.seedancePrompt !== "string" || !clip.seedancePrompt.trim()) continue;
      total += 1;
      const before = clip.seedancePrompt;
      const beforeLength = before.length;
      maxBefore = Math.max(maxBefore, beforeLength);
      const after = workflowsTestInternals.finalizeWorkflowVideoPrompt(before);
      const afterLength = after.length;
      maxAfter = Math.max(maxAfter, afterLength);
      if (afterLength > maxChars) overLimitAfter += 1;
      if (after !== before) {
        clip.seedancePrompt = after;
        changed += 1;
        if (changedSamples.length < 20) {
          changedSamples.push({ episodeId, clipId: clip.id || "", before: beforeLength, after: afterLength });
        }
      }
    }
  }

  if (changed > 0) {
    await prisma.project.update({
      where: { id: projectId },
      data: { metadata },
    });
  }

  console.log(JSON.stringify({
    projectId,
    total,
    changed,
    maxBefore,
    maxAfter,
    overLimitAfter,
    changedSamples,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
