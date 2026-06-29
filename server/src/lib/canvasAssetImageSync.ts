export type WorkflowAssetKind = "characters" | "scenes" | "props";

export interface WorkflowAssetCanvasImageChange {
  assetKind: WorkflowAssetKind;
  assetName: string;
  imageUrl: string;
  imageAssetId: string;
  episodeId?: string;
}

export interface WorkflowAssetCanvasImageResult {
  metadata: Record<string, unknown>;
  changedNodeCount: number;
}

export interface WorkflowAssetImageFillChange {
  assetKind: WorkflowAssetKind;
  assetName: string;
  field: "referenceImageUrl" | "generatedImageUrl";
  imageUrl: string;
  imageAssetId: string;
}

export interface WorkflowAssetImageFillResult {
  metadata: Record<string, unknown>;
  changedEpisodeIds: string[];
}

const MISSING_ASSET_IMAGE_ERROR = "该资产还没有参考图，请上传或生成后再生成视频。";

export function applyWorkflowAssetImageToCanvasScenes(
  metadata: Record<string, unknown>,
  change: WorkflowAssetCanvasImageChange,
  now: string,
): WorkflowAssetCanvasImageResult {
  const scenes = isRecord(metadata.canvasScenes) ? metadata.canvasScenes : null;
  if (!scenes) return { metadata, changedNodeCount: 0 };
  const targetName = normalizeCompareText(change.assetName);
  if (!targetName) return { metadata, changedNodeCount: 0 };
  const nextImageUrl = canvasSyncableImageUrl(change.imageUrl);
  const nextAssetId = stringValue(change.imageAssetId);
  let changedNodeCount = 0;
  let scenesChanged = false;
  const nextScenes: Record<string, unknown> = {};
  for (const [sceneId, sceneValue] of Object.entries(scenes)) {
    if (change.assetKind !== "characters" && change.episodeId && !canvasSceneMatchesEpisode(sceneId, change.episodeId)) {
      nextScenes[sceneId] = sceneValue;
      continue;
    }
    if (!isRecord(sceneValue) || !Array.isArray(sceneValue.nodes)) {
      nextScenes[sceneId] = sceneValue;
      continue;
    }
    let sceneChanged = false;
    const nextNodes = sceneValue.nodes.map((node: unknown) => {
      if (!isRecord(node) || node.type !== "imageInput" || !isRecord(node.data)) return node;
      const data = node.data;
      if (stringValue(data.assetKind) !== change.assetKind) return node;
      if (normalizeCompareText(data.assetName) !== targetName) return node;
      if (change.assetKind !== "characters" && change.episodeId) {
        const nodeEpisodeId = stringValue(data.sourceEpisodeId) || stringValue(data.episodeId);
        if (nodeEpisodeId && !canvasSceneMatchesEpisode(nodeEpisodeId, change.episodeId)) return node;
      }
      const currentImageUrl = stringValue(data.imageUrl);
      if (currentImageUrl && currentImageUrl !== stringValue(data.clipSyncUrl)) return node;
      const patch: Record<string, unknown> = {
        imageUrl: nextImageUrl,
        clipSyncUrl: nextImageUrl,
        assetId: nextAssetId,
        clipSyncAssetId: nextAssetId,
        uploadStatus: nextImageUrl ? "linked" : "missing",
        uploadError: nextImageUrl ? "" : MISSING_ASSET_IMAGE_ERROR,
        imageLoadError: false,
      };
      const unchanged = Object.entries(patch).every(([key, value]) => data[key] === value);
      if (unchanged) return node;
      sceneChanged = true;
      changedNodeCount += 1;
      return { ...node, data: { ...data, ...patch } };
    });
    if (sceneChanged) {
      scenesChanged = true;
      nextScenes[sceneId] = { ...sceneValue, nodes: nextNodes, updatedAt: now };
    } else {
      nextScenes[sceneId] = sceneValue;
    }
  }
  if (!scenesChanged) return { metadata, changedNodeCount: 0 };
  return { metadata: { ...metadata, canvasScenes: nextScenes }, changedNodeCount };
}

