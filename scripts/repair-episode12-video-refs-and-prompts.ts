import { prisma } from "../server/src/lib/prisma";
import { buildEpisodeCanvasSyncScene, writeEpisodeCanvasSyncMetadata } from "../server/src/lib/episodeCanvasSync";
import { workflowMaintenanceInternals } from "../server/src/routes/workflows";
import { metadataWithProjectSettings, projectGenerationStrategyFromMetadata } from "../server/src/lib/projectGenerationStrategy";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = process.argv[3] || "episode-012";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanKnownReactionBoilerplate(value: unknown): string {
  return stringValue(value)
    .replace(/\b([A-Z][A-Za-z'’.-]+(?:\s+and\s+[A-Z][A-Za-z'’.-]+)?)\s+absorbs\s+the\s+spoken\s+line\s+with\s+a\s+changed\s+expression,\s+gesture,\s+or\s+posture\.?/gi,
      "$1 hold a specific visible reaction tied to this shot.")
    .replace(/\b([A-Z][A-Za-z'’.-]+(?:\s+and\s+[A-Z][A-Za-z'’.-]+)?)\s+absorb\s+the\s+spoken\s+line\s+with\s+a\s+changed\s+expression,\s+gesture,\s+or\s+posture\.?/gi,
      "$1 hold a specific visible reaction tied to this shot.")
    .replace(/\b([A-Z][A-Za-z'’.-]+(?:\s+and\s+[A-Z][A-Za-z'’.-]+)?)\s+holds\s+a\s+concrete\s+reaction\s+tied\s+to\s+the\s+visible\s+action,\s+with\s+readable\s+expression\s+and\s+body\s+language\.?/gi,
      "$1 hold a specific visible reaction tied to this shot.")
    .replace(/\b([A-Z][A-Za-z'’.-]+(?:\s+and\s+[A-Z][A-Za-z'’.-]+)?)\s+hold\s+a\s+concrete\s+reaction\s+tied\s+to\s+the\s+visible\s+action,\s+with\s+readable\s+expression\s+and\s+body\s+language\.?/gi,
      "$1 hold a specific visible reaction tied to this shot.")
    .replace(/\bSame dialogue turn continues over this silent reaction\/cutaway shot\.?/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeText(value: unknown): string {
  return stringValue(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function looksGenericReaction(value: unknown): boolean {
  const text = normalizeText(value);
  return (
    /absorbs? the spoken line with a changed expression gesture or posture/.test(text) ||
    /holds? a concrete reaction tied to the visible action with readable expression and body language/.test(text) ||
    /hold a specific visible reaction tied to this shot/.test(text) ||
    /reacts? to the previous moment with a visible change in expression or posture/.test(text)
  );
}

function splitCandidates(value: unknown): string[] {
  return cleanKnownReactionBoilerplate(value)
    .split(/\s*;\s*|(?<=[.!?。！？])\s+|\s*\|\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function concreteShotText(shot: Record<string, unknown>, fallback = ""): string {
  const candidates = [
    ...splitCandidates(shot.action),
    ...splitCandidates(shot.description),
    ...splitCandidates(shot.visualPrompt),
    ...splitCandidates(shot.references),
    stringValue(shot.title),
    fallback,
  ];
  return candidates.find((item) => item && !looksGenericReaction(item)) || candidates.find(Boolean) || fallback;
}

function cleanEndpointState(value: unknown, shot: Record<string, unknown>, kind: "start" | "end"): string {
  const cleaned = cleanKnownReactionBoilerplate(value);
  if (cleaned && !looksGenericReaction(cleaned)) return cleaned;
  const prefix = kind === "start" ? "Starts with" : "Ends with";
  const setting = stringValue(shot.setting);
  return [prefix, setting ? `in ${setting}` : "", concreteShotText(shot)].filter(Boolean).join(" ");
}

function cleanLayoutMemory(value: unknown): string {
  return cleanKnownReactionBoilerplate(value)
    .split("\n")
    .map((line) => cleanKnownReactionBoilerplate(line))
    .filter((line) => line && !looksGenericReaction(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanDirectorBoardPrompt(value: unknown, action: string): string {
  const cleaned = cleanKnownReactionBoilerplate(value);
  if (!cleaned) return cleaned;
  return cleaned
    .replace(/^Action:\s*.*$/gim, `Action: ${action}`)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function syncTranslationNodesToVideoPrompts(sync: { nodes: any[]; edges: any[] }) {
  const promptByVideoNodeId = new Map<string, string>();
  const labelByVideoNodeId = new Map<string, string>();
  for (const node of sync.nodes) {
    if (node?.type !== "video") continue;
    const prompt = stringValue(node.data?.prompt);
    if (!prompt) continue;
    promptByVideoNodeId.set(node.id, prompt);
    labelByVideoNodeId.set(node.id, stringValue(node.data?.label) || stringValue(node.data?.title));
  }
  const stalePattern = /absorbs the spoken line|holds a concrete reaction tied to the visible action|hold a specific visible reaction tied to this shot/i;
  return {
    ...sync,
    nodes: sync.nodes.map((node) => {
      const cleanedPromptFields = {
        sourcePrompt: cleanKnownReactionBoilerplate(node.data?.sourcePrompt),
        prompt: cleanKnownReactionBoilerplate(node.data?.prompt),
        finalPrompt: cleanKnownReactionBoilerplate(node.data?.finalPrompt),
      };
      const cleanedPromptUpdates = Object.fromEntries(Object.entries(cleanedPromptFields).filter(([, value]) => value));
      if (node?.type !== "translation") {
        return Object.keys(cleanedPromptUpdates).length
          ? { ...node, data: { ...(node.data ?? {}), ...cleanedPromptUpdates } }
          : node;
      }
      const sourceNodeId = stringValue(node.data?.sourceNodeId);
      const prompt = promptByVideoNodeId.get(sourceNodeId);
      if (!prompt) {
        return {
          ...node,
          data: {
            ...(node.data ?? {}),
            ...cleanedPromptUpdates,
          },
        };
      }
      const translatedPrompt = stringValue(node.data?.translatedPrompt);
      const staleTranslation = stalePattern.test(translatedPrompt);
      return {
        ...node,
        data: {
          ...(node.data ?? {}),
          sourcePrompt: prompt,
          sourceNodeLabel: labelByVideoNodeId.get(sourceNodeId) || node.data?.sourceNodeLabel,
          ...(staleTranslation ? {
            translatedPrompt: "",
            status: "waiting",
            error: "",
          } : {}),
        },
      };
    }),
  };
}

async function main() {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, aspectRatio: true, settings: true, metadata: true },
  });

  if (!project || !isRecord(project.metadata)) {
    console.error(`Project not found or invalid metadata: ${projectId}`);
    process.exit(1);
  }

  const baseMetadata = project.metadata;
  const metadata = metadataWithProjectSettings(baseMetadata, project.settings);
  const workflow = workflowMaintenanceInternals.getWorkflowState(metadata, episodeId);
  const shotsById = new Map(workflow.breakdownScenes.map((shot) => [shot.id, shot]));
  let cleanedShots = 0;
  const nextBreakdownScenes = workflow.breakdownScenes.map((shot) => {
    const fallbackAction = concreteShotText(shot, stringValue(shot.action));
    const nextAction = looksGenericReaction(shot.action) ? fallbackAction : cleanKnownReactionBoilerplate(shot.action);
    const nextDescription = cleanKnownReactionBoilerplate(shot.description);
    const nextVisualPrompt = cleanKnownReactionBoilerplate(shot.visualPrompt);
    const nextReferences = cleanKnownReactionBoilerplate(shot.references);
    const nextDirectorBoardPrompt = cleanDirectorBoardPrompt(shot.directorBoardPrompt, nextAction || fallbackAction);
    const changed = (
      nextAction !== stringValue(shot.action) ||
      nextDescription !== stringValue(shot.description) ||
      nextVisualPrompt !== stringValue(shot.visualPrompt) ||
      nextReferences !== stringValue(shot.references) ||
      nextDirectorBoardPrompt !== stringValue(shot.directorBoardPrompt)
    );
    if (changed) cleanedShots += 1;
    const nextShot = {
      ...shot,
      action: nextAction || shot.action,
      description: nextDescription || shot.description,
      visualPrompt: nextVisualPrompt || shot.visualPrompt,
      references: nextReferences || shot.references,
      directorBoardPrompt: nextDirectorBoardPrompt || shot.directorBoardPrompt,
    };
    shotsById.set(nextShot.id, nextShot);
    return nextShot;
  });

  let regeneratedCount = 0;
  const nextClips = workflow.clips.map((clip) => {
    const shots = clip.shotIds.map((shotId) => shotsById.get(shotId)).filter((shot): shot is NonNullable<typeof shot> => Boolean(shot));
    if (!shots.length) return clip;
    const clipForGeneration = {
      ...clip,
      startState: cleanEndpointState(clip.startState, shots[0], "start"),
      endState: cleanEndpointState(clip.endState, shots[shots.length - 1], "end"),
      layoutMemory: cleanLayoutMemory(clip.layoutMemory),
    };
    const generated = workflowMaintenanceInternals.regenerateWorkflowClipSeedancePrompt(project, {
      ...workflow,
      breakdownScenes: nextBreakdownScenes,
    }, clipForGeneration, shots);
    regeneratedCount += 1;
    return { ...clip, ...generated };
  });

  const nextWorkflow = {
    ...workflow,
    breakdownScenes: nextBreakdownScenes,
    clips: nextClips,
    stageStatuses: {
      ...workflow.stageStatuses,
      video: "done",
    },
    lastRun: {
      ...(isRecord(workflow.lastRun) ? workflow.lastRun : {}),
      status: "episode-012-video-refs-and-prompts-repaired",
      stage: "video",
      completedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };

  let nextMetadata = workflowMaintenanceInternals.writeWorkflowEpisode(baseMetadata, episodeId, nextWorkflow, true);
  const canvasScenes = isRecord(baseMetadata.canvasScenes) ? baseMetadata.canvasScenes : {};
  const existingScene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] as { nodes?: unknown[]; edges?: unknown[] } : undefined;
  const sync = syncTranslationNodesToVideoPrompts(buildEpisodeCanvasSyncScene({
    metadata: nextMetadata,
    episodeId,
    generationStrategy: projectGenerationStrategyFromMetadata(metadata),
    existingScene,
    now: new Date().toISOString(),
  }));
  nextMetadata = writeEpisodeCanvasSyncMetadata({ metadata: nextMetadata, sync, makeActive: true });

  await prisma.project.update({
    where: { id: projectId },
    data: { metadata: nextMetadata },
  });

  const badPromptCount = nextClips.filter((clip) => /absorbs the spoken line|holds a concrete reaction tied to the visible action/i.test(clip.seedancePrompt)).length;
  const staleMetadataCount = (JSON.stringify(nextMetadata).match(/absorbs the spoken line|holds a concrete reaction tied to the visible action/gi) ?? []).length;
  console.log(JSON.stringify({
    projectId,
    episodeId,
    cleanedShots,
    regeneratedCount,
    canvasNodes: sync.nodes.length,
    canvasEdges: sync.edges.length,
    badPromptCount,
    staleMetadataCount,
  }, null, 2));
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
