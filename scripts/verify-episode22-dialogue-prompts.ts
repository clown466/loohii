import { prisma } from "../server/src/lib/prisma";

const project = await prisma.project.findUnique({
  where: { id: "cmq8dw07r0003l00tewomnzwd" },
  select: { metadata: true },
});

const metadata = project?.metadata as any;
const workflow = metadata.episodes["episode-022"].workflowCenter;
const canvas = metadata.canvasScenes["episode-022"];
const whole = JSON.stringify({ workflow, canvas });

const stalePatterns = [
  "Exact dialogue: Meow~",
  "Exact dialogue: Then you freakin",
  "Exact dialogue: I.. I can't",
  "Exact dialogue: Look. These are",
  "Exact dialogue: Flawless closed-loop logic",
  "Exact dialogue:..So",
];

const expectedPatterns = [
  "Bob: “Flash freeze?!”",
  "Bob: “Cold storage?! We're fruit! Minus fifteen degrees will give us critical frostbite, tissue necrosis, and turn us into a puddle of shriveled mush!”",
  "Chloe: “Leo! Shut it off!”",
  "Leo: “The controls are locked.”",
  "Leo: “By stepping on the manual switch, the console has entered 'Admin Lockdown.' It requires the biometric print of the root administrator—meaning Tangelo's paw pads—to unlock.”",
];

const repairedIds = ["clip-006", "clip-007", "clip-008", "clip-009", "clip-010", "clip-011", "clip-012"];
const clips = workflow.clips.filter((clip: any) => repairedIds.includes(clip.id));
const videoNodes = canvas.nodes.filter((node: any) => node.type === "video" && repairedIds.includes(node.data?.clipId));

function speakerlessExactDialogue(prompt: string): string[] {
  return (prompt.match(/Exact dialogue:[^\n]*/g) || [])
    .filter((line) => !/Exact dialogue:\s*[^:：;\n]{1,60}[:：]\s*[“"][\s\S]+[”"]/.test(line));
}

console.log(JSON.stringify({
  stalePatterns: stalePatterns.map((pattern) => ({ pattern, found: whole.includes(pattern) })),
  expectedPatterns: expectedPatterns.map((pattern) => ({ pattern: pattern.slice(0, 72), found: whole.includes(pattern) })),
  clipLengths: clips.map((clip: any) => ({
    id: clip.id,
    duration: clip.estimatedDuration,
    chars: String(clip.seedancePrompt || "").length,
    speakerless: speakerlessExactDialogue(String(clip.seedancePrompt || "")),
  })),
  videoNodeLengths: videoNodes.map((node: any) => ({
    id: node.id,
    duration: node.data?.duration,
    durationSeconds: node.data?.durationSeconds,
    chars: String(node.data?.prompt || "").length,
    speakerless: speakerlessExactDialogue(String(node.data?.prompt || "")),
  })),
}, null, 2));

await prisma.$disconnect();
