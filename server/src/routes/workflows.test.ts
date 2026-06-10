import assert from "node:assert/strict";
import test from "node:test";
import { workflowsTestInternals } from "./workflows";

test("Dreamina Web video timeout without submit id is reported as not submitted", () => {
  const result = workflowsTestInternals.canvasVideoResultFailureMessage({
    provider: "dreamina-web",
    result: {
      genStatus: "missing-submit-id-timeout",
    },
  });

  assert.match(result, /未成功提交/);
  assert.match(result, /未拿到 submit_id/);
  assert.doesNotMatch(result, /后台处理中/);
});

test("Dreamina Web timeout with submit id keeps background-processing guidance", () => {
  const result = workflowsTestInternals.formatDreaminaGenerationFailure(new Error("TimeoutError: timed out while querying submit id abc"));

  assert.match(result, /可能仍在后台处理中/);
  assert.match(result, /submit_id/);
});

test("Dreamina Web reference upload timeout is not reported as background generation", () => {
  const result = workflowsTestInternals.formatDreaminaGenerationFailure(
    new Error("Dreamina Web 参考素材上传到页面超时：本次 7 个文件，已等待 185 秒。素材还没成功进入 Dreamina 输入框，未提交生成，未拿到 submit_id；请减少参考素材或稍后重试。"),
  );

  assert.match(result, /参考素材上传到页面超时/);
  assert.match(result, /未提交生成/);
  assert.doesNotMatch(result, /可能仍在后台处理中/);
});

test("video prompt finalizer keeps P beats and exact dialogue under Dreamina Web limit", () => {
  const longPrompt = [
    "Generate one continuous 10-second vertical cinematic video, aspect ratio 9:16.",
    `Style: ${"masterpiece cinematic saturated dark-comedy 3D American animated sitcom ".repeat(45)}`,
    `Characters: Chloe = use Chloe's connected character reference image; Leo = use Leo's connected character reference image; Tiffany = use Tiffany's connected character reference image; Eugene = use Eugene's connected character reference image. ${"Keep identity locked. ".repeat(30)}`,
    `Scene: laser-filled cosmetic lab. ${"glossy beauty machinery, purple lasers, poster wall, continuity geography. ".repeat(30)}`,
    `P1 / S1 - Physics Hack: Camera medium shot. ${"Chloe aims upward, shotgun blast hits ceiling laser emitter, sparks fly. ".repeat(18)} Chloe: Then I will hack them with physics!`,
    `P2 / S2 - Poster Ruined: Camera medium shot. ${"Purple laser slices Tiffany poster while the team reacts. ".repeat(18)} Tiffany: You ruined my Photoshopped poster!!! Tiffany: That picture removed 50% of my wrinkles!!!`,
    `P3 / S3 - Face Cracks Open: Camera close-up. ${"Tiffany's fake beauty face fractures into shark-toothed rage mask, needle arms rise. ".repeat(18)} Tiffany: Die! You ugly haters!!!`,
  ].join("\n");

  const result = workflowsTestInternals.finalizeWorkflowVideoPrompt(longPrompt);

  assert.ok(result.length <= 3900, `expected <= 3900 chars, got ${result.length}`);
  assert.match(result, /P1:/);
  assert.match(result, /P2:/);
  assert.match(result, /P3:/);
  assert.match(result, /Chloe: Then I will hack them with physics!/);
  assert.match(result, /Tiffany: You ruined my Photoshopped poster!!!/);
  assert.match(result, /Tiffany: Die! You ugly haters!!!/);
});

test("canvas video ratio resolves adaptive from prompt aspect ratio", () => {
  assert.equal(
    workflowsTestInternals.normalizeCanvasVideoRatio(
      "adaptive",
      "Generate one continuous video, aspect ratio 9:16.",
      "16:9",
    ),
    "9:16",
  );
  assert.equal(workflowsTestInternals.normalizeCanvasVideoRatio("16:9", "aspect ratio 9:16", "9:16"), "16:9");
});

test("Dreamina query raw extracts existing generated video urls", () => {
  const urls = workflowsTestInternals.dreaminaExistingVideoUrlsFromRaw({
    dom: {
      ignoredVideoUrls: [
        "https://v16-cc.capcut.com/old/video/tos/alisg/file.mp4?mime_type=video_mp4",
        "https://v16-cc.capcut.com/audio/ref.wav?mime_type=audio_wav",
      ],
    },
    result: {
      summary: JSON.stringify({
        dom: {
          ignoredVideoUrls: ["https://v16-cc.capcut.com/older/video/tos/alisg/file.mp4?mime_type=video_mp4"],
        },
      }),
    },
  });

  assert.deepEqual(urls.sort(), [
    "https://v16-cc.capcut.com/old/video/tos/alisg/file.mp4?mime_type=video_mp4",
    "https://v16-cc.capcut.com/older/video/tos/alisg/file.mp4?mime_type=video_mp4",
  ].sort());
});

test("prompt optimization cleaner extracts optimized prompt from json fences", () => {
  const result = workflowsTestInternals.cleanOptimizedPrompt('```json\n{"optimizedPrompt":"P1: staged comedy malfunction. Chloe: Keep moving!"}\n```');

  assert.equal(result, "P1: staged comedy malfunction. Chloe: Keep moving!");
});

test("prompt optimization detects missing character dialogue", () => {
  const missing = workflowsTestInternals.missingPreservedDialogueFragments(
    'P1: chaotic elevator motion. Chloe: Keep moving! Bob: I hate this place.',
    'P1: stylized elevator malfunction. Chloe: Keep moving!',
  );

  assert.deepEqual(missing, ["Bob: I hate this place."]);
});
