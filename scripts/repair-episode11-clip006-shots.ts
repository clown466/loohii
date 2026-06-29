import { prisma } from "../server/src/lib/prisma";
import { workflowMaintenanceInternals } from "../server/src/routes/workflows";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeId = process.argv[3] || "episode-011";
const clipId = process.argv[4] || "clip-006";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const project = await prisma.project.findUnique({
  where: { id: projectId },
  select: { id: true, metadata: true },
});

if (!project) {
  console.error(`Project not found: ${projectId}`);
  process.exit(1);
}

const metadata = isRecord(project.metadata) ? project.metadata : {};
const workflow = workflowMaintenanceInternals.getWorkflowState(metadata, episodeId);
const clipIndex = workflow.clips.findIndex((clip) => clip.id === clipId);
if (clipIndex < 0) {
  console.error(`Clip not found: ${clipId}`);
  process.exit(1);
}

const repairedShots = [
  {
    id: "shot-041",
    title: "Flora studies Chloe",
    description: "Flora's cold attention shifts from the ritual stage to Chloe in the front row.",
    action: "Flora leans over the podium and fixes an icy stare on Chloe; Chloe stiffens under the attention.",
    dialogue:
      "Flora: Your soul, so full of fury and defiance, is exactly the primal engine the Earth Mother craves. Even in the face of terror, your heart rate erupts with astonishing power.",
    shotSize: "medium close-up",
    cameraAngle: "slight low angle",
    cameraMove: "slow push-in",
    composition: "Flora high on the ritual stage screen-right, Chloe seated front-left below her, Bob and Leo flanking Chloe.",
    lens: "50mm",
    references: "Use linked images; Flora dominates from the podium, Chloe left front row, Bob and Leo beside her.",
    visualPrompt: "Flora locks eyes with Chloe from the podium; Chloe freezes, Bob and Leo tense on either side.",
  },
  {
    id: "shot-042",
    title: "Chloe receives the accusation",
    description: "Chloe processes Flora's praise like a threat, unable to hide her defiance.",
    action: "Chloe's shoulders tighten; she keeps her chin raised while her eyes flick toward the blocked aisles.",
    dialogue: "",
    shotSize: "close-up",
    cameraAngle: "eye-level",
    cameraMove: "static hold",
    composition: "Chloe foreground left facing screen-right, Flora blurred high in the background, Bob and Leo at frame edges.",
    lens: "85mm",
    references: "Chloe remains left front row under scrutiny; blocked aisles stay visible behind her.",
    visualPrompt: "Close on Chloe's tense defiant face; Bob and Leo hover at frame edges, worried.",
  },
  {
    id: "shot-043",
    title: "Bob and Leo react",
    description: "Bob and Leo realize Flora has singled Chloe out.",
    action: "Bob glances from Chloe to Flora; Leo freezes with the pizza gear held close, both trying not to draw attention.",
    dialogue: "",
    shotSize: "medium shot",
    cameraAngle: "over-shoulder",
    cameraMove: "small lateral slide",
    composition: "Over Chloe's shoulder toward Bob center and Leo right, Flora's stage light cutting across them.",
    lens: "50mm",
    references: "Bob and Leo stay beside Chloe; Leo's carried delivery gear remains with him.",
    visualPrompt: "Bob and Leo tense beside Chloe, eyes tracking Flora's stare from the stage.",
  },
  {
    id: "shot-044",
    title: "Flora intensifies the sermon",
    description: "Flora turns the compliment into ritual judgment.",
    action: "Flora raises one hand over the podium, voice swelling with ceremonial certainty as she points down at Chloe.",
    dialogue: "",
    shotSize: "close-up",
    cameraAngle: "low angle",
    cameraMove: "slow push-in",
    composition: "Flora fills the upper frame at the podium, Chloe small below in the foreground line of sight.",
    lens: "85mm",
    references: "Flora remains on the ritual stage with the podium; Chloe stays front-left below.",
    visualPrompt: "Low close-up of Flora pointing from the podium, theatrical and severe, Chloe small below.",
  },
  {
    id: "shot-045",
    title: "Cultists focus on Chloe",
    description: "The surrounding cultists silently accept Flora's choice.",
    action: "Celery cultists in the aisles pivot their heads toward Chloe in a quiet wave, tightening the space around her.",
    dialogue: "",
    shotSize: "wide shot",
    cameraAngle: "eye-level",
    cameraMove: "slow pan",
    composition: "Chloe front-left as the visual target, cultists forming aisle walls, Flora elevated screen-right.",
    lens: "24mm",
    references: "Use Celery Cultist linked image repeated as crowd; keep Chloe left front row.",
    visualPrompt: "Wide ritual hall view as celery cultists turn toward Chloe, aisles narrowing around her.",
  },
  {
    id: "shot-046",
    title: "Chloe hides panic with defiance",
    description: "Chloe tries to stay tough while the room closes in.",
    action: "Chloe swallows the panic, sets her jaw, and grips the edge of her seat instead of backing down.",
    dialogue: "",
    shotSize: "close-up",
    cameraAngle: "eye-level",
    cameraMove: "static hold",
    composition: "Chloe centered left, cultist silhouettes behind her, Bob and Leo partially visible beside her.",
    lens: "85mm",
    references: "Chloe keeps the same front-row position; Bob and Leo remain beside her.",
    visualPrompt: "Chloe's defiant close-up, jaw tight, hands gripping the seat as cultists loom behind.",
  },
  {
    id: "shot-047",
    title: "Flora names Chloe the core",
    description: "Flora delivers the final selection line directly to Chloe.",
    action: "Flora extends both hands toward Chloe as if presenting her to the sanctuary.",
    dialogue: "Flora: You are the perfect beating core for our Sanctuary.",
    shotSize: "medium close-up",
    cameraAngle: "low angle",
    cameraMove: "controlled push-in",
    composition: "Flora screen-right on the podium, Chloe foreground left in Flora's pointing line, crowd framing both sides.",
    lens: "50mm",
    references: "Flora speaks from the podium; Chloe remains the selected target in the front row.",
    visualPrompt: "Flora ceremonially presents Chloe as the chosen core, hands extended from the podium.",
  },
  {
    id: "shot-048",
    title: "Chloe's fate lands",
    description: "The room absorbs Flora's declaration before the cultists act.",
    action: "A silent beat lands on Chloe's face; Bob and Leo tense beside her as the cultists hold their stare.",
    dialogue: "",
    shotSize: "close-up",
    cameraAngle: "eye-level",
    cameraMove: "slow push-in",
    composition: "Chloe front-left in sharp focus, Bob and Leo behind her shoulders, cultists as a still wall of eyes.",
    lens: "85mm",
    references: "End with Chloe selected, Bob and Leo beside her, cultists blocking aisles for the next clip.",
    visualPrompt: "Chloe absorbs the declaration in tense silence; Bob and Leo freeze beside her, cultists staring.",
  },
];

