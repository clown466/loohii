import assert from "node:assert/strict";
import test from "node:test";
import { restoreSucceededCanvasVideoNodesFromRecords, type CanvasVideoGenerationRecord } from "./canvasSucceededVideoNodes";

const videoUrl = "https://v16-cc.capcut.com/demo/video.mp4?mime_type=video_mp4";

const records: CanvasVideoGenerationRecord[] = [{
  id: "gen-1",
  providerJobId: "submit-1",
  assets: [{
    id: "asset-1",
    type: "VIDEO",
    url: videoUrl,
    mimeType: "video/mp4",
    durationMs: 10000,
  }],
}];

test("restores a failed canvas video node from a succeeded generation asset", () => {
  const input = [{
    id: "video-1",
    type: "video",
    data: {
      status: "failed",
      videoStatus: "failed",
      generationId: "gen-1",
      videoError: "Dreamina Web 视频任务失败",
      outputVideo: "",
    },
  }];

  const result = restoreSucceededCanvasVideoNodesFromRecords(input, records);
  assert.equal(result.changed, true);
  const node = result.nodes[0] as Record<string, unknown>;
  const data = node.data as Record<string, unknown>;
  assert.equal(data.status, "completed");
  assert.equal(data.videoStatus, "completed");
  assert.equal(data.generationStatus, "succeeded");
  assert.equal(data.videoError, "");
  assert.equal(data.outputVideo, videoUrl);
  assert.equal(data.outputVideoAssetId, "asset-1");
  assert.equal(data.videoGenerationRequestId, "gen-1");
  assert.equal(data.videoSubmitId, "submit-1");
  assert.equal(data.durationSeconds, 10);
  assert.deepEqual(data.generatedVideo, {
    url: videoUrl,
    assetId: "asset-1",
    generationId: "gen-1",
    mimeType: "video/mp4",
    submitId: "submit-1",
    durationSeconds: 10,
  });
});

test("restores a video node when only the provider submit id is present", () => {
  const input = [{
    id: "video-1",
    type: "video",
    data: {
      status: "failed",
      videoSubmitId: "submit-1",
      outputVideo: "",
    },
  }];

  const result = restoreSucceededCanvasVideoNodesFromRecords(input, records);
  const data = (result.nodes[0] as Record<string, unknown>).data as Record<string, unknown>;
  assert.equal(result.changed, true);
  assert.equal(data.generationId, "gen-1");
  assert.equal(data.outputVideo, videoUrl);
});

test("does not change unrelated video nodes", () => {
  const input = [{
    id: "video-1",
    type: "video",
    data: {
      status: "failed",
      generationId: "other-gen",
      outputVideo: "",
    },
  }];

  const result = restoreSucceededCanvasVideoNodesFromRecords(input, records);
  assert.equal(result.changed, false);
  assert.equal(result.nodes, input);
});

test("is idempotent after restoring a video node", () => {
  const input = [{
    id: "video-1",
    type: "video",
    data: {
      status: "failed",
      generationId: "gen-1",
      outputVideo: "",
    },
  }];

  const first = restoreSucceededCanvasVideoNodesFromRecords(input, records);
  const second = restoreSucceededCanvasVideoNodesFromRecords(first.nodes, records);
  assert.equal(second.changed, false);
  assert.equal(second.nodes, first.nodes);
});
