import { PrismaClient } from "@prisma/client";
import { storyboardReferencesFromGenerationRecords } from "../server/src/lib/canvasStoryboardReferences.ts";

const projectId = process.argv[2];
if (!projectId) {
  console.error("Usage: node scripts/check-video-prompts-follow-storyboards.mjs <projectId>");
  process.exit(2);
}

const prisma = new PrismaClient();

const project = await prisma.project.findUnique({
  where: { id: projectId },
  select: { id: true, name: true, metadata: true },
});
if (!project) {
  console.error(`Project not found: ${projectId}`);
  process.exit(2);
}

const workflow = project.metadata?.workflowCenter ?? {};
const clips = Array.isArray(workflow.clips) ? workflow.clips : [];
const records = await prisma.generation.findMany({
  where: { projectId, status: "SUCCEEDED" },
  include: { assets: true },
  orderBy: { createdAt: "desc" },
  take: 300,
});
const refs = storyboardReferencesFromGenerationRecords(records, { workflowCenter: { clips } });

let failCount = 0;
console.log(`Project: ${project.name} (${project.id})`);
console.log(`Clips: ${clips.length}, recovered storyboard refs: ${refs.length}`);

for (const clip of clips) {
  const prompt = String(clip.storyboardPrompt || refs.find((ref) => ref.clipId === clip.id)?.prompt || "");
  const panelLabels = extractStoryboardPanelLabels(prompt);
  if (panelLabels.length === 0) {
    console.log(`SKIP ${clip.id} ${clip.title}: no storyboard panels found`);
    continue;
  }

  const videoPrompt = buildVideoPromptFromStoryboard(clip, panelLabels);
  const videoLabels = extractVideoBeatLabels(videoPrompt);
  const missing = panelLabels.filter((label) => !videoLabels.includes(label));
  if (missing.length > 0) {
    failCount += 1;
    console.log(`FAIL ${clip.id} ${clip.title}: missing ${missing.join(", ")}`);
    continue;
  }
  console.log(`OK ${clip.id} ${clip.title}: ${panelLabels.join(", ")}`);
}

console.log(`FAIL_COUNT=${failCount}`);
await prisma.$disconnect();
process.exit(failCount > 0 ? 1 : 0);

function extractStoryboardPanelLabels(value) {
  const prompt = String(value || "");
  const matches = prompt.matchAll(
    /(?:^|\n|\s)(?:Panel|panel|Storyboard\s*panel|分镜|镜头|格|画面|Shot|shot)\s*#?\s*(\d{1,2})\s*(?:[:：.\-]|[)\]]|\s+-\s+)/gi,
  );
  return Array.from(matches)
    .map((match) => `P${Number(match[1])}`)
    .filter((label, index, labels) => labels.indexOf(label) === index)
    .slice(0, 9);
}

function extractVideoBeatLabels(value) {
  return Array.from(String(value || "").matchAll(/\bP(\d{1,2})\s*:/g))
    .map((match) => `P${Number(match[1])}`)
    .filter((label, index, labels) => labels.indexOf(label) === index);
}

function buildVideoPromptFromStoryboard(clip, panelLabels) {
  return [
    `Clip video prompt for ${clip.title || clip.id}.`,
    "Use the connected storyboard image as the main visual reference and animate these panels in order:",
    panelLabels.map((label) => `${label}: storyboard panel beat`).join("\n"),
  ].join("\n");
}
