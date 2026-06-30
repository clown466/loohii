import assert from "node:assert/strict";
import test from "node:test";
import { applyWorkflowAssetImageToCanvasScenes, canvasSyncableImageUrl, fillMissingAssetImageAcrossEpisodes } from "./canvasAssetImageSync";

const chloeUrl = "https://loohii.com/api/uploads/public/project/chloe.png";
const bossRoomUrl = "https://loohii.com/api/uploads/public/project/boss-room.png";
const missingImageError = "该资产还没有参考图，请上传或生成后再生成视频。";

function emptyCharacterNode(id: string, assetName: string): Record<string, unknown> {
  return {
    id,
    type: "imageInput",
    data: {
      label: `角色参考: ${assetName}`,
      imageUrl: "",
      imageAspectRatio: 1.45,
      uploadStatus: "missing",
      uploadError: missingImageError,
      imageLoadError: false,
      assetKind: "characters",
      assetName,
      assetId: "",
      episodeCanvasSync: true,
      clipSyncAssetId: "",
      clipSyncUrl: "",
    },
  };
}

function canvasMetadata(nodes: Record<string, unknown>[], sceneId = "episode-canvas-episode-001"): Record<string, unknown> {
  return {
    canvasScenes: {
      [sceneId]: {
        nodes,
        edges: [],
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    },
  };
}

function sceneNodes(metadata: Record<string, unknown>, sceneId = "episode-canvas-episode-001"): Record<string, unknown>[] {
  const scenes = metadata.canvasScenes as Record<string, { nodes: Record<string, unknown>[] }>;
  return scenes[sceneId].nodes;
}

test("applyWorkflowAssetImageToCanvasScenes backfills empty matching nodes", () => {
  const metadata = canvasMetadata([
    emptyCharacterNode("chloe-ref", "Chloe"),
    {
      id: "scene-ref",
      type: "imageInput",
      data: { assetKind: "scenes", assetName: "Boss Room", imageUrl: "", clipSyncUrl: "" },
    },
  ]);
  const result = applyWorkflowAssetImageToCanvasScenes(
    metadata,
    { assetKind: "characters", assetName: "Chloe", imageUrl: chloeUrl, imageAssetId: "media-1" },
    "2026-06-12T08:00:00.000Z",
  );

  assert.equal(result.changedNodeCount, 1);
  const nodes = sceneNodes(result.metadata);
  const data = nodes[0].data as Record<string, unknown>;
  assert.equal(data.imageUrl, chloeUrl);
  assert.equal(data.clipSyncUrl, chloeUrl);
  assert.equal(data.assetId, "media-1");
  assert.equal(data.clipSyncAssetId, "media-1");
  assert.equal(data.uploadStatus, "linked");
  assert.equal(data.uploadError, "");
  assert.equal(data.imageLoadError, false);
  assert.equal(data.label, "角色参考: Chloe");
  const sceneRecord = (result.metadata.canvasScenes as Record<string, Record<string, unknown>>)["episode-canvas-episode-001"];
  assert.equal(sceneRecord.updatedAt, "2026-06-12T08:00:00.000Z");
  const otherData = nodes[1].data as Record<string, unknown>;
  assert.equal(otherData.imageUrl, "");
});

test("applyWorkflowAssetImageToCanvasScenes updates matching nodes in every canvas scene", () => {
  const metadata = {
    canvasScenes: {
      "episode-canvas-episode-001": { nodes: [emptyCharacterNode("a", "Chloe")], edges: [], updatedAt: "x" },
      "episode-canvas-episode-002": { nodes: [emptyCharacterNode("b", "Chloe")], edges: [], updatedAt: "x" },
    },
  };
  const result = applyWorkflowAssetImageToCanvasScenes(
    metadata,
    { assetKind: "characters", assetName: "Chloe", imageUrl: chloeUrl, imageAssetId: "media-1" },
    "2026-06-12T08:00:00.000Z",
  );
  assert.equal(result.changedNodeCount, 2);
  assert.equal((sceneNodes(result.metadata, "episode-canvas-episode-002")[0].data as Record<string, unknown>).imageUrl, chloeUrl);
});

test("applyWorkflowAssetImageToCanvasScenes scopes scene updates to the requested episode", () => {
  const episode18Url = "https://loohii.com/api/uploads/public/project/episode18-highway.png";
  const episode25Url = "https://loohii.com/api/uploads/public/project/episode25-highway.png";
  const metadata = {
    canvasScenes: {
      "episode-018": {
        nodes: [{
          id: "ep18-highway",
          type: "imageInput",
          data: {
            assetKind: "scenes",
            assetName: "Wasteland Highway",
            imageUrl: episode18Url,
            clipSyncUrl: episode18Url,
            sourceEpisodeId: "episode-018",
          },
        }],
        edges: [],
      },
      "episode-025": {
        nodes: [{
          id: "ep25-highway",
          type: "imageInput",
          data: {
            assetKind: "scenes",
            assetName: "Wasteland Highway",
            imageUrl: "",
            clipSyncUrl: "",
            sourceEpisodeId: "episode-025",
          },
        }],
        edges: [],
      },
    },
  };

  const result = applyWorkflowAssetImageToCanvasScenes(
    metadata,
    { assetKind: "scenes", assetName: "Wasteland Highway", imageUrl: episode25Url, imageAssetId: "media-25", episodeId: "episode-025" },
    "2026-06-12T08:00:00.000Z",
  );

  assert.equal(result.changedNodeCount, 1);
  assert.equal((sceneNodes(result.metadata, "episode-018")[0].data as Record<string, unknown>).imageUrl, episode18Url);
  assert.equal((sceneNodes(result.metadata, "episode-025")[0].data as Record<string, unknown>).imageUrl, episode25Url);
});

test("applyWorkflowAssetImageToCanvasScenes keeps legacy character updates cross-episode", () => {
  const metadata = {
    canvasScenes: {
      "episode-018": { nodes: [emptyCharacterNode("ep18-chloe", "Chloe")], edges: [] },
      "episode-025": { nodes: [emptyCharacterNode("ep25-chloe", "Chloe")], edges: [] },
    },
  };

  const result = applyWorkflowAssetImageToCanvasScenes(
    metadata,
    { assetKind: "characters", assetName: "Chloe", imageUrl: chloeUrl, imageAssetId: "media-1", episodeId: "episode-025" },
    "2026-06-12T08:00:00.000Z",
  );

  assert.equal(result.changedNodeCount, 2);
  assert.equal((sceneNodes(result.metadata, "episode-018")[0].data as Record<string, unknown>).imageUrl, chloeUrl);
  assert.equal((sceneNodes(result.metadata, "episode-025")[0].data as Record<string, unknown>).imageUrl, chloeUrl);
});

test("applyWorkflowAssetImageToCanvasScenes skips manually overridden nodes", () => {
  const node = emptyCharacterNode("chloe-ref", "Chloe");
  (node.data as Record<string, unknown>).imageUrl = "https://example.com/manual.png";
  (node.data as Record<string, unknown>).clipSyncUrl = "https://loohii.com/api/uploads/public/project/old.png";
  const metadata = canvasMetadata([node]);
  const result = applyWorkflowAssetImageToCanvasScenes(
    metadata,
    { assetKind: "characters", assetName: "Chloe", imageUrl: chloeUrl, imageAssetId: "media-1" },
    "2026-06-12T08:00:00.000Z",
  );
  assert.equal(result.changedNodeCount, 0);
  assert.equal((sceneNodes(result.metadata)[0].data as Record<string, unknown>).imageUrl, "https://example.com/manual.png");
});

test("applyWorkflowAssetImageToCanvasScenes force overwrites manually overridden nodes", () => {
  const node = emptyCharacterNode("chloe-ref", "Chloe");
  (node.data as Record<string, unknown>).imageUrl = "https://example.com/manual.png";
  (node.data as Record<string, unknown>).clipSyncUrl = "https://loohii.com/api/uploads/public/project/old.png";
  const metadata = canvasMetadata([node]);
  const result = applyWorkflowAssetImageToCanvasScenes(
    metadata,
    { assetKind: "characters", assetName: "Chloe", imageUrl: chloeUrl, imageAssetId: "media-1", force: true },
    "2026-06-12T08:00:00.000Z",
  );
  assert.equal(result.changedNodeCount, 1);
  const data = sceneNodes(result.metadata)[0].data as Record<string, unknown>;
  assert.equal(data.imageUrl, chloeUrl);
  assert.equal(data.clipSyncUrl, chloeUrl);
});

test("applyWorkflowAssetImageToCanvasScenes overwrites synced nodes whose imageUrl equals clipSyncUrl", () => {
  const node = emptyCharacterNode("chloe-ref", "Chloe");
  (node.data as Record<string, unknown>).imageUrl = "https://loohii.com/api/uploads/public/project/old.png";
  (node.data as Record<string, unknown>).clipSyncUrl = "https://loohii.com/api/uploads/public/project/old.png";
  (node.data as Record<string, unknown>).uploadStatus = "linked";
  (node.data as Record<string, unknown>).uploadError = "";
  const metadata = canvasMetadata([node]);
  const result = applyWorkflowAssetImageToCanvasScenes(
    metadata,
    { assetKind: "characters", assetName: "Chloe", imageUrl: chloeUrl, imageAssetId: "media-2" },
    "2026-06-12T08:00:00.000Z",
  );
  assert.equal(result.changedNodeCount, 1);
  const data = sceneNodes(result.metadata)[0].data as Record<string, unknown>;
  assert.equal(data.imageUrl, chloeUrl);
  assert.equal(data.clipSyncUrl, chloeUrl);
});

test("applyWorkflowAssetImageToCanvasScenes resets nodes to missing when imageUrl is empty", () => {
  const node = emptyCharacterNode("chloe-ref", "Chloe");
  (node.data as Record<string, unknown>).imageUrl = chloeUrl;
  (node.data as Record<string, unknown>).clipSyncUrl = chloeUrl;
  (node.data as Record<string, unknown>).uploadStatus = "linked";
  (node.data as Record<string, unknown>).uploadError = "";
  (node.data as Record<string, unknown>).assetId = "media-1";
  (node.data as Record<string, unknown>).clipSyncAssetId = "media-1";
  const metadata = canvasMetadata([node]);
  const result = applyWorkflowAssetImageToCanvasScenes(
    metadata,
    { assetKind: "characters", assetName: "Chloe", imageUrl: "", imageAssetId: "" },
    "2026-06-12T08:00:00.000Z",
  );
  assert.equal(result.changedNodeCount, 1);
  const data = sceneNodes(result.metadata)[0].data as Record<string, unknown>;
  assert.equal(data.imageUrl, "");
  assert.equal(data.clipSyncUrl, "");
  assert.equal(data.uploadStatus, "missing");
  assert.equal(data.uploadError, missingImageError);
  assert.equal(data.imageLoadError, false);
});

test("applyWorkflowAssetImageToCanvasScenes matches asset names ignoring case and whitespace", () => {
  const metadata = canvasMetadata([emptyCharacterNode("chloe-ref", "  chloe  ")]);
  const result = applyWorkflowAssetImageToCanvasScenes(
    metadata,
    { assetKind: "characters", assetName: "Chloe", imageUrl: chloeUrl, imageAssetId: "media-1" },
    "2026-06-12T08:00:00.000Z",
  );
  assert.equal(result.changedNodeCount, 1);
  assert.equal((sceneNodes(result.metadata)[0].data as Record<string, unknown>).imageUrl, chloeUrl);
});

test("applyWorkflowAssetImageToCanvasScenes ignores nodes of other kinds or names", () => {
  const metadata = canvasMetadata([
    {
      id: "scene-ref",
      type: "imageInput",
      data: { assetKind: "scenes", assetName: "Chloe", imageUrl: "", clipSyncUrl: "" },
    },
    {
      id: "leo-ref",
      type: "imageInput",
      data: { assetKind: "characters", assetName: "Leo", imageUrl: "", clipSyncUrl: "" },
    },
    { id: "video", type: "video", data: { assetKind: "characters", assetName: "Chloe" } },
  ]);
  const result = applyWorkflowAssetImageToCanvasScenes(
    metadata,
    { assetKind: "characters", assetName: "Chloe", imageUrl: chloeUrl, imageAssetId: "media-1" },
    "2026-06-12T08:00:00.000Z",
  );
  assert.equal(result.changedNodeCount, 0);
  assert.equal(result.metadata, metadata);
});

test("applyWorkflowAssetImageToCanvasScenes rewrites localhost public upload urls", () => {
  const metadata = canvasMetadata([emptyCharacterNode("chloe-ref", "Chloe")]);
  const result = applyWorkflowAssetImageToCanvasScenes(
    metadata,
    {
      assetKind: "characters",
      assetName: "Chloe",
      imageUrl: "http://localhost:3001/api/uploads/public/project/chloe.png",
      imageAssetId: "media-1",
    },
    "2026-06-12T08:00:00.000Z",
  );
  assert.equal(result.changedNodeCount, 1);
  assert.equal((sceneNodes(result.metadata)[0].data as Record<string, unknown>).imageUrl, chloeUrl);
});

test("applyWorkflowAssetImageToCanvasScenes is idempotent", () => {
  const metadata = canvasMetadata([emptyCharacterNode("chloe-ref", "Chloe")]);
  const change = { assetKind: "characters" as const, assetName: "Chloe", imageUrl: chloeUrl, imageAssetId: "media-1" };
  const first = applyWorkflowAssetImageToCanvasScenes(metadata, change, "2026-06-12T08:00:00.000Z");
  const second = applyWorkflowAssetImageToCanvasScenes(first.metadata, change, "2026-06-12T09:00:00.000Z");
  assert.equal(first.changedNodeCount, 1);
  assert.equal(second.changedNodeCount, 0);
  assert.equal(second.metadata, first.metadata);
  const sceneRecord = (second.metadata.canvasScenes as Record<string, Record<string, unknown>>)["episode-canvas-episode-001"];
  assert.equal(sceneRecord.updatedAt, "2026-06-12T08:00:00.000Z");
});

test("applyWorkflowAssetImageToCanvasScenes does not mutate the input metadata", () => {
  const metadata = canvasMetadata([emptyCharacterNode("chloe-ref", "Chloe")]);
  const snapshot = JSON.stringify(metadata);
  applyWorkflowAssetImageToCanvasScenes(
    metadata,
    { assetKind: "characters", assetName: "Chloe", imageUrl: chloeUrl, imageAssetId: "media-1" },
    "2026-06-12T08:00:00.000Z",
  );
  assert.equal(JSON.stringify(metadata), snapshot);
});

test("applyWorkflowAssetImageToCanvasScenes ignores blank asset names and blank-named nodes", () => {
  const metadata = canvasMetadata([emptyCharacterNode("blank-ref", "")]);
  const result = applyWorkflowAssetImageToCanvasScenes(
    metadata,
    { assetKind: "characters", assetName: "  ", imageUrl: chloeUrl, imageAssetId: "media-1" },
    "2026-06-12T08:00:00.000Z",
  );
  assert.equal(result.changedNodeCount, 0);
  assert.equal(result.metadata, metadata);
  const data = sceneNodes(result.metadata)[0].data as Record<string, unknown>;
  assert.equal(data.imageUrl, "");
  assert.equal(data.uploadStatus, "missing");
});

test("applyWorkflowAssetImageToCanvasScenes tolerates malformed metadata structures", () => {
  const change = { assetKind: "characters" as const, assetName: "Chloe", imageUrl: chloeUrl, imageAssetId: "media-1" };
  const now = "2026-06-12T08:00:00.000Z";

  const scenesAsString = { canvasScenes: "not-a-record" };
  const scenesAsStringResult = applyWorkflowAssetImageToCanvasScenes(scenesAsString, change, now);
  assert.equal(scenesAsStringResult.changedNodeCount, 0);
  assert.equal(scenesAsStringResult.metadata, scenesAsString);

  const malformed = {
    canvasScenes: {
      "scene-nodes-string": { nodes: "not-an-array", edges: [], updatedAt: "x" },
      "scene-node-without-data": {
        nodes: [{ id: "no-data", type: "imageInput" }],
        edges: [],
        updatedAt: "x",
      },
    },
  };
  const malformedResult = applyWorkflowAssetImageToCanvasScenes(malformed, change, now);
  assert.equal(malformedResult.changedNodeCount, 0);
  assert.equal(malformedResult.metadata, malformed);
});

function episodesMetadata(): Record<string, unknown> {
  return {
    workflowCenter: { assets: { characters: [], scenes: [], props: [] } },
    episodes: {
      "episode-001": {
        id: "episode-001",
        title: "第 1 集",
        workflowCenter: {
          assets: {
            characters: [
              { id: "char-1", name: "Chloe", title: "Chloe", referenceImageUrl: chloeUrl, referenceImageAssetId: "media-1" },
            ],
            scenes: [],
            props: [],
          },
        },
      },
      "episode-002": {
        id: "episode-002",
        title: "第 2 集",
        workflowCenter: {
          assets: {
            characters: [{ id: "char-2", name: " CHLOE ", title: "Chloe" }, { id: "char-3", name: "Leo" }],
            scenes: [],
            props: [],
          },
        },
      },
      "episode-003": {
        id: "episode-003",
        title: "第 3 集",
        workflowCenter: {
          assets: {
            characters: [{ id: "char-4", name: "Chloe", generatedImageUrl: bossRoomUrl, generatedImageAssetId: "media-9" }],
            scenes: [],
            props: [],
          },
        },
      },
    },
  };
}

function episodeCharacters(metadata: Record<string, unknown>, episodeId: string): Record<string, unknown>[] {
  const episodes = metadata.episodes as Record<string, Record<string, unknown>>;
  const workflow = episodes[episodeId].workflowCenter as Record<string, unknown>;
  const assets = workflow.assets as Record<string, Record<string, unknown>[]>;
  return assets.characters;
}

test("fillMissingAssetImageAcrossEpisodes fills only episodes missing both image fields", () => {
  const metadata = episodesMetadata();
  const result = fillMissingAssetImageAcrossEpisodes(metadata, {
    assetKind: "characters",
    assetName: "Chloe",
    field: "referenceImageUrl",
    imageUrl: chloeUrl,
    imageAssetId: "media-1",
  });

  assert.deepEqual(result.changedEpisodeIds, ["episode-002"]);
  const filled = episodeCharacters(result.metadata, "episode-002")[0];
  assert.equal(filled.referenceImageUrl, chloeUrl);
  assert.equal(filled.referenceImageAssetId, "media-1");
  assert.equal(filled.name, " CHLOE ");
  const untouchedLeo = episodeCharacters(result.metadata, "episode-002")[1];
  assert.equal(untouchedLeo.referenceImageUrl, undefined);
  const untouchedGenerated = episodeCharacters(result.metadata, "episode-003")[0];
  assert.equal(untouchedGenerated.referenceImageUrl, undefined);
  assert.equal(untouchedGenerated.generatedImageUrl, bossRoomUrl);
});

test("fillMissingAssetImageAcrossEpisodes writes generatedImageUrl with matching asset id field", () => {
  const metadata = episodesMetadata();
  const result = fillMissingAssetImageAcrossEpisodes(metadata, {
    assetKind: "characters",
    assetName: "Chloe",
    field: "generatedImageUrl",
    imageUrl: chloeUrl,
    imageAssetId: "media-5",
  });
  assert.deepEqual(result.changedEpisodeIds, ["episode-002"]);
  const filled = episodeCharacters(result.metadata, "episode-002")[0];
  assert.equal(filled.generatedImageUrl, chloeUrl);
  assert.equal(filled.generatedImageAssetId, "media-5");
  assert.equal(filled.referenceImageUrl, undefined);
});

test("fillMissingAssetImageAcrossEpisodes does not propagate scene images by name", () => {
  const metadata: Record<string, unknown> = {
    episodes: {
      "episode-001": {
        workflowCenter: {
          assets: {
            characters: [],
            scenes: [{ id: "scene-1", name: "Wasteland Highway" }],
            props: [],
          },
        },
      },
    },
  };
  const result = fillMissingAssetImageAcrossEpisodes(metadata, {
    assetKind: "scenes",
    assetName: "Wasteland Highway",
    field: "generatedImageUrl",
    imageUrl: bossRoomUrl,
    imageAssetId: "media-scene",
  });
  assert.deepEqual(result.changedEpisodeIds, []);
  assert.equal(result.metadata, metadata);
});

test("fillMissingAssetImageAcrossEpisodes does not propagate prop images by name", () => {
  const metadata: Record<string, unknown> = {
    episodes: {
      "episode-001": {
        workflowCenter: {
          assets: {
            characters: [],
            scenes: [],
            props: [{ id: "prop-1", name: "Broken Door" }],
          },
        },
      },
    },
  };
  const result = fillMissingAssetImageAcrossEpisodes(metadata, {
    assetKind: "props",
    assetName: "Broken Door",
    field: "referenceImageUrl",
    imageUrl: bossRoomUrl,
    imageAssetId: "media-prop",
  });
  assert.deepEqual(result.changedEpisodeIds, []);
  assert.equal(result.metadata, metadata);
});

test("fillMissingAssetImageAcrossEpisodes does nothing for an empty image url", () => {
  const metadata = episodesMetadata();
  const result = fillMissingAssetImageAcrossEpisodes(metadata, {
    assetKind: "characters",
    assetName: "Chloe",
    field: "referenceImageUrl",
    imageUrl: "",
    imageAssetId: "media-1",
  });
  assert.deepEqual(result.changedEpisodeIds, []);
  assert.equal(result.metadata, metadata);
});

test("fillMissingAssetImageAcrossEpisodes does not mutate the input metadata", () => {
  const metadata = episodesMetadata();
  const snapshot = JSON.stringify(metadata);
  fillMissingAssetImageAcrossEpisodes(metadata, {
    assetKind: "characters",
    assetName: "Chloe",
    field: "referenceImageUrl",
    imageUrl: chloeUrl,
    imageAssetId: "media-1",
  });
  assert.equal(JSON.stringify(metadata), snapshot);
});

test("fillMissingAssetImageAcrossEpisodes ignores blank asset names and blank-named assets", () => {
  const metadata = {
    episodes: {
      "episode-001": {
        id: "episode-001",
        workflowCenter: {
          assets: { characters: [{ id: "char-blank", name: "", title: "" }], scenes: [], props: [] },
        },
      },
    },
  };
  const result = fillMissingAssetImageAcrossEpisodes(metadata, {
    assetKind: "characters",
    assetName: "  ",
    field: "referenceImageUrl",
    imageUrl: chloeUrl,
    imageAssetId: "media-1",
  });
  assert.deepEqual(result.changedEpisodeIds, []);
  assert.equal(result.metadata, metadata);
  const asset = episodeCharacters(result.metadata, "episode-001")[0];
  assert.equal(asset.referenceImageUrl, undefined);
  assert.equal(asset.referenceImageAssetId, undefined);
});

test("canvasSyncableImageUrl passes through https urls unchanged", () => {
  assert.equal(canvasSyncableImageUrl(chloeUrl), chloeUrl);
});

test("canvasSyncableImageUrl returns an empty string for data urls", () => {
  assert.equal(canvasSyncableImageUrl("data:image/png;base64,iVBORw0KGgo="), "");
});
