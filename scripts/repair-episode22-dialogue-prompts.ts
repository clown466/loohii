import { prisma } from "../server/src/lib/prisma";
import { buildClipPositioningBoardPrompt } from "../server/src/lib/workflowPositioningBoards";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = "episode-022";

type JsonRecord = Record<string, any>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return String(value || "").trim();
}

function sceneLock(mode: "normal" | "cold"): string {
  const base = "Canonical scene: Black Spire B7 Core Server Room";
  if (mode === "cold") {
    return `${base}, cold lockdown state after the flash-freeze system activates. Preserve the same server rack layout, main console/keyboard, highest server rack, blast-door access, red/blue alarms, golden cables, and cat-admin props, now filled with blue-white cold fog, rim frost on metal, visible freezing air, and emergency lockdown lighting.`;
  }
  return `${base}, normal pre-lockdown state. Preserve a vast corporate core server chamber with black server racks, golden fiber-optic cable glow, central main console/keyboard where Tangelo rests, red alarm accents, blue system monitors, blast-door access, and cat-admin props. Warm/dry server room air; no frost, no ice, no white cold fog until the lockdown trigger.`;
}

const prompts: Record<string, { duration: number; prompt: string; title?: string; plotGoal?: string; startState?: string; endState?: string; shotIds?: string[] }> = {
  "clip-006": {
    duration: 10,
    title: "Clip 06 · Chloe Rages at Tangelo",
    plotGoal: "Chloe's anger boils over. She storms to the main console and presses the shotgun against Tangelo's head while delivering her full accusation.",
    startState: "Starts with in B7 Core Server Room Leo finishing his deadpan analysis while Tangelo sleeps on the keyboard.",
    endState: "Ends with in B7 Core Server Room Chloe has the shotgun barrel pressed against Tangelo's head.",
    prompt: `Clip video prompt for Clip 06 · Chloe Rages at Tangelo.
Duration target: 10s, 16:9 cinematic 3D animated dark comedy style.
Characters: Chloe, Tangelo, Leo. Use connected character references; do not redesign.
Setting: B7 Core Server Room.
Scene visual continuity lock: ${sceneLock("normal")}
Initial state: Leo finishes his deadpan explanation near the console; Tangelo is asleep on the main keyboard; Chloe's patience snaps, shotgun in hand.
Global shot rules: keep one continuous room geography, readable screen direction, visible-subject framing, and clear foreground/midground/background depth.
Story goal: Chloe crosses from stunned disbelief into explosive anger and pins the shotgun barrel to Tangelo's head.

Shot beats, follow in exact order:
S1: Shot: close-up; eye-level; slow push-in; 85mm; Chloe glares at the sleeping orange cat, forehead veins popping, shotgun trembling in her hands.
S2: Shot: medium; eye-level; handheld step-in; 50mm; Chloe storms toward the main console while Leo stiffens behind her.
S3: Exact dialogue: Chloe: “You little.. you fuzzy little bastard! Do you have any idea what you've done?! You turned 90% of the global population into moldy zombies! You ruined my Friday night! My beanbag chair! My beer! I literally smell like sauerkraut and rotting meat right now! Get your fat ass up!”; Shot: close-up; low angle; handheld; 85mm; Chloe presses the shotgun barrel directly against Tangelo's head, furious and shaking.
S4: Shot: close-up; over-shoulder from Chloe to Tangelo; static hold; 85mm; Tangelo remains asleep for a beat under the cold metal barrel, HR lanyard visible.
S5: Shot: medium; eye-level; slight push-in; 50mm; The room freezes around Chloe's outburst; Leo watches, Tangelo still sprawled on the keyboard.

Do not add subtitles, speech bubbles, UI, panel borders, panel numbers, watermarks, or explanatory text.`,
  },
  "clip-007": {
    duration: 6,
    title: "Clip 07 · Tangelo Disarms Chloe with Cuteness",
    plotGoal: "Tangelo wakes, meows, rubs against the shotgun, and rolls over, making Chloe hesitate despite herself.",
    startState: "Starts with in B7 Core Server Room Chloe holding the shotgun barrel against Tangelo's head on the main keyboard.",
    endState: "Ends with in B7 Core Server Room Tangelo rolling onto its back and exposing its fluffy white belly while Chloe freezes.",
    shotIds: ["shot-037", "shot-038", "shot-039", "shot-040", "shot-041"],
    prompt: `Clip video prompt for Clip 07 · Tangelo Disarms Chloe with Cuteness.
Duration target: 6s, 16:9 cinematic 3D animated dark comedy style.
Characters: Chloe, Tangelo. Use connected character references; do not redesign.
Setting: B7 Core Server Room.
Scene visual continuity lock: ${sceneLock("normal")}
Initial state: Chloe holds her shotgun barrel against Tangelo's head on the main keyboard; Tangelo is just waking.
Global shot rules: keep one continuous room geography, readable screen direction, visible-subject framing, and clear foreground/midground/background depth.
Story goal: The threat collapses into an absurd cute-cat beat; Chloe cannot pull the trigger.

Shot beats, follow in exact order:
S1: Shot: close-up; over-shoulder from Chloe; static hold; 85mm; Tangelo slowly opens huge amber eyes with the shotgun barrel in the foreground.
S2: Exact dialogue: Tangelo: “Meow~”; Shot: medium; eye-level; soft push-in; 50mm; Tangelo stretches luxuriously across the keyboard and chirps, completely unfazed.
S3: Shot: close-up; eye-level; static hold; 85mm; Tangelo rubs its fluffy chin against the cold shotgun barrel, purring like an engine.
S4: Shot: close-up; eye-level; static hold; 85mm; Chloe's trigger finger freezes; her fury falters into horrified hesitation.
S5: Shot: medium; eye-level; slow push-in; 50mm; Tangelo rolls onto its back, HR lanyard slipping aside, fluffy white belly exposed; Chloe stays locked in place.

Do not add subtitles, speech bubbles, UI, panel borders, panel numbers, watermarks, or explanatory text.`,
  },
  "clip-008": {
    duration: 15,
    title: "Clip 08 · Bob Panics and Leo Opens the Logs",
    plotGoal: "Bob panics that Tangelo is hypnotizing Chloe, Chloe snaps back, Bob refuses to shoot, and Leo pulls up the Day 1 logs.",
    startState: "Starts with in B7 Core Server Room Tangelo on its back exposing its fluffy belly while Chloe hesitates with shotgun in hand.",
    endState: "Ends with in B7 Core Server Room Leo tapping the main console and opening the Day 1 system logs.",
    prompt: `Clip video prompt for Clip 08 · Bob Panics and Leo Opens the Logs.
Duration target: 15s, 16:9 cinematic 3D animated dark comedy style.
Characters: Bob, Chloe, Tangelo, Leo. Use connected character references; do not redesign.
Bob continuity: Bob keeps both hands visible and empty throughout this episode.
Setting: B7 Core Server Room.
Scene visual continuity lock: ${sceneLock("normal")}
Initial state: Tangelo is belly-up on the keyboard; Chloe is frozen with the shotgun; Bob hangs back, panicked; Leo observes the console.
Global shot rules: keep one continuous room geography, readable screen direction, visible-subject framing, and clear foreground/midground/background depth.
Story goal: Bob's fear turns the cute-cat beat into a paranoid comedy beat, then Leo shifts attention to the logs.

Shot beats, follow in exact order:
S1: Exact dialogue: Bob: “Chloe! Don't let its mind-control pollute your brain! That is high-dimensional cognitive hypnosis! Initiate the physical purge!”; Shot: medium; eye-level; handheld; 50mm; Bob points frantically at Tangelo while half-covering his eyes.
S2: Shot: close-up; over-shoulder; handheld; 85mm; Chloe glances from Tangelo's exposed belly back to Bob, furious and conflicted.
S3: Exact dialogue: Chloe: “Then you freakin' shoot it!”; Shot: close-up; eye-level; sharp pan; 85mm; Chloe swings the shotgun toward Bob, then back toward Tangelo.
S4: Exact dialogue: Bob: “I.. I can't! I'm allergic to dander! And it's showing me its belly!”; Shot: medium; eye-level; static hold; 50mm; Bob turns away in exaggerated agony, hands over eyes.
S5: Shot: medium; eye-level; slow push-in; 50mm; Leo calmly steps to the half-visible monitor beside Tangelo's body on the keyboard.
S6: Exact dialogue: Leo: “Look. These are the Day 1 system logs.”; Shot: close-up; over-shoulder to monitor; static hold; 85mm; Leo taps the screen and red-green log code scrolls up.

Do not add subtitles, speech bubbles, UI, panel borders, panel numbers, watermarks, or explanatory text.`,
  },
  "clip-009": {
    duration: 10,
    title: "Clip 09 · Logs Reveal the Catastrophe",
    plotGoal: "The logs show the apocalypse was triggered by Tangelo's accidental keyboard inputs, and Chloe realizes the absurd truth.",
    startState: "Starts with in B7 Core Server Room Leo opens the Day 1 system logs on the monitor.",
    endState: "Ends with in B7 Core Server Room Chloe staring at the monitor, jaw clenched, processing the cat-caused apocalypse.",
    prompt: `Clip video prompt for Clip 09 · Logs Reveal the Catastrophe.
Duration target: 10s, 16:9 cinematic 3D animated dark comedy style.
Characters: Chloe, Bob, Leo, Tangelo. Use connected character references; do not redesign.
Bob continuity: Bob keeps both hands visible and empty throughout this episode.
Setting: B7 Core Server Room.
Scene visual continuity lock: ${sceneLock("normal")}
Initial state: Leo has the Day 1 logs open; Tangelo's body still sprawls over part of the keyboard.
Global shot rules: keep one continuous room geography, readable screen direction, visible-subject framing, and clear foreground/midground/background depth.
Story goal: Visual logs establish accidental cat-keyboard commands, then Chloe voices the awful realization.

Shot beats, follow in exact order:
S1: Shot: close-up; over-shoulder to monitor; static hold; 85mm; Red and green log lines scroll, showing absurd cat-triggered commands without requiring readable rendered text.
S2: Shot: insert; eye-level; static hold; 85mm; Tangelo's tail lazily thwacks the keyboard beside the monitor glow.
S3: Exact dialogue: Chloe: “..So you're telling me, there was no master extinction plan. No 'New Era of Purification.' Just this fatass cat stepping on the console because it wanted a fish treat, and then sitting its heavy ass on the Enter key for six months?”; Shot: close-up; eye-level; slow push-in; 85mm; Chloe stares at the screen, jaw clenched, anger turning into disbelief.
S4: Shot: medium; eye-level; static hold; 50mm; Bob and Leo react behind Chloe while Tangelo purrs innocently on the console.

Do not add subtitles, speech bubbles, UI, panel borders, panel numbers, watermarks, or explanatory text.`,
  },
  "clip-010": {
    duration: 9,
    title: "Clip 10 · Leo Explains the Iterations",
    plotGoal: "Leo explains that Tangelo's tail and rolling body accidentally iterated the virus and triggered the recall signal.",
    startState: "Starts with in B7 Core Server Room Chloe still absorbing the absurd Day 1 logs.",
    endState: "Ends with in B7 Core Server Room Chloe's worldview visibly shattering as Tangelo keeps purring.",
    prompt: `Clip video prompt for Clip 10 · Leo Explains the Iterations.
Duration target: 9s, 16:9 cinematic 3D animated dark comedy style.
Characters: Leo, Chloe, Bob, Tangelo. Use connected character references; do not redesign.
Bob continuity: Bob keeps both hands visible and empty throughout this episode.
Setting: B7 Core Server Room.
Scene visual continuity lock: ${sceneLock("normal")}
Initial state: The log reveal has landed; Chloe is stunned and angry, Bob is rattled, Leo remains deadpan.
Global shot rules: keep one continuous room geography, readable screen direction, visible-subject framing, and clear foreground/midground/background depth.
Story goal: Leo turns the catastrophe into a clinical explanation, making Chloe's despair worse.

Shot beats, follow in exact order:
S1: Exact dialogue: Leo: “Flawless closed-loop logic. In fact, just from the daily swishing of its tail, the virus has automatically iterated to Version 3276. The recall signal we intercepted? That was just it rolling over and squashing the 'Forced Assembly' shortcut key.”; Shot: medium; eye-level; static hold; 50mm; Leo points calmly at Tangelo's tail swishing over the keyboard.
S2: Shot: close-up; low angle; slow push-in; 85mm; Tangelo's tail brushes keys with casual precision, blue monitor light flickering over orange peel fur.
S3: Shot: close-up; eye-level; static hold; 85mm; Chloe looks down at Tangelo, eyes wide, anger collapsing into existential defeat.
S4: Shot: medium; eye-level; static hold; 50mm; Bob shakes his head in disbelief while Leo remains impossibly calm.

Do not add subtitles, speech bubbles, UI, panel borders, panel numbers, watermarks, or explanatory text.`,
  },
  "clip-011": {
    duration: 15,
    title: "Clip 11 · Abort Attempt Triggers Flash Freeze",
    plotGoal: "Chloe orders Leo to shut down the recall signal, Tangelo swats Leo's finger and accidentally triggers Produce Cold Storage Mode.",
    startState: "Starts with in B7 Core Server Room Chloe recovering from the revelation and pointing at the keyboard.",
    endState: "Ends with in B7 Core Server Room blue strobes and system speakers announce flash-freeze lockdown.",
    prompt: `Clip video prompt for Clip 11 · Abort Attempt Triggers Flash Freeze.
Duration target: 15s, 16:9 cinematic 3D animated dark comedy style.
Characters: Chloe, Leo, Bob, Tangelo, System. Use connected character references; do not redesign.
Bob continuity: Bob keeps both hands visible and empty throughout this episode.
Setting: B7 Core Server Room.
Scene visual continuity lock: ${sceneLock("normal")}
Initial state: Tangelo is sprawled across the main keyboard; Chloe points at the trapped red keyboard section; Leo holds his corporate delivery card and reaches toward the Abort button.
Global shot rules: keep one continuous room geography, readable screen direction, visible-subject framing, and clear foreground/midground/background depth.
Story goal: A simple shutdown attempt turns into a cat-toy reflex disaster and activates the freezer defense.

Shot beats, follow in exact order:
S1: Exact dialogue: Chloe: “Since we found the source, Leo, use your corporate delivery card and turn the damn recall signal off!”; Shot: medium; eye-level; handheld; 50mm; Chloe points aggressively at the red section of keyboard buried under Tangelo's fluff.
S2: Exact dialogue: Leo: “Understood.”; Shot: close-up; over-shoulder; static hold; 85mm; Leo extends his lemon finger toward the Abort button.
S3: Shot: close-up; eye-level; snap zoom; 85mm; Tangelo's leafy ears twitch and amber eyes lock onto Leo's moving finger like prey.
S4: Exact dialogue: Tangelo: “Meow!”; Shot: medium; low angle; fast handheld; 50mm; Tangelo launches up, twists mid-air, and swats Leo's hand off course.
S5: Shot: insert; eye-level; static hold; 85mm; Tangelo lands with its rear paws on a yellow skull-marked flip-switch; the switch clicks down.
S6: Exact dialogue: System: “[WARNING! High-Risk Heart Rate Invasion Detected.] [Executing automated defense module per Admin 'Tangelo' override: Produce Cold Storage Mode — Flash Freeze Initiated.] [Current Room Temp: 26°C. Target Temp: -15°C.] [Preservation commencing.]”; Shot: wide; eye-level; strobing blue light; 24mm; Warm light dies, blue strobes flood the room, and cold alarms begin.

Do not add subtitles, speech bubbles, UI, panel borders, panel numbers, watermarks, or explanatory text. The system line is spoken by loudspeaker; do not render it as readable screen text.`,
  },
  "clip-012": {
    duration: 15,
    title: "Clip 12 · Flash Freeze Panic and Admin Lockdown",
    plotGoal: "The freezer defense blasts the room. Bob panics about fruit frostbite, Chloe orders Leo to shut it off, and Leo explains the Admin Lockdown requires Tangelo's paw pads.",
    startState: "Starts with in B7 Core Server Room cold lockdown: blue strobes, vents opening, Tangelo near the console, Chloe/Bob/Leo caught in freezing air.",
    endState: "Ends with in B7 Core Server Room cold lockdown Leo pointing from the frozen console toward Tangelo's paw pads as Chloe and Bob shiver.",
    prompt: `Clip video prompt for Clip 12 · Flash Freeze Panic and Admin Lockdown.
Duration target: 15s, 16:9 cinematic 3D animated dark comedy style.
Characters: Bob, Chloe, Leo, Tangelo. Use connected character references; do not redesign.
Bob continuity: Bob keeps both hands visible and empty throughout this episode.
Setting: B7 Core Server Room - Cold Lockdown.
Scene visual continuity lock: ${sceneLock("cold")}
Initial state: Blue-white frost fog blasts from the ceiling vents; Tangelo is near the console; Chloe, Bob, and Leo are trapped beside the freezing mainframe.
Global shot rules: keep one continuous room geography, readable screen direction, visible-subject framing, and clear foreground/midground/background depth.
Story goal: The room becomes a giant freezer, the trio realizes they cannot shut it off, and the required unlock target is Tangelo's paw pads.

Shot beats, follow in exact order:
S1: Exact dialogue: Bob: “Flash freeze?!”; Shot: close-up; eye-level; handheld tremor; 85mm; Bob recoils under blue strobes, orange peel prickling with goosebumps behind his mask.
S2: Exact dialogue: Bob: “Cold storage?! We're fruit! Minus fifteen degrees will give us critical frostbite, tissue necrosis, and turn us into a puddle of shriveled mush!”; Shot: medium; eye-level; static hold; 50mm; Bob shivers violently, hands visible and empty, staring up at the vents.
S3: Shot: wide; low angle; fast push-in; 24mm; Four industrial ceiling vents blast open, flooding the server room with thick white frost-fog.
S4: Exact dialogue: Chloe: “Leo! Shut it off!”; Shot: close-up; eye-level; handheld; 85mm; Chloe hugs herself, peach shoulders darkening with frost as her teeth chatter.
S5: Exact dialogue: Leo: “The controls are locked.”; Shot: close-up; over-shoulder to console; static hold; 85mm; Leo checks the frozen controls, lemon rind stiffening.
S6: Exact dialogue: Leo: “By stepping on the manual switch, the console has entered 'Admin Lockdown.' It requires the biometric print of the root administrator—meaning Tangelo's paw pads—to unlock.”; Shot: medium; eye-level; slow push-in; 50mm; Leo gestures from the locked console toward Tangelo's paws while Chloe and Bob shiver in the cold fog.
S7: Shot: wide; eye-level; static hold; 24mm; The trio stands trapped between frosted server racks and the locked main console, breath clouds thick in the blue light.

Do not add subtitles, speech bubbles, UI, panel borders, panel numbers, watermarks, or explanatory text.`,
  },
};

