import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCanvasVideoReferenceInputs } from "./canvasVideoReferences";

const storyboardUrl = "https://loohii.com/api/uploads/public/project/storyboards/clip-001.png";
const chloeUrl = "https://loohii.com/api/uploads/public/project/chloe.png";
const leoUrl = "https://loohii.com/api/uploads/public/project/leo.png";
const tiffanyUrl = "https://loohii.com/api/uploads/public/project/tiffany.png";
const eugeneUrl = "https://loohii.com/api/uploads/public/project/eugene.png";
const sceneUrl = "https://loohii.com/api/uploads/public/project/boss-room.png";
const tiffanyAudioUrl = "https://loohii.com/api/uploads/public/project/tiffany.wav";
const leoAudioUrl = "https://loohii.com/api/uploads/public/project/leo.wav";
const eugeneAudioPath = "/api/uploads/public/project/eugene.wav";

test("normalizes canvas video refs from storyboard slot, character refs, and audio refs", () => {
  const result = normalizeCanvasVideoReferenceInputs({
    metadata: {
      activeEpisodeId: "episode-002",
      canvasScenes: {
        "episode-002": {
          nodes: [
            {
              id: "episode-sync-storyboard-episode-002-clip-001",
              type: "generation",
              data: {
                clipId: "clip-001",
                clipNodeKind: "storyboard",
                storyboardForClip: true,
                outputImage: storyboardUrl,
              },
            },
            {
              id: "episode-sync-video-storyboard-slot-episode-002-clip-001",
              type: "imageInput",
              data: {
                clipId: "clip-001",
                targetClipId: "clip-001",
                storyboardSlotForClip: true,
                clipSyncRole: "storyboard-slot",
                imageUrl: storyboardUrl,
              },
            },
            characterNode("chloe", "Chloe", chloeUrl),
            characterNode("leo", "Leo", leoUrl),
            characterNode("tiffany", "Tiffany", tiffanyUrl),
            characterNode("eugene", "Eugene", eugeneUrl),
            {
              id: "scene",
              type: "imageInput",
              data: { assetKind: "scenes", assetName: "Boss Room", imageUrl: sceneUrl },
            },
            audioNode("tiffany-audio", "Tiffany", tiffanyAudioUrl),
            audioNode("leo-audio", "Leo", leoAudioUrl),
            audioNode("eugene-audio", "Eugene", eugeneAudioPath),
            {
              id: "episode-sync-video-node-episode-002-clip-001",
              type: "video",
              data: {
                clipId: "clip-001",
                includeAudio: true,
                referenceImageUrls: [chloeUrl, leoUrl, tiffanyUrl, eugeneUrl],
              },
            },
          ],
          edges: [
            edge("story-to-slot", "episode-sync-storyboard-episode-002-clip-001", "episode-sync-video-storyboard-slot-episode-002-clip-001"),
            edge("slot-to-video", "episode-sync-video-storyboard-slot-episode-002-clip-001", "episode-sync-video-node-episode-002-clip-001"),
            edge("chloe-to-video", "chloe", "episode-sync-video-node-episode-002-clip-001"),
            edge("leo-to-video", "leo", "episode-sync-video-node-episode-002-clip-001"),
            edge("tiffany-to-video", "tiffany", "episode-sync-video-node-episode-002-clip-001"),
            edge("eugene-to-video", "eugene", "episode-sync-video-node-episode-002-clip-001"),
            edge("scene-to-video", "scene", "episode-sync-video-node-episode-002-clip-001"),
            edge("tiffany-audio-to-video", "tiffany-audio", "episode-sync-video-node-episode-002-clip-001"),
            edge("leo-audio-to-video", "leo-audio", "episode-sync-video-node-episode-002-clip-001"),
            edge("eugene-audio-to-video", "eugene-audio", "episode-sync-video-node-episode-002-clip-001"),
          ],
        },
      },
    },
    requestMetadata: {
      nodeId: "episode-sync-video-node-episode-002-clip-001",
      sourceEpisodeId: "episode-002",
      clipId: "clip-001",
    },
    referenceImageUrls: [chloeUrl, leoUrl, tiffanyUrl, eugeneUrl],
    referenceAudioUrls: [],
  });

  assert.deepEqual(result.referenceImageUrls, [storyboardUrl, chloeUrl, leoUrl, tiffanyUrl, eugeneUrl]);
  assert.deepEqual(result.referenceAudioUrls, [
    tiffanyAudioUrl,
    leoAudioUrl,
    "https://loohii.com/api/uploads/public/project/eugene.wav",
  ]);
  assert.equal(result.storyboardImageUrl, storyboardUrl);
  assert.equal(result.source, "canvas");
  assert.deepEqual(result.imageSourceNodeIds, [
    "episode-sync-video-storyboard-slot-episode-002-clip-001",
    "chloe",
    "leo",
    "tiffany",
    "eugene",
  ]);
});

test("uses connected storyboard source when the storyboard slot has no image yet", () => {
  const result = normalizeCanvasVideoReferenceInputs({
    metadata: {
      canvasScenes: {
        "episode-002": {
          nodes: [
            {
              id: "story",
              type: "generation",
              data: {
                clipId: "clip-001",
                clipNodeKind: "storyboard",
                storyboardForClip: true,
                outputImage: storyboardUrl,
              },
            },
            {
              id: "slot",
              type: "imageInput",
              data: {
                clipId: "clip-001",
                targetClipId: "clip-001",
                storyboardSlotForClip: true,
                clipSyncRole: "storyboard-slot",
                imageUrl: "",
              },
            },
            characterNode("chloe", "Chloe", chloeUrl),
            { id: "video", type: "video", data: { clipId: "clip-001", includeAudio: false } },
          ],
          edges: [
            edge("story-slot", "story", "slot"),
            edge("slot-video", "slot", "video"),
            edge("chloe-video", "chloe", "video"),
          ],
        },
      },
    },
    requestMetadata: { nodeId: "video", sourceEpisodeId: "episode-002", clipId: "clip-001" },
  });

  assert.deepEqual(result.referenceImageUrls, [storyboardUrl, chloeUrl]);
  assert.equal(result.storyboardImageUrl, storyboardUrl);
});

