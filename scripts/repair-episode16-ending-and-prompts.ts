import { prisma } from "../server/src/lib/prisma";
import { workflowsTestInternals } from "../server/src/routes/workflows";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = "episode-016";
const clipId = "clip-009";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function syncVideoNodePrompt(node: Record<string, unknown>, prompt: string) {
  const data = isRecord(node.data) ? node.data : {};
  let changed = 0;
  for (const field of ["prompt", "videoPrompt", "seedancePrompt"]) {
    if (typeof data[field] === "string" && data[field] !== prompt) {
      data[field] = prompt;
      changed += 1;
    }
  }
  return changed;
}

function compactCanvasVideoPrompts(scene: Record<string, unknown>) {
  const nodes = Array.isArray(scene.nodes) ? scene.nodes as Record<string, unknown>[] : [];
  const report: Array<{ nodeId: string; field: string; before: number; after: number }> = [];
  for (const node of nodes) {
    const data = isRecord(node.data) ? node.data : {};
    const isVideoNode = node.type === "video" || data.workflowKind === "video" || String(node.id || "").includes("video-node");
    if (!isVideoNode) continue;
    const source = typeof data.seedancePrompt === "string"
      ? data.seedancePrompt
      : typeof data.videoPrompt === "string"
        ? data.videoPrompt
        : typeof data.prompt === "string"
          ? data.prompt
          : "";
    if (!source) continue;
    const compact = workflowsTestInternals.finalizeWorkflowVideoPrompt(source);
    for (const field of ["prompt", "videoPrompt", "seedancePrompt"]) {
      if (typeof data[field] === "string" && data[field] !== compact) {
        report.push({ nodeId: String(node.id || ""), field, before: data[field].length, after: compact.length });
        data[field] = compact;
      }
    }
  }
  return report;
}

function updateTranslationSource(scene: Record<string, unknown>, sourceNodeId: string, prompt: string) {
  const nodes = Array.isArray(scene.nodes) ? scene.nodes as Record<string, unknown>[] : [];
  const report: Array<{ nodeId: string; field: string; before: number; after: number }> = [];
  for (const node of nodes) {
    const data = isRecord(node.data) ? node.data : {};
    if (node.type !== "translation" || data.sourceNodeId !== sourceNodeId) continue;
    if (typeof data.sourcePrompt === "string" && data.sourcePrompt !== prompt) {
      report.push({ nodeId: String(node.id || ""), field: "sourcePrompt", before: data.sourcePrompt.length, after: prompt.length });
      data.sourcePrompt = prompt;
      if (typeof data.translatedPrompt === "string") {
        data.translatedPrompt = "";
        data.status = "idle";
      }
    }
  }
  return report;
}

function clearTranslationResult(data: Record<string, unknown>) {
  if (typeof data.translatedPrompt === "string") data.translatedPrompt = "";
  data.status = "idle";
  data.error = "";
}

function episode16EndingStoryboardPrompt() {
  return [
    "Create a 3x3 comic storyboard board for Clip 09 · Black Spire Cat-Eye Ending, matching the video prompt shots S1-S7 in exact order.",
    "Image type: one 16:9 storyboard sheet with clean grid panels. Each panel is a still frame for one shot, not a single positioning still and not a video.",
    "Panel labels: draw only small upper-left labels S1, S2, S3, S4, S5, S6, S7. No other text, captions, subtitles, speech bubbles, UI, watermark, or random labels.",
    "Style: saturated 3D American animated dark-comedy storyboard/previsualization, cinematic night lighting, readable silhouettes.",
    "Scene continuity lock: Wasteland Highway at night. Keep the same endless cracked highway, cold blue-black sky, infected-produce horde path, distant Black Spire position, and chopper travel direction across panels.",
    "References to preserve: Chloe, Bob, Leo, Zombie/Pumpkin Zombie horde, Wasteland Highway, Spike-Covered Chopper, Pulsing Red Spire Light.",
    "Panel plan:",
    "S1: Wide low tracking view. Bob drives the spike-covered three-seat chopper onto the endless night highway; headlights cut across cracked asphalt and dead root veins.",
    "S2: Wide side tracking view. The chopper rides beside a thickening infected-produce horde marching in eerie unison toward the distant Black Spire.",
    "S3: Close-up of Chloe. She stares past the road at the towering black monolith, realizing the ultimate villain is pulling the world like a puppet master.",
    "S4: Close-up over Chloe's shoulder. Chloe mutters with cold fury, fists tightening against the chopper frame: “The whole human race is just its personal plaything now.”",
    "S5: Medium close-up. Chloe continues: “We need to stop it before it completely breaks this world for fun.” Bob and Leo glance toward her, tense and silent.",
    "S6: Extreme wide high angle. Down the endless highway, the zombie horde grows denser, pouring toward the Black Spire under the night sky.",
    "S7: Telephoto close-up on the Black Spire peak. A single red light pulses eerily, blinking like the slitted pupil of a cat.",
    "Keep character identities consistent and keep the chopper, horde, highway, and Black Spire spatial relationship continuous.",
  ].join("\n");
}