const shotUpdates: Record<string, Partial<JsonRecord>> = {
  "shot-032": {
    dialogue: "Chloe: “You little.. you fuzzy little bastard! Do you have any idea what you've done?! You turned 90% of the global population into moldy zombies! You ruined my Friday night! My beanbag chair! My beer! I literally smell like sauerkraut and rotting meat right now! Get your fat ass up!”",
    subtitle: "Chloe: “You little.. you fuzzy little bastard! Do you have any idea what you've done?! You turned 90% of the global population into moldy zombies! You ruined my Friday night! My beanbag chair! My beer! I literally smell like sauerkraut and rotting meat right now! Get your fat ass up!”",
  },
  "shot-038": {
    dialogue: "Tangelo: “Meow~”",
    subtitle: "Tangelo: “Meow~”",
  },
  "shot-042": {
    dialogue: "Bob: “Chloe! Don't let its mind-control pollute your brain! That is high-dimensional cognitive hypnosis! Initiate the physical purge!”",
    subtitle: "Bob: “Chloe! Don't let its mind-control pollute your brain! That is high-dimensional cognitive hypnosis! Initiate the physical purge!”",
  },
  "shot-045": {
    dialogue: "Chloe: “Then you freakin' shoot it!”",
    subtitle: "Chloe: “Then you freakin' shoot it!”",
  },
  "shot-046": {
    dialogue: "Bob: “I.. I can't! I'm allergic to dander! And it's showing me its belly!”",
    subtitle: "Bob: “I.. I can't! I'm allergic to dander! And it's showing me its belly!”",
  },
  "shot-049": {
    dialogue: "Leo: “Look. These are the Day 1 system logs.”",
    subtitle: "Leo: “Look. These are the Day 1 system logs.”",
  },
  "shot-051": {
    dialogue: "Chloe: “..So you're telling me, there was no master extinction plan. No 'New Era of Purification.' Just this fatass cat stepping on the console because it wanted a fish treat, and then sitting its heavy ass on the Enter key for six months?”",
    subtitle: "Chloe: “..So you're telling me, there was no master extinction plan. No 'New Era of Purification.' Just this fatass cat stepping on the console because it wanted a fish treat, and then sitting its heavy ass on the Enter key for six months?”",
  },
  "shot-056": {
    dialogue: "Leo: “Flawless closed-loop logic. In fact, just from the daily swishing of its tail, the virus has automatically iterated to Version 3276. The recall signal we intercepted? That was just it rolling over and squashing the 'Forced Assembly' shortcut key.”",
    subtitle: "Leo: “Flawless closed-loop logic. In fact, just from the daily swishing of its tail, the virus has automatically iterated to Version 3276. The recall signal we intercepted? That was just it rolling over and squashing the 'Forced Assembly' shortcut key.”",
  },
  "shot-069": {
    dialogue: "System: “[WARNING! High-Risk Heart Rate Invasion Detected.] [Executing automated defense module per Admin 'Tangelo' override: Produce Cold Storage Mode — Flash Freeze Initiated.] [Current Room Temp: 26°C. Target Temp: -15°C.] [Preservation commencing.]”",
    subtitle: "System: “[WARNING! High-Risk Heart Rate Invasion Detected.] [Executing automated defense module per Admin 'Tangelo' override: Produce Cold Storage Mode — Flash Freeze Initiated.] [Current Room Temp: 26°C. Target Temp: -15°C.] [Preservation commencing.]”",
    description: "Warm lighting dies, replaced by blinding blue strobe lights. A loudspeaker system announces the full flash-freeze protocol.",
    action: "Blue strobes flood the room as the system voice announces flash-freeze lockdown.",
    durationSeconds: 3,
  },
  "shot-070": {
    title: "Bob Reacts to Flash Freeze",
    characters: ["Bob"],
    action: "Bob recoils under blue strobes, orange peel prickling with goosebumps.",
    dialogue: "Bob: “Flash freeze?!”",
    subtitle: "Bob: “Flash freeze?!”",
    description: "Bob shrieks from behind his mask as the flash-freeze protocol starts.",
    visualPrompt: "Close-up of Bob under blue strobe light, breath visible, orange peel goosebumps, gas mask on, hands visible and empty.",
    durationSeconds: 1,
  },
  "shot-071": {
    title: "Bob Explains Fruit Frostbite",
    characters: ["Bob", "Chloe", "Leo"],
    action: "Bob shivers violently and stares up at the ceiling vents.",
    dialogue: "Bob: “Cold storage?! We're fruit! Minus fifteen degrees will give us critical frostbite, tissue necrosis, and turn us into a puddle of shriveled mush!”",
    subtitle: "Bob: “Cold storage?! We're fruit! Minus fifteen degrees will give us critical frostbite, tissue necrosis, and turn us into a puddle of shriveled mush!”",
    description: "Bob panics about the biological danger of sub-zero cold to fruit bodies while Chloe and Leo react.",
    visualPrompt: "Medium shot in cold blue server room, Bob shaking behind mask with empty hands, Chloe and Leo turning toward the blasting vents.",
    durationSeconds: 3,
  },
  "shot-072": {
    title: "Freezer Vents Blast Open",
    characters: ["Chloe", "Bob", "Leo", "Tangelo"],
    action: "Four industrial ceiling vents blast open and flood the room with white frost-fog.",
    dialogue: "",
    subtitle: "",
    description: "Bone-chilling air pours from the ceiling, and frost begins coating the fiber optic cables and server racks.",
    visualPrompt: "Wide low-angle shot of B7 server room in blue-white lockdown light, four ceiling vents blasting thick frost fog, frosted golden cables, Tangelo near console.",
    durationSeconds: 2,
  },
  "shot-073": {
    title: "Chloe Orders Leo to Shut It Off",
    characters: ["Chloe", "Leo", "Bob"],
    action: "Chloe hugs herself, teeth chattering, and yells to Leo.",
    dialogue: "Chloe: “Leo! Shut it off!”",
    subtitle: "Chloe: “Leo! Shut it off!”",
    description: "Chloe shivers hard as frost darkens her peach shoulders and she orders Leo to stop the freezer system.",
    visualPrompt: "Close-up of Chloe in freezing blue fog, shotgun still with her, shoulders frosting and darkening, teeth chattering, Leo visible near console.",
    durationSeconds: 2,
  },
  "shot-074": {
    title: "Leo Finds Locked Controls",
    characters: ["Leo", "Chloe", "Bob"],
    action: "Leo checks the frozen console controls while his lemon rind stiffens.",
    dialogue: "Leo: “The controls are locked.”",
    subtitle: "Leo: “The controls are locked.”",
    description: "Leo steps back from the console, joints stiffening from the cold, and reports the lockout.",
    visualPrompt: "Over-shoulder close-up of Leo at frozen main console, blue lockout glow, frost on controls, Chloe and Bob shivering behind.",
    durationSeconds: 2,
  },
  "shot-075": {
    title: "Leo Explains Admin Lockdown",
    characters: ["Leo", "Chloe", "Bob", "Tangelo"],
    action: "Leo gestures from the locked console toward Tangelo's paws.",
    dialogue: "Leo: “By stepping on the manual switch, the console has entered 'Admin Lockdown.' It requires the biometric print of the root administrator—meaning Tangelo's paw pads—to unlock.”",
    subtitle: "Leo: “By stepping on the manual switch, the console has entered 'Admin Lockdown.' It requires the biometric print of the root administrator—meaning Tangelo's paw pads—to unlock.”",
    description: "Leo explains that Tangelo's paw pads are required to unlock the console while the cold fog thickens.",
    visualPrompt: "Medium shot, Leo pointing from frozen console toward Tangelo's paw pads, Chloe and Bob shivering, blue-white cold fog, frosted racks.",
    durationSeconds: 3,
  },
  "shot-076": {
    title: "Trio Trapped in Freezer Room",
    characters: ["Chloe", "Bob", "Leo", "Tangelo"],
    action: "Chloe, Bob, and Leo shiver beside the locked mainframe while Tangelo remains the needed administrator.",
    dialogue: "",
    subtitle: "",
    description: "The trio realizes they are trapped in the freezing server room until they can get Tangelo's paw pads onto the console.",
    visualPrompt: "Wide shot of Chloe, Bob, and Leo trapped among frosted server racks and locked console, Tangelo visible above or near the console, breath clouds thick.",
    durationSeconds: 1,
  },
};

