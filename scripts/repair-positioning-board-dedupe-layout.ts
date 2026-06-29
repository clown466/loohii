/**
 * Repair positioning-board / storyboard sections:
 *   1. (optional, --dedupe) remove duplicate reference image nodes (same asset added
 *      multiple times across re-syncs), keeping one linked copy per asset.
 *   2. Lay the kept reference nodes on a grid sized to their REAL footprint (340 wide),
 *      with the storyboard/positioning generation node to the right.
 *   3. Right-align the section so its right edge sits a fixed gutter left of the matching
 *      video board, and size the section to fit (height-aware, stays within the row pitch).
 *
 * Race-safe: re-reads metadata inside a FOR UPDATE transaction and replaces only the
 * targeted episode canvas scenes, so concurrent edits to other episodes are preserved.
 *
 * Usage:
 *   tsx scripts/repair-positioning-board-dedupe-layout.ts <projectId> <episodeId...> [--dedupe] [--dry-run]
 */
import { prisma } from "../server/src/lib/prisma";

const rawArgs = process.argv.slice(2);
const flags = new Set(rawArgs.filter((a) => a.startsWith("--")));
const positional = rawArgs.filter((a) => !a.startsWith("--"));
const projectId = positional[0] || "cmq8dw07r0003l00tewomnzwd";
const episodeIds = positional.slice(1);
const DEDUPE = flags.has("--dedupe");
const DRY_RUN = flags.has("--dry-run");

// Layout constants matched to the REAL rendered node footprint.
const PADDING_X = 12;
const HEADER_HEIGHT = 42;
const PADDING_BOTTOM = 8;
const REF_NODE_WIDTH = 340; // preferredImageInputNodeWidth for landscape references
const REF_ROW_HEIGHT = 300; // max preferredImageInputNodeHeight (ratio 1.45) — uniform row pitch
const REF_GAP_X = 16;
const REF_GAP_Y = 10;
const REF_ROWS_TARGET = 3; // keep sections within the video row pitch (~1104px)
const REF_MIN_COLUMNS = 3;
const REF_MAX_COLUMNS = 6;
const GEN_NODE_WIDTH = 420;
const GEN_NODE_HEIGHT = 560;
const TARGET_GAP = 24; // between reference grid and the generation node
const SECTION_GAP = 36; // between positioning section right edge and video section left edge

