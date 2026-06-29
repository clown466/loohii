import { prisma } from "../server/src/lib/prisma";
import { workflowsTestInternals } from "../server/src/routes/workflows";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = "episode-016";
const clipId = "clip-008";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function videoPrompt() {
  return workflowsTestInternals.finalizeWorkflowVideoPrompt([
    "Generate one continuous 15s cinematic video, 9:16.",
    "Style: 3D American cartoon dark comedy, fast-paced exaggerated reactions, cinematic night lighting.",
    "Scene: Livestream Rest Area at night, immediately outside the terrarium emergency exit, with the highway exit visible beyond the broadcast clutter.",
    "Characters: Leo, Pineapple Showrunner, Chloe, Bob. Use connected character reference images; do not redesign.",
    "Initial state: This starts right after Chloe kicks open the terrarium exit in Clip 07. The trio rushes into the rest area chaos; the infected-produce horde keeps marching toward the highway. Leo still carries his cast iron pan, Bob is aiming for the spike-covered three-seat chopper, and Chloe is tense but moving fast.",
    "Story goal: Pineapple Showrunner tries to block the escape, Leo forces him aside with a deadpan legal threat and the pan, then Chloe, Bob, and Leo mount the chopper so Clip 09 can begin with Bob already driving onto the wasteland highway.",
    "Shot beats, follow in this exact order:",
    "S1: Shot: wide tracking; eye-level; handheld; 35mm. Chloe, Bob, and Leo burst from the terrarium exit into the Livestream Rest Area. Pineapple Showrunner steps into their path, still clutching his remote, while drones and abandoned broadcast gear jitter around him.",
    "S2: Exact dialogue: Leo: “Fellow industry professional, according to Omega's system logs, your rest area is actively interfering with a 'Major Logistics Event' and has just been classified as an illegal structure. If you don't shut your mouth right now, the orbital satellite sweep in five seconds will automatically designate you as a 'clearable roadblock'.”; Shot: medium over-shoulder; handheld slow push; 50mm. Leo plants himself screen-left and presses the flat cast iron pan against Pineapple Showrunner's nose with calm professional menace.",
    "S3: Shot: close-up; low angle; static hold; 85mm. A blue targeting reticle locks onto Pineapple Showrunner's forehead; his showman grin collapses, leafy hands twitch upward, and the remote drops lower in his grip.",
    "S4: Shot: medium; eye-level; handheld tracking; 50mm. Pineapple Showrunner backs aside with both leafy hands raised. Chloe passes him without slowing, Bob angles toward the chopper, and Leo keeps the pan between the Showrunner and the trio.",
    "S5: Shot: wide tracking; low angle; 35mm. The trio reaches the spike-covered three-seat chopper near the highway exit. The horde streams toward the road in the background, making the rest area feel abandoned and unsafe.",
    "S6: Shot: medium close-up; eye-level; handheld; 50mm. Bob grabs the handlebars and front seat, Chloe swings onto the middle seat with clenched fists, and Leo jumps onto the rear holding his cast iron pan. The engine coughs alive and the front wheel points toward the dark highway.",
    "Direction: keep the terrarium exit behind them, Pineapple Showrunner backing away, chopper orientation toward the highway, and the horde movement continuous. End with the trio mounted and ready to accelerate, not already far down the highway. No subtitles, UI, watermarks, random text, gore, or identity drift.",
  ].join("\n"));
}

