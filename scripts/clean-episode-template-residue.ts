import { prisma } from "../server/src/lib/prisma";
import { workflowMaintenanceInternals } from "../server/src/routes/workflows";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = process.argv[3] || "episode-011";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const TEMPLATE_PATTERNS: RegExp[] = [
  /\bShow the listener's reaction, speaker's expression, and body language as the line lands\.?/gi,
  /\bHold the same scene geography and shift to a natural reaction or angle change\.?/gi,
  /\bSame setting and character blocking,?\s*natural reaction or angle change\.?/gi,
  /\breaction\/cutaway detail, same scene geography, same character positions\.?/gi,
  /\bSame dialogue turn continues over this silent reaction\/cutaway shot\.?/gi,
  /\bContinue the exchange with a clean reaction beat\.?/gi,
  /\bReaction beat\.?/gi,
  /\b(?:Cultists s|Cultists sit r|as if addre|addre|del)\.?(?=\s|$)/gi,
  /\b(?:show the consequence of the previous action|hold the previous action|previous action|reaction angle|without repeating the same pose)\b[^.\n;]*[.\n;]?/gi,
];

const CLEAN_TEXT_KEYS = [
  "title",
  "description",
  "action",
  "references",
  "visualPrompt",
  "composition",
  "startState",
  "endState",
  "layoutMemory",
  "plotGoal",
  "storyboardNotes",
  "seedancePrompt",
];

function cleanTemplateText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  let text = value;
  for (const pattern of TEMPLATE_PATTERNS) text = text.replace(pattern, "");
  return text
    .replace(/\s+([.,!?;:，。！？；：])/g, "$1")
    .replace(/([;；])\s*([;；])+/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*;\s*([.\n]|$)/g, "$1")
    .replace(/\s*[;:：,，]\s*$/g, "")
    .trim();
}

function cleanRecordText<T extends Record<string, unknown>>(record: T): T {
  const next: Record<string, unknown> = { ...record };
  for (const key of CLEAN_TEXT_KEYS) {
    if (typeof next[key] === "string") next[key] = cleanTemplateText(next[key]);
  }
  return next as T;
}

const project = await prisma.project.findUnique({
  where: { id: projectId },
  select: { id: true, metadata: true },
});

if (!project) {
  console.error(`Project not found: ${projectId}`);
  process.exit(1);
}

const metadata = isRecord(project.metadata) ? project.metadata : {};
const workflow = workflowMaintenanceInternals.getWorkflowState(metadata, episodeId);

let changedClips = 0;
let changedShots = 0;
const nextClips = workflow.clips.map((clip) => {
  const next = cleanRecordText(clip as unknown as Record<string, unknown>) as typeof clip;
  if (JSON.stringify(next) !== JSON.stringify(clip)) changedClips += 1;
  return next;
});
const nextShots = workflow.breakdownScenes.map((shot) => {
  const next = cleanRecordText(shot as unknown as Record<string, unknown>) as typeof shot;
  if (JSON.stringify(next) !== JSON.stringify(shot)) changedShots += 1;
  return next;
});

const nextWorkflow = {
  ...workflow,
  clips: nextClips,
  breakdownScenes: nextShots,
  updatedAt: new Date().toISOString(),
};

const nextMetadata = workflowMaintenanceInternals.writeWorkflowEpisode(metadata, episodeId, nextWorkflow, true);
await prisma.project.update({
  where: { id: projectId },
  data: { metadata: nextMetadata },
});

console.log(JSON.stringify({
  projectId,
  episodeId,
  changedClips,
  changedShots,
}, null, 2));

await prisma.$disconnect();
