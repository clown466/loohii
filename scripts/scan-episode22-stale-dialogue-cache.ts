import { prisma } from "../server/src/lib/prisma";

const project = await prisma.project.findUnique({
  where: { id: "cmq8dw07r0003l00tewomnzwd" },
  select: { metadata: true },
});

const metadata = project?.metadata as any;
const workflow = metadata.episodes["episode-022"].workflowCenter;
const canvas = metadata.canvasScenes["episode-022"];

const patterns = [
  "Exact dialogue: Meow~",
  "Exact dialogue: Then you freakin",
  "Exact dialogue: I.. I can't",
  "Exact dialogue: Look. These are",
  "Exact dialogue: Flawless closed-loop logic",
  "Exact dialogue:..So",
];

function scan(value: unknown, path: string, pattern: string, output: string[]) {
  if (typeof value === "string") {
    const index = value.indexOf(pattern);
    if (index >= 0) {
      output.push(`${path} = ${value.slice(Math.max(0, index - 80), index + 180).replace(/\n/g, "\\n")}`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => scan(item, `${path}[${index}]`, pattern, output));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    scan(item, `${path}.${key}`, pattern, output);
  }
}

for (const pattern of patterns) {
  const output: string[] = [];
  scan({ workflow, canvas }, "root", pattern, output);
  console.log(`PATTERN ${pattern} COUNT ${output.length}`);
  for (const item of output.slice(0, 30)) console.log(item);
}

await prisma.$disconnect();