function storyboardPrompt() {
  return [
    "Create a 3x2 comic storyboard board for Clip 08 · Showrunner Forced Aside, matching video shots S1-S6 in exact order.",
    "Image type: one 16:9 storyboard sheet with six clean panels. Each panel is a still frame for one shot, not a positioning still and not a video.",
    "Panel labels: draw only small upper-left labels S1, S2, S3, S4, S5, S6. No other text, subtitles, captions, speech bubbles, UI, watermark, or random labels.",
    "Style: saturated 3D American animated dark-comedy storyboard/previsualization, cinematic night exterior, readable silhouettes.",
    "Scene continuity lock: Livestream Rest Area outside the terrarium emergency exit. Keep the same exit door, broadcast clutter, highway exit direction, chopper parking position, and horde movement across all panels.",
    "References to preserve: Leo, Pineapple Showrunner, Chloe, Bob, Livestream Rest Area, Cast Iron Pan, Blue Laser Targeting Reticle, Spike-Covered Chopper.",
    "Continuity entering: Chloe has just kicked open the terrarium emergency exit; the trio is escaping while the infected-produce horde marches toward the highway.",
    "Continuity target: Bob, Chloe, and Leo end mounted on the spike-covered chopper, front wheel aimed toward the dark highway, ready for Clip 09.",
    "Panel plan:",
    "S1: Wide tracking frame. Chloe, Bob, and Leo burst from the terrarium exit; Pineapple Showrunner blocks their path with his remote, drones and broadcast gear shaking around him.",
    "S2: Medium over-shoulder frame. Leo screen-left presses the flat cast iron pan into Pineapple Showrunner's nose; Chloe and Bob are visible behind Leo, still moving toward escape.",
    "S3: Close-up low angle. Blue targeting reticle on Pineapple Showrunner's forehead; his grin collapses and the remote droops in his hand.",
    "S4: Medium tracking frame. Showrunner backs aside with both leafy hands raised; Chloe strides past, Bob cuts toward the chopper, Leo keeps the pan between them.",
    "S5: Wide low tracking frame. The trio reaches the spike-covered three-seat chopper near the highway exit; the horde streams toward the road in the background.",
    "S6: Medium close-up. Bob grips handlebars/front seat, Chloe swings onto the middle seat with clenched fists, Leo lands on the rear holding his pan; engine vibration implied, front wheel aimed at the dark highway.",
    "Keep screen direction continuous: escape movement flows from terrarium exit toward the chopper, then toward the highway. Do not show the chopper already far down the highway.",
  ].join("\n");
}

function positioningPrompt() {
  return [
    "Create ONE static 16:9 keyframe positioning-board image for Clip 08 · Showrunner Forced Aside.",
    "Image type: a single frozen spatial layout reference, not a storyboard and not a video prompt.",
    "Style: saturated 3D American animated dark-comedy previsualization, cinematic night lighting, clear readable blocking.",
    "Scene: Livestream Rest Area outside the terrarium emergency exit. Keep the exit behind the characters, broadcast clutter around Pineapple Showrunner, the spike-covered three-seat chopper near the highway exit, and the dark road visible beyond.",
    "Visible layout: Pineapple Showrunner stands screen-right backing away with leafy hands raised and a blue targeting reticle on his forehead. Leo stands center-left, facing him, holding the cast iron pan defensively. Chloe and Bob are at the chopper: Bob at the handlebars/front seat, Chloe climbing onto the middle seat, both facing toward the highway exit.",
    "Optional background: the infected-produce horde continues moving toward the road, but it must not crowd the main blocking.",
    "Purpose: lock the transition between Clip 07's escape and Clip 09's highway ride. End state should show the trio ready to launch, not already driving far away.",
    "No subtitles, panel labels, speech bubbles, UI, watermark, random text, gore, or identity drift.",
  ].join("\n");
}

function directorPrompt(scene: Record<string, unknown>) {
  const characters = Array.isArray(scene.characters) ? scene.characters.join(", ") : "visible characters only";
  return [
    "Create a vertical 9-panel director storyboard for this shot.",
    `Shot title: ${String(scene.title || "")}`,
    `Setting: ${String(scene.setting || "Livestream Rest Area")}`,
    `Characters: ${characters}`,
    `Action: ${String(scene.action || scene.description || "")}`,
    typeof scene.dialogue === "string" && scene.dialogue.trim()
      ? `Dialogue to preserve exactly: ${scene.dialogue}`
      : "Dialogue: none.",
    `Camera: ${String(scene.camera || "eye-level handheld")}`,
    "Composition: preserve the terrarium exit, Pineapple Showrunner's blocking position, the chopper parking position, and the highway exit direction.",
    `Visual prompt: ${String(scene.visualPrompt || scene.description || "")}`,
    "No subtitles, speech bubbles, UI, watermark, random text, or identity drift.",
  ].join("\n");
}

