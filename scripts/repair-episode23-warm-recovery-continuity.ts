import { prisma } from "../server/src/lib/prisma";
import { buildClipPositioningBoardPrompt } from "../server/src/lib/workflowPositioningBoards";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = "episode-023";

type JsonRecord = Record<string, any>;
type CanvasNode = { id: string; type?: string; parentId?: string; data?: JsonRecord; [key: string]: any };

const COLD_LOCK =
  "Canonical scene: Black Spire B7 Core Server Room, cold lockdown state after the flash-freeze system activates. Preserve the same rack layout, main console/keyboard, highest server rack, blast-door access, red/blue alarms, golden cables, and cat-admin props, filled with blue-white cold fog, rim frost on metal, visible freezing air, and emergency lockdown lighting.";

const TRANSITION_LOCK =
  "Canonical scene: Black Spire B7 Core Server Room, transition from cold lockdown to restored heat. Preserve the same server rack layout, main console/keyboard, biometric scanner, blast-door access, golden cables, red/blue alarm accents, and cat-admin props. The clip must visibly progress from blue-white frost fog and rim ice to warm amber central-heating glow; vents stop blasting cold air, frost begins melting, and the room remains the same B7 server room.";

const WARM_LOCK =
  "Canonical scene: Black Spire B7 Core Server Room, restored warm/dry state after Produce Cold Storage Mode is deactivated. Preserve the same black server racks, main console/keyboard, biometric scanner, blast-door access, golden fiber-optic cables, red alarm accents, blue system monitors, and cat-admin props. Warm central heating has returned; only small melting frost residue may remain on edges. Use warm amber server light, not a freezer-room look.";

const NORMAL_SCENE_IMAGE_URL =
  "https://loohii.com/api/uploads/public/cmq8cvumo0000l00tqtcjsi0i/generated/cmq8dw07r0003l00tewomnzwd/asset-cmqul2m7u0009qx0pwpsd3sax.png";

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return String(value || "").trim();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function clipNo(id: unknown): number {
  return Number(text(id).match(/clip-(\d+)/)?.[1] || 0);
}

function shotNo(id: unknown): number {
  return Number(text(id).match(/shot-(\d+)/)?.[1] || 0);
}

function normalizeDialogue(value: string): string {
  const raw = text(value);
  if (!raw) return "";
  if (/^[^:：]{1,40}:\s*“/.test(raw)) return raw;
  const match = raw.match(/^([^:：]{1,40})[:：]\s*(.+)$/);
  if (!match) return raw;
  return `${match[1].trim()}: “${match[2].trim().replace(/^["“]|["”]$/g, "")}”`;
}

function withWarmSceneText(value: unknown): string {
  return text(value)
    .replace(/\bcold server room air\b/gi, "warm restored server room air with faint melting frost residue")
    .replace(/\bcold air\b/gi, "warm restored air")
    .replace(/\bcold blue lighting\b/gi, "warm amber server lighting mixed with blue monitor glow")
    .replace(/\bcold mist\b/gi, "fading mist and melting frost residue")
    .replace(/\bfrost on screen\b/gi, "melting frost residue on screen edges")
    .replace(/\bfrost on equipment\b/gi, "melting frost residue on equipment edges")
    .replace(/\bfrostbitten face\b/gi, "recently thawed face")
    .replace(/\bfrosty environment\b/gi, "recently warmed server room with melting frost residue")
    .replace(/\bfrozen console\b/gi, "thawed main console")
    .replace(/\bfreezing air\b/gi, "restored warm air")
    .replace(/\bbreath clouds\b/gi, "fading breath vapor")
    .replace(/\bblue-white cold fog\b/gi, "faint residual vapor thinning under warm vents")
    .trim();
}

