import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = "episode-018";
const clipId = "clip-003";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return String(value || "").trim();
}

function resetOutput(data: Record<string, unknown>) {
  return {
    ...data,
    status: "waiting",
    error: "",
    outputImage: "",
    outputImageAssetId: "",
    outputImages: [],
    revisedPrompt: "",
    submittedPrompt: "",
    generationStartedAt: "",
    generationRequestId: "",
    generationId: "",
  };
}

const storyboardPrompt = [
  "Create a 2x3 comic storyboard board for Clip 03 · Stun baton attack and fishtail slide, matching video shots S1-S5 in exact order.",
  "Image type: one 16:9 storyboard sheet with five panels in a clean grid. Each panel is one still frame for one shot.",
  "Panel numbering is mandatory: small readable labels S1, S2, S3, S4, S5 in the upper-left corner. No other text, captions, speech bubbles, UI, watermark, or random labels.",
  "Project: 美式漫剧. Style: saturated 3D American animated dark-comedy storyboard/previsualization, cinematic but readable.",
  "Scene continuity lock: Wasteland Highway under the ruined overpass, cold night, wet cracked asphalt, dust, sparks, same road direction.",
  "Connected references to preserve exactly: Bob, Chloe, Leo, Avocado Emotion Wipers, Chopper, Stun Baton, Shotgun.",
  "Hard cast rule: exactly three riders on the chopper, no duplicates. One Bob only, one Chloe only, one Leo only. Bob is the orange driver in the front seat at the handlebars. Chloe is the peach rider in the middle seat with the shotgun. Leo is the yellow lemon rider in the rear seat with the terminal/pan. Keep this order in every panel where riders are visible.",
  "Hard vehicle rule: one two-wheel three-seat armored chopper only, with a single front wheel and single rear wheel. Do not change the vehicle body structure.",
  "Storyboard panels:",
  "Panel 1: Shot wide, 24mm. A suited Avocado Emotion Wiper drops from the overpass edge with a blue-white stun baton; below, the chopper has exactly three riders in order: Bob front, Chloe middle, Leo rear.",
  "Panel 2: Shot medium tracking, 35mm. The stun baton sweeps low toward Bob's front wheel. Show the same three riders only: Bob twists the handlebars, Chloe braces in the middle with shotgun, Leo clings to the rear. Do not add a second Chloe or extra peach rider.",
  "Panel 3: Shot over-shoulder from Chloe toward Bob, 50mm. Bob yells while forcing the chopper into a hard sideways skid; Chloe remains the single middle-seat rider.",
  "Panel 4: Shot low medium close-up, 50mm. The two-wheel chopper fishtails, throwing sparks and dust; Chloe braces in the middle seat, Leo hooks one arm around the rear grip.",
  "Panel 5: Shot wide-to-medium, 35mm. Chloe rises from the middle seat without leaving the chopper, plants one foot against the frame, and aims the shotgun at the charging Wiper while Bob drives and Leo stays rear.",
  "Continuity note: this clip starts after Bob swerves under the overpass and ends with Chloe aiming from the moving bike for the next shotgun blast.",
  "Do not redesign characters, scene architecture, props, clothing, held items, vehicle type, or visible character states.",
].join("\n");

async function main() {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
  if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);
  const metadata = project.metadata as Record<string, unknown>;
  const episodes = isRecord(metadata.episodes) ? metadata.episodes as Record<string, unknown> : {};
  const episode = isRecord(episodes[episodeId]) ? episodes[episodeId] as Record<string, unknown> : null;
  const workflow = isRecord(episode?.workflowCenter) ? episode.workflowCenter as Record<string, unknown> : {};
  const clips = Array.isArray(workflow.clips) ? workflow.clips.filter(isRecord) : [];
  const nextClips = clips.map((clip) => stringValue(clip.id) === clipId
    ? { ...clip, storyboardPrompt, panelCount: 5, storyboardPanelCount: 5 }
    : clip);
  const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes as Record<string, unknown> : {};
  const canvas = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] as Record<string, unknown> : null;
  if (!canvas) throw new Error(`Canvas scene not found: ${episodeId}`);
  const nodes = Array.isArray(canvas.nodes) ? canvas.nodes.filter(isRecord) : [];
  let touched = 0;
  const nextNodes = nodes.map((node) => {
    const data = isRecord(node.data) ? node.data as Record<string, unknown> : {};
    if (node.type === "generation" && data.positioningBoardFlow === true && stringValue(data.clipId) === clipId) {
      touched += 1;
      return {
        ...node,
        data: {
          ...resetOutput(data),
          prompt: storyboardPrompt,
          finalPrompt: storyboardPrompt,
          storyboardPrompt,
          manualFinalPrompt: true,
          positioningBoardMode: "storyboard",
          panelCount: 5,
          storyboardPanelCount: 5,
        },
      };
    }
    return node;
  });
  await prisma.project.update({
    where: { id: projectId },
    data: {
      metadata: {
        ...metadata,
        episodes: {
          ...episodes,
          [episodeId]: {
            ...(episode || {}),
            workflowCenter: { ...workflow, clips: nextClips, updatedAt: new Date().toISOString() },
            updatedAt: new Date().toISOString(),
          },
        },
        canvasScenes: {
          ...canvasScenes,
          [episodeId]: { ...canvas, nodes: nextNodes, updatedAt: new Date().toISOString() },
        },
      },
    },
  });
  console.log(JSON.stringify({ projectId, episodeId, clipId, touched, storyboardPromptLength: storyboardPrompt.length }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