function rewriteDirectorPrompt(shot: JsonRecord): string {
  const lines = [
    "Create a vertical 9-panel director storyboard for this shot.",
    `Shot title: ${text(shot.title)}`,
    `Setting: ${text(shot.setting)}`,
    Array.isArray(shot.characters) && shot.characters.length ? `Characters: ${shot.characters.join(", ")}` : "",
    `Action: ${text(shot.action)}`,
    text(shot.dialogue) ? `Dialogue to preserve exactly: ${text(shot.dialogue)}` : "",
    `Camera: ${text(shot.shotSize)}, ${text(shot.cameraAngle)}, ${text(shot.cameraMove)}, ${text(shot.lens)}, ${text(shot.aperture)}, ${text(shot.shutter)}, ${text(shot.iso)}.`,
    text(shot.composition) ? `Composition: ${text(shot.composition)}` : "",
    text(shot.visualPrompt) ? `Visual prompt: ${text(shot.visualPrompt)}` : "",
    text(shot.references) ? `References: ${text(shot.references)}` : "",
    "Requirements: no explanatory paragraphs, clear action continuity, consistent character positions, readable blocking, professional previsualization storyboard, keep dialogue language unchanged.",
  ].filter(Boolean);
  return lines.join("\n");
}

function referenceNodesForGeneration(nodes: JsonRecord[], generationNode: JsonRecord): JsonRecord[] {
  return nodes.filter((node) => node.type === "imageInput" && node.parentId === generationNode.parentId && node.data?.positioningBoardFlow === true);
}