function patchWorkflowCenter(workflowCenter: Record<string, unknown> | undefined, prompt: string) {
  if (!workflowCenter) return false;
  const clips = Array.isArray(workflowCenter.clips) ? workflowCenter.clips as Record<string, unknown>[] : [];
  const clip = clips.find((item) => item.id === clipId);
  if (!clip) return false;

  clip.title = "Clip 08 · Showrunner Forced Aside";
  clip.setting = "Livestream Rest Area";
  clip.characters = ["Leo", "Pineapple Showrunner", "Chloe", "Bob"];
  clip.targetDuration = 15;
  clip.estimatedDuration = 15;
  clip.startState = "Starts immediately after Clip 07: Chloe has kicked open the terrarium emergency exit and the trio rushes into the Livestream Rest Area while the horde marches toward the highway.";
  clip.endState = "Ends with Bob, Chloe, and Leo mounted on the spike-covered three-seat chopper, engine starting, front wheel aimed toward the dark highway for Clip 09.";
  clip.plotGoal = "Pineapple Showrunner tries to block the escape; Leo uses his cast iron pan and an Omega roadblock threat to force him aside; the trio mounts the chopper without stopping.";
  clip.seedancePrompt = prompt;
  clip.layoutMemory = [
    "Location: Livestream Rest Area outside the terrarium emergency exit",
    "Characters: Leo, Pineapple Showrunner, Chloe, Bob",
    "Start: The trio exits the terrarium after Chloe kicks the door open; Pineapple Showrunner blocks the path with his remote.",
    "End: Bob, Chloe, and Leo are mounted on the spike-covered three-seat chopper, aimed toward the highway.",
    "Continuity into next clip: Clip 09 begins after this launch, with Bob already driving onto the Wasteland Highway beside the marching horde.",
  ].join("\n");

  const scenes = Array.isArray(workflowCenter.breakdownScenes) ? workflowCenter.breakdownScenes as Record<string, unknown>[] : [];
  const patches: Record<string, Partial<Record<string, unknown>>> = {
    "shot-044": {
      title: "Leo pins Showrunner with the pan",
      setting: "Livestream Rest Area",
      subtitle: "Leo: “Fellow industry professional, according to Omega's system logs, your rest area is actively interfering with a 'Major Logistics Event' and has just been classified as an illegal structure. If you don't shut your mouth right now, the orbital satellite sweep in five seconds will automatically designate you as a 'clearable roadblock'.”",
      dialogue: "Leo: “Fellow industry professional, according to Omega's system logs, your rest area is actively interfering with a 'Major Logistics Event' and has just been classified as an illegal structure. If you don't shut your mouth right now, the orbital satellite sweep in five seconds will automatically designate you as a 'clearable roadblock'.”",
      action: "Leo steps between the trio and Pineapple Showrunner, pressing the flat cast iron pan against the Showrunner's nose while Chloe and Bob keep moving toward the chopper.",
      description: "Immediately after the terrarium escape, Pineapple Showrunner blocks the path. Leo calmly pins him with the pan and delivers the full Omega roadblock threat.",
      visualPrompt: "Medium over-shoulder night shot: Leo screen-left presses a cast iron pan into Pineapple Showrunner's nose; Chloe and Bob are behind Leo, ready to run toward the chopper; broadcast drones wobble in the rest area.",
      characters: ["Leo", "Pineapple Showrunner", "Chloe", "Bob"],
      camera: "medium over-shoulder, handheld slow push, 50mm, f/2.8, 1/48, ISO 1000",
      shotSize: "medium",
      cameraAngle: "over-shoulder",
      cameraMove: "handheld slow push",
      lens: "50mm",
      durationSeconds: 7,
    },
    "shot-045": {
      title: "Reticle forces Showrunner aside",
      setting: "Livestream Rest Area",
      subtitle: "",
      dialogue: "",
      action: "A blue targeting reticle locks onto Pineapple Showrunner's forehead; he raises both leafy hands and backs away from the trio.",
      description: "The threat lands visually: a blue reticle targets Pineapple Showrunner, his remote droops, and he clears the path.",
      visualPrompt: "Close-up low angle: blue targeting reticle centered on Pineapple Showrunner's forehead, terrified leafy hands raised, remote lowered, Leo's pan still near frame edge.",
      characters: ["Pineapple Showrunner", "Leo"],
      camera: "close-up, low angle, static hold, 85mm, f/2.8, 1/48, ISO 1000",
      shotSize: "close-up",
      cameraAngle: "low angle",
      cameraMove: "static hold",
      lens: "85mm",
      durationSeconds: 3,
    },
    "shot-046": {
      title: "Trio mounts the chopper",
      setting: "Livestream Rest Area",
      subtitle: "",
      dialogue: "",
      action: "Chloe, Bob, and Leo reach the spike-covered three-seat chopper; Bob takes the handlebars, Chloe climbs onto the middle seat, and Leo jumps onto the rear holding his pan.",
      description: "The trio mounts the chopper at the edge of the rest area, engine starting and front wheel aimed toward the dark highway so the next clip can begin on the road.",
      visualPrompt: "Wide-to-medium tracking night shot: spike-covered three-seat chopper near highway exit; Bob at handlebars/front seat, Chloe climbing onto middle seat with clenched fists, Leo on rear seat holding cast iron pan; horde moving toward road in background.",
      characters: ["Chloe", "Bob", "Leo"],
      camera: "wide tracking into medium close-up, low-to-eye level, handheld, 35mm to 50mm, f/2.8, 1/48, ISO 1000",
      shotSize: "wide to medium close-up",
      cameraAngle: "low-to-eye level",
      cameraMove: "handheld tracking",
      lens: "35mm to 50mm",
      durationSeconds: 5,
    },
  };
  for (const scene of scenes) {
    const patch = patches[String(scene.id || "")];
    if (!patch) continue;
    Object.assign(scene, patch);
    scene.directorBoardPrompt = directorPrompt(scene);
  }
  return true;
}