export function fillMissingAssetImageAcrossEpisodes(
  metadata: Record<string, unknown>,
  change: WorkflowAssetImageFillChange,
): WorkflowAssetImageFillResult {
  const imageUrl = stringValue(change.imageUrl);
  const episodes = isRecord(metadata.episodes) ? metadata.episodes : null;
  if (!imageUrl || !episodes) return { metadata, changedEpisodeIds: [] };
  // Only character identity images are safe to propagate by name across episodes.
  // Scenes and props often share generic names while differing by time of day,
  // geography, damage state, or embedding inside a scene. Copying them by name
  // causes visual-lock drift, e.g. a dusk highway plate reused for later night
  // overpass/highway scenes.
  if (change.assetKind !== "characters") return { metadata, changedEpisodeIds: [] };
  const targetName = normalizeCompareText(change.assetName);
  if (!targetName) return { metadata, changedEpisodeIds: [] };
  const assetIdField = change.field === "referenceImageUrl" ? "referenceImageAssetId" : "generatedImageAssetId";
  const changedEpisodeIds: string[] = [];
  const nextEpisodes: Record<string, unknown> = {};
  for (const [episodeId, episodeValue] of Object.entries(episodes)) {
    nextEpisodes[episodeId] = episodeValue;
    if (!isRecord(episodeValue) || !isRecord(episodeValue.workflowCenter)) continue;
    const workflow = episodeValue.workflowCenter;
    const assets = isRecord(workflow.assets) ? workflow.assets : null;
    const items = assets ? assets[change.assetKind] : null;
    if (!assets || !Array.isArray(items)) continue;
    let episodeChanged = false;
    const nextItems = items.map((item: unknown) => {
      if (!isRecord(item)) return item;
      const itemName = stringValue(item.name) || stringValue(item.title);
      if (normalizeCompareText(itemName) !== targetName) return item;
      if (stringValue(item.referenceImageUrl) || stringValue(item.generatedImageUrl)) return item;
      episodeChanged = true;
      return { ...item, [change.field]: imageUrl, [assetIdField]: change.imageAssetId };
    });
    if (!episodeChanged) continue;
    changedEpisodeIds.push(episodeId);
    nextEpisodes[episodeId] = {
      ...episodeValue,
      workflowCenter: {
        ...workflow,
        assets: { ...assets, [change.assetKind]: nextItems },
      },
    };
  }
  if (changedEpisodeIds.length === 0) return { metadata, changedEpisodeIds };
  return { metadata: { ...metadata, episodes: nextEpisodes }, changedEpisodeIds };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 以下工具函数复制自 server/src/lib/episodeCanvasSync.ts:1459-1486（约束：不修改该文件）；将来提取共享模块时需两处同步。
// 归一化为可同步到画布的公开图片 URL；data:/blob: 等不可同步的值返回空串。
export function canvasSyncableImageUrl(value: unknown): string {
  const url = stringValue(value);
  const localPublicPath = localPublicUploadPath(url);
  if (localPublicPath) return `https://loohii.com${localPublicPath}`;
  if (/^https?:\/\//i.test(url) || /^\/api\/uploads\/public\//i.test(url)) return url;
  return "";
}

function localPublicUploadPath(value: string): string {
  if (/^\/api\/uploads\/public\//i.test(value)) return value;
  try {
    const url = new URL(value);
    if (/^(localhost|127\.0\.0\.1)$/i.test(url.hostname) && /^\/api\/uploads\/public\//i.test(url.pathname)) {
      return `${url.pathname}${url.search}`;
    }
  } catch {
    return "";
  }
  return "";
}

function normalizeCompareText(value: unknown): string {
  return stringValue(value).replace(/\s+/g, " ").trim().toLowerCase();
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function canvasSceneMatchesEpisode(sceneId: string, episodeId: string): boolean {
  const normalizedScene = normalizeCompareText(sceneId);
  const normalizedEpisode = normalizeCompareText(episodeId);
  if (!normalizedScene || !normalizedEpisode) return false;
  return normalizedScene === normalizedEpisode || normalizedScene === `episode-canvas-${normalizedEpisode}`;
}