function episode16EndingPositioningPrompt() {
  return [
    "Create ONE static 16:9 keyframe positioning-board image for Clip 09 · Black Spire Cat-Eye Ending.",
    "Image type: a single still frame used as a spatial layout reference, not a storyboard and not a video prompt.",
    "Style: saturated 3D American animated dark-comedy previsualization, cinematic night lighting, clear readable blocking.",
    "Scene: Wasteland Highway at night. Use the connected Wasteland Highway reference as the spatial authority.",
    "Visible layout: Bob drives the spike-covered three-seat chopper along the lower foreground/midground. Chloe rides tense and forward-facing with clenched fists. Leo rides behind with his cast iron pan. An infected-produce horde thickens along the highway beside and behind them.",
    "Background authority: the towering Black Spire stands far ahead on the horizon. At its peak, a single red light pulses like a slitted cat pupil.",
    "Purpose: lock the geography for the final ending sequence: chopper direction, horde flow, highway depth, Black Spire position, and Chloe's determined state.",
    "No captions, subtitles, panel labels, speech bubbles, UI, watermark, random text, gore, or identity drift.",
  ].join("\n");
}

function directorBoardPrompt(scene: {
  title: string;
  setting: string;
  characters: string[];
  action: string;
  dialogue?: string;
  camera: string;
  visualPrompt: string;
}) {
  return [
    "Create a vertical 9-panel director storyboard for this shot.",
    `Shot title: ${scene.title}`,
    `Setting: ${scene.setting}`,
    `Characters: ${scene.characters.length ? scene.characters.join(", ") : "none visible / environment only"}`,
    `Action: ${scene.action}`,
    scene.dialogue ? `Dialogue to preserve exactly: ${scene.dialogue}` : "Dialogue: none.",
    `Camera: ${scene.camera}`,
    "Composition: keep Wasteland Highway geography readable; preserve the chopper direction, horde flow, and Black Spire horizon position.",
    `Visual prompt: ${scene.visualPrompt}`,
    "No subtitles, speech bubbles, UI, watermark, random text, or identity drift.",
  ].join("\n");
}

function nightHighwayPrompt() {
  return [
    "Style: 3D American cartoon dark comedy, cinematic night lighting, consistent scene design.",
    "Asset kind: scenes",
    "Asset name: Wasteland Highway",
    "Time of day / lighting context: night exterior",
    "Create a clean empty environment reference image: an endless ruined wasteland highway at night, cracked asphalt, dead roadside gravel, blackened root veins crossing the road, dry dust, cold moon-blue shadows, faint sickly green haze from a distant infected-produce horde.",
    "In the far distance, show the towering Black Spire as a pitch-black monolith on the horizon, with a single red light at its peak pulsing like a slitted cat pupil.",
    "No warm sunset, no daylight, no golden sky. Keep the palette cold: moonlit gray asphalt, blue-black sky, rusted metal, red spire signal, subtle green zombie glow.",
    "Environment plate only: no characters, no people, no creatures, no visible actors, no captions, no UI, no watermark, no labels.",
  ].join("\n");
}

