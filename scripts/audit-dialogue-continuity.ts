import { prisma } from "../server/src/lib/prisma";
import { workflowsTestInternals } from "../server/src/routes/workflows";

type ClipRecord = {
  id?: string;
  title?: string;
  seedancePrompt?: string;
  plotGoal?: string;
  startState?: string;
  endState?: string;
  setting?: string;
};

function norm(input: string): string {
  return input
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(input: string): string {
  return norm(input).replace(/\s+/g, "");
}

function quotedText(input: string): string[] {
  const out: string[] = [];
  const re = /["“]([\s\S]*?)["”]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input))) {
    const text = match[1].trim();
    if (text) out.push(text);
  }
  return out;
}

function exactDialogueLines(prompt: string): string[] {
  return prompt
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => /Exact dialogue:/i.test(line))
    .map((line) => line.replace(/^S\d+:\s*/i, ""));
}

function shotLines(prompt: string): string[] {
  return prompt
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => /^S\d+:/i.test(line));
}

function lineShotId(line: string): string {
  return line.match(/^(S\d+):/i)?.[1] ?? "";
}

function hasUnbalancedQuotes(line: string): boolean {
  const left = (line.match(/[“"]/g) || []).length;
  const right = (line.match(/[”"]/g) || []).length;
  const curlyLeft = (line.match(/“/g) || []).length;
  const curlyRight = (line.match(/”/g) || []).length;
  if (curlyLeft !== curlyRight) return true;
  return left % 2 !== 0 || right % 2 !== 0;
}

function sourceDialogueCoverage(sourceDialogues: string[], clips: ClipRecord[]) {
  const allPromptText = compact(clips.map((clip) => clip.seedancePrompt || "").join("\n"));
  return sourceDialogues.map((dialogue, index) => {
    const normalized = compact(dialogue);
    const covered = normalized.length > 0 && dialogueCoveredByPrompt(dialogue, normalized, allPromptText);
    return { index: index + 1, dialogue, covered };
  });
}

function dialogueCoveredByPrompt(dialogue: string, normalizedDialogue: string, allPromptText: string): boolean {
  if (allPromptText.includes(normalizedDialogue)) return true;
  const naturalUnits = String(dialogue || "")
    .split(/(?<=[.!?。！？])\s+/)
    .map((unit) => compact(unit))
    .filter((unit) => unit.length >= 18);
  if (naturalUnits.length >= 2 && naturalUnits.every((unit) => allPromptText.includes(unit))) return true;
  const words = norm(dialogue).split(/\s+/).filter(Boolean);
  if (words.length < 10) return false;
  const chunks: string[] = [];
  let current: string[] = [];
  for (const word of words) {
    current.push(word);
    if (current.length >= 8 || /[.!?。！？]$/.test(word)) {
      chunks.push(compact(current.join(" ")));
      current = [];
    }
  }
  if (current.length > 0) chunks.push(compact(current.join(" ")));
  const meaningful = chunks.filter((chunk) => chunk.length >= 18);
  if (meaningful.length < 2) return false;
  return meaningful.every((chunk) => allPromptText.includes(chunk));
}

function promptDialogueCoverage(sourceText: string, clips: ClipRecord[]) {
  const sourceCompact = compact(sourceText);
  const rows: Array<{
    clipId: string;
    clipTitle: string;
    shot: string;
    dialogue: string;
    inSource: boolean;
    suspicious: string[];
  }> = [];
  for (const clip of clips) {
    for (const line of exactDialogueLines(clip.seedancePrompt || "")) {
      const dialogues = quotedText(line);
      const suspicious: string[] = [];
      if (/Narration\s*:/i.test(line)) suspicious.push("Narration inside Exact dialogue");
      if (hasUnbalancedQuotes(line)) suspicious.push("Unbalanced quote marks");
      if (dialogues.length === 0) suspicious.push("No quoted dialogue segment");
      for (const dialogue of dialogues.length ? dialogues : [line]) {
        const normalized = compact(dialogue);
        rows.push({
          clipId: clip.id || "",
          clipTitle: clip.title || "",
          shot: lineShotId(line),
          dialogue,
          inSource: normalized.length > 0 && sourceCompact.includes(normalized),
          suspicious,
        });
      }
    }
  }
  return rows;
}

function emptyOrWeakShots(clip: ClipRecord) {
  return shotLines(clip.seedancePrompt || "")
    .map((line) => {
      const body = line.replace(/^S\d+:\s*/i, "");
      const hasDialogue = /Exact dialogue:/i.test(body);
      const hasBlocking = /blocking:/i.test(body);
      const concreteWords = body
        .replace(/Shot:[^;]+;/gi, "")
        .replace(/Performance:[^;]+/gi, "")
        .replace(/keeps the established blocking while changing gaze, posture, hand position, or prop contact/gi, "")
        .replace(/No subtitles.*/gi, "")
        .trim();
      const weak =
        body.length < 90 ||
        /^Shot:[^;]+;\s*$/i.test(body) ||
        /keeps the established blocking while changing gaze, posture, hand position, or prop contact/i.test(body) ||
        concreteWords.length < 35;
      return { shot: lineShotId(line), line, hasDialogue, hasBlocking, weak };
    })
    .filter((row) => row.weak);
}

async function main() {
  const projectId = process.argv[2];
  const episodeArgs = process.argv.slice(3);
  if (!projectId || episodeArgs.length === 0) {
    throw new Error("Usage: npx tsx scripts/audit-dialogue-continuity.ts <projectId> <episodeId...>");
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { metadata: true },
  });
  const episodes = (project?.metadata as any)?.episodes || {};
  const report = [];

  for (const episodeId of episodeArgs) {
    const workflow = episodes[episodeId]?.workflowCenter || {};
    const sourceText = String(workflow.sourceText || "");
    const clips: ClipRecord[] = Array.isArray(workflow.clips) ? workflow.clips : [];
    const sourceDialogues = workflowsTestInternals.sourceDialogueLockLines(sourceText);
    const rawQuotedSourceDialogues = quotedText(sourceText);
    const sourceCoverage = sourceDialogueCoverage(sourceDialogues, clips);
    const promptCoverage = promptDialogueCoverage(sourceText, clips);
    const missingSourceDialogues = sourceCoverage.filter((row) => !row.covered);
    const promptNotInSource = promptCoverage.filter((row) => !row.inSource);
    const suspiciousPromptDialogues = promptCoverage.filter((row) => row.suspicious.length > 0);
    const weakShots = clips.flatMap((clip) =>
      emptyOrWeakShots(clip).map((row) => ({
        clipId: clip.id || "",
        clipTitle: clip.title || "",
        ...row,
      })),
    );

    report.push({
      episodeId,
      title: episodes[episodeId]?.title || episodeId,
      sourceDialogueCount: sourceDialogues.length,
      rawQuotedSourceDialogueCount: rawQuotedSourceDialogues.length,
      clipCount: clips.length,
      missingSourceDialogues,
      promptNotInSource,
      suspiciousPromptDialogues,
      weakShots,
      clips: clips.map((clip) => ({
        id: clip.id,
        title: clip.title,
        setting: clip.setting,
        plotGoal: clip.plotGoal,
        startState: clip.startState,
        endState: clip.endState,
        promptDialogues: exactDialogueLines(clip.seedancePrompt || ""),
      })),
    });
  }

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
