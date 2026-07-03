import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = "episode-018";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return String(value || "").trim();
}

function clipNumber(clipId: string): string {
  return clipId.match(/\d+/)?.[0]?.padStart(2, "0") || clipId;
}

const sharedStyle = "Style: saturated 3D American animated dark-comedy, cinematic lighting, fast exaggerated reactions, polished render.";
const sharedVehicle =
  "Vehicle lock: one two-wheel three-seat armored chopper only, with a single front wheel and single rear wheel. Do not change the vehicle body structure. Seat order must stay fixed whenever the trio is on it: Bob front seat driving at the handlebars, Chloe middle seat with the shotgun, Leo rear seat with the terminal or cast iron pan. If a close-up isolates one rider, keep the other two as edge/background continuity when visible.";
const sharedRules =
  "Use connected character, scene, and prop reference images for identity. Maintain continuous screen direction and scene geography. Do not add subtitles, speech bubbles, UI, panel borders, watermarks, random text, gore, or identity drift.";

const videoPrompts: Record<string, string> = {
  "clip-001": [
    "Generate one continuous 11s cinematic video, 9:16.",
    sharedStyle,
    "Scene: Wasteland Highway at cold night.",
    "Characters: Bob, Chloe, Leo, Zombie, Avocado Emotion Wipers.",
    sharedVehicle,
    "Initial state: the chopper rides along the cracked highway shoulder beside a synchronized infected-produce horde; Bob drives front, Chloe sits middle gripping her shotgun low, Leo sits rear and leans forward to scan the overpass.",
    "Story goal: establish the eerie synchronized horde, reveal the suited Avocado Emotion Wipers on the ruined overpass, and let Chloe identify their emotion-control wristbands.",
    "Shot beats, follow in exact order:",
    "S1: Shot wide, eye-level, slow push-in, 24mm. The three-seat chopper moves screen-right along the night highway; Bob front, Chloe middle, Leo rear. Gravel trembles as the synchronized horde marches in parallel beyond them.",
    "S2: Exact dialogue: Leo: “Look up there.” Shot close-up from Chloe's shoulder toward Leo, 85mm. Leo stays on the rear seat, leaning forward between Chloe and Bob to point at the ruined overpass ahead.",
    "S3: Shot telephoto close-up, static, 85mm. A line of suited Avocado Emotion Wipers stands perfectly still on the overpass against the black sky.",
    "S4: Shot medium detail, low angle, 50mm. Corporate badges and glowing blue biometric wristbands read as flatline-calm visual details; no readable screen text required.",
    "S5: Exact dialogue: Chloe: “Heart Rate: 0. Status: Absolute Zen. Looks like Omega Corp doesn't just micromanage the emotions of the living. They’ve got dead fruit locked into a corporate flow state too.” Shot close-up, 85mm. Chloe on the middle seat narrows her eyes, shotgun still low but ready; Bob keeps driving and Leo watches over her shoulder.",
    sharedRules,
  ].join("\n"),
  "clip-002": [
    "Generate one continuous 12s cinematic video, 9:16.",
    sharedStyle,
    "Scene: Ruined Overpass, same cold-night highway continuity.",
    "Characters: Bob, Chloe, Leo, Avocado Emotion Wipers.",
    sharedVehicle,
    "Initial state: the chopper passes under the overpass; Bob front at the handlebars, Chloe middle braced with shotgun, Leo rear crouched behind her. The Avocado guards remain above them.",
    "Story goal: Bob identifies the Emotion Wipers, the guard activates, and Bob swerves the trio out of the attack line.",
    "Shot beats, follow in exact order:",
    "S1: Exact dialogue: Bob: “That's Omega's elite security detail.” Shot medium close-up, 50mm. Bob grips the handlebars, eyes locked upward while Chloe and Leo remain behind him on the same bike.",
    "S2: Exact dialogue: Bob: “I read about these freaks on a deep-web conspiracy board before the world ended. They're Emotion Wipers—corporate hit squads sent to scrub redundant populations with unsanctioned heart rates.” Shot close-up, 85mm. His paranoia sharpens into certainty; Chloe leans in from the middle seat, Leo listens from the rear.",
    "S3: Shot close-up, 85mm. One Avocado Wiper snaps from stillness to mechanical attention, wristband glowing blue.",
    "S4: Exact dialogue: Avocado Emotion Wiper: “Unsanctioned heart rate anomaly detected. Produce citizens, please remain calm and submit to optimization.” Shot medium, eye-level. The guard speaks from above with sterile customer-service calm.",
    "S5: Exact dialogue: Bob: “Get down!” Shot handheld close-up. Bob ducks and yanks the handlebars; Chloe folds low over the middle seat with the shotgun, Leo clamps onto the rear seat as the chopper swerves.",
    sharedRules,
  ].join("\n"),
  "clip-003": [
    "Generate one continuous 10s cinematic video, 9:16.",
    sharedStyle,
    "Scene: Wasteland Highway under the ruined overpass.",
    "Characters: Avocado Emotion Wipers, Bob, Chloe, Leo.",
    sharedVehicle,
    "Initial state: Bob is already swerving the three-seat chopper from the previous clip; Chloe is low in the middle seat with shotgun, Leo clings to the rear seat.",
    "Story goal: the stun baton attacks the front wheel, Bob fishtails the chopper, and Chloe rises from the middle seat to aim.",
    "Shot beats, follow in exact order:",
    "S1: Shot wide, 24mm. A Wiper drops from the overpass edge; blue-white arcs crackle from its stun baton as the chopper skids below.",
    "S2: Shot medium tracking, 35mm. The baton sweeps low toward Bob's front wheel; Bob twists the handlebars hard, keeping Chloe and Leo aligned behind him on the same two-wheel bike.",
    "S3: Exact dialogue: Bob: “Optimize my ass!” Shot over-shoulder from Chloe toward Bob, 50mm. Bob snarls while forcing a hard sideways skid.",
    "S4: Shot low medium close-up, 50mm. The motorcycle fishtails, throwing sparks and dust; Chloe braces in the middle seat and Leo hooks one arm around the rear grip.",
    "S5: Shot wide-to-medium, 35mm. Chloe rises from the middle seat without leaving the chopper, plants one foot against the frame, and aims the shotgun coldly at the charging Wiper.",
    sharedRules,
  ].join("\n"),
  "clip-004": [
    "Generate one continuous 10s cinematic video, 9:16.",
    sharedStyle,
    "Scene: Wasteland Highway, night skid continuing.",
    "Characters: Chloe, Avocado Emotion Wipers, Bob, Leo.",
    sharedVehicle,
    "Initial state: the chopper is still sliding; Bob front controls the handlebars, Chloe middle has stood into a braced firing stance, Leo rear ducks behind her.",
    "Story goal: Chloe blasts the guard, revealing cybernetics, but the guard continues without feeling pain.",
    "Shot beats, follow in exact order:",
    "S1: Shot wide, 24mm. Chloe fires from the middle seat during the slide; the muzzle flash lights Bob at the handlebars and Leo crouched at the rear.",
    "S2: Shot medium tracking, 35mm. The blast hits the Avocado Wiper, exposing silver corporate wiring inside its fruit body.",
    "S3: Shot close-up, 85mm. The damaged Wiper calmly straightens, suit smoking, expression blank.",
    "S4: Exact dialogue: Avocado Emotion Wiper: “Index: 0. Resuming soothing protocol.” Shot medium close-up. Its voice stays smooth and sterile despite the damage.",
    "S5: Exact dialogue: Chloe: “These corporate stiffs don't feel pain!” Shot close-up on Chloe in the middle seat. She ejects a shell and reloads, furious but controlled; Bob keeps the bike alive and Leo watches the wristband.",
    sharedRules,
  ].join("\n"),
  "clip-005": [
    "Generate one continuous 12s cinematic video, 9:16.",
    sharedStyle,
    "Scene: Wasteland Highway, moving fight beside the chopper.",
    "Characters: Leo, Chloe, Bob, Avocado Emotion Wipers.",
    sharedVehicle,
    "Initial state: Bob front steadies the chopper after the skid, Chloe middle reloads the shotgun, Leo rear spots the blue wristbands and readies his cast iron pan.",
    "Story goal: Leo identifies the wristbands as the weakness, leaps from the rear seat, and shatters one.",
    "Shot beats, follow in exact order:",
    "S1: Exact dialogue: Leo: “Aim for their wristbands!” Shot medium close-up, 50mm. Leo points from the rear seat past Chloe's shoulder toward the glowing blue band.",
    "S2: Shot medium tracking, 35mm. Leo pushes off from the rear seat with comic determination while Bob keeps the chopper close and Chloe covers him from the middle.",
    "S3: Shot close-up, 85mm. The cast iron pan edge closes on the blue glass wristband.",
    "S4: Shot low medium, 50mm. The wristband shatters under the pan blow, sparks popping blue-white.",
    "S5: Shot wide, 24mm. The controlled Wiper collapses into rotten infected instinct as the suppressor fails.",
    "S6: Shot medium reaction. Bob, Chloe, and Leo understand the pattern: the wristbands suppress the infected instincts, and breaking them turns the guards against themselves.",
    sharedRules,
  ].join("\n"),
  "clip-006": [
    "Generate one continuous 11s cinematic video, 9:16.",
    sharedStyle,
    "Scene: Wasteland Highway after the ambush.",
    "Characters: Chloe, Bob, Leo, Avocado Emotion Wipers, Daniel Greene.",
    sharedVehicle,
    "Initial state: the chopper idles on the shoulder; Bob front keeps one hand on the handlebars, Chloe middle holds the shotgun across her lap, Leo rear retrieves the encrypted mobile terminal from the wreckage.",
    "Story goal: the trio regroups among smoking wreckage and unlocks a terminal showing Daniel Greene.",
    "Shot beats, follow in exact order:",
    "S1: Shot wide, 24mm. The three-seat chopper idles amid smoking corporate wreckage and broken blue wristbands.",
    "S2: Shot medium, 35mm. Chloe stays on the middle seat with shotgun ready while Leo reaches from the rear toward a silver encrypted terminal.",
    "S3: Shot close-up, 85mm. The device unlocks with cold corporate efficiency using severed biometric access; keep it stylized and non-gory.",
    "S4: Shot medium close-up. The terminal displays a mature pitch-black purple grape CEO in a tuxedo: Daniel Greene.",
    "S5: Exact dialogue: Chloe: “Daniel Greene. Founder and CEO of Omega Corp. The Savior and Ultimate Architect of Human... wait, no, Produce Civilization.” Shot close-up. Chloe reads dryly from the middle seat as Bob and Leo crowd into frame around the terminal.",
    sharedRules,
  ].join("\n"),
  "clip-007": [
    "Generate one continuous 12s cinematic video, 9:16.",
    sharedStyle,
    "Scene: Wasteland Highway, chopper parked on the shoulder.",
    "Characters: Bob, Chloe, Leo, Daniel Greene.",
    sharedVehicle,
    "Initial state: Bob sits front but twists back toward Leo's terminal; Chloe sits middle with shotgun lowered; Leo sits rear holding the terminal where Daniel Greene's image glows.",
    "Story goal: Bob recognizes Greene's manifesto and explains the scale of Omega's plan.",
    "Shot beats, follow in exact order:",
    "S1: Exact dialogue: Bob: “Savior?” Shot medium close-up, 50mm. Bob turns from the handlebars toward the terminal, orange rind trembling with anger.",
    "S2: Exact dialogue: Bob: “This psycho-grape plastered pamphlets everywhere saying the Z-Virus was Phase One of Evolution.” Shot close-up, 85mm. Cut between Bob's furious face and the Daniel Greene photo on Leo's terminal.",
    "S3: Exact dialogue: Bob: “His manifesto literally said, When all produce loses their ego, the world will achieve eternal peace.” Shot over-shoulder from Chloe, 50mm. Bob quotes the slogan like a warning.",
    "S4: Exact dialogue: Bob: “He's a straight-up megalomaniac! He wants to turn the entire planet into his personal bonsai garden!” Shot medium close-up. Chloe's sarcasm drops into grim focus; Leo calculates silently from the rear seat.",
    "S5: Shot wide. The terminal image frames Greene as grim, mature, and authoritarian against the dead highway night.",
    sharedRules,
  ].join("\n"),
  "clip-008": [
    "Generate one continuous 11s cinematic video, 9:16.",
    sharedStyle,
    "Scene: Wasteland Highway, same parked chopper and terminal setup.",
    "Characters: Leo, Chloe, Bob, The Temp, Daniel Greene.",
    sharedVehicle,
    "Initial state: Leo on the rear seat scrolls the terminal; Chloe middle leans back with shotgun lowered; Bob front watches the overpass road while listening.",
    "Story goal: Leo finds the mysterious Executive Advisor codename The Temp, and the hierarchy shows it outranks Daniel Greene.",
    "Shot beats, follow in exact order:",
    "S1: Exact dialogue: Leo: “Look at this.” Shot medium close-up, 50mm. Leo tilts the terminal so Chloe and Bob can see a shadowed figure behind Greene.",
    "S2: Shot insert/medium, 35mm. The screen holds on a mysterious pale, yarn-like silhouette hidden by photo lighting; do not reveal a clear cat identity.",
    "S3: Exact dialogue: Chloe: “Executive Advisor? It looks like a ball of yarn.” Shot over-shoulder toward Chloe in the middle seat. She squints, suspicious but dismissive.",
    "S4: Exact dialogue: Leo: “Negative. That's the codename for absolute root access.” Shot medium close-up. Leo's deadpan expression flickers with rare confusion as he opens a hierarchy file.",
    "S5: Exact dialogue: Leo: “Every major override in the system is digitally signed by an entity named The Temp. According to this hierarchy, The Temp actually outranks Daniel Greene.” Shot close-up on terminal glow reflecting on all three riders.",
    sharedRules,
  ].join("\n"),
  "clip-009": [
    "Generate one continuous 11s cinematic video, 9:16.",
    sharedStyle,
    "Scene: Black Spire visible from the night highway.",
    "Characters: Chloe, Bob, Leo.",
    sharedVehicle,
    "Initial state: the chopper has turned toward the distant Black Spire; Bob front idles at the handlebars, Chloe middle shuts the terminal with decisive anger, Leo rear keeps scanning.",
    "Story goal: Chloe chooses the Black Spire as their target and Leo confirms it is Omega HQ.",
    "Shot beats, follow in exact order:",
    "S1: Exact dialogue: Chloe: “I don't care who it is. Even if it's a giant alien brain, I'm kicking its ass straight off the top of that tower.” Shot medium close-up, 50mm. Chloe powers down the terminal and lifts her eyes toward the horizon.",
    "S2: Shot wide tracking, 35mm. The Black Spire dominates the distant road ahead under cold moonlight.",
    "S3: Shot close-up/telephoto, 85mm. Red scanning lasers trace a deadly net around the tower; no greenery, no warm dusk.",
    "S4: Exact dialogue: Leo: “That's Omega HQ. The terminal point for all the recall signals.” Shot medium close-up. Leo on the rear seat aligns terminal data with the tower while Chloe and Bob look forward.",
    "S5: Shot wide, 24mm. Bob revs the two-wheel three-seat chopper; Bob front, Chloe middle, Leo rear become a single moving silhouette against the huge Black Spire.",
    sharedRules,
  ].join("\n"),
  "clip-010": [
    "Generate one continuous 10s cinematic video, 9:16.",
    sharedStyle,
    "Scene: Black Spire approach road.",
    "Characters: Chloe, Bob, Leo, The Temp.",
    sharedVehicle,
    "Initial state: Bob front grips the handlebars ready to launch, Chloe middle angles forward with the shotgun, Leo rear secures the terminal and pan.",
    "Story goal: the trio commits to the attack; the Black Spire's red peak light watches like a cat pupil.",
    "Shot beats, follow in exact order:",
    "S1: Exact dialogue: Chloe: “Alright, boys. You ready to go meet the Savior?” Shot medium close-up, 50mm. Chloe leans forward from the middle seat, eyes locked on the tower peak.",
    "S2: Shot medium tracking, 35mm. Bob twists the throttle at the front; Chloe braces in the middle; Leo locks himself onto the rear seat with terminal tucked away.",
    "S3: Shot telephoto close-up, 85mm. The single red light at the Black Spire peak burns brighter like a slitted cat pupil watching them.",
    "S4: Shot low medium close-up, 50mm. Chloe stares back at the red light, rebel chaos facing corporate calm.",
    "S5: Shot wide, 24mm. The two-wheel three-seat chopper surges down the highway lines toward the Black Spire, preserving Bob-front, Chloe-middle, Leo-rear order.",
    sharedRules,
  ].join("\n"),
};