type NodeRecord = {
  id: string;
  type?: string;
  parentId?: string;
  position?: { x?: number; y?: number };
  width?: number;
  height?: number;
  measured?: unknown;
  style?: Record<string, unknown>;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

type EdgeRecord = { id?: string; source?: string; target?: string; [key: string]: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function kindOrder(kind: string): number {
  switch (kind) {
    case "characters": return 0;
    case "scenes": return 1;
    case "props": return 2;
    default: return 3;
  }
}

function compareClipOrder(a: NodeRecord, b: NodeRecord): number {
  const orderA = numberValue(a.data?.clipOrder, Number.MAX_SAFE_INTEGER);
  const orderB = numberValue(b.data?.clipOrder, Number.MAX_SAFE_INTEGER);
  if (orderA !== orderB) return orderA - orderB;
  return numberValue(a.position?.y) - numberValue(b.position?.y);
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

/** Dedupe key for a reference node: kind + (assetId or normalized name). */
function refDedupeKey(node: NodeRecord): string {
  const kind = normalizeText(node.data?.assetKind);
  const id = normalizeText(node.data?.assetId);
  const name = normalizeText(node.data?.assetName ?? node.data?.label);
  return `${kind}|${id || name}`;
}

function refHasImage(node: NodeRecord): boolean {
  return Boolean(normalizeText(node.data?.imageUrl)) || normalizeText(node.data?.uploadStatus) === "linked";
}

type SectionReport = {
  clipId: string;
  totalRefs: number;
  keptRefs: number;
  removedRefs: number;
  columns: number;
  rows: number;
  sectionWidth: number;
  sectionHeight: number;
  sectionX: number;
  sectionY: number;
};

function repairScene(nodesInput: unknown[], edgesInput: unknown[]): {
  nodes: NodeRecord[];
  edges: EdgeRecord[];
  changed: boolean;
  removedNodeIds: string[];
  sections: SectionReport[];
} {
  const nodes = nodesInput.filter(isRecord) as NodeRecord[];
  const edges = (Array.isArray(edgesInput) ? edgesInput.filter(isRecord) : []) as EdgeRecord[];
  const sections = nodes
    .filter((node) => node.type === "section" && node.data?.positioningBoardFlow === true)
    .sort(compareClipOrder);

  const removedNodeIds = new Set<string>();
  const reports: SectionReport[] = [];
  let changed = false;

  for (const section of sections) {
    const children = nodes.filter((node) => node.parentId === section.id);
    const allRefs = children.filter((node) => node.type === "imageInput");
    const generations = children.filter((node) => node.type === "generation");

    // 1. Dedupe references (stable: keep first-seen, prefer a copy that has an image).
    const byKey = new Map<string, NodeRecord>();
    const orderedKept: NodeRecord[] = [];
    for (const ref of allRefs) {
      const key = refDedupeKey(ref);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, ref);
        orderedKept.push(ref);
        continue;
      }
      if (!DEDUPE) {
        // keep both, but they still need unique placement — treat as kept
        orderedKept.push(ref);
        continue;
      }
      // prefer the copy that has an image
      if (!refHasImage(existing) && refHasImage(ref)) {
        const idx = orderedKept.indexOf(existing);
        if (idx >= 0) orderedKept[idx] = ref;
        byKey.set(key, ref);
        removedNodeIds.add(existing.id);
      } else {
        removedNodeIds.add(ref.id);
      }
    }

    // stable, tidy order: by kind then name
    const keptRefs = orderedKept
      .filter((node) => !removedNodeIds.has(node.id))
      .sort((a, b) => {
        const ka = kindOrder(normalizeText(a.data?.assetKind));
        const kb = kindOrder(normalizeText(b.data?.assetKind));
        if (ka !== kb) return ka - kb;
        return normalizeText(a.data?.assetName).localeCompare(normalizeText(b.data?.assetName));
      });

    // 2. Grid layout for kept references.
    const n = keptRefs.length;
    const columns = Math.min(
      REF_MAX_COLUMNS,
      Math.max(REF_MIN_COLUMNS, Math.ceil(n / REF_ROWS_TARGET) || REF_MIN_COLUMNS),
    );
    keptRefs.forEach((node, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      node.position = {
        ...(node.position || {}),
        x: PADDING_X + col * (REF_NODE_WIDTH + REF_GAP_X),
        y: HEADER_HEIGHT + row * (REF_ROW_HEIGHT + REF_GAP_Y),
      };
      node.style = { ...(node.style || {}), width: REF_NODE_WIDTH };
      delete node.style.height; // let preferredImageInputNodeHeight drive the height
      delete node.width;
      delete node.height;
      delete node.measured;
      node.extent = "parent";
      node.expandParent = false;
      node.zIndex = 1;
    });

    const rows = Math.max(1, Math.ceil(n / columns));
    const refsRight = n > 0
      ? PADDING_X + columns * REF_NODE_WIDTH + Math.max(0, columns - 1) * REF_GAP_X
      : PADDING_X;
    const refsBottom = n > 0
      ? HEADER_HEIGHT + rows * REF_ROW_HEIGHT + Math.max(0, rows - 1) * REF_GAP_Y
      : HEADER_HEIGHT;

    // 3. Generation node(s) to the right of the grid.
    const genX = refsRight + TARGET_GAP;
    generations.forEach((node, index) => {
      node.position = {
        ...(node.position || {}),
        x: genX,
        y: HEADER_HEIGHT + index * (GEN_NODE_HEIGHT + REF_GAP_Y),
      };
      node.style = { ...(node.style || {}), width: GEN_NODE_WIDTH };
      node.extent = "parent";
      node.expandParent = false;
      node.zIndex = 1;
    });
    const genBottom = generations.length
      ? HEADER_HEIGHT + generations.length * GEN_NODE_HEIGHT + Math.max(0, generations.length - 1) * REF_GAP_Y
      : HEADER_HEIGHT;
    const genRight = generations.length ? genX + GEN_NODE_WIDTH : refsRight;

    const sectionWidth = Math.max(genRight, refsRight) + PADDING_X;
    const sectionHeight = Math.max(360, Math.max(refsBottom, genBottom) + PADDING_BOTTOM);

    // 4. Position the section: top-aligned to its video board, right edge a fixed gutter to its left.
    const videoSection = videoSectionFor(nodes, section);
    const nextX = videoSection
      ? numberValue(videoSection.position?.x) - sectionWidth - SECTION_GAP
      : numberValue(section.position?.x);
    const nextY = videoSection
      ? numberValue(videoSection.position?.y, numberValue(section.position?.y))
      : numberValue(section.position?.y);
    section.position = { ...(section.position || {}), x: nextX, y: nextY };
    section.style = { ...(section.style || {}), width: sectionWidth, height: sectionHeight };
    section.data = {
      ...(section.data || {}),
      itemCount: n + generations.length,
      description: "故事板/定位板图片流程：左侧参考图网格，右侧故事板生成节点，已自动去重并整理避免重叠。",
    };

    changed = true;
    reports.push({
      clipId: String(section.data?.clipId || section.id),
      totalRefs: allRefs.length,
      keptRefs: n,
      removedRefs: allRefs.length - n,
      columns,
      rows,
      sectionWidth,
      sectionHeight,
      sectionX: Math.round(nextX),
      sectionY: Math.round(nextY),
    });
  }

  const finalNodes = nodes.filter((node) => !removedNodeIds.has(node.id));
  const finalEdges = edges.filter((edge) => !removedNodeIds.has(String(edge.source)) && !removedNodeIds.has(String(edge.target)));

  return {
    nodes: finalNodes,
    edges: finalEdges,
    changed,
    removedNodeIds: [...removedNodeIds],
    sections: reports,
  };
}

async function main() {
  const summary = await prisma.$transaction(async (tx: any) => {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
    if (!project || !isRecord(project.metadata)) throw new Error(`Project not found: ${projectId}`);

    const metadata = project.metadata as Record<string, any>;
    const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
    const targets = episodeIds.length > 0 ? episodeIds : Object.keys(canvasScenes);

    const perEpisode: Record<string, any> = {};
    let scenesChanged = 0;
    let totalRemoved = 0;

    for (const episodeId of targets) {
      const scene = canvasScenes[episodeId];
      if (!isRecord(scene) || !Array.isArray(scene.nodes)) continue;
      const result = repairScene(scene.nodes, Array.isArray(scene.edges) ? scene.edges : []);
      if (!result.changed) continue;
      scene.nodes = result.nodes;
      scene.edges = result.edges;
      scene.updatedAt = new Date().toISOString();
      scenesChanged += 1;
      totalRemoved += result.removedNodeIds.length;
      perEpisode[episodeId] = {
        removedNodes: result.removedNodeIds.length,
        sections: result.sections,
      };
    }

    if (scenesChanged > 0 && !DRY_RUN) {
      metadata.updatedAt = new Date().toISOString();
      await tx.project.update({ where: { id: projectId }, data: { metadata } });
    }

    return { projectId, dedupe: DEDUPE, dryRun: DRY_RUN, targets, scenesChanged, totalRemoved, perEpisode };
  }, { maxWait: 20000, timeout: 120000 });

  console.log(JSON.stringify(summary, null, 2));
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