function compactPrompt(value: string): string {
  return text(value)
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

const conciseStates: Record<string, { start: string; end: string }> = {
  "clip-009": {
    start: "Starts in restored-warm B7 Core Server Room: Chloe lies on the floor recovering, warm vents are on, Tangelo kneads inside the pizza box on the scanner, Leo reaches toward the box.",
    end: "Ends with Tangelo growling and hooking its claws through the pizza box into the keyboard.",
  },
  "clip-010": {
    start: "Starts in restored-warm B7 Core Server Room: Leo pulls back from the cat-in-box, Tangelo's claws are hooked under keyboard keys, Chloe and Bob watch the countdown.",
    end: "Ends with Bob jumping and pointing at the countdown.",
  },
  "clip-011": {
    start: "Starts in restored-warm B7 Core Server Room: Bob panics beside the countdown while Tangelo keeps making biscuits in the pizza box.",
    end: "Ends with the trio staggered by a massive impact from the B7 blast doors.",
  },
  "clip-012": {
    start: "Starts in restored-warm B7 Core Server Room: Leo reads the secondary monitor as the B7 blast doors begin taking heavy impacts.",
    end: "Ends at the B7 blast doors with fungus-covered hands squeezing through the buckling gap.",
  },
  "clip-013": {
    start: "Starts in restored-warm B7 Core Server Room: Chloe stands and pumps the shotgun while Leo grips his cast-iron pan.",
    end: "Ends with Bob igniting the flamethrower pilot light, orange glow on his recently thawed face.",
  },
  "clip-014": {
    start: "Starts in restored-warm B7 Core Server Room: Chloe, Leo, and Bob form a defensive line between the console and buckling blast doors.",
    end: "Ends with the blast doors ripped open a few inches and fungus-covered hands pushing through.",
  },
};

function buildPrompt(clip: JsonRecord, shots: JsonRecord[], sceneLock: string): string {
  const duration = Number(clip.estimatedDuration || clip.targetDuration || 12);
  const lines: string[] = [
    `Clip video prompt for ${clip.title}.`,
    `Duration target: ${Math.max(4, Math.min(15, duration))}s, 16:9 cinematic 3D animated dark comedy style.`,
    `Characters: ${(clip.characters || []).join(", ")}. Use connected character references; do not redesign.`,
    `Setting: ${clip.setting}.`,
    `Scene visual continuity lock: ${sceneLock}`,
    `Initial state: ${text(clip.startState).replace(/\s+/g, " ")}`,
    "Global shot rules: keep one continuous B7 server-room geography, readable screen direction, visible-subject framing, and clear foreground/midground/background depth.",
    "Each S beat should contain only concrete shot design, specific blocking, visible action, exact dialogue when present, and useful acting notes.",
    text(clip.plotGoal),
    "",
    "Shot beats, follow in exact order:",
  ];
  shots.forEach((shot, index) => {
    const parts = [
      `S${index + 1}: Shot: ${text(shot.shotSize || "medium")}; ${text(shot.cameraAngle || "eye-level")}; ${text(shot.cameraMove || "static hold")}; ${text(shot.lens || "50mm")};`,
      normalizeDialogue(text(shot.dialogue)) ? `Exact dialogue: ${normalizeDialogue(text(shot.dialogue))};` : "",
      text(shot.action || shot.description || shot.visualPrompt),
    ].filter(Boolean);
    lines.push(parts.join(" "));
  });
  lines.push("");
  lines.push("Do not skip, merge, or reorder the shot beats. Do not add subtitles, speech bubbles, UI, panel borders, panel numbers, watermarks, or explanatory text.");
  return compactPrompt(lines.join("\n"));
}

function updateShotForRecovery(shot: JsonRecord): JsonRecord {
  const id = text(shot.id);
  const n = shotNo(id);
  let next = { ...shot };
  if (n >= 54 && n <= 58) {
    next.sceneVisualLock = TRANSITION_LOCK;
    next.canonicalSceneId = "scene-b7-core-server-room-cold-to-warm-transition";
    next.canonicalSceneName = "B7 Core Server Room - Cold to Warm Transition";
  } else if (n === 59) {
    next = {
      ...next,
      title: "Biometric validation restores heat",
      action: "Scanner validates Tangelo paw pressure through the pizza box; cold mode deactivates",
      description:
        "A crisp BEEP confirms Tangelo's paw pads pressing through the cardboard onto the biometric scanner. The console accepts the emergency override; ceiling vents stop blasting cold air and warm central heating rolls through the same room.",
      visualPrompt:
        "Main console close-up: Tangelo kneads inside the pizza box directly over the biometric scanner, paws pressing through cardboard; scanner glow changes from icy blue to warm amber, cold fog cuts off, vents switch to warm air, Chloe and Bob react in relief.",
      references: "Tangelo, Pizza Box, Biometric Scanner, Main Console Keyboard, Digital Thermometer",
      characters: ["Tangelo", "Leo", "Chloe", "Bob"],
      sceneVisualLock: TRANSITION_LOCK,
      canonicalSceneId: "scene-b7-core-server-room-cold-to-warm-transition",
      canonicalSceneName: "B7 Core Server Room - Cold to Warm Transition",
    };
  } else if (n >= 60) {
    next.sceneVisualLock = WARM_LOCK;
    next.canonicalSceneId = "scene-b7-core-server-room-restored-warm";
    next.canonicalSceneName = "B7 Core Server Room - Restored Warm";
    next.description = withWarmSceneText(next.description);
    next.visualPrompt = withWarmSceneText(next.visualPrompt);
    next.action = withWarmSceneText(next.action);
    next.references = withWarmSceneText(next.references);
  }
  if (n === 58) {
    next.description =
      "Tangelo launches into the pizza box on top of the biometric scanner and begins kneading; its paw pads press downward through the cardboard toward the scanner glass.";
    next.visualPrompt =
      "Action shot: Tangelo arcs into the pizza box sitting directly on the biometric scanner; paws sink into cardboard over the glass, cold fog still present, scanner beginning to glow under the box.";
    next.references = "Tangelo, Pizza Box, Biometric Scanner";
  }
  if (n === 60) {
    next.description =
      "With cold mode deactivated, Chloe collapses onto the floor, gasping as warm air returns to her peach flesh; the room is now warm with only melting frost residue.";
    next.visualPrompt =
      "Low angle: Chloe lying on the server room floor, arms spread, steam and fading vapor rising from her clothes, warm amber light on her face, Tangelo kneading in the pizza box on the scanner behind her.";
  }
  if (next.dialogue) {
    next.dialogue = normalizeDialogue(next.dialogue);
    next.subtitle = next.dialogue;
  }
  return next;
}

function referenceNodesForGeneration(nodes: CanvasNode[], generationNode: CanvasNode): CanvasNode[] {
  return nodes.filter((node) => node.type === "imageInput" && node.parentId === generationNode.parentId && node.data?.positioningBoardFlow === true);
}

function referenceLabels(refs: CanvasNode[]): string[] {
  return refs.map((ref) => text(ref.data?.assetName || ref.data?.label || ref.data?.name)).filter(Boolean);
}

function visibleCharacterNames(refs: CanvasNode[]): string[] {
  return refs
    .filter((ref) => text(ref.data?.assetKind) === "characters")
    .map((ref) => text(ref.data?.assetName || ref.data?.label || ref.data?.name))
    .filter(Boolean);
}

function sceneLockName(refs: CanvasNode[]): string {
  const sceneRef = refs.find((ref) => text(ref.data?.assetKind) === "scenes");
  return text(sceneRef?.data?.assetName || sceneRef?.data?.label || sceneRef?.data?.name) || "B7 Core Server Room";
}

function clipShots(clip: JsonRecord, shots: JsonRecord[]): JsonRecord[] {
  const ids = new Set(Array.isArray(clip.shotIds) ? clip.shotIds.map(String) : []);
  return ids.size ? shots.filter((shot) => ids.has(text(shot.id))) : shots.filter((shot) => text(shot.clipId) === text(clip.id));
}

const project = await prisma.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);