const shotUpdates = new Map(repairedShots.map((shot) => [shot.id, shot]));
const nextWorkflow = {
  ...workflow,
  clips: workflow.clips.map((clip, index) => index === clipIndex
    ? {
        ...clip,
        plotGoal: "Flora singles Chloe out as the living core of the sanctuary ritual.",
        startState: "Starts with Flora's attention narrowing from the ritual stage to Chloe in the front row.",
        endState: "Ends with Chloe selected as the sanctuary's core while Bob, Leo, and the cultists react in tense silence.",
        layoutMemory: [
          "Location: Gutted Produce Section Ritual Hall",
          "Characters: Flora high on the ritual stage screen-right; Chloe front-left below; Bob and Leo flank Chloe; Celery cultists form aisle walls.",
          "Start: Flora's attention narrows from the stage to Chloe.",
          "End: Chloe is selected as the sanctuary's core; Bob and Leo stay beside her; cultists hold their stare for the next clip.",
          "Keep screen direction, character side, important props, and aisle blockage continuous into the next clip.",
        ].join("\n"),
      }
    : clip),
  breakdownScenes: workflow.breakdownScenes.map((shot) => {
    const update = shotUpdates.get(shot.id);
    return update ? { ...shot, ...update } : shot;
  }),
  updatedAt: new Date().toISOString(),
};

const nextMetadata = workflowMaintenanceInternals.writeWorkflowEpisode(metadata, episodeId, nextWorkflow, true);
await prisma.project.update({
  where: { id: projectId },
  data: { metadata: nextMetadata },
});

console.log(JSON.stringify({
  projectId,
  episodeId,
  clipId,
  repairedShotIds: repairedShots.map((shot) => shot.id),
}, null, 2));

await prisma.$disconnect();
