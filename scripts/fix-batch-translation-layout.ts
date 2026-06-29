import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type CanvasNode = {
  id?: unknown;
  type?: unknown;
  parentId?: unknown;
  position?: unknown;
  width?: unknown;
  height?: unknown;
  measured?: unknown;
  style?: unknown;
  data?: unknown;
};

type CanvasEdge = {
  source?: unknown;
  target?: unknown;
};

type CanvasScene = {
  nodes?: unknown;
  edges?: unknown;
  updatedAt?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function nodePosition(node: CanvasNode): { x: number; y: number } {
  const position = isRecord(node.position) ? node.position : {};
  return {
    x: numberValue(position.x) ?? 0,
    y: numberValue(position.y) ?? 0,
  };
}

function nodeAbsolutePosition(node: CanvasNode, nodeById: Map<string, CanvasNode>, seen = new Set<string>()): { x: number; y: number } {
  const current = nodePosition(node);
  const id = stringValue(node.id);
  const parentId = stringValue(node.parentId);
  if (!parentId || seen.has(id)) return current;
  const parent = nodeById.get(parentId);
  if (!parent) return current;
  seen.add(id);
  const parentPosition = nodeAbsolutePosition(parent, nodeById, seen);
  return {
    x: parentPosition.x + current.x,
    y: parentPosition.y + current.y,
  };
}

function nodeWidth(node: CanvasNode): number {
  const measured = isRecord(node.measured) ? node.measured : {};
  const style = isRecord(node.style) ? node.style : {};
  return numberValue(node.width) ?? numberValue(measured.width) ?? numberValue(style.width) ?? (node.type === "video" ? 520 : 260);
}

function isBatchTranslationNode(node: CanvasNode): boolean {
  const id = stringValue(node.id);
  const data = isRecord(node.data) ? node.data : {};
  return node.type === "translation" && (data.batchTranslation === true || id.startsWith("batch-translation-node-") || Boolean(stringValue(data.sourceNodeId)));
}

function translationSourceId(node: CanvasNode, edges: CanvasEdge[]): string {
  const data = isRecord(node.data) ? node.data : {};
  const sourceNodeId = stringValue(data.sourceNodeId);
  if (sourceNodeId) return sourceNodeId;
  const id = stringValue(node.id);
  return stringValue(edges.find((edge) => stringValue(edge.target) === id)?.source);
}

function fixScene(scene: CanvasScene): { scene: CanvasScene; changed: boolean; moved: number } {
  const nodes = Array.isArray(scene.nodes) ? scene.nodes.filter(isRecord) as CanvasNode[] : [];
  const edges = Array.isArray(scene.edges) ? scene.edges.filter(isRecord) as CanvasEdge[] : [];
  if (!nodes.length) return { scene, changed: false, moved: 0 };

  const nodeById = new Map(nodes.map((node) => [stringValue(node.id), node]).filter(([id]) => Boolean(id)));
  let moved = 0;
  const nextNodes = nodes.map((node) => {
    if (!isBatchTranslationNode(node)) return node;
    const sourceId = translationSourceId(node, edges);
    const source = sourceId ? nodeById.get(sourceId) : undefined;
    if (!source) return node;

    const sourcePosition = nodeAbsolutePosition(source, nodeById);
    const nextPosition = {
      x: sourcePosition.x + nodeWidth(source) + 120,
      y: sourcePosition.y,
    };
    const currentPosition = nodePosition(node);
    if (currentPosition.x === nextPosition.x && currentPosition.y === nextPosition.y) return node;
    moved += 1;
    return {
      ...node,
      position: nextPosition,
      style: {
        ...(isRecord(node.style) ? node.style : {}),
        width: numberValue(isRecord(node.style) ? node.style.width : undefined) ?? 520,
      },
    };
  });

  if (!moved) return { scene, changed: false, moved: 0 };
  return {
    scene: {
      ...scene,
      nodes: nextNodes,
      edges,
      updatedAt: new Date().toISOString(),
    },
    changed: true,
    moved,
  };
}

async function main() {
  const projects = await prisma.project.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, metadata: true },
  });

  let changedProjects = 0;
  let changedScenes = 0;
  let movedNodes = 0;

  for (const project of projects) {
    const metadata = isRecord(project.metadata) ? project.metadata : {};
    const canvasScenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : {};
    const nextCanvasScenes: Record<string, unknown> = { ...canvasScenes };
    let projectChanged = false;

    for (const [sceneId, rawScene] of Object.entries(canvasScenes)) {
      if (!isRecord(rawScene)) continue;
      const result = fixScene(rawScene as CanvasScene);
      if (!result.changed) continue;
      nextCanvasScenes[sceneId] = result.scene;
      projectChanged = true;
      changedScenes += 1;
      movedNodes += result.moved;
      console.log(`moved ${result.moved} translation node(s): ${project.name} / ${sceneId}`);
    }

    if (!projectChanged) continue;
    await prisma.project.update({
      where: { id: project.id },
      data: {
        metadata: {
          ...metadata,
          canvasScenes: nextCanvasScenes,
        },
      },
    });
    changedProjects += 1;
  }

  console.log(`done: changedProjects=${changedProjects}, changedScenes=${changedScenes}, movedNodes=${movedNodes}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
