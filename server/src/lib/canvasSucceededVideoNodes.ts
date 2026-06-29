import { isRecord } from "./mappers";
import { prisma } from "./prisma";

export type CanvasVideoAssetRecord = {
  id: string;
  type?: string | null;
  url: string;
  mimeType?: string | null;
  durationMs?: number | null;
  deletedAt?: Date | string | null;
};

export type CanvasVideoGenerationRecord = {
  id: string;
  providerJobId?: string | null;
  assets?: CanvasVideoAssetRecord[];
};

type SuccessfulVideoEntry = {
  generation: CanvasVideoGenerationRecord;
  asset: CanvasVideoAssetRecord;
};

const CANVAS_VIDEO_GENERATION_ID_KEYS = [
  "generationId",
  "videoGenerationRequestId",
  "generationRequestId",
];

const CANVAS_VIDEO_SUBMIT_ID_KEYS = [
  "providerJobId",
  "submitId",
  "videoSubmitId",
];

export async function restoreSucceededCanvasVideoNodes(input: {
  projectId: string;
  userId?: string;
  nodes: unknown[];
}): Promise<{ nodes: unknown[]; changed: boolean }> {
  const refs = collectCanvasVideoGenerationReferences(input.nodes);
  if (refs.generationIds.length === 0 && refs.submitIds.length === 0) {
    return { nodes: input.nodes, changed: false };
  }

  const records = await prisma.generation.findMany({
    where: {
      projectId: input.projectId,
      ...(input.userId ? { userId: input.userId } : {}),
      status: "SUCCEEDED",
      OR: [
        ...(refs.generationIds.length ? [{ id: { in: refs.generationIds } }] : []),
        ...(refs.submitIds.length ? [{ providerJobId: { in: refs.submitIds } }] : []),
      ],
    },
    include: {
      assets: {
        where: { type: "VIDEO", deletedAt: null },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return restoreSucceededCanvasVideoNodesFromRecords(input.nodes, records);
}

export function restoreSucceededCanvasVideoNodesFromRecords<T extends unknown[]>(
  nodes: T,
  records: CanvasVideoGenerationRecord[],
): { nodes: T; changed: boolean } {
  const lookup = buildSuccessfulVideoLookup(records);
  if (lookup.byGenerationId.size === 0 && lookup.bySubmitId.size === 0) {
    return { nodes, changed: false };
  }

  let changed = false;
  const nextNodes = nodes.map((node) => {
    if (!isRecord(node) || !isCanvasVideoNode(node)) return node;
    const data = isRecord(node.data) ? node.data : {};
    const entry = findSuccessfulVideoEntry(data, lookup);
    if (!entry) return node;
    const nextData = restoredVideoNodeData(data, entry);
    if (!canvasVideoNodePatchChanged(data, nextData)) return node;
    changed = true;
    return { ...node, data: nextData };
  }) as T;

  return { nodes: changed ? nextNodes : nodes, changed };
}

function collectCanvasVideoGenerationReferences(nodes: unknown[]): { generationIds: string[]; submitIds: string[] } {
  const generationIds = new Set<string>();
  const submitIds = new Set<string>();
  for (const node of nodes) {
    if (!isRecord(node) || !isCanvasVideoNode(node)) continue;
    const data = isRecord(node.data) ? node.data : {};
    for (const key of CANVAS_VIDEO_GENERATION_ID_KEYS) {
      const value = stringValue(data[key]);
      if (value) generationIds.add(value);
    }
    for (const key of CANVAS_VIDEO_SUBMIT_ID_KEYS) {
      const value = stringValue(data[key]);
      if (value) submitIds.add(value);
    }
  }
  return {
    generationIds: Array.from(generationIds),
    submitIds: Array.from(submitIds),
  };
}

function buildSuccessfulVideoLookup(records: CanvasVideoGenerationRecord[]) {
  const byGenerationId = new Map<string, SuccessfulVideoEntry>();
  const bySubmitId = new Map<string, SuccessfulVideoEntry>();
  for (const generation of records) {
    const asset = (generation.assets ?? []).find(isUsableVideoAsset);
    if (!asset) continue;
    const entry = { generation, asset };
    byGenerationId.set(generation.id, entry);
    const providerJobId = stringValue(generation.providerJobId);
    if (providerJobId) bySubmitId.set(providerJobId, entry);
  }
  return { byGenerationId, bySubmitId };
}

function findSuccessfulVideoEntry(
  data: Record<string, unknown>,
  lookup: ReturnType<typeof buildSuccessfulVideoLookup>,
): SuccessfulVideoEntry | null {
  for (const key of CANVAS_VIDEO_GENERATION_ID_KEYS) {
    const entry = lookup.byGenerationId.get(stringValue(data[key]));
    if (entry) return entry;
  }
  for (const key of CANVAS_VIDEO_SUBMIT_ID_KEYS) {
    const entry = lookup.bySubmitId.get(stringValue(data[key]));
    if (entry) return entry;
  }
  return null;
}

function restoredVideoNodeData(
  data: Record<string, unknown>,
  entry: SuccessfulVideoEntry,
): Record<string, unknown> {
  const videoUrl = entry.asset.url.trim();
  const assetId = entry.asset.id;
  const submitId = stringValue(entry.generation.providerJobId) || stringValue(data.submitId) || stringValue(data.videoSubmitId);
  const durationSeconds = assetDurationSeconds(entry.asset.durationMs);
  const generatedVideo: Record<string, unknown> = {
    ...(isRecord(data.generatedVideo) ? data.generatedVideo : {}),
    url: videoUrl,
    assetId,
    generationId: entry.generation.id,
    mimeType: stringValue(entry.asset.mimeType) || "video/mp4",
    ...(submitId ? { submitId } : {}),
    ...(durationSeconds ? { durationSeconds } : {}),
  };

  return {
    ...data,
    status: "completed",
    videoStatus: "completed",
    generationStatus: "succeeded",
    statusLabel: "视频已完成",
    errorMessage: "",
    generationError: "",
    videoError: "",
    outputVideo: videoUrl,
    videoUrl,
    outputVideoAssetId: assetId,
    videoAssetId: assetId,
    assetId,
    generationId: entry.generation.id,
    videoGenerationRequestId: entry.generation.id,
    videoProviderStatus: "succeeded",
    ...(submitId ? { providerJobId: submitId, submitId, videoSubmitId: submitId } : {}),
    ...(durationSeconds ? { durationSeconds } : {}),
    generatedVideo,
  };
}

function canvasVideoNodePatchChanged(current: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(expected)) {
    if (key === "generatedVideo") continue;
    if (current[key] !== value) return true;
  }
  const currentGeneratedVideo = isRecord(current.generatedVideo) ? current.generatedVideo : {};
  const expectedGeneratedVideo = isRecord(expected.generatedVideo) ? expected.generatedVideo : {};
  for (const [key, value] of Object.entries(expectedGeneratedVideo)) {
    if (currentGeneratedVideo[key] !== value) return true;
  }
  return false;
}

function isCanvasVideoNode(node: Record<string, unknown>): boolean {
  const data = isRecord(node.data) ? node.data : {};
  return stringValue(node.type) === "video" || stringValue(data.workflowKind) === "video";
}

function isUsableVideoAsset(asset: CanvasVideoAssetRecord): boolean {
  return stringValue(asset.url) !== "" && stringValue(asset.type || "VIDEO") === "VIDEO" && !asset.deletedAt;
}

function assetDurationSeconds(durationMs: unknown): number | undefined {
  const value = Number(durationMs);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value / 1000);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