const metadata = clone(project.metadata) as JsonRecord;
const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
const episode = isRecord(episodes[episodeId]) ? episodes[episodeId] : {};
const workflow = isRecord(episode.workflowCenter) ? episode.workflowCenter : {};
const clips = Array.isArray(workflow.clips) ? workflow.clips.filter(isRecord) : [];
const breakdownScenes = Array.isArray(workflow.breakdownScenes) ? workflow.breakdownScenes.filter(isRecord) : [];
const assets = isRecord(workflow.assets) ? workflow.assets : {};
const sceneAssets = Array.isArray(assets.scenes) ? assets.scenes.filter(isRecord) : [];
const now = new Date().toISOString();

metadata.workflowRepairBackups = {
  ...(isRecord(metadata.workflowRepairBackups) ? metadata.workflowRepairBackups : {}),
  [`${episodeId}-warm-recovery-${now}`]: {
    clips: clips.filter((clip) => clipNo(clip.id) >= 8),
    breakdownScenes: breakdownScenes.filter((shot) => shotNo(shot.id) >= 54),
    canvasNodes: (metadata.canvasScenes?.[episodeId]?.nodes || []).filter((node: CanvasNode) =>
      /clip-(00[8-9]|01[0-4])/.test(JSON.stringify(node).slice(0, 4000)),
    ),
  },
};