function referenceLabels(refs: JsonRecord[]): string[] {
  return refs.map((ref) => text(ref.data?.assetName || ref.data?.label || ref.data?.name)).filter(Boolean);
}

function visibleCharacterNames(refs: JsonRecord[], clip: JsonRecord): string[] {
  const fromRefs = refs
    .filter((ref) => text(ref.data?.assetKind) === "characters")
    .map((ref) => text(ref.data?.assetName || ref.data?.label || ref.data?.name))
    .filter(Boolean);
  const fromClip = Array.isArray(clip.characters) ? clip.characters.map(text).filter(Boolean) : [];
  return [...new Set([...fromRefs, ...fromClip])];
}

function sceneLockName(refs: JsonRecord[], clip: JsonRecord): string {
  const sceneRef = refs.find((ref) => text(ref.data?.assetKind) === "scenes");
  return text(sceneRef?.data?.assetName || sceneRef?.data?.label || sceneRef?.data?.name || clip.setting);
}

function updateCanvasVideoNode(node: JsonRecord, clipId: string, prompt: string, duration: number, title?: string) {
  const data = node.data || {};
  data.prompt = prompt;
  data.videoPrompt = prompt;
  data.seedancePrompt = prompt;
  data.duration = duration;
  data.durationSeconds = duration;
  if (title) data.title = title;
  node.data = data;
}