function storyboardPromptFor(clipId: string, title: string, videoPrompt: string): string {
  const num = clipNumber(clipId);
  const scene = clipId === "clip-002" ? "Ruined Overpass" : clipId === "clip-009" || clipId === "clip-010" ? "Black Spire" : "Wasteland Highway";
  return [
    `Create a 2x3 comic storyboard board for ${title}, matching video shots S1-S5 in exact order.`,
    "Image type: one 16:9 storyboard sheet with five panels in a clean grid. Each panel is one still frame for one shot.",
    "Panel numbering is mandatory: small readable labels S1, S2, S3, S4, S5 in the upper-left corner of panels. No other text, captions, speech bubbles, UI, watermark, or random labels.",
    "Project: 美式漫剧. Style: saturated 3D American animated dark-comedy storyboard/previsualization, cinematic but readable.",
    `Scene continuity lock: ${scene}. Keep cold night continuity and the same road/overpass/tower geography across panels unless the shot explicitly changes.`,
    "Connected references to preserve exactly: Bob, Chloe, Leo, Chopper, Shotgun, Cast Iron Pan, Encrypted Mobile Terminal, relevant scene and antagonist references.",
    "Hard vehicle rule: show one two-wheel three-seat armored chopper only, with a single front wheel and single rear wheel. Do not change the vehicle body structure. Seat order must stay fixed whenever visible: Bob front seat driving at handlebars, Chloe middle seat with shotgun, Leo rear seat with terminal or cast iron pan.",
    "For close-ups, isolating one rider is allowed, but do not contradict the fixed seat order; keep the other riders as edge/background continuity when the frame is wide enough.",
    "Storyboard panels:",
    ...videoPrompt
      .split("\n")
      .filter((line) => /^S\d+:/.test(line))
      .map((line, index) => `Panel ${index + 1}: ${line.replace(/^S\d+:\s*/, "")}`),
    `Continuity note: this is episode 18 clip ${num}; preserve the previous/next clip riding order and action state.`,
    "Do not redesign characters, scene architecture, props, clothing, held items, vehicle type, or visible character states.",
  ].join("\n");
}

