import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { asyncRoute } from "../lib/asyncRoute";
import {
  normalizeCanvasStoryboardReferencesForScene,
  preserveExistingClipStoryboardSections,
  storyboardReferencesFromGenerationRecords,
} from "../lib/canvasStoryboardReferences";
import { buildEpisodeCanvasSyncScene, writeEpisodeCanvasSyncMetadata } from "../lib/episodeCanvasSync";
import { HttpError, notFound, routeParam } from "../lib/httpErrors";
import { isRecord } from "../lib/mappers";
import { prisma } from "../lib/prisma";
import { ok } from "../lib/response";
import { requireAuth } from "../middleware/auth";

const router = Router();

const canvasSchema = z.object({
  projectId: z.string().optional(),
  sceneId: z.string().optional(),
  nodes: z.array(z.record(z.string(), z.unknown())),
  edges: z.array(z.record(z.string(), z.unknown())),
  deletedNodeIds: z.array(z.string()).optional(),
  baseUpdatedAt: z.string().optional(),
});

const episodeCanvasSyncSchema = z.object({
  episodeId: z.string().max(180).optional(),
  generationStrategy: z.string().max(80).optional(),
});

router.use(requireAuth);

router.get(
  "/scenes/:projectId/:sceneId",
  asyncRoute(async (req, res) => {
    const projectId = routeParam(req.params.projectId, "projectId");
    const sceneId = routeParam(req.params.sceneId, "sceneId");
    const project = await findOwnedProject(projectId, req.user!.id);
    const metadata = isRecord(project.metadata) ? project.metadata : {};
    const canvasScenes = getCanvasScenes(metadata);
    const scene = canvasScenes[sceneId];
    const episodeId = resolveCanvasEpisodeId(metadata, sceneId);
    const storyboardRefs = await getStoryboardGenerationReferences(project.id, metadata, episodeId);
    const normalized = normalizeCanvasStoryboardReferencesForScene(
      Array.isArray(scene?.nodes) ? scene.nodes : [],
      Array.isArray(scene?.edges) ? scene.edges : [],
      metadata,
      storyboardRefs,
      episodeId,
    );
    const stable = sanitizeCanvasGraph(normalized.nodes, normalized.edges);
    const stableNodes = normalizeCanvasSectionChildren(stable.nodes);
    const normalizedChanged = normalized.changed || stable.changed || stableNodes !== stable.nodes;
    let updatedAt = scene?.updatedAt;
    if (normalizedChanged) {
      updatedAt = new Date().toISOString();
      await prisma.project.update({
        where: { id: project.id },
        data: {
          metadata: {
            ...metadata,
            canvasScenes: {
              ...canvasScenes,
              [sceneId]: {
                nodes: stableNodes,
                edges: stable.edges,
                updatedAt,
              },
            },
          },
        },
      });
    }
    ok(res, {
      projectId: project.id,
      sceneId,
      nodes: stableNodes,
      edges: stable.edges,
      updatedAt,
    });
  }),
);

router.put(
  "/scenes/:projectId/:sceneId",
  asyncRoute(async (req, res) => {
    const input = canvasSchema.parse(req.body);
    const projectId = routeParam(req.params.projectId, "projectId");
    const sceneId = routeParam(req.params.sceneId, "sceneId");
    const project = await findOwnedProject(projectId, req.user!.id);
    const metadata = isRecord(project.metadata) ? project.metadata : {};
    const canvasScenes = getCanvasScenes(metadata);
    const existingScene = canvasScenes[sceneId];
    if (isStaleCanvasSave(input.baseUpdatedAt, existingScene?.updatedAt)) {
      throw new HttpError(409, "画布已在其他页面更新。请刷新后再保存，避免旧页面把已删除节点写回来。");
    }
    const preserved = preserveExistingClipStoryboardSections(
      input.nodes,
      input.edges,
      Array.isArray(existingScene?.nodes) ? existingScene.nodes : [],
      Array.isArray(existingScene?.edges) ? existingScene.edges : [],
      input.deletedNodeIds ?? [],
    );
    const episodeId = resolveCanvasEpisodeId(metadata, sceneId);
    const storyboardRefs = await getStoryboardGenerationReferences(project.id, metadata, episodeId);
    const normalized = normalizeCanvasStoryboardReferencesForScene(preserved.nodes, preserved.edges, metadata, storyboardRefs, episodeId);
    const stable = sanitizeCanvasGraph(normalized.nodes, normalized.edges);
    const stableNodes = normalizeCanvasSectionChildren(stable.nodes);

    const nextScene = {
      nodes: stableNodes,
      edges: stable.edges,
      updatedAt: new Date().toISOString(),
    };

    await prisma.project.update({
      where: { id: project.id },
      data: {
        metadata: {
          ...metadata,
          canvasScenes: {
            ...canvasScenes,
            [sceneId]: nextScene,
          },
        },
      },
    });

    ok(res, {
      projectId: project.id,
      sceneId,
      ...nextScene,
    });
  }),
);

