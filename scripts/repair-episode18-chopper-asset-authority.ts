import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = "episode-018";
const targetClipIds = new Set(process.argv.slice(3).filter(Boolean));

type R = Record<string, unknown>;

function isRecord(value: unknown): value is R {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function s(value: unknown): string {
  return String(value || "").trim();
}

function resetOutput(data: R): R {
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

const titleByClip: Record<string, string> = {
  "clip-001": "Clip 01 · Synchronized horde on the highway",
  "clip-002": "Clip 02 · Bob identifies the Emotion Wipers",
  "clip-003": "Clip 03 · Stun baton attack and fishtail slide",
  "clip-004": "Clip 04 · Shotgun blast does not stop the guard",
  "clip-005": "Clip 05 · Leo discovers the wristband weakness",
  "clip-006": "Clip 06 · Aftermath and encrypted terminal",
  "clip-007": "Clip 07 · Daniel Greene manifesto",
  "clip-008": "Clip 08 · The Temp outranks Daniel Greene",
  "clip-009": "Clip 09 · Chloe chooses the Black Spire target",
  "clip-010": "Clip 10 · Ready to meet the Savior",
};

const sceneByClip: Record<string, string> = {
  "clip-002": "Ruined Overpass",
  "clip-009": "Black Spire approach road",
  "clip-010": "Black Spire approach road",
};

const panelText: Record<string, string[]> = {
  "clip-001": [
    "S1 wide side/profile frame: Bob drives in the front seat, Chloe sits in the middle seat, Leo sits in the rear seat on the connected Chopper reference vehicle beside the synchronized horde.",
    "S2 over-shoulder from Chloe toward Leo: Leo leans forward from the rear seat and points at the overpass; keep Chloe visibly seated in the middle and Bob's hands on the handlebars.",
    "S3 telephoto: Avocado Emotion Wipers stand in a line on the ruined overpass, the trio and motorcycle are small below or off-frame.",
    "S4 medium detail: corporate badges and blue wristbands on the Wipers; no motorcycle needed.",
    "S5 close three-rider frame: Chloe in the middle seat reads the wristband with shotgun low, Bob front keeps driving, Leo rear watches the terminal.",
  ],
  "clip-002": [
    "S1 medium front-side frame: Bob drives under the overpass on the connected Chopper reference vehicle, Chloe middle and Leo rear behind him.",
    "S2 close-up on Bob at handlebars explaining the Emotion Wipers; Chloe's middle-seat shoulder and Leo rear edge remain visible, no one changes seats.",
    "S3 close-up on one Avocado Wiper activating above them; no motorcycle needed.",
    "S4 reverse wide from behind the trio looking up at the Wiper on the overpass; Bob front, Chloe middle, Leo rear remain seated in order.",
    "S5 side action frame: Bob ducks and swerves the connected Chopper reference vehicle; Chloe folds low in the middle seat with shotgun, Leo clamps onto the rear seat.",
  ],
  "clip-003": [
    "S1 wide under-overpass frame: Wiper drops with stun baton; below, the connected Chopper reference vehicle carries Bob front, Chloe middle, Leo rear.",
    "S2 medium tracking frame: baton sweeps near the front wheel; Bob twists the handlebars, Chloe remains seated in the middle with shotgun braced across her lap, Leo stays on the rear seat. No duplicate Chloe.",
    "S3 tight driver close-up on Bob at the handlebars as he yells and forces the skid. Keep Chloe out of frame or only barely visible behind Bob in her middle seat; do not use Chloe as the foreground subject.",
    "S4 low side frame: the connected Chopper reference vehicle fishtails with sparks; all three riders stay in order on its three visible seats.",
    "S5 wide-to-medium side frame: Chloe rises from the middle saddle while still on the chopper and aims at the Wiper; Bob still drives front, Leo stays rear.",
  ],
  "clip-004": [
    "S1 wide side/profile firing frame: Chloe fires from the middle seat while Bob front drives and Leo rear ducks on the connected Chopper reference vehicle.",
    "S2 medium on Wiper impact revealing cybernetics; motorcycle may be off-frame.",
    "S3 close-up on damaged Wiper calmly straightening; no motorcycle needed.",
    "S4 medium on Wiper speaking with sterile calm; no motorcycle needed.",
    "S5 close three-rider frame: Chloe middle reloads, Bob front keeps the chopper steady, Leo rear watches the wristband.",
  ],
  "clip-005": [
    "S1 close three-rider frame: Leo points from the rear seat past Chloe's middle-seat shoulder; Bob front keeps the handlebars; show the three visible seats from the connected Chopper reference vehicle.",
    "S2 side action frame: Leo launches from the rear seat toward a Wiper while Bob and Chloe remain on the connected Chopper reference vehicle.",
    "S3 insert: cast iron pan approaches the blue wristband; no motorcycle needed.",
    "S4 impact close-up: wristband shatters under pan blow; no motorcycle needed.",
    "S5 wide aftermath: disabled Wiper collapses while the connected Chopper reference vehicle idles nearby with the trio in the same seat order.",
  ],
  "clip-006": [
    "S1 full side/profile frame: the connected Chopper reference vehicle idles among smoking wreckage; Bob front, Chloe middle, Leo rear are seated in order.",
    "S2 medium three-rider frame: Chloe middle holds shotgun, Leo rear reaches for the encrypted terminal, Bob front watches the road.",
    "S3 insert terminal biometric unlock; no motorcycle needed.",
    "S4 close terminal display of Daniel Greene with Chloe/Bob/Leo gathered around, still seated or leaning from the chopper.",
    "S5 close group reaction around the terminal; preserve Bob-front Chloe-middle Leo-rear geography if the bike is visible.",
  ],
  "clip-007": [
    "S1 medium group frame on the connected Chopper reference vehicle: Bob front turns back from handlebars, Chloe middle listens, Leo rear holds terminal; keep the reference vehicle visually dominant without adding text-invented vehicle details.",
    "S2 close Bob and terminal photo of Daniel Greene; chopper details may be cropped but handlebars/front saddle stay consistent.",
    "S3 over-shoulder from Chloe middle toward Bob front as he quotes the manifesto; preserve seat order.",
    "S4 medium group frame: Bob front furious, Chloe middle grim, Leo rear analytical, all still on the same reference chopper.",
    "S5 wide parked profile: the connected Chopper reference vehicle sits in the highway night with Bob front, Chloe middle, Leo rear.",
  ],
  "clip-008": [
    "S1 medium group frame: Leo rear tilts the terminal toward Chloe middle and Bob front; all three remain seated on the connected Chopper reference vehicle, with the vehicle copied from the reference image rather than described from text.",
    "S2 insert terminal: mysterious pale yarn-like silhouette behind Daniel Greene; no clear cat reveal.",
    "S3 over-shoulder from Leo rear toward Chloe middle and Bob front; Chloe squints at the terminal, shotgun low.",
    "S4 close Leo rear with terminal; Chloe middle shoulder and Bob front edge maintain geography.",
    "S5 close group around terminal glow; if the vehicle is visible, use the connected Chopper reference vehicle without redesigning it.",
  ],
  "clip-009": [
    "S1 medium three-rider frame: Chloe middle shuts the terminal and holds shotgun, Bob front idles at handlebars, Leo rear watches the tower.",
    "S2 wide rear-side profile: the connected Chopper reference vehicle faces Black Spire with Bob front, Chloe middle, Leo rear in order.",
    "S3 telephoto Black Spire red laser net; no motorcycle needed.",
    "S4 over-shoulder from Leo rear showing terminal data aligned with Black Spire; Chloe middle and Bob front stay in position.",
    "S5 wide silhouette: the connected Chopper reference vehicle with three riders becomes a single dark shape against Black Spire.",
  ],
  "clip-010": [
    "S1 close three-rider frame: Chloe middle leans forward with shotgun, Bob front at handlebars, Leo rear behind her; Black Spire glows ahead.",
    "S2 side tracking profile: the connected Chopper reference vehicle accelerates with Bob front, Chloe middle, Leo rear.",
    "S3 telephoto close-up of Black Spire peak red slitted cat-pupil light; no motorcycle needed.",
    "S4 close Chloe middle staring back at the red light; Bob front and Leo rear stay as edge continuity.",
    "S5 wide rear-side shot: Bob drives front, Chloe middle, Leo rear toward Black Spire on the connected Chopper reference vehicle.",
  ],
};

function buildPrompt(clipId: string): string {
  const scene = sceneByClip[clipId] || "Wasteland Highway";
  return [
    `Create a 2x3 comic storyboard board for ${titleByClip[clipId]}, matching video shots S1-S5 in exact order.`,
    "Image type: one 16:9 storyboard sheet with five panels in a clean grid. Each panel is one still frame for one shot.",
    "Panel numbering is mandatory: small readable labels S1, S2, S3, S4, S5 in the upper-left corner. No other text, captions, speech bubbles, UI, watermark, or random labels.",
    "Project: 美式漫剧. Style: saturated 3D American animated dark-comedy storyboard/previsualization, cinematic but readable.",
    `Scene continuity lock: ${scene}, cold night continuity, same road direction and screen geography.`,
    "Primary prop authority: the connected Chopper reference image is the only vehicle visual authority. Copy that reference image for the vehicle; do not redesign, reinterpret, simplify, or add vehicle features from text.",
    "Seat/cast lock: use the three seats already visible in the Chopper reference. Bob sits in the front driver seat at the handlebars, Chloe sits in the middle seat with shotgun, Leo sits in the rear seat with terminal or cast iron pan. Do not create duplicate riders. Do not swap seats. Do not move Chloe ahead of Bob.",
    "Vehicle wording lock: if the vehicle is visible, refer to it only as the connected Chopper reference vehicle. Do not use text to describe its appearance; the image reference controls the appearance.",
    "Storyboard panels:",
    ...(panelText[clipId] || []),
    "Use connected character and scene references for identity and palette, but the Chopper reference overrides any generic motorcycle interpretation.",
    "Do not redesign characters, scene architecture, props, clothing, held items, or visible character states.",
  ].join("\n");
}

async function main() {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
  if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);
  const metadata = project.metadata as R;
  const episodes = isRecord(metadata.episodes) ? metadata.episodes as R : {};
  const episode = isRecord(episodes[episodeId]) ? episodes[episodeId] as R : null;
  if (!episode) throw new Error(`Episode not found: ${episodeId}`);
  const workflow = isRecord(episode.workflowCenter) ? episode.workflowCenter as R : {};
  const clips = Array.isArray(workflow.clips) ? workflow.clips.filter(isRecord) : [];
  const prompts = Object.fromEntries(Object.keys(titleByClip).map((clipId) => [clipId, buildPrompt(clipId)]));
  const nextClips = clips.map((clip) => {
    const clipId = s(clip.id);
    const prompt = prompts[clipId];
    return prompt ? { ...clip, storyboardPrompt: prompt, panelCount: 5, storyboardPanelCount: 5 } : clip;
  });

  const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes as R : {};
  const canvas = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] as R : null;
  if (!canvas) throw new Error(`Canvas scene not found: ${episodeId}`);
  const nodes = Array.isArray(canvas.nodes) ? canvas.nodes.filter(isRecord) : [];
  const edges = Array.isArray(canvas.edges) ? canvas.edges.filter(isRecord) : [];
  const boardIds = new Set<string>();
  const nextNodes = nodes.map((node) => {
    const data = isRecord(node.data) ? node.data as R : {};
    const clipId = s(data.clipId);
    const prompt = prompts[clipId];
    if (node.type === "generation" && data.positioningBoardFlow === true && prompt) {
      boardIds.add(s(node.id));
      if (targetClipIds.size && !targetClipIds.has(clipId)) {
        return {
          ...node,
          data: {
            ...data,
            prompt,
            finalPrompt: prompt,
            storyboardPrompt: prompt,
            manualFinalPrompt: true,
            positioningBoardMode: "storyboard",
            panelCount: 5,
            storyboardPanelCount: 5,
          },
        };
      }
      return {
        ...node,
        data: {
          ...resetOutput(data),
          prompt,
          finalPrompt: prompt,
          storyboardPrompt: prompt,
          manualFinalPrompt: true,
          positioningBoardMode: "storyboard",
          panelCount: 5,
          storyboardPanelCount: 5,
        },
      };
    }
    return node;
  });

  const chopperRefIds = new Set(nodes.filter((node) => {
    const data = isRecord(node.data) ? node.data as R : {};
    return s(data.assetKind) === "props" && /Chopper/i.test(s(data.assetName || data.label || data.title));
  }).map((node) => s(node.id)));
  const nextEdges = [...edges].sort((a, b) => {
    const at = boardIds.has(s(a.target)) && chopperRefIds.has(s(a.source)) ? 0 : 1;
    const bt = boardIds.has(s(b.target)) && chopperRefIds.has(s(b.source)) ? 0 : 1;
    return at - bt;
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
          [episodeId]: { ...canvas, nodes: nextNodes, edges: nextEdges, updatedAt: new Date().toISOString() },
        },
      },
    },
  });

  console.log(JSON.stringify({
    projectId,
    episodeId,
    prompts: Object.fromEntries(Object.entries(prompts).map(([clipId, prompt]) => [clipId, prompt.length])),
    boardsReset: boardIds.size,
    chopperRefs: chopperRefIds.size,
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