function resetStoryboardOutput(data: JsonRecord): JsonRecord {
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
    positioningBoardMode: "storyboard",
  };
}

async function main() {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
  if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);
  const metadata = project.metadata as JsonRecord;
  const episodes = isRecord(metadata.episodes) ? metadata.episodes as JsonRecord : {};
  const episode = isRecord(episodes[episodeId]) ? episodes[episodeId] as JsonRecord : null;
  if (!episode) throw new Error(`Episode not found: ${episodeId}`);
  const workflow = isRecord(episode.workflowCenter) ? episode.workflowCenter as JsonRecord : {};
  const clips = Array.isArray(workflow.clips) ? workflow.clips.filter(isRecord) : [];
  const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes as JsonRecord : {};
  const canvas = isRecord(canvasScenes[episodeId]) ? canvasScenes[episodeId] as JsonRecord : null;
  if (!canvas) throw new Error(`Canvas scene not found: ${episodeId}`);
  const nodes = Array.isArray(canvas.nodes) ? canvas.nodes.filter(isRecord) : [];

  await mkdir("/tmp/loohii-backups", { recursive: true });
  const backupPath = path.join("/tmp/loohii-backups", `episode-018-before-chopper-repair-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(backupPath, JSON.stringify({ episode, canvas }, null, 2));

  const nextClips = clips.map((clip) => {
    const id = stringValue(clip.id);
    const prompt = videoPrompts[id];
    if (!prompt) return clip;
    const title = stringValue(clip.title) || `Clip ${clipNumber(id)}`;
    return {
      ...clip,
      videoPrompt: prompt,
      seedancePrompt: prompt,
      storyboardPrompt: storyboardPromptFor(id, title, prompt),
      panelCount: 5,
      storyboardPanelCount: 5,
      storyboardNotes: "Repaired episode 18 chopper seat continuity: Bob front, Chloe middle, Leo rear.",
    };
  });

  const clipById = new Map(nextClips.map((clip) => [stringValue(clip.id), clip]));
  const nextNodes = nodes.map((node) => {
    const data = isRecord(node.data) ? node.data as JsonRecord : {};
    const clipId = stringValue(data.clipId);
    const clip = clipById.get(clipId);
    if (!clip) return node;
    const prompt = stringValue(clip.videoPrompt || clip.seedancePrompt);
    const storyboardPrompt = stringValue(clip.storyboardPrompt);
    if (node.type === "video" || data.workflowKind === "video" || data.videoPrompt || data.seedancePrompt) {
      return {
        ...node,
        data: {
          ...data,
          prompt,
          videoPrompt: prompt,
          seedancePrompt: prompt,
          status: data.status === "completed" ? "waiting" : data.status || "waiting",
          error: "",
        },
      };
    }
    if (node.type === "generation" && data.positioningBoardFlow === true) {
      return {
        ...node,
        data: {
          ...resetStoryboardOutput(data),
          prompt: storyboardPrompt,
          finalPrompt: storyboardPrompt,
          storyboardPrompt,
          manualFinalPrompt: true,
          panelCount: 5,
          storyboardPanelCount: 5,
        },
      };
    }
    return node;
  });

  const topWorkflow = isRecord(metadata.workflowCenter) ? metadata.workflowCenter as JsonRecord : null;
  const topClips = topWorkflow && Array.isArray(topWorkflow.clips)
    ? topWorkflow.clips.filter(isRecord).map((clip) => {
        const replacement = clipById.get(stringValue(clip.id));
        return replacement ?? clip;
      })
    : undefined;

  const nextMetadata: JsonRecord = {
    ...metadata,
    episodes: {
      ...episodes,
      [episodeId]: {
        ...episode,
        workflowCenter: {
          ...workflow,
          clips: nextClips,
          updatedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      },
    },
    canvasScenes: {
      ...canvasScenes,
      [episodeId]: {
        ...canvas,
        nodes: nextNodes,
        updatedAt: new Date().toISOString(),
      },
    },
  };
  if (topWorkflow && topClips) {
    nextMetadata.workflowCenter = {
      ...topWorkflow,
      clips: topClips,
      updatedAt: new Date().toISOString(),
    };
  }

  await prisma.project.update({ where: { id: projectId }, data: { metadata: nextMetadata } });

  console.log(JSON.stringify({
    projectId,
    episodeId,
    backupPath,
    clipsUpdated: nextClips.filter((clip) => videoPrompts[stringValue(clip.id)]).length,
    videoNodesUpdated: nextNodes.filter((node) => {
      const data = isRecord(node.data) ? node.data : {};
      return videoPrompts[stringValue(data.clipId)] && (node.type === "video" || data.workflowKind === "video" || data.videoPrompt || data.seedancePrompt);
    }).length,
    storyboardNodesReset: nextNodes.filter((node) => {
      const data = isRecord(node.data) ? node.data : {};
      return videoPrompts[stringValue(data.clipId)] && node.type === "generation" && data.positioningBoardFlow === true;
    }).length,
    maxVideoPromptLength: Math.max(...Object.values(videoPrompts).map((prompt) => prompt.length)),
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