async function main() {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
  if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);

  const metadata = project.metadata as Record<string, unknown>;
  const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
  const episode = isRecord(episodes[episodeId]) ? episodes[episodeId] : undefined;
  if (!episode) throw new Error(`Missing ${episodeId}`);
  const workflowCenter = isRecord(episode.workflowCenter) ? episode.workflowCenter : undefined;
  const clips = Array.isArray(workflowCenter?.clips) ? workflowCenter.clips as Record<string, unknown>[] : [];
  const clip = clips.find((item) => item.id === clipId);
  if (!clip) throw new Error(`Missing ${episodeId}/${clipId}`);

  const prompt = workflowsTestInternals.finalizeWorkflowVideoPrompt([
    "Generate one continuous 15s cinematic video, 9:16.",
    "Style: 3D American cartoon dark comedy, fast-paced exaggerated reactions, cinematic night lighting.",
    "Scene: Wasteland Highway at night, with the distant Black Spire on the horizon.",
    "Characters: Chloe, Bob, Leo. Use connected character reference images; do not redesign.",
    "Initial state: Bob drives the spike-covered chopper down the dark highway. Chloe rides tense and watchful, fists clenched; Leo rides behind with his cast iron pan. A thickening infected-produce horde marches along the road.",
    "Story goal: The trio leaves the livestream arena behind, sees the Black Spire controlling the world, and Chloe commits to stopping it before the world breaks completely.",
    "Shot beats, follow in this exact order:",
    "S1: Shot: wide tracking; low angle; handheld; 35mm. The spike-covered chopper roars onto the endless night highway, headlights cutting across cracked asphalt and dead root veins.",
    "S2: Shot: wide side tracking; eye-level; 35mm. The chopper rides beside a growing horde of infected produce marching in eerie unison toward the distant Black Spire.",
    "S3: Shot: close-up; eye-level; static hold; 85mm. Chloe stares past the road at the towering black monolith, realizing the ultimate villain is pulling the whole world like a puppet master.",
    "S4: Exact dialogue: Chloe: “The whole human race is just its personal plaything now.”; Shot: close-up; over-shoulder; slow push-in; 85mm. Chloe mutters the line with cold fury, fists tightening against the chopper frame.",
    "S5: Exact dialogue: Chloe: “We need to stop it before it completely breaks this world for fun.”; Shot: medium close-up; eye-level; handheld; 50mm. Bob and Leo glance toward her, tense and silent, while the horde thickens beside them.",
    "S6: Shot: extreme wide; high angle; slow push-in; 24mm. Down the endless highway, the zombie horde grows denser, pouring toward the Black Spire under the night sky.",
    "S7: Shot: close-up telephoto; low angle; static hold; 85mm. At the peak of the Black Spire, a single red light pulses eerily, blinking like the slitted pupil of a cat.",
    "Direction: keep chopper direction, horde movement, road geography, Black Spire position, and Chloe's clenched-fist state continuous. No subtitles, UI, watermarks, random text, gore, or identity drift.",
  ].join("\n"));

  clip.title = "Clip 09 · Black Spire Cat-Eye Ending";
  clip.setting = "Wasteland Highway";
  clip.characters = ["Chloe", "Bob", "Leo", "Zombie"];
  clip.targetDuration = 15;
  clip.estimatedDuration = 15;
  clip.startState = "Starts with in Wasteland Highway Bob driving the spike-covered chopper onto the dark highway beside the marching infected-produce horde.";
  clip.endState = "Ends with in Wasteland Highway the Black Spire's single red peak light pulsing like the slitted pupil of a cat.";
  clip.plotGoal = "Chloe sees the Black Spire as the world's puppet master, says the human race is its personal plaything, and vows to stop it before it breaks the world for fun.";
  clip.seedancePrompt = prompt;
  clip.layoutMemory = [
    "Location: Wasteland Highway at night",
    "Characters: Chloe, Bob, Leo, infected-produce horde",
    "Start: Bob drives the spike-covered chopper onto the dark endless highway beside the thickening infected-produce horde.",
    "End: The Black Spire's single red peak light pulses like the slitted pupil of a cat.",
    "Continuity references: Wasteland Highway night palette; Spike-Covered Chopper; Black Spire on the horizon; Chloe clenched fists; Leo cast iron pan.",
    "Keep chopper direction, horde movement, road geography, Black Spire position, and important props continuous into the next episode.",
  ].join("\n");

  const scenes = Array.isArray(workflowCenter?.breakdownScenes) ? workflowCenter.breakdownScenes as Record<string, unknown>[] : [];
  const updates: Record<string, Partial<Record<string, unknown>>> = {
    "shot-050": {
      title: "Chloe sees the Black Spire",
      setting: "Wasteland Highway",
      subtitle: "",
      dialogue: "",
      action: "Staring at the towering black monolith in the distance while riding.",
      description: "Chloe stares at the towering black monolith in the distance and realizes the ultimate villain is sitting there, pulling the entire world like a twisted puppet master.",
      visualPrompt: "Close-up of Chloe on the moving chopper at night, eyes locked on the distant Black Spire, cold realization crossing her face.",
      characters: ["Chloe"],
      camera: "close-up, eye-level, static hold, 85mm, f/2.8, 1/48, ISO 800",
    },
    "shot-051": {
      title: "Chloe names the puppet master",
      subtitle: "Chloe: “The whole human race is just its personal plaything now.”",
      dialogue: "Chloe: “The whole human race is just its personal plaything now.”",
      action: "Muttering with clenched fists while riding.",
      description: "Chloe stares at the towering black monolith in the distance and understands the ultimate villain is pulling the world's strings like a twisted puppet master.",
      visualPrompt: "Close-up of Chloe riding the chopper at night, fists clenched, eyes fixed on the distant Black Spire, infected horde beside the road.",
      characters: ["Chloe"],
      camera: "close-up, over-shoulder, slow push-in, 85mm, f/2.8, 1/48, ISO 800",
    },
    "shot-052": {
      title: "Bob and Leo absorb Chloe's realization",
      setting: "Wasteland Highway",
      subtitle: "",
      dialogue: "",
      action: "Bob and Leo glance toward Chloe while the chopper keeps pace with the horde.",
      description: "Bob and Leo silently react to Chloe's grim realization as the night highway and infected-produce horde continue moving toward the Black Spire.",
      visualPrompt: "Medium close-up on Bob driving and Leo behind him, both tense after Chloe's line, cold night highway rushing past, Black Spire ahead.",
      characters: ["Bob", "Leo", "Chloe"],
      camera: "medium close-up, eye-level, handheld, 50mm, f/2.8, 1/48, ISO 800",
    },
    "shot-053": {
      title: "Chloe vows to stop it",
      subtitle: "Chloe: “We need to stop it before it completely breaks this world for fun.”",
      dialogue: "Chloe: “We need to stop it before it completely breaks this world for fun.”",
      action: "Clenching fists, speaking with cold determination.",
      description: "Chloe commits to stopping the Black Spire before it breaks the world for fun.",
      visualPrompt: "Medium close-up Chloe on moving chopper, cold determined expression, Bob and Leo tense nearby, Black Spire ahead.",
      characters: ["Chloe", "Bob", "Leo"],
      camera: "medium close-up, eye-level, handheld, 50mm, f/2.8, 1/48, ISO 800",
    },
    "shot-054": {
      title: "Horde thickens toward Black Spire",
      setting: "Wasteland Highway",
      subtitle: "",
      dialogue: "",
      action: "Horde grows thicker; Black Spire red light pulses.",
      description: "Down the endless highway, the zombie horde grows thicker and thicker. At the peak of the Black Spire, a single red light pulses in the night sky like a slitted cat pupil.",
      visualPrompt: "Wide aerial night shot, endless highway packed with marching infected produce, Black Spire in the distance, red peak light pulsing like a cat pupil.",
      characters: [],
      camera: "extreme wide, high angle, slow push-in, 24mm, f/4, 1/48, ISO 1000",
    },
    "shot-055": {
      title: "Cat-eye red light ending",
      setting: "Wasteland Highway",
      subtitle: "",
      dialogue: "",
      action: "Red light blinks like a cat pupil.",
      description: "Final ominous view of the Black Spire peak: the red light blinks like the slitted pupil of a cat.",
      visualPrompt: "Telephoto close-up of Black Spire peak, single red light pulsing like a slitted cat pupil against cold night sky.",
      characters: [],
      camera: "close-up telephoto, low angle, static hold, 85mm, f/2.8, 1/48, ISO 1000",
    },
  };
  for (const scene of scenes) {
    const patch = updates[String(scene.id || "")];
    if (patch) {
      Object.assign(scene, patch);
      scene.directorBoardPrompt = directorBoardPrompt({
        title: String(scene.title || ""),
        setting: String(scene.setting || "Wasteland Highway"),
        characters: Array.isArray(scene.characters) ? scene.characters.map(String) : [],
        action: String(scene.action || ""),
        dialogue: typeof scene.dialogue === "string" && scene.dialogue.trim() ? scene.dialogue : undefined,
        camera: String(scene.camera || "eye-level, static hold"),
        visualPrompt: String(scene.visualPrompt || scene.description || ""),
      });
    }
  }

  const topWorkflowCenter = isRecord(metadata.workflowCenter) ? metadata.workflowCenter : undefined;
  if (topWorkflowCenter && topWorkflowCenter !== workflowCenter) {
    const topClips = Array.isArray(topWorkflowCenter.clips) ? topWorkflowCenter.clips as Record<string, unknown>[] : [];
    const topClip = topClips.find((item) => item.id === clipId);
    if (topClip) {
      Object.assign(topClip, {
        title: clip.title,
        setting: clip.setting,
        characters: clip.characters,
        targetDuration: clip.targetDuration,
        estimatedDuration: clip.estimatedDuration,
        startState: clip.startState,
        endState: clip.endState,
        plotGoal: clip.plotGoal,
        seedancePrompt: clip.seedancePrompt,
        layoutMemory: clip.layoutMemory,
      });
    }
    const topScenes = Array.isArray(topWorkflowCenter.breakdownScenes) ? topWorkflowCenter.breakdownScenes as Record<string, unknown>[] : [];
    for (const scene of topScenes) {
      const patch = updates[String(scene.id || "")];
      if (!patch) continue;
      Object.assign(scene, patch);
      scene.directorBoardPrompt = directorBoardPrompt({
        title: String(scene.title || ""),
        setting: String(scene.setting || "Wasteland Highway"),
        characters: Array.isArray(scene.characters) ? scene.characters.map(String) : [],
        action: String(scene.action || ""),
        dialogue: typeof scene.dialogue === "string" && scene.dialogue.trim() ? scene.dialogue : undefined,
        camera: String(scene.camera || "eye-level, static hold"),
        visualPrompt: String(scene.visualPrompt || scene.description || ""),
      });
    }
  }

  const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
  const canvasScene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : undefined;
  const videoReport: unknown[] = [];
  const boardReport: unknown[] = [];
  if (canvasScene) {
    videoReport.push(...compactCanvasVideoPrompts(canvasScene));
    const nodes = Array.isArray(canvasScene.nodes) ? canvasScene.nodes as Record<string, unknown>[] : [];
    const videoNodeId = `episode-sync-video-node-${episodeId}-${clipId}`;
    const boardNodeId = `clip-position-board-gen-${episodeId}-${clipId}`;
    const storyboardPrompt = episode16EndingStoryboardPrompt();
    const positioningPrompt = episode16EndingPositioningPrompt();
    for (const node of nodes) {
      const data = isRecord(node.data) ? node.data : {};
      if (node.id === `clip-position-board-${episodeId}-${clipId}`) {
        data.title = "Clip 09 · Black Spire Cat-Eye Ending · 故事板/定位板图片流程";
        data.description = "第16集结尾：废土公路、黑塔、猫眼红光。";
      }
      if (node.id === `episode-sync-video-${episodeId}-${clipId}`) {
        data.title = "Clip 09 · Black Spire Cat-Eye Ending · 视频板";
        data.description = "第16集结尾：Chloe 发现 Black Spire 并立下阻止它的目标。";
      }
      if (node.id === videoNodeId || (node.type === "video" && data.clipId === clipId)) {
        videoReport.push({ nodeId: String(node.id || ""), clipId, changedFields: syncVideoNodePrompt(node, prompt), after: prompt.length });
        data.title = "Clip 09 · Black Spire Cat-Eye Ending 视频任务";
        data.description = "Chloe sees the Black Spire and vows to stop it before it breaks the world.";
        data.characters = ["Chloe", "Bob", "Leo", "Zombie", "Pumpkin Zombie"];
      }
      if (node.id === boardNodeId || (node.type === "generation" && data.clipId === clipId && data.positioningBoardFlow)) {
        const before = {
          prompt: typeof data.prompt === "string" ? data.prompt.length : 0,
          positioningPrompt: typeof data.positioningPrompt === "string" ? data.positioningPrompt.length : 0,
        };
        data.title = "Clip 09 · Black Spire Cat-Eye Ending 故事板/定位板";
        data.clipTitle = "Clip 09 · Black Spire Cat-Eye Ending";
        data.description = "第16集结尾故事板/定位板提示词已同步到 Black Spire 猫眼红光版本。";
        data.prompt = storyboardPrompt;
        data.finalPrompt = storyboardPrompt;
        data.submittedPrompt = storyboardPrompt;
        data.storyboardPrompt = storyboardPrompt;
        data.positioningPrompt = positioningPrompt;
        data.manualFinalPrompt = true;
        boardReport.push({
          nodeId: String(node.id || ""),
          before,
          after: { storyboardPrompt: storyboardPrompt.length, positioningPrompt: positioningPrompt.length },
        });
      }
    }
    videoReport.push(...updateTranslationSource(canvasScene, videoNodeId, prompt));
    for (const node of nodes) {
      const data = isRecord(node.data) ? node.data : {};
      if (node.type !== "translation") continue;
      if (data.sourceNodeId === boardNodeId) {
        data.title = "Clip 09 · Black Spire Cat-Eye Ending 定位板 · 中文翻译";
        data.sourceNodeLabel = "Clip 09 · Black Spire Cat-Eye Ending 故事板/定位板";
        data.sourcePrompt = storyboardPrompt;
        clearTranslationResult(data);
        boardReport.push({ nodeId: String(node.id || ""), field: "sourcePrompt", after: storyboardPrompt.length });
      }
      if (data.sourceNodeId === videoNodeId) {
        data.title = "Clip 09 · Black Spire Cat-Eye Ending 视频任务 · 中文翻译";
        data.sourceNodeLabel = "Clip 09 · Black Spire Cat-Eye Ending 视频任务";
      }
    }
  }

  const assets = isRecord(workflowCenter?.assets) ? workflowCenter.assets : {};
  const assetScenes = Array.isArray(assets.scenes) ? assets.scenes as Record<string, unknown>[] : [];
  const highwayPrompt = nightHighwayPrompt();
  const assetReport: unknown[] = [];
  for (const asset of assetScenes) {
    if (asset.name !== "Wasteland Highway" && asset.canonicalSceneName !== "Wasteland Highway") continue;
    asset.timeOfDay = "Night exterior";
    asset.description = "Endless ruined night highway with cracked asphalt, dead root veins, thickening infected-produce horde, and the distant Black Spire with a pulsing red catlike peak light.";
    asset.colorPalette = "cold moonlit asphalt gray, blue-black night sky, rusted metal, sickly green horde glow, distant red Black Spire signal; no warm sunset or golden daylight";
    asset.sceneVisualLock = "Canonical scene: Wasteland Highway at night. Preserve ruined interstate, cracked asphalt, dead roadside gravel, dry wasteland skyline, infected-produce procession, distant Black Spire, and a red catlike peak light. Do not use warm sunset/daylight palette.";
    asset.generatedImagePrompt = highwayPrompt;
    asset.referenceAnalysisStatus = "needs-regeneration";
    asset.visualAuthority = "prompt-needs-regeneration";
    assetReport.push({ id: asset.id, name: asset.name, generatedImagePromptLength: highwayPrompt.length });
  }

  metadata.updatedAt = new Date().toISOString();
  await prisma.project.update({ where: { id: projectId }, data: { metadata } });

  console.log(JSON.stringify({
    projectId,
    episodeId,
    clipId,
    promptLength: prompt.length,
    videoReport,
    boardReport,
    assetReport,
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
