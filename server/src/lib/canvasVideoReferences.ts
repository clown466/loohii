import { isRecord } from "./mappers";
import { stringValue } from "./typeGuards";

type CanvasNode = Record<string, unknown> & {
  id: string;
  type?: string;
  data?: Record<string, unknown>;
  parentId?: string;
};

type CanvasEdge = Record<string, unknown> & {
  id?: string;
  source?: string;
  target?: string;
};

type CanvasScene = {
  nodes?: unknown[];
  edges?: unknown[];
};

export type CanvasVideoReferenceNormalizationInput = {
  metadata: unknown;
  requestMetadata?: unknown;
  referenceImageUrls?: string[];
  referenceAudioUrls?: string[];
  maxImageReferences?: number;
  maxAudioReferences?: number;
};

export type CanvasVideoReferenceNormalizationResult = {
  referenceImageUrls: string[];
  referenceAudioUrls: string[];
  storyboardImageUrl: string;
  source: "canvas" | "request";
  imageSourceNodeIds: string[];
  audioSourceNodeIds: string[];
};

export function normalizeCanvasVideoReferenceInputs(
  input: CanvasVideoReferenceNormalizationInput,
): CanvasVideoReferenceNormalizationResult {
  const requestMetadata = isRecord(input.requestMetadata) ? input.requestMetadata : {};
  const requestedImages = uniquePublicMediaUrls(input.referenceImageUrls ?? []).slice(0, input.maxImageReferences ?? 9);
  const requestedAudio = uniquePublicMediaUrls(input.referenceAudioUrls ?? []).slice(0, input.maxAudioReferences ?? 16);
  const canvas = resolveCanvasVideoContext(input.metadata, requestMetadata);
  if (!canvas.videoNode) {
    return {
      referenceImageUrls: requestedImages,
      referenceAudioUrls: requestedAudio,
      storyboardImageUrl: "",
      source: "request",
      imageSourceNodeIds: [],
      audioSourceNodeIds: [],
    };
  }

  const videoNode = canvas.videoNode;
  const videoData = videoNode.data ?? {};
  const incomingEdges = canvas.edges.filter((edge) => edge.target === videoNode.id);
  const incomingSources = incomingEdges
    .map((edge) => canvas.nodes.find((node) => node.id === edge.source))
    .filter((node): node is CanvasNode => Boolean(node));
  const hasIncomingImageSources = incomingSources.some((source) => {
    if (isAudioNode(source)) return false;
    if (isStoryboardSourceForVideo(source, videoNode)) return Boolean(canvasNodeImageUrl(source));
    const assetKind = normalizeAssetKind(source.data?.assetKind);
    if (assetKind === "scenes" || assetKind === "props" || assetKind === "audio") return false;
    return Boolean(canvasNodeImageUrl(source));
  });

  const imageSourceNodeIds: string[] = [];
  const audioSourceNodeIds: string[] = [];
  const imageRefs: string[] = [];
  const addImage = (url: unknown, nodeId = "") => {
    const normalized = publicMediaUrl(url);
    if (!normalized || imageRefs.includes(normalized) || imageRefs.length >= (input.maxImageReferences ?? 9)) return;
    imageRefs.push(normalized);
    if (nodeId) imageSourceNodeIds.push(nodeId);
  };

  const storyboardCandidates = collectStoryboardImageCandidates({ ...canvas, videoNode }, incomingSources, requestMetadata);
  for (const candidate of storyboardCandidates) addImage(candidate.url, candidate.nodeId);
  const storyboardImageUrl = imageRefs[0] ?? "";

  const orderedSources = [...incomingSources].sort((a, b) => videoReferenceSourcePriority(a, videoNode) - videoReferenceSourcePriority(b, videoNode));
  for (const source of orderedSources) {
    if (isAudioNode(source)) continue;
    if (isStoryboardSourceForVideo(source, videoNode)) continue;
    const assetKind = normalizeAssetKind(source.data?.assetKind);
    if (assetKind === "scenes" || assetKind === "props") continue;
    addImage(canvasNodeImageUrl(source), source.id);
  }

  if (imageRefs.length === 0) {
    for (const url of requestedImages) addImage(url);
  }
  if (!hasIncomingImageSources) {
    for (const url of arrayFrom(videoData.referenceImageUrls)) addImage(url);
  }

  const audioRefs: string[] = [];
  const addAudio = (url: unknown, nodeId = "") => {
    const normalized = publicMediaUrl(url);
    if (!normalized || audioRefs.includes(normalized) || audioRefs.length >= (input.maxAudioReferences ?? 16)) return;
    audioRefs.push(normalized);
    if (nodeId) audioSourceNodeIds.push(nodeId);
  };
  const shouldUseCanvasAudio = videoData.includeAudio !== false || requestedAudio.length > 0;
  if (shouldUseCanvasAudio) {
    for (const source of orderedSources) {
      if (!isAudioNode(source)) continue;
      addAudio(canvasNodeAudioUrl(source), source.id);
    }
    for (const ref of arrayFrom(videoData.characterAudioReferences)) {
      if (!isRecord(ref)) continue;
      addAudio(ref.url ?? ref.referenceAudioUrl);
    }
    for (const url of arrayFrom(videoData.referenceAudioUrls)) addAudio(url);
  }
  for (const url of requestedAudio) addAudio(url);

  return {
    referenceImageUrls: imageRefs.slice(0, input.maxImageReferences ?? 9),
    referenceAudioUrls: audioRefs.slice(0, input.maxAudioReferences ?? 16),
    storyboardImageUrl,
    source: imageRefs.length > 0 || audioRefs.length > 0 ? "canvas" : "request",
    imageSourceNodeIds,
    audioSourceNodeIds,
  };
}