const normalScenePatch = {
  referenceImageUrl: NORMAL_SCENE_IMAGE_URL,
  generatedImageUrl: NORMAL_SCENE_IMAGE_URL,
  referenceImageAssetId: "",
  generatedImageAssetId: "",
  canonicalSceneId: "scene-b7-core-server-room-restored-warm",
  canonicalSceneName: "B7 Core Server Room - Restored Warm",
  timeOfDay: "Interior restored warm",
  colorPalette: "black racks, warm amber server glow, golden cables, red alarm accents, blue system monitors, small melting frost residue",
  description:
    "Black Spire B7 core server room after cold storage is deactivated: same racks, main console, scanner, blast doors, golden cables, red/blue alarms, warm central heating and small melting frost residue only.",
  sceneVisualLock: WARM_LOCK,
  referencePolicy:
    "Use the existing B7 Core Server Room normal reference as spatial authority for the restored warm state. Do not use the cold-lockdown reference for clips after the scanner override.",
};

const nextSceneAssets = sceneAssets.map((scene) => {
  if (!["Main Console Station", "B7 Blast Doors", "B7 Freight Elevator Approach"].includes(text(scene.name))) return scene;
  return { ...scene, ...normalScenePatch };
});

const nextBreakdownScenes = breakdownScenes.map((shot) => {
  const n = shotNo(shot.id);
  if (n < 54) return shot;
  return updateShotForRecovery(shot);
});

const shotsById = new Map(nextBreakdownScenes.map((shot) => [text(shot.id), shot]));
const nextClips = clips.map((clip) => {
  const no = clipNo(clip.id);
  if (no < 8) return clip;
  const next = { ...clip };
  if (no === 8) {
    next.title = "Clip 08 · Pizza Box Scanner Override";
    next.setting = "Omega Server Farm - Main Console Station";
    next.plotGoal =
      "Leo places the pizza box over the biometric scanner, Tangelo jumps into the box, its paw pads trigger the scanner through the cardboard, and the system deactivates cold storage before Chloe collapses in relief.";
    next.startState = "Starts with in cold B7 Core Server Room Leo unfolding the empty pizza box beside the biometric scanner while Chloe and Bob shiver nearby.";
    next.endState = "Ends with in restored-warm B7 Core Server Room Chloe collapsed on the floor breathing hard as Tangelo kneads in the pizza box on the scanner.";
  } else {
    next.setting = text(next.setting).replace("Omega Server Farm", "B7 Core Server Room");
    next.startState = conciseStates[text(next.id)]?.start || withWarmSceneText(next.startState);
    next.endState = conciseStates[text(next.id)]?.end || withWarmSceneText(next.endState);
    next.plotGoal = withWarmSceneText(next.plotGoal);
    next.layoutMemory = `${next.startState} ${next.endState}`;
  }
  const shots = (Array.isArray(next.shotIds) ? next.shotIds.map((id) => shotsById.get(String(id))).filter(Boolean) : []) as JsonRecord[];
  const sceneLock = no === 8 ? TRANSITION_LOCK : WARM_LOCK;
  next.seedancePrompt = buildPrompt(next, shots, sceneLock);
  next.videoPrompt = next.seedancePrompt;
  next.prompt = next.seedancePrompt;
  return next;
});

const nextWorkflow = {
  ...workflow,
  assets: { ...assets, scenes: nextSceneAssets },
  breakdownScenes: nextBreakdownScenes,
  clips: nextClips,
  updatedAt: now,
};

episodes[episodeId] = { ...episode, workflowCenter: nextWorkflow, updatedAt: now };
metadata.episodes = episodes;
if (text(metadata.activeEpisodeId) === episodeId || text(metadata.currentEpisodeId) === episodeId || text(metadata.selectedEpisodeId) === episodeId) {
  metadata.workflowCenter = nextWorkflow;
}

const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
const canvasScene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : {};
const nodes = Array.isArray(canvasScene.nodes) ? (canvasScene.nodes.filter(isRecord) as CanvasNode[]) : [];
const clipsById = new Map(nextClips.map((clip) => [text(clip.id), clip]));

