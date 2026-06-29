import { prisma } from "../server/src/lib/prisma";
import { workflowsTestInternals } from "../server/src/routes/workflows";

type ClipRecord = {
  id: string;
  title?: string;
  seedancePrompt?: string;
  characters?: string[];
};

type CanvasNode = {
  id?: string;
  type?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeIds = process.argv.slice(3);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeDialogue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”‘’"']/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactDialogue(value: string): string {
  return normalizeDialogue(value).replace(/\s+/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trimDialogueQuotes(value: string): string {
  return value.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
}

function promptHasDialogue(prompt: string, dialogue: string): boolean {
  const key = compactDialogue(dialogue);
  return Boolean(key) && compactDialogue(prompt).includes(key);
}

function sourceDialogueIndex(sourceText: string, dialogue: string): number {
  const variants = [
    `"${dialogue}"`,
    `“${dialogue}”`,
    dialogue,
  ];
  for (const variant of variants) {
    const index = sourceText.indexOf(variant);
    if (index >= 0) return index;
  }
  return -1;
}

function knownNames(workflow: any): string[] {
  const names = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim()) names.add(value.trim());
  };
  for (const clip of workflow.clips ?? []) {
    for (const name of clip.characters ?? []) add(name);
  }
  for (const section of ["characters", "props", "scenes"]) {
    const items = workflow.assets?.[section];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      add(item?.name);
      add(item?.title);
      if (Array.isArray(item?.aliases)) item.aliases.forEach(add);
    }
  }
  ["Chloe", "Bob", "Leo", "Tangelo", "Pineapple Showrunner", "Showrunner", "Kiwi Greeter", "Announcer", "System"].forEach(add);
  return Array.from(names).sort((a, b) => b.length - a.length);
}