function resolveCanvasVideoContext(metadata: unknown, requestMetadata: Record<string, unknown>): { nodes: CanvasNode[]; edges: CanvasEdge[]; videoNode: CanvasNode | null } {
  const record = isRecord(metadata) ? metadata : {};
  const nodeId = stringValue(requestMetadata.nodeId);
  const clipId = stringValue(requestMetadata.clipId);
  const episodeId = stringValue(requestMetadata.sourceEpisodeId) || stringValue(requestMetadata.episodeId) || stringValue(record.activeEpisodeId);
  const scenes = canvasScenesFromMetadata(record);
  const preferredSceneIds = [
    episodeId,
    workflowEpisodeCanvasSceneId(episodeId),
    stringValue(requestMetadata.sceneId),
    stringValue(requestMetadata.canvasSceneId),
  ].filter(Boolean);
  const sceneEntries = [
    ...preferredSceneIds.map((id) => [id, scenes[id]] as const).filter((entry) => Boolean(entry[1])),
    ...Object.entries(scenes).filter(([id]) => !preferredSceneIds.includes(id)),
  ];

  for (const [, scene] of sceneEntries) {
    const nodes = arrayFrom(scene?.nodes).filter(isCanvasNode);
    const edges = arrayFrom(scene?.edges).filter(isCanvasEdge);
    const videoNode = findVideoNode(nodes, nodeId, clipId);
    if (videoNode) return { nodes, edges, videoNode };
  }
  return { nodes: [], edges: [], videoNode: null };
}

function collectStoryboardImageCandidates(
  canvas: { nodes: CanvasNode[]; edges: CanvasEdge[]; videoNode: CanvasNode },
  incomingSources: CanvasNode[],
  requestMetadata: Record<string, unknown>,
): Array<{ url: string; nodeId: string }> {
  const result: Array<{ url: string; nodeId: string }> = [];
  const push = (url: unknown, nodeId = "") => {
    const normalized = publicMediaUrl(url);
    if (!normalized || result.some((item) => item.url === normalized)) return;
    result.push({ url: normalized, nodeId });
  };

  const storyboardSlots = incomingSources.filter((source) => isStoryboardSlotForVideo(source, canvas.videoNode));
  for (const slot of storyboardSlots) {
    push(canvasNodeImageUrl(slot), slot.id);
    for (const edge of canvas.edges.filter((edge) => edge.target === slot.id)) {
      const source = canvas.nodes.find((node) => node.id === edge.source);
      if (source && isStoryboardSourceForVideo(source, canvas.videoNode)) push(canvasNodeImageUrl(source), source.id);
    }
  }

  const videoData = canvas.videoNode.data ?? {};
  push(videoData.storyboardImageUrl);
  push(videoData.storyboardUrl);
  push(requestMetadata.storyboardImageUrl);

  if (result.length === 0) {
    for (const source of incomingSources) {
      if (isStoryboardSourceForVideo(source, canvas.videoNode)) push(canvasNodeImageUrl(source), source.id);
    }
  }
  return result;
}

function findVideoNode(nodes: CanvasNode[], nodeId: string, clipId: string): CanvasNode | null {
  if (nodeId) {
    const byId = nodes.find((node) => node.id === nodeId && isVideoNode(node));
    if (byId) return byId;
  }
  if (clipId) {
    const byClip = nodes.find((node) => isVideoNode(node) && stringValue(node.data?.clipId) === clipId);
    if (byClip) return byClip;
  }
  return null;
}

function videoReferenceSourcePriority(source: CanvasNode, video: CanvasNode): number {
  if (isStoryboardSlotForVideo(source, video)) return 0;
  if (isStoryboardSourceForVideo(source, video)) return 1;
  const assetKind = normalizeAssetKind(source.data?.assetKind);
  if (source.type === "character" || assetKind === "characters") return 2;
  if (isAudioNode(source)) return 3;
  if (assetKind === "scenes") return 7;
  if (assetKind === "props") return 8;
  return 5;
}

