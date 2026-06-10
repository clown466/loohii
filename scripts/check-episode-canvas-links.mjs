import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function stableCanvasIdPart(value, fallback) {
  const raw = String(value || fallback || "item").trim();
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80) || String(fallback || "item");
}

function normalizeCompareText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function stripPreviousStoryboardReferenceText(value) {
  return String(value || "")
    .replace(/Use the linked previous storyboard image[\s\S]*?as the continuity reference for scene layout and character positions\.?\s*/gi, " ")
    .replace(/(^|\n)\s*上一个故事板[:：][^\n。.]*(?:[。.])?\s*(?=\n|$)/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function recordHasClipAnchor(text, clip) {
  const normalized = normalizeCompareText(text);
  if (!normalized) return false;
  if (clip.id && normalized.includes(normalizeCompareText(clip.id))) return true;
  const title = normalizeCompareText(clip.title || "");
  if (title && normalized.includes(title)) return true;
  const clipNumber = title.match(/\bclip\s*0*(\d+)\b/i)?.[1];
  if (!clipNumber) return false;
  const padded2 = clipNumber.padStart(2, "0");
  const padded3 = clipNumber.padStart(3, "0");
  return new RegExp(`\\bclip\\s*0*${Number(clipNumber)}\\b|\\bclip[-_\\s]?${padded2}\\b|\\bclip[-_\\s]?${padded3}\\b`, "i").test(normalized);
}

function recordImageUrl(record) {
  return record.assets.find((asset) => asset.url && String(asset.type || "").toUpperCase() === "IMAGE")?.url
    || record.assets.find((asset) => asset.url)?.url
    || "";
}

function generationRecordTime(record) {
  return Date.parse(record.completedAt || record.updatedAt || record.createdAt || record.startedAt || record.queuedAt || "") || 0;
}

function storyboardReferencesFromGenerationRecords(records, clips) {
  const refs = [];
  const seenClips = new Set();
  const ordered = [...records].sort((a, b) => generationRecordTime(b) - generationRecordTime(a));
  for (const record of ordered) {
    if (record.status !== "SUCCEEDED" || record.input?.kind !== "canvas-image-generation") continue;
    const url = recordImageUrl(record);
    if (!url) continue;
    const promptWithoutPrevious = stripPreviousStoryboardReferenceText(record.prompt);
    const metadata = record.input?.metadata && typeof record.input.metadata === "object" ? record.input.metadata : {};
    const assetMetadata = record.assets.find((asset) => asset.url)?.metadata || {};
    let matchedClip = null;
    const metadataClipId = metadata.clipId || assetMetadata.clipId;
    if ((metadata.clipNodeKind || assetMetadata.clipNodeKind) === "storyboard" && metadataClipId) {
      matchedClip = clips.find((clip) => clip.id === metadataClipId) || null;
    }
    if (!matchedClip) {
      matchedClip = clips.find((clip) => recordHasClipAnchor(promptWithoutPrevious, clip)) || null;
    }
    if (!matchedClip || seenClips.has(matchedClip.id)) continue;
    if (!/storyboard|director board|production board|clip-level director|故事板|导演板|分镜/i.test(`${promptWithoutPrevious} ${metadata.clipNodeKind || ""} ${assetMetadata.clipNodeKind || ""}`)) continue;
    seenClips.add(matchedClip.id);
    refs.push({
      clipId: matchedClip.id,
      clipTitle: matchedClip.title,
      title: `${matchedClip.title} 故事板`,
      url,
      assetId: record.assets.find((asset) => asset.url)?.id || "",
      prompt: record.prompt,
    });
  }
  return refs;
}

function nodeReferenceUrl(node) {
  if (!node) return "";
  if (node.type === "imageInput") return node.data?.imageUrl || "";
  if (node.type === "generation") return node.data?.outputImage || "";
  if (node.type === "character") return node.data?.avatar || "";
  return "";
}

function isStoryboardNode(node) {
  return node?.type === "generation" && node.data?.clipNodeKind === "storyboard" && node.data?.storyboardForClip === true;
}

function isVideoNode(node) {
  return node?.type === "video" || node?.data?.workflowKind === "video";
}

function isStoryboardSlotNode(node, clip) {
  return node?.type === "imageInput"
    && node.data?.clipId === clip.id
    && (node.data?.storyboardSlotForClip === true || node.data?.clipSyncRole === "storyboard-slot");
}

const args = process.argv.slice(2);
const projectId = args.find((arg) => !arg.startsWith("--"));
const fix = args.includes("--fix");
if (!projectId) {
  console.error("Usage: node scripts/check-episode-canvas-links.mjs <projectId> [--fix]");
  process.exit(2);
}

const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, metadata: true } });
if (!project) {
  console.error(`Project not found: ${projectId}`);
  process.exit(2);
}

const metadata = project.metadata && typeof project.metadata === "object" ? project.metadata : {};
const clips = Array.isArray(metadata.workflowCenter?.clips) ? metadata.workflowCenter.clips : [];
const scene = metadata.canvasScenes?.default || {};
const nodes = Array.isArray(scene.nodes) ? scene.nodes : [];
const edges = Array.isArray(scene.edges) ? scene.edges : [];
const nodeById = new Map(nodes.map((node) => [node.id, node]));
let nextEdges = edges;
let changed = false;

const records = await prisma.generation.findMany({
  where: { projectId },
  orderBy: { createdAt: "desc" },
  take: 300,
  include: { assets: true },
});
const storyboardRefs = storyboardReferencesFromGenerationRecords(records, clips);
const refByClipId = new Map(storyboardRefs.map((ref) => [ref.clipId, ref]));