router.post(
  "/projects/:projectId/sync-episode",
  asyncRoute(async (req, res) => {
    const projectId = routeParam(req.params.projectId, "projectId");
    const input = episodeCanvasSyncSchema.parse(req.body);
    const project = await findOwnedProject(projectId, req.user!.id);
    const records = await prisma.generation.findMany({
      where: {
        projectId: project.id,
        status: "SUCCEEDED",
      },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { assets: true },
    });

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${project.id} FOR UPDATE`;
      const currentProject = await tx.project.findUnique({
        where: { id: project.id },
        select: { metadata: true },
      });
      const metadata = isRecord(currentProject?.metadata) ? currentProject.metadata : {};
      const canvasScenes = getCanvasScenes(metadata);
      const targetEpisodeId = input.episodeId || stringValue(metadata.activeEpisodeId) || resolveCanvasEpisodeId(metadata, "");
      const sync = buildEpisodeCanvasSyncScene({
        metadata,
        episodeId: targetEpisodeId,
        generationStrategy: input.generationStrategy,
        existingScene: canvasScenes[targetEpisodeId] ?? canvasScenes[resolveCanvasEpisodeId(metadata, targetEpisodeId)] ?? undefined,
        records,
      });
      const nextMetadata = writeEpisodeCanvasSyncMetadata({ metadata, sync, makeActive: true });
      await tx.project.update({
        where: { id: project.id },
        data: { metadata: nextMetadata as Prisma.InputJsonValue },
      });
      return { sync, metadata: nextMetadata };
    });

    ok(res, {
      projectId: project.id,
      sceneId: result.sync.sceneId,
      episodeId: result.sync.episodeId,
      nodes: result.sync.nodes,
      edges: result.sync.edges,
      updatedAt: result.sync.updatedAt,
      storyboardCount: result.sync.storyboardCount,
      videoCount: result.sync.videoCount,
      recoveredStoryboardCount: result.sync.recoveredStoryboardCount,
      workflow: workflowFromMetadata(result.metadata, result.sync.episodeId),
    });
  }),
);

async function findOwnedProject(projectId: string, ownerId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId, deletedAt: null },
  });
  if (!project) notFound("Project not found");
  return project;
}

function getCanvasScenes(metadata: unknown): Record<string, { nodes?: unknown[]; edges?: unknown[]; updatedAt?: string }> {
  if (!isRecord(metadata) || !isRecord(metadata.canvasScenes)) return {};
  return metadata.canvasScenes as Record<string, { nodes?: unknown[]; edges?: unknown[]; updatedAt?: string }>;
}

function normalizeCanvasSectionChildren<T extends Record<string, unknown>>(nodes: T[]): T[] {
  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (node.parentId && node.expandParent === true) {
      changed = true;
      return { ...node, expandParent: false };
    }
    return node;
  });
  return changed ? nextNodes : nodes;
}

function sanitizeCanvasGraph<T extends Record<string, unknown>, E extends Record<string, unknown>>(
  nodes: T[],
  edges: E[],
): { nodes: T[]; edges: E[]; changed: boolean } {
  const seenNodeIds = new Set<string>();
  const cleanNodes: T[] = [];
  let changed = false;
  for (const node of nodes) {
    const id = stringValue(node.id);
    if (id && seenNodeIds.has(id)) {
      changed = true;
      continue;
    }
    if (id) seenNodeIds.add(id);
    const normalizedNode = normalizeCanvasNodeImageUrls(node);
    if (normalizedNode !== node) changed = true;
    cleanNodes.push(normalizedNode);
  }

  const nodeIds = new Set(cleanNodes.map((node) => stringValue(node.id)).filter(Boolean));
  const seenEdgeIds = new Set<string>();
  const cleanEdges: E[] = [];
  for (const edge of edges) {
    const source = stringValue(edge.source);
    const target = stringValue(edge.target);
    if ((source && !nodeIds.has(source)) || (target && !nodeIds.has(target))) {
      changed = true;
      continue;
    }
    const edgeKey = stringValue(edge.id) || `${source}|${stringValue(edge.sourceHandle)}|${target}|${stringValue(edge.targetHandle)}`;
    if (edgeKey && seenEdgeIds.has(edgeKey)) {
      changed = true;
      continue;
    }
    if (edgeKey) seenEdgeIds.add(edgeKey);
    cleanEdges.push(edge);
  }

  return { nodes: changed ? cleanNodes : nodes, edges: changed ? cleanEdges : edges, changed };
}

function normalizeCanvasNodeImageUrls<T extends Record<string, unknown>>(node: T): T {
  if (!isRecord(node.data)) return node;
  let changed = false;
  const data = { ...node.data };
  for (const key of ["imageUrl", "outputImage", "avatar", "image", "referenceImageUrl", "generatedImageUrl", "clipSyncUrl"]) {
    const normalized = normalizeLocalPublicUploadUrl(data[key]);
    if (normalized !== data[key]) {
      data[key] = normalized;
      changed = true;
    }
  }
  return changed ? { ...node, data } : node;
}

function normalizeLocalPublicUploadUrl(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (/^\/api\/uploads\/public\//i.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (/^(localhost|127\.0\.0\.1)$/i.test(url.hostname) && /^\/api\/uploads\/public\//i.test(url.pathname)) {
      return `${url.pathname}${url.search}`;
    }
  } catch {
    return value;
  }
  return value;
}

async function getStoryboardGenerationReferences(projectId: string, metadata: unknown, episodeId: string) {
  const records = await prisma.generation.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { assets: true },
  });
  return storyboardReferencesFromGenerationRecords(records, metadata, episodeId);
}

function resolveCanvasEpisodeId(metadata: unknown, sceneId: string): string {
  if (!sceneId || sceneId === "default") return "";
  if (!isRecord(metadata) || !isRecord(metadata.episodes)) return sceneId;
  if (isRecord(metadata.episodes[sceneId])) return sceneId;
  for (const [episodeId, episode] of Object.entries(metadata.episodes)) {
    if (isRecord(episode) && episode.canvasSceneId === sceneId) return episodeId;
  }
  return sceneId;
}

function workflowFromMetadata(metadata: unknown, episodeId: string): Record<string, unknown> | null {
  if (!isRecord(metadata)) return null;
  const episodes = isRecord(metadata.episodes) ? metadata.episodes : {};
  const episode = isRecord(episodes[episodeId]) ? episodes[episodeId] : null;
  if (episode && isRecord(episode.workflowCenter)) return { ...episode.workflowCenter, episodeId };
  if (isRecord(metadata.workflowCenter)) return { ...metadata.workflowCenter, episodeId };
  return null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isStaleCanvasSave(baseUpdatedAt: string | undefined, existingUpdatedAt: string | undefined): boolean {
  if (!existingUpdatedAt) return false;
  if (!baseUpdatedAt) return true;
  const baseTime = Date.parse(baseUpdatedAt);
  const existingTime = Date.parse(existingUpdatedAt);
  if (!Number.isFinite(baseTime) || !Number.isFinite(existingTime)) return false;
  return baseTime < existingTime;
}

export const canvasRouter = router;