function isStoryboardSourceForVideo(source: CanvasNode, video: CanvasNode): boolean {
  const data = source.data ?? {};
  const videoData = video.data ?? {};
  if (isStoryboardSlotForVideo(source, video)) return true;
  if (source.type !== "generation" && source.type !== "imageInput") return false;
  const role = stringValue(data.clipSyncRole) || stringValue(data.clipNodeKind);
  const looksStoryboard = role === "storyboard" || data.clipNodeKind === "storyboard" || data.storyboardForClip === true || /storyboard|故事板/i.test([
    data.title,
    data.label,
    data.description,
    data.sourcePrompt,
  ].filter(Boolean).join(" "));
  if (!looksStoryboard) return false;
  const sourceClipId = stringValue(data.clipId) || stringValue(data.sourceClipId) || stringValue(data.targetClipId);
  const videoClipId = stringValue(videoData.clipId);
  if (sourceClipId && videoClipId) return sourceClipId === videoClipId;
  return true;
}

function isStoryboardSlotForVideo(source: CanvasNode, video: CanvasNode): boolean {
  const data = source.data ?? {};
  const videoData = video.data ?? {};
  if (source.type !== "imageInput") return false;
  if (data.storyboardSlotForClip !== true && data.clipSyncRole !== "storyboard-slot") return false;
  const sourceClipId = stringValue(data.clipId);
  const targetClipId = stringValue(data.targetClipId);
  const videoClipId = stringValue(videoData.clipId);
  if (sourceClipId && videoClipId && sourceClipId !== videoClipId) return false;
  if (targetClipId && videoClipId && targetClipId !== videoClipId) return false;
  return true;
}

function isVideoNode(node: CanvasNode): boolean {
  const data = node.data ?? {};
  return node.type === "video" || data.workflowKind === "video" || data.kind === "video" || data.clipSyncRole === "video";
}

function isCanvasNode(value: unknown): value is CanvasNode {
  return isRecord(value) && typeof value.id === "string";
}

function isCanvasEdge(value: unknown): value is CanvasEdge {
  return isRecord(value) && typeof value.source === "string" && typeof value.target === "string";
}

function isAudioNode(node: CanvasNode): boolean {
  const data = node.data ?? {};
  return node.type === "audio" || data.workflowKind === "audio" || data.kind === "audio" || data.assetKind === "audio";
}

function canvasNodeImageUrl(node: CanvasNode): string {
  const data = node.data ?? {};
  if (node.type === "generation") return publicMediaUrl(data.outputImage ?? data.generatedImage ?? data.imageUrl ?? data.clipSyncUrl);
  if (node.type === "character") return publicMediaUrl(data.avatar ?? data.referenceImageUrl ?? data.generatedImageUrl ?? data.imageUrl);
  return publicMediaUrl(data.imageUrl ?? data.referenceImageUrl ?? data.generatedImageUrl ?? data.outputImage ?? data.clipSyncUrl ?? data.url);
}

function canvasNodeAudioUrl(node: CanvasNode): string {
  const data = node.data ?? {};
  return publicMediaUrl(data.audioUrl ?? data.referenceAudioUrl ?? data.url ?? data.clipSyncUrl);
}

function canvasScenesFromMetadata(metadata: Record<string, unknown>): Record<string, CanvasScene> {
  if (!isRecord(metadata.canvasScenes)) return {};
  const result: Record<string, CanvasScene> = {};
  for (const [id, value] of Object.entries(metadata.canvasScenes)) {
    if (id && isRecord(value)) result[id] = value as CanvasScene;
  }
  return result;
}

function workflowEpisodeCanvasSceneId(episodeId: string): string {
  return episodeId || "default";
}

function publicMediaUrl(value: unknown): string {
  const raw = stringValue(value);
  if (!raw) return "";
  const localPath = localPublicUploadPath(raw);
  if (localPath) return `https://loohii.com${localPath}`;
  return /^https?:\/\//i.test(raw) ? raw : "";
}

function localPublicUploadPath(value: string): string {
  if (/^\/api\/uploads\/public\//i.test(value)) return value;
  try {
    const url = new URL(value);
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(url.host) && /^\/api\/uploads\/public\//i.test(url.pathname)) return url.pathname;
    if (/^\/api\/uploads\/public\//i.test(url.pathname) && /seedancea\.com$/i.test(url.hostname)) return url.pathname;
  } catch {
    // Not a URL.
  }
  return "";
}

function uniquePublicMediaUrls(values: string[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const url = publicMediaUrl(value);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function normalizeAssetKind(value: unknown): string {
  const text = stringValue(value).toLowerCase();
  if (text === "character" || text === "characters") return "characters";
  if (text === "scene" || text === "scenes") return "scenes";
  if (text === "prop" || text === "props") return "props";
  if (text === "audio") return "audio";
  return text;
}

function arrayFrom(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}