let canvasChanges = 0;
let resetStoryboards = 0;
const nextNodes = nodes.map((node) => {
  const data = isRecord(node.data) ? { ...node.data } : {};
  const clipId = text(data.clipId) || text(node.id.match(/clip-(\d+)/)?.[0]);
  const no = clipNo(clipId);
  let nextData = data;

  if (no >= 8) {
    const clip = clipsById.get(clipId);
    if (clip) {
      if (node.type === "video") {
        nextData = {
          ...nextData,
          title: `${clip.title} 视频任务`,
          prompt: clip.seedancePrompt,
          finalPrompt: clip.seedancePrompt,
          sourcePrompt: clip.seedancePrompt,
          submittedPrompt: "",
          status: "waiting",
          error: "",
        };
      }
      if (node.type === "generation" && data.positioningBoardFlow === true) {
        const refs = referenceNodesForGeneration(nodes, node);
        const shots = clipShots(clip, nextBreakdownScenes);
        const sceneVisualLock = no === 8 ? TRANSITION_LOCK : WARM_LOCK;
        const positioningPrompt = buildClipPositioningBoardPrompt({
          projectName: "美式漫剧",
          clip,
          shots,
          referenceLabels: referenceLabels(refs),
          visibleCharacterNames: visibleCharacterNames(refs),
          sceneLockName: sceneLockName(refs),
          sceneVisualLock,
          mode: "positioning",
        });
        const storyboardPrompt = buildClipPositioningBoardPrompt({
          projectName: "美式漫剧",
          clip,
          shots,
          referenceLabels: referenceLabels(refs),
          visibleCharacterNames: visibleCharacterNames(refs),
          sceneLockName: sceneLockName(refs),
          sceneVisualLock,
          mode: "storyboard",
        });
        nextData = {
          ...nextData,
          title: `${clip.title} 故事板`,
          prompt: storyboardPrompt,
          finalPrompt: storyboardPrompt,
          storyboardPrompt,
          positioningPrompt,
          positioningBoardMode: "storyboard",
          manualFinalPrompt: true,
          status: "waiting",
          error: "",
          outputImage: "",
          outputImageAssetId: "",
          outputImages: [],
          revisedPrompt: "",
          submittedPrompt: "",
          generationId: "",
          generationRequestId: "",
          generationStartedAt: "",
          generationStoppedAt: "",
        };
        resetStoryboards += 1;
      }
      if (data.assetKind === "scenes" && no >= 9) {
        nextData = {
          ...nextData,
          assetName: "B7 Core Server Room - Restored Warm",
          label: "场景 · B7 Core Server Room - Restored Warm",
          name: "B7 Core Server Room - Restored Warm",
          imageUrl: NORMAL_SCENE_IMAGE_URL,
          url: NORMAL_SCENE_IMAGE_URL,
          uploadStatus: "linked",
          imageLoadError: false,
          sourcePrompt: `场景参考: B7 Core Server Room restored warm state for ${clip.title}; ${WARM_LOCK}`,
        };
      }
      if (data.assetKind === "scenes" && no === 8) {
        nextData = {
          ...nextData,
          sourcePrompt: `场景参考: B7 Core Server Room cold-to-warm scanner override transition for ${clip.title}; ${TRANSITION_LOCK}`,
        };
      }
    }
  }

  if (JSON.stringify(nextData) !== JSON.stringify(data)) {
    canvasChanges += 1;
    return { ...node, data: nextData };
  }
  return node;
});

canvasScenes[episodeId] = { ...canvasScene, nodes: nextNodes, updatedAt: now };
metadata.canvasScenes = canvasScenes;
metadata.updatedAt = now;

await prisma.project.update({ where: { id: projectId }, data: { metadata } });

console.log(
  JSON.stringify(
    {
      projectId,
      episodeId,
      changedClips: nextClips.filter((clip) => clipNo(clip.id) >= 8).map((clip) => ({
        id: clip.id,
        title: clip.title,
        setting: clip.setting,
        promptLength: text(clip.seedancePrompt).length,
      })),
      changedShots: nextBreakdownScenes.filter((shot) => shotNo(shot.id) >= 54).map((shot) => ({
        id: shot.id,
        title: shot.title,
        canonicalSceneName: shot.canonicalSceneName,
      })),
      canvasChanges,
      resetStoryboards,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