function screenTextLike(dialogue: string): boolean {
  return /^\[/.test(dialogue) ||
    /\b(?:System Alert|CRITICAL WARNING|Current Room Temp|Target Temp|Room Temp|Reject edit|Forced Heart-Rate|Global Update|Countdown|Status:|Recommendation:|Cancel Formatting|directive|Patch:|BEEP|WARNING!)\b/i.test(dialogue);
}

function skipDialogue(dialogue: string): boolean {
  const cleaned = dialogue.trim();
  if (!cleaned) return true;
  if (/^\.\.\.?$/.test(cleaned)) return true;
  if (cleaned.length <= 2) return true;
  return false;
}

function inferSpeaker(sourceText: string, dialogue: string, names: string[], fallback = ""): string {
  if (screenTextLike(dialogue)) return "System";
  const explicit = dialogue.match(/^([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}|[一-龥·]{1,12})\s*[:：]\s*(\S[\s\S]*)$/);
  if (explicit && names.some((name) => normalizeDialogue(name) === normalizeDialogue(explicit[1] ?? ""))) return explicit[1]?.trim() ?? fallback;

  const index = sourceDialogueIndex(sourceText, dialogue);
  const context = index >= 0
    ? sourceText.slice(Math.max(0, index - 260), Math.min(sourceText.length, index + dialogue.length + 260))
    : "";
  const verbs = "(?:said|asked|replied|responded|muttered|shouted|yelled|called|snapped|whispered|announced|continued|added|scoffed|sneered|translated|read|roared|hissed|growled|deadpanned|sighed)";
  for (const name of names) {
    const n = escapeRegExp(name);
    const before = new RegExp(`${n}(?:\\s*\\([^)]*\\))?[^\\n.?!]{0,120}${verbs}\\s*[:，,]?\\s*[“"]?$`, "i");
    const after = new RegExp(`[”"]?\\s*[,，]?\\s*${n}(?:\\s*\\([^)]*\\))?\\s*${verbs}`, "i");
    const beforeText = index >= 0 ? sourceText.slice(Math.max(0, index - 180), index) : context;
    const afterText = index >= 0 ? sourceText.slice(index + dialogue.length, Math.min(sourceText.length, index + dialogue.length + 180)) : context;
    if (before.test(beforeText) || after.test(afterText)) return name;
  }
  if (/PA|speaker|system|terminal|monitor|screen|console/i.test(context)) return "System";
  return fallback || "Unknown";
}

function dialogueBody(dialogue: string, speaker: string): string {
  const explicit = dialogue.match(/^([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}|[一-龥·]{1,12})\s*[:：]\s*(\S[\s\S]*)$/);
  if (explicit && normalizeDialogue(explicit[1] ?? "") === normalizeDialogue(speaker)) return trimDialogueQuotes(explicit[2] ?? "");
  return trimDialogueQuotes(dialogue);
}

function formattedDialogue(dialogue: string, speaker: string): string {
  if (screenTextLike(dialogue)) return `Monitor/System text: “${trimDialogueQuotes(dialogue)}”`;
  const safeSpeaker = speaker && speaker !== "Unknown" ? speaker : "Speaker";
  return `Exact dialogue: ${safeSpeaker}: “${dialogueBody(dialogue, safeSpeaker)}”`;
}

function findClipContaining(clips: ClipRecord[], dialogue: string): number {
  const key = compactDialogue(dialogue);
  if (!key) return -1;
  return clips.findIndex((clip) => promptHasDialogue(clip.seedancePrompt || "", dialogue));
}

function partialScore(line: string, dialogue: string): number {
  const lineKey = normalizeDialogue(line);
  const dialogueKey = normalizeDialogue(dialogue);
  if (!lineKey || !dialogueKey) return 0;
  if (lineKey.includes(dialogueKey) || dialogueKey.includes(lineKey)) return Math.min(lineKey.length, dialogueKey.length);
  const words = dialogueKey.split(/\s+/).filter((word) => word.length >= 4);
  let score = 0;
  for (let size = Math.min(8, words.length); size >= 2; size -= 1) {
    for (let index = 0; index + size <= words.length; index += 1) {
      const phrase = words.slice(index, index + size).join(" ");
      if (lineKey.includes(phrase)) score = Math.max(score, phrase.length);
    }
  }
  for (const word of words) {
    if (word.length >= 8 && lineKey.includes(word)) score = Math.max(score, word.length);
  }
  return score;
}

function findBestPartialLine(clips: ClipRecord[], dialogue: string): { clipIndex: number; lineIndex: number; score: number } | null {
  let best: { clipIndex: number; lineIndex: number; score: number } | null = null;
  clips.forEach((clip, clipIndex) => {
    const lines = (clip.seedancePrompt || "").split("\n");
    lines.forEach((line, lineIndex) => {
      if (!/^S\d+:/i.test(line) && !/Exact dialogue|Monitor\/System text/i.test(line)) return;
      const score = partialScore(line, dialogue);
      if (score > (best?.score ?? 0)) best = { clipIndex, lineIndex, score };
    });
  });
  return best && best.score >= 8 ? best : null;
}

function targetClipIndex(clips: ClipRecord[], sourceDialogues: string[], missingIndex: number): number {
  for (let index = missingIndex - 1; index >= 0; index -= 1) {
    const clipIndex = findClipContaining(clips, sourceDialogues[index] ?? "");
    if (clipIndex >= 0) return clipIndex;
  }
  for (let index = missingIndex + 1; index < sourceDialogues.length; index += 1) {
    const clipIndex = findClipContaining(clips, sourceDialogues[index] ?? "");
    if (clipIndex >= 0) return clipIndex;
  }
  return Math.min(clips.length - 1, Math.max(0, Math.floor((missingIndex / Math.max(1, sourceDialogues.length)) * clips.length)));
}

function nextShotLabel(prompt: string): string {
  const numbers = Array.from(prompt.matchAll(/^S(\d+):/gim)).map((match) => Number(match[1])).filter(Number.isFinite);
  return `S${(numbers.length ? Math.max(...numbers) : 0) + 1}`;
}

function replaceOrInsertDialogue(clips: ClipRecord[], clipIndex: number, lineIndex: number | null, dialogue: string, speaker: string) {
  const clip = clips[clipIndex];
  if (!clip) return false;
  const lines = (clip.seedancePrompt || "").split("\n");
  const formatted = formattedDialogue(dialogue, speaker);
  if (lineIndex !== null && lines[lineIndex]) {
    const line = lines[lineIndex];
    if (/Exact dialogue\s*[:：]/i.test(line)) {
      lines[lineIndex] = line.replace(/\bExact dialogue\s*[:：]\s*[^;]+/i, formatted);
    } else if (/Monitor\/System text\s*[:：]/i.test(line)) {
      lines[lineIndex] = line.replace(/\bMonitor\/System text\s*[:：]\s*[^;]+/i, formatted);
    } else {
      lines[lineIndex] = `${line.replace(/\s*;\s*$/g, "")}; ${formatted}`;
    }
    clip.seedancePrompt = lines.join("\n");
    return true;
  }

  const label = nextShotLabel(clip.seedancePrompt || "");
  const action = screenTextLike(dialogue)
    ? "insert monitor/console close-up so the text is readable, then show the nearest characters reacting."
    : "the speaker delivers this source line in story order while nearby visible characters react with matching posture and expression.";
  const inserted = `${label}: ${formatted}; Shot: close-up; eye-level; static hold; 85mm; ${action}`;
  const insertBefore = lines.findIndex((line) => /^(?:No subtitles|Do not add subtitles)/i.test(line));
  if (insertBefore >= 0) lines.splice(insertBefore, 0, inserted);
  else lines.push(inserted);
  clip.seedancePrompt = lines.join("\n");
  return true;
}

async function main() {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { metadata: true },
  });
  if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);
  const metadata = project.metadata as Record<string, unknown>;
  const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
  const targetEpisodeIds = episodeIds.length ? episodeIds : Object.keys(episodes).filter((id) => id >= "episode-015").sort();
  const report: any[] = [];

  for (const episodeId of targetEpisodeIds) {
    const episode = episodes[episodeId];
    if (!isRecord(episode) || !isRecord(episode.workflowCenter)) continue;
    const workflow = episode.workflowCenter as any;
    const sourceText = String(workflow.sourceText || "");
    const sourceDialogues = workflowsTestInternals.sourceDialogueLockLines(sourceText);
    const clips: ClipRecord[] = Array.isArray(workflow.clips) ? workflow.clips : [];
    const allPromptText = clips.map((clip) => clip.seedancePrompt || "").join("\n");
    const names = knownNames(workflow);
    const repairs = [];

    for (let index = 0; index < sourceDialogues.length; index += 1) {
      const dialogue = sourceDialogues[index] ?? "";
      if (skipDialogue(dialogue) || promptHasDialogue(allPromptText, dialogue)) continue;
      const partial = findBestPartialLine(clips, dialogue);
      const clipIndex = partial?.clipIndex ?? targetClipIndex(clips, sourceDialogues, index);
      const targetClip = clips[clipIndex];
      const fallbackSpeaker = targetClip?.characters?.[0] || "";
      const speaker = inferSpeaker(sourceText, dialogue, names, fallbackSpeaker);
      const repaired = replaceOrInsertDialogue(clips, clipIndex, partial?.lineIndex ?? null, dialogue, speaker);
      if (repaired) {
        repairs.push({
          sourceIndex: index + 1,
          clipId: targetClip?.id,
          clipTitle: targetClip?.title,
          mode: partial ? "replace-partial" : "insert",
          speaker,
          dialogue,
        });
      }
    }

    if (repairs.length > 0) {
      workflow.clips = clips;
      const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
      const scene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : null;
      if (scene && Array.isArray(scene.nodes)) {
        const promptByClip = new Map(clips.map((clip) => [clip.id, clip.seedancePrompt || ""]));
        scene.nodes = (scene.nodes as CanvasNode[]).map((node) => {
          const data = isRecord(node.data) ? node.data : {};
          const clipId = typeof data.clipId === "string" ? data.clipId : "";
          const prompt = promptByClip.get(clipId);
          if (node.type !== "video" || !prompt) return node;
          return {
            ...node,
            data: {
              ...data,
              prompt,
              seedancePrompt: prompt,
              videoPrompt: prompt,
            },
          };
        });
        scene.updatedAt = new Date().toISOString();
      }
      workflow.updatedAt = new Date().toISOString();
    }
    report.push({ episodeId, repairs });
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { metadata },
  });
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