test("uses persisted video node image refs as fallback after canvas sync", () => {
  const result = normalizeCanvasVideoReferenceInputs({
    metadata: {
      canvasScenes: {
        "episode-002": {
          nodes: [
            {
              id: "video",
              type: "video",
              data: {
                clipId: "clip-001",
                includeAudio: false,
                storyboardImageUrl: storyboardUrl,
                referenceImageUrls: [storyboardUrl, chloeUrl, leoUrl],
              },
            },
          ],
          edges: [],
        },
      },
    },
    requestMetadata: { nodeId: "video", sourceEpisodeId: "episode-002", clipId: "clip-001" },
  });

  assert.deepEqual(result.referenceImageUrls, [storyboardUrl, chloeUrl, leoUrl]);
  assert.equal(result.storyboardImageUrl, storyboardUrl);
  assert.equal(result.source, "canvas");
});

test("falls back to request refs when no matching canvas video node exists", () => {
  const result = normalizeCanvasVideoReferenceInputs({
    metadata: { canvasScenes: {} },
    requestMetadata: { nodeId: "missing", sourceEpisodeId: "episode-002", clipId: "clip-001" },
    referenceImageUrls: [chloeUrl, chloeUrl],
    referenceAudioUrls: [leoAudioUrl],
  });

  assert.deepEqual(result.referenceImageUrls, [chloeUrl]);
  assert.deepEqual(result.referenceAudioUrls, [leoAudioUrl]);
  assert.equal(result.source, "request");
});

test("keeps storyboard slot as primary video image with audio and character refs", () => {
  const clip02StoryboardUrl = "https://loohii.com/api/uploads/public/user/generated/project/clip02-storyboard.png";
  const clip02ChloeUrl = "https://loohii.com/api/uploads/public/user/generated/project/chloe.png";
  const clip02TiffanyUrl = "https://loohii.com/api/uploads/public/user/generated/project/tiffany.png";
  const clip02ChloeAudio = "https://loohii.com/api/uploads/public/user/audio/chloe.wav";
  const clip02TiffanyAudio = "https://loohii.com/api/uploads/public/user/audio/tiffany.wav";

  const result = normalizeCanvasVideoReferenceInputs({
    metadata: {
      activeEpisodeId: "episode-002",
      canvasScenes: {
        "episode-002": {
          nodes: [
            {
              id: "slot-clip02",
              type: "imageInput",
              data: {
                label: "对应故事板",
                imageUrl: clip02StoryboardUrl,
                clipId: "clip-002",
                clipNodeKind: "storyboard",
                storyboardForClip: true,
                storyboardSlotForClip: true,
                clipSyncRole: "storyboard-slot",
              },
            },
            characterNode("clip02-chloe", "Chloe", clip02ChloeUrl),
            characterNode("clip02-tiffany", "Tiffany", clip02TiffanyUrl),
            audioNode("clip02-chloe-audio", "Chloe", clip02ChloeAudio),
            audioNode("clip02-tiffany-audio", "Tiffany", clip02TiffanyAudio),
            { id: "video-clip02", type: "video", data: { title: "Clip 02 视频任务", clipId: "clip-002", workflowKind: "video" } },
          ],
          edges: [
            edge("slot-video", "slot-clip02", "video-clip02"),
            edge("chloe-video", "clip02-chloe", "video-clip02"),
            edge("tiffany-video", "clip02-tiffany", "video-clip02"),
            edge("chloe-audio-video", "clip02-chloe-audio", "video-clip02"),
            edge("tiffany-audio-video", "clip02-tiffany-audio", "video-clip02"),
          ],
        },
      },
    },
    requestMetadata: { episodeId: "episode-002", nodeId: "video-clip02", clipId: "clip-002" },
    maxImageReferences: 9,
    maxAudioReferences: 16,
  });

  assert.equal(result.storyboardImageUrl, clip02StoryboardUrl);
  assert.deepEqual(result.referenceImageUrls, [clip02StoryboardUrl, clip02ChloeUrl, clip02TiffanyUrl]);
  assert.deepEqual(result.referenceAudioUrls, [clip02ChloeAudio, clip02TiffanyAudio]);
  assert.deepEqual(result.imageSourceNodeIds, ["slot-clip02", "clip02-chloe", "clip02-tiffany"]);
  assert.deepEqual(result.audioSourceNodeIds, ["clip02-chloe-audio", "clip02-tiffany-audio"]);
});

function characterNode(id: string, name: string, url: string) {
  return {
    id,
    type: "imageInput",
    data: {
      assetKind: "characters",
      assetName: name,
      imageUrl: url,
    },
  };
}

function audioNode(id: string, name: string, url: string) {
  return {
    id,
    type: "audio",
    data: {
      assetKind: "audio",
      characterName: name,
      audioUrl: url,
      referenceAudioUrl: url,
    },
  };
}

function edge(id: string, source: string, target: string) {
  return { id, source, target };
}
