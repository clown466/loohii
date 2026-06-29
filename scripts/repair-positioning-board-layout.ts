import { prisma } from "../server/src/lib/prisma";

const projectId = process.argv[2] || "cmq8dw07r0003l00tewomnzwd";
const episodeIds = process.argv.slice(3);

const SECTION_WIDTH = 1180;
const PADDING_X = 12;
const HEADER_HEIGHT = 42;
const PADDING_BOTTOM = 12;
const REF_WIDTH = 220;
const REF_HEIGHT = 180;
const REF_GAP_X = 18;
const REF_GAP_Y = 16;
const REF_COLUMNS = 3;
const GEN_WIDTH = 420;
const GEN_HEIGHT = 560;
const TARGET_GAP = 18;
const SECTION_GAP = 36;
const GEN_X = PADDING_X + REF_COLUMNS * REF_WIDTH + Math.max(0, REF_COLUMNS - 1) * REF_GAP_X + TARGET_GAP;

type NodeRecord = {
  id: string;
  type?: string;
  parentId?: string;
  position?: { x?: number; y?: number };
  style?: Record<string, unknown>;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function compareClipOrder(a: NodeRecord, b: NodeRecord): number {
  const orderA = numberValue(a.data?.clipOrder, Number.MAX_SAFE_INTEGER);
  const orderB = numberValue(b.data?.clipOrder, Number.MAX_SAFE_INTEGER);
  if (orderA !== orderB) return orderA - orderB;
  return numberValue(a.position?.y) - numberValue(b.position?.y);
}

function layoutSection(nodes: NodeRecord[], section: NodeRecord): { height: number; changed: number } {
  const children = nodes.filter((node) => node.parentId === section.id);
  const refs = children
    .filter((node) => node.type === "imageInput" && node.data?.positioningBoardFlow === true)
    .sort((a, b) => numberValue(a.position?.y) - numberValue(b.position?.y) || numberValue(a.position?.x) - numberValue(b.position?.x) || a.id.localeCompare(b.id));
  const generations = children
    .filter((node) => node.type === "generation" && node.data?.positioningBoardFlow === true)
    .sort((a, b) => a.id.localeCompare(b.id));

  let changed = 0;
  refs.forEach((node, index) => {
    const column = index % REF_COLUMNS;
    const row = Math.floor(index / REF_COLUMNS);
    node.position = {
      ...(node.position || {}),
      x: PADDING_X + column * (REF_WIDTH + REF_GAP_X),
      y: HEADER_HEIGHT + row * (REF_HEIGHT + REF_GAP_Y),
    };
    node.style = {
      ...(node.style || {}),
      width: REF_WIDTH,
      height: REF_HEIGHT,
    };
    node.extent = "parent";
    node.expandParent = false;
    node.zIndex = 1;
    changed += 1;
  });

  generations.forEach((node, index) => {
    node.position = {
      ...(node.position || {}),
      x: GEN_X,
      y: HEADER_HEIGHT + index * (GEN_HEIGHT + REF_GAP_Y),
    };
    node.style = {
      ...(node.style || {}),
      width: GEN_WIDTH,
    };
    node.extent = "parent";
    node.expandParent = false;
    node.zIndex = 1;
    changed += 1;
  });

  const refRows = Math.ceil(refs.length / REF_COLUMNS);
  const refHeight = refRows > 0
    ? refRows * REF_HEIGHT + Math.max(0, refRows - 1) * REF_GAP_Y
    : 0;
  const generationHeight = generations.length > 0
    ? generations.length * GEN_HEIGHT + Math.max(0, generations.length - 1) * REF_GAP_Y
    : 0;
  const height = Math.max(360, HEADER_HEIGHT + Math.max(refHeight, generationHeight) + PADDING_BOTTOM);

  section.style = {
    ...(section.style || {}),
    width: SECTION_WIDTH,
    height,
  };
  section.data = {
    ...(section.data || {}),
    description: "故事板/定位板图片流程；左侧为参考图网格，右侧为生成节点，已自动整理避免节点重叠。",
  };
  changed += 1;
  return { height, changed };
}

function videoSectionFor(nodes: NodeRecord[], section: NodeRecord): NodeRecord | null {
  const clipId = String(section.data?.clipId || "");
  if (!clipId) return null;
  const sourceEpisodeId = String(section.data?.sourceEpisodeId || "");
  return nodes.find((node) => (
    node.type === "section" &&
    node.data?.sectionKind === "clip-video-assets" &&
    String(node.data?.clipId || "") === clipId &&
    (!sourceEpisodeId || String(node.data?.sourceEpisodeId || "") === sourceEpisodeId)
  )) ?? nodes.find((node) => (
    node.type === "section" &&
    node.data?.sectionKind === "clip-video-assets" &&
    String(node.data?.clipId || "") === clipId
  )) ?? null;
}

const project = await prisma.project.findUnique({
  where: { id: projectId },
  select: { metadata: true },
});

if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);

const metadata = project.metadata;
const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
const targetEpisodes = episodeIds.length > 0 ? episodeIds : Object.keys(canvasScenes);

let scenesChanged = 0;
let sectionsChanged = 0;
let nodesChanged = 0;

for (const episodeId of targetEpisodes) {
  const scene = canvasScenes[episodeId];
  if (!isRecord(scene) || !Array.isArray(scene.nodes)) continue;
  const nodes = scene.nodes.filter(isRecord) as NodeRecord[];
  const sections = nodes
    .filter((node) => node.type === "section" && node.data?.positioningBoardFlow === true)
    .sort(compareClipOrder);
  if (!sections.length) continue;

  let yCursor: number | null = null;
  let sceneChanged = false;

  sections.forEach((section, index) => {
    const videoSection = videoSectionFor(nodes, section);
    const oldY = numberValue(section.position?.y, index === 0 ? 120 : 0);
    const nextY = videoSection ? numberValue(videoSection.position?.y, oldY) : (yCursor === null ? oldY : yCursor);
    const nextX = videoSection
      ? numberValue(videoSection.position?.x) - SECTION_WIDTH - SECTION_GAP
      : numberValue(section.position?.x);
    section.position = {
      ...(section.position || {}),
      x: nextX,
      y: nextY,
    };
    const { height, changed } = layoutSection(nodes, section);
    nodesChanged += changed;
    sectionsChanged += 1;
    sceneChanged = true;
    yCursor = nextY + height + 64;
  });

  if (sceneChanged) {
    scene.nodes = nodes;
    scene.updatedAt = new Date().toISOString();
    scenesChanged += 1;
  }
}

if (scenesChanged > 0) {
  metadata.updatedAt = new Date().toISOString();
  await prisma.project.update({ where: { id: projectId }, data: { metadata } });
}

console.log(JSON.stringify({
  projectId,
  targetEpisodes,
  scenesChanged,
  sectionsChanged,
  nodesChanged,
  layout: {
    sectionWidth: SECTION_WIDTH,
    referenceColumns: REF_COLUMNS,
    referenceNode: { width: REF_WIDTH, height: REF_HEIGHT },
    generationNode: { x: GEN_X, width: GEN_WIDTH },
  },
}, null, 2));

await prisma.$disconnect();