function updateStoryboardNode(node: JsonRecord, prompt: string, title?: string) {
  const data = node.data || {};
  data.prompt = prompt;
  data.finalPrompt = prompt;
  data.storyboardPrompt = prompt;
  data.positioningPrompt = prompt;
  if (title) {
    data.title = `${title} · storyboard board`;
    data.clipTitle = title;
  }
  node.data = data;
}

function hasSpeakerlessExactDialogue(prompt: string): boolean {
  return prompt
    .split("\n")
    .filter((line) => /Exact dialogue:/i.test(line))
    .some((line) => !/Exact dialogue:\s*[^:：;\n]{1,60}[:：]\s*[“"][\s\S]+[”"]/i.test(line));
}

async function main() {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, metadata: true } });
  if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);

  const metadata = project.metadata;
  const episode = metadata.episodes?.[episodeId];
  const workflow = episode?.workflowCenter;
  const canvas = metadata.canvasScenes?.[episodeId];
  if (!workflow || !canvas) throw new Error(`Missing ${episodeId} workflow or canvas`);

  const clips: JsonRecord[] = Array.isArray(workflow.clips) ? workflow.clips : [];
  const breakdownScenes: JsonRecord[] = Array.isArray(workflow.breakdownScenes) ? workflow.breakdownScenes : [];
  const nodes: JsonRecord[] = Array.isArray(canvas.nodes) ? canvas.nodes : [];

  let clipUpdates = 0;
  for (const clip of clips) {
    const replacement = prompts[clip.id];
    if (!replacement) continue;
    if (replacement.title) clip.title = replacement.title;
    clip.seedancePrompt = replacement.prompt;
    clip.estimatedDuration = replacement.duration;
    clip.targetDuration = replacement.duration;
    clip.maxDuration = Math.max(replacement.duration, clip.maxDuration || replacement.duration);
    if (replacement.plotGoal) clip.plotGoal = replacement.plotGoal;
    if (replacement.startState) clip.startState = replacement.startState;
    if (replacement.endState) clip.endState = replacement.endState;
    if (replacement.shotIds) clip.shotIds = replacement.shotIds;
    clipUpdates += 1;
  }

  let shotUpdatesCount = 0;
  for (const shot of breakdownScenes) {
    const update = shotUpdates[shot.id];
    if (!update) continue;
    Object.assign(shot, update);
    shot.directorBoardPrompt = rewriteDirectorPrompt(shot);
    shotUpdatesCount += 1;
  }

  let videoNodeUpdates = 0;
  let storyboardNodeUpdates = 0;
  for (const node of nodes) {
    const clipId = text(node.data?.clipId);
    const replacement = prompts[clipId];
    if (!replacement) continue;

    if (node.type === "video" || node.id === `episode-sync-video-node-${episodeId}-${clipId}`) {
      updateCanvasVideoNode(node, clipId, replacement.prompt, replacement.duration, replacement.title);
      videoNodeUpdates += 1;
      continue;
    }

    if (node.id === `clip-position-board-gen-${episodeId}-${clipId}` || text(node.data?.clipNodeKind) === "positioning-board-generator") {
      const clip = clips.find((item) => item.id === clipId);
      if (!clip) continue;
      const shotIds = new Set(Array.isArray(clip.shotIds) ? clip.shotIds.map(String) : []);
      const shots = breakdownScenes.filter((shot) => shotIds.has(String(shot.id)));
      const refs = referenceNodesForGeneration(nodes, node);
      const prompt = buildClipPositioningBoardPrompt({
        projectName: text(project.name || metadata.projectTitle || "美式漫剧"),
        clip,
        shots,
        referenceLabels: referenceLabels(refs),
        visibleCharacterNames: visibleCharacterNames(refs, clip),
        sceneLockName: sceneLockName(refs, clip),
        sceneVisualLock: text(shots[0]?.sceneVisualLock || (clipId === "clip-012" ? sceneLock("cold") : sceneLock("normal"))),
        mode: text(node.data?.positioningBoardMode) === "positioning" ? "positioning" : "storyboard",
      });
      updateStoryboardNode(node, prompt, replacement.title || clip.title);
      storyboardNodeUpdates += 1;
    }
  }

  metadata.updatedAt = new Date().toISOString();
  episode.updatedAt = metadata.updatedAt;
  workflow.updatedAt = metadata.updatedAt;
  canvas.updatedAt = metadata.updatedAt;

  await prisma.project.update({ where: { id: projectId }, data: { metadata } });

  const repairedClips = clips.filter((clip) => prompts[clip.id]);
  const speakerless = repairedClips.filter((clip) => hasSpeakerlessExactDialogue(text(clip.seedancePrompt))).map((clip) => clip.id);
  const tooLong = repairedClips
    .map((clip) => ({ id: clip.id, length: text(clip.seedancePrompt).length }))
    .filter((item) => item.length > 4000);

  console.log(JSON.stringify({
    projectId,
    episodeId,
    clipUpdates,
    shotUpdates: shotUpdatesCount,
    videoNodeUpdates,
    storyboardNodeUpdates,
    clip07Duration: clips.find((clip) => clip.id === "clip-007")?.estimatedDuration,
    speakerlessExactDialogueClips: speakerless,
    over4000: tooLong,
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