function syncTranslation(scene: Record<string, unknown>, sourceNodeId: string, sourcePrompt: string, title: string, sourceNodeLabel: string) {
  const nodes = Array.isArray(scene.nodes) ? scene.nodes as Record<string, unknown>[] : [];
  let changed = 0;
  for (const node of nodes) {
    const data = isRecord(node.data) ? node.data : {};
    if (node.type !== "translation" || data.sourceNodeId !== sourceNodeId) continue;
    data.title = title;
    data.sourceNodeLabel = sourceNodeLabel;
    data.sourcePrompt = sourcePrompt;
    if (typeof data.translatedPrompt === "string") data.translatedPrompt = "";
    data.status = "idle";
    data.error = "";
    changed += 1;
  }
  return changed;
}

async function main() {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
  if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);
  const metadata = project.metadata as Record<string, unknown>;
  const prompt = videoPrompt();
  const boardPrompt = storyboardPrompt();
  const posPrompt = positioningPrompt();

  const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
  const episode = isRecord(episodes[episodeId]) ? episodes[episodeId] : undefined;
  const workflowCenter = isRecord(episode?.workflowCenter) ? episode.workflowCenter : undefined;
  const topWorkflowCenter = isRecord(metadata.workflowCenter) ? metadata.workflowCenter : undefined;
  const workflowPatched = patchWorkflowCenter(workflowCenter, prompt);
  const topPatched = topWorkflowCenter === workflowCenter ? false : patchWorkflowCenter(topWorkflowCenter, prompt);

  const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
  const canvasScene = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] : undefined;
  const canvasReport: unknown[] = [];
  if (canvasScene) {
    const nodes = Array.isArray(canvasScene.nodes) ? canvasScene.nodes as Record<string, unknown>[] : [];
    const boardNodeId = `clip-position-board-gen-${episodeId}-${clipId}`;
    const videoNodeId = `episode-sync-video-node-${episodeId}-${clipId}`;
    for (const node of nodes) {
      const data = isRecord(node.data) ? node.data : {};
      if (node.id === `clip-position-board-${episodeId}-${clipId}`) {
        data.title = "Clip 08 · Showrunner Forced Aside · 故事板/定位板图片流程";
        data.description = "优化后承接 Clip 07 逃出，并衔接 Clip 09 上路。";
      }
      if (node.id === boardNodeId || (node.type === "generation" && data.clipId === clipId && data.positioningBoardFlow)) {
        data.title = "Clip 08 · Showrunner Forced Aside 故事板/定位板";
        data.clipTitle = "Clip 08 · Showrunner Forced Aside";
        data.description = "已优化为 6 格故事板，细化 Showrunner 让路、三人上车和接续高速公路。";
        data.prompt = boardPrompt;
        data.finalPrompt = boardPrompt;
        data.submittedPrompt = boardPrompt;
        data.storyboardPrompt = boardPrompt;
        data.positioningPrompt = posPrompt;
        data.manualFinalPrompt = true;
        data.status = "idle";
        data.error = "";
        canvasReport.push({ nodeId: String(node.id || ""), kind: "board", storyboardLength: boardPrompt.length, positioningLength: posPrompt.length });
      }
      if (node.id === `episode-sync-video-${episodeId}-${clipId}`) {
        data.title = "Clip 08 · Showrunner Forced Aside · 视频板";
        data.description = "承接逃出 terrarium，结束于三人上车准备驶入高速。";
      }
      if (node.id === videoNodeId || (node.type === "video" && data.clipId === clipId)) {
        data.title = "Clip 08 · Showrunner Forced Aside 视频任务";
        data.description = "Leo forces Pineapple Showrunner aside; the trio mounts the chopper for the highway transition.";
        data.characters = ["Leo", "Pineapple Showrunner", "Chloe", "Bob"];
        data.duration = "15";
        data.durationSeconds = 15;
        data.prompt = prompt;
        data.videoPrompt = prompt;
        data.seedancePrompt = prompt;
        data.status = "waiting";
        data.videoStatus = "waiting";
        data.statusLabel = "视频提示词已优化，等待生成";
        canvasReport.push({ nodeId: String(node.id || ""), kind: "video", promptLength: prompt.length });
      }
    }
    canvasReport.push({
      sourceNodeId: boardNodeId,
      translations: syncTranslation(
        canvasScene,
        boardNodeId,
        boardPrompt,
        "Clip 08 · Showrunner Forced Aside 定位板 · 中文翻译",
        "Clip 08 · Showrunner Forced Aside 故事板/定位板",
      ),
    });
    canvasReport.push({
      sourceNodeId: videoNodeId,
      translations: syncTranslation(
        canvasScene,
        videoNodeId,
        prompt,
        "Clip 08 · Showrunner Forced Aside 视频任务 · 中文翻译",
        "Clip 08 · Showrunner Forced Aside 视频任务",
      ),
    });
  }

  metadata.updatedAt = new Date().toISOString();
  await prisma.project.update({ where: { id: projectId }, data: { metadata } });
  console.log(JSON.stringify({
    projectId,
    episodeId,
    clipId,
    promptLength: prompt.length,
    storyboardLength: boardPrompt.length,
    positioningLength: posPrompt.length,
    workflowPatched,
    topPatched,
    canvasReport,
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