let failures = 0;
function addEdgeIfMissing(source, target, prefix) {
  if (!source || !target || nextEdges.some((edge) => edge.source === source && edge.target === target)) return;
  nextEdges = [
    ...nextEdges,
    {
      id: `${prefix}-${source}-${target}`.replace(/[^a-zA-Z0-9_-]+/g, "-"),
      source,
      target,
      sourceHandle: null,
      targetHandle: null,
    },
  ];
  changed = true;
}

console.log(`project=${project.name} clips=${clips.length} nodes=${nodes.length} edges=${edges.length} storyboardRecords=${storyboardRefs.length} fix=${fix ? "yes" : "no"}`);
for (const [index, clip] of clips.entries()) {
  const clipKey = stableCanvasIdPart(clip.id || clip.title, `clip-${index + 1}`);
  const storyNodeId = `episode-sync-storyboard-1-${clipKey}`;
  const videoNodeId = `episode-sync-video-node-1-${clipKey}`;
  const story = nodeById.get(storyNodeId) || nodes.find((node) => isStoryboardNode(node) && node.data?.clipId === clip.id);
  const video = nodeById.get(videoNodeId) || nodes.find((node) => isVideoNode(node) && node.data?.clipId === clip.id);
  const slot = nodes.find((node) => isStoryboardSlotNode(node, clip));
  const ref = refByClipId.get(clip.id);
  const incomingVideo = video ? edges.filter((edge) => edge.target === video.id).map((edge) => nodeById.get(edge.source)).filter(Boolean) : [];
  const incomingStory = story ? edges.filter((edge) => edge.target === story.id).map((edge) => nodeById.get(edge.source)).filter(Boolean) : [];
  const storyToVideo = Boolean(story && video && edges.some((edge) => edge.source === story.id && edge.target === video.id));
  const storyToSlot = Boolean(story && slot && edges.some((edge) => edge.source === story.id && edge.target === slot.id));
  const slotToVideo = Boolean(slot && video && edges.some((edge) => edge.source === slot.id && edge.target === video.id));
  const prevClip = clips[index - 1];
  const prevStory = prevClip ? nodes.find((node) => isStoryboardNode(node) && node.data?.clipId === prevClip.id) : null;
  const prevToStory = !prevClip || Boolean(prevStory && story && edges.some((edge) => edge.source === prevStory.id && edge.target === story.id));
  let videoHasStoryboardImage = incomingVideo.some((node) => (
    node.data?.clipNodeKind === "storyboard" &&
    node.data?.clipId === clip.id &&
    Boolean(nodeReferenceUrl(node))
  ));
  let storyHasRecoveredImage = !ref || nodeReferenceUrl(story) === ref.url;
  if (fix) {
    if (story && ref && nodeReferenceUrl(story) !== ref.url) {
      story.data = {
        ...(story.data || {}),
        status: "completed",
        outputImage: ref.url,
        outputImageAssetId: ref.assetId || story.data?.outputImageAssetId || "",
        submittedPrompt: ref.prompt || story.data?.submittedPrompt || "",
        error: "已关联本 Clip 的故事板生成记录。",
        generationStartedAt: "",
        clipSyncUrl: ref.url,
      };
      changed = true;
    }
    if (story && video) addEdgeIfMissing(story.id, video.id, "episode-video-ref");
    if (story && slot) addEdgeIfMissing(story.id, slot.id, "episode-storyboard-slot");
    if (slot && video) addEdgeIfMissing(slot.id, video.id, "episode-video-ref");
    if (prevStory && story) addEdgeIfMissing(prevStory.id, story.id, "episode-storyboard-prev");
    videoHasStoryboardImage = incomingVideo.some((node) => (
      node.data?.clipNodeKind === "storyboard" &&
      node.data?.clipId === clip.id &&
      Boolean(nodeReferenceUrl(node))
    ));
    storyHasRecoveredImage = !ref || nodeReferenceUrl(story) === ref.url;
  }
  const hasRequiredStoryboardImage = ref ? (videoHasStoryboardImage || nodeReferenceUrl(story) === ref.url) : true;
  const ok = Boolean(story && video && slot && storyToSlot && slotToVideo && storyToVideo && prevToStory && hasRequiredStoryboardImage && storyHasRecoveredImage);
  if (!ok) failures += 1;
  const status = ok ? (ref ? "OK" : "NO_RECORD") : "FAIL";
  console.log(`${status} ${clip.id} ${clip.title || ""} story=${story?.id || "missing"} storyImage=${nodeReferenceUrl(story) ? "yes" : "no"} slot=${slot?.id || "missing"} slotImage=${nodeReferenceUrl(slot) ? "yes" : "no"} record=${ref?.url ? "yes" : "no"} videoStoryboardImage=${videoHasStoryboardImage ? "yes" : "no"} story->slot=${storyToSlot ? "yes" : "no"} slot->video=${slotToVideo ? "yes" : "no"} story->video=${storyToVideo ? "yes" : "no"} prev->story=${prevToStory ? "yes" : "no"} incomingVideo=${incomingVideo.length} incomingStory=${incomingStory.length}`);
}

if (fix && changed) {
  const nextMetadata = {
    ...metadata,
    canvasScenes: {
      ...(metadata.canvasScenes || {}),
      default: {
        ...scene,
        nodes,
        edges: nextEdges,
        updatedAt: new Date().toISOString(),
      },
    },
  };
  await prisma.project.update({
    where: { id: projectId },
    data: { metadata: nextMetadata },
  });
  console.log("UPDATED canvas scene");
}

await prisma.$disconnect();
if (failures > 0) {
  console.error(`FAIL_COUNT=${failures}`);
  process.exit(1);
}
console.log("FAIL_COUNT=0");
