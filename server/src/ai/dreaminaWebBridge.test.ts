import assert from "node:assert/strict";
import test from "node:test";
import {
  dreaminaMediaExtensionForTest,
  dreaminaReferenceImageDescriptorForTest,
  dreaminaWebBrowserTaskForTest,
  dreaminaWebExclusiveTaskForTest,
  dreaminaReferenceMediaForTest,
  dreaminaReferenceSnapshotForTest,
  dreaminaReferenceStatsFromSnapshotsForTest,
  dreaminaReferenceUploadAcceptedForTest,
  dreaminaWebVideoDomFailureMessageAfterSubmissionForTest,
  dreaminaWebVideoDomFailureMessageForTest,
  dreaminaWebVideoPendingStatusForTest,
  dreaminaWebVideoResultForSubmitIdForTest,
  dreaminaWebVideoResultFromPayloadsForTest,
  dreaminaWebRuntimeVideoModelForTest,
  stableDreaminaWebVideoDurationSecondsForTest,
} from "./dreaminaWebBridge";

const submittedAt = 1_780_758_000_000;
const generatedVideoUrl = "https://v16-cc.capcut.com/token/video/tos/alisg/tos-alisg-ve-14178-sg/file.mp4?mime_type=video_mp4";

test("Dreamina Web video parser ignores credit-history payloads with old videos", () => {
  const result = dreaminaWebVideoResultFromPayloadsForTest([{
    url: "https://commerce-api-sg.capcut.com/commerce/v1/benefits/user_credit_history",
    capturedAt: submittedAt + 1000,
    payload: {
      ret: "0",
      errmsg: "success",
      response: JSON.stringify({
        total_credit: 50717,
        records: [{
          title: "Generate",
          status: "Checked",
          submit_id: "old-submit-id",
          extra_content: "dre_m10n_credits_returned",
          video_url: generatedVideoUrl,
        }],
      }),
    },
  }], { submittedAt, existingVideoKeys: new Set() });

  assert.equal(result.submitId, undefined);
  assert.equal(result.videoUrl, undefined);
  assert.equal(result.genStatus, undefined);
});

test("Dreamina Web video parser accepts non-history generated video payloads", () => {
  const result = dreaminaWebVideoResultFromPayloadsForTest([{
    url: "https://www.dreamina.capcut.com/ai-tool/video/task",
    capturedAt: submittedAt + 1000,
    payload: {
      submit_id: "new-submit-id",
      status: "success",
      data: {
        video_url: generatedVideoUrl,
      },
    },
  }], { submittedAt, existingVideoKeys: new Set() });

  assert.equal(result.submitId, "new-submit-id");
  assert.equal(result.videoUrl, generatedVideoUrl);
  assert.equal(result.genStatus, "succeeded");
});

test("Dreamina Web video parser scopes get_history_by_ids to requested record", () => {
  const targetVideoUrl = "https://v16-cc.capcut.com/new/video/tos/alisg/tos-alisg-ve-14178-sg/target.mp4?mime_type=video_mp4";
  const staleVideoUrl = "https://v16-cc.capcut.com/old/video/tos/alisg/tos-alisg-ve-14178-sg/stale.mp4?mime_type=video_mp4";
  const payload = {
    ret: "0",
    errmsg: "success",
    data: {
      "22000000000001": {
        history_record_id: "22000000000001",
        status: 50,
        item_list: [{ video: { transcoded_video: { origin: { video_url: staleVideoUrl } } } }],
      },
      "22000000000002": {
        history_record_id: "22000000000002",
        status: 50,
        item_list: [{ video: { transcoded_video: { origin: { video_url: targetVideoUrl } } } }],
      },
    },
  };
  const result = dreaminaWebVideoResultForSubmitIdForTest([{
    url: "https://mweb-api-sg.capcut.com/mweb/v1/get_history_by_ids",
    capturedAt: submittedAt + 1000,
    payload,
  }], "22000000000002");

  assert.equal(result.submitId, "22000000000002");
  assert.equal(result.videoUrl, targetVideoUrl);
  assert.equal(result.genStatus, "succeeded");
});

test("Dreamina Web video parser marks finished empty history records as failed", () => {
  const payload = {
    ret: "0",
    errmsg: "success",
    data: {
      "22093844289028": {
        history_record_id: "22093844289028",
        status: 30,
        item_list: [],
        origin_item_list: [],
        task: {
          task_id: "22093844289028",
          submit_id: "32362d23-097d-49cf-8928-c86a6e7a31dc",
          status: 10,
          finish_time: 1780838158,
          history_id: "22093844289028",
        },
      },
    },
  };
  const result = dreaminaWebVideoResultForSubmitIdForTest([{
    url: "https://mweb-api-sg.capcut.com/mweb/v1/get_history_by_ids",
    capturedAt: submittedAt + 1000,
    payload,
  }], "22093844289028");

  assert.equal(result.submitId, "22093844289028");
  assert.equal(result.videoUrl, undefined);
  assert.equal(result.genStatus, "failed");
});

test("Dreamina Web video parser rejects running draft payload audio urls", () => {
  const audioUrl = "https://v16-cc.capcut.com/token/video/tos/alisg/tos-alisg-v-14178-sg/audio-ref/?mime_type=audio_wav";
  const result = dreaminaWebVideoResultFromPayloadsForTest([{
    url: "https://mweb-api-sg.capcut.com/mweb/v1/aigc_draft/generate",
    capturedAt: submittedAt + 1000,
    payload: {
      ret: "0",
      errmsg: "success",
      data: {
        aigc_data: {
          history_record_id: "22088650298884",
          item_list: [],
          status: 20,
          task: {
            task_id: "22088650298884",
            submit_id: "01d6a5bf-08ff-4304-8d3a-d44c329b10d9",
            status: 20,
            finish_time: 0,
          },
          draft_content: JSON.stringify({
            component_list: [{
              abilities: {
                gen_video: {
                  text_to_video_params: {
                    video_gen_inputs: [{
                      unified_edit_input: {
                        material_list: [{
                          material_type: "audio",
                          audio_info: {
                            url: audioUrl,
                          },
                        }],
                      },
                    }],
                  },
                },
              },
            }],
          }),
        },
      },
    },
  }], { submittedAt, existingVideoKeys: new Set() });

  assert.equal(result.submitId, "22088650298884");
  assert.equal(result.videoUrl, undefined);
  assert.equal(result.genStatus, "running");
});

test("Dreamina Web video parser rejects audio mime urls even on video host", () => {
  const result = dreaminaWebVideoResultFromPayloadsForTest([{
    url: "https://www.dreamina.capcut.com/ai-tool/video/task",
    capturedAt: submittedAt + 1000,
    payload: {
      submit_id: "new-submit-id",
      status: "success",
      data: {
        video_url: "https://v16-cc.capcut.com/token/video/tos/alisg/tos-alisg-v-14178-sg/audio-ref/?mime_type=audio_wav",
      },
    },
  }], { submittedAt, existingVideoKeys: new Set() });

  assert.equal(result.submitId, "new-submit-id");
  assert.equal(result.videoUrl, undefined);
  assert.equal(result.genStatus, "running");
});

test("Dreamina Web video DOM failure parser detects inappropriate audio review failure", () => {
  const message = dreaminaWebVideoDomFailureMessageForTest("The audio may contain inappropriate content · Give feedback");

  assert.match(message, /审核失败/);
  assert.match(message, /inappropriate content/);
});

test("Dreamina Web video DOM failure ignores stale review failures before submit", () => {
  const bodyText = "Previous task · The audio may contain inappropriate content · Give feedback";

  assert.equal(dreaminaWebVideoDomFailureMessageAfterSubmissionForTest(bodyText, 1, 1), "");
  assert.match(dreaminaWebVideoDomFailureMessageAfterSubmissionForTest(bodyText, 1, 2), /审核失败/);
});

test("Dreamina Web video DOM failure ignores active generating text", () => {
  const bodyText = "No subtitles, speech bubbles, UI. AI Video Dreamina Seedance 2.0 Fast Omni reference 9:16 11s 209 0 / 1 Generating... Go to bottom";

  assert.equal(dreaminaWebVideoDomFailureMessageForTest(bodyText), "");
  assert.deepEqual(
    dreaminaWebVideoPendingStatusForTest({ latestSubmitId: "22091599909892", bodyTail: bodyText }),
    { submitId: "22091599909892", genStatus: "running" },
  );
});

test("Dreamina Web video DOM failure ignores story words like shark-toothed", () => {
  const bodyText = "Tiffany's fake beauty face fractures; her mouth opens into a shark-toothed rage mask. AI Video Dreamina Seedance 2.0 Fast Omni reference 9:16 11s 209 Go to bottom";

  assert.equal(dreaminaWebVideoDomFailureMessageForTest(bodyText), "");
});

test("Dreamina Web video runtime duration uses the stable Dreamina range", () => {
  assert.equal(stableDreaminaWebVideoDurationSecondsForTest(15), 10);
  assert.equal(stableDreaminaWebVideoDurationSecondsForTest(12), 10);
  assert.equal(stableDreaminaWebVideoDurationSecondsForTest(8), 8);
});

test("Dreamina Web runtime uses Seedance 2.0 Fast model key", () => {
  assert.deepEqual(dreaminaWebRuntimeVideoModelForTest(), {
    key: "dreamina_seedance_40_vision",
    label: "Dreamina Seedance 2.0 Fast",
  });
});

test("Dreamina Web reference descriptors stay neutral", () => {
  const descriptor = dreaminaReferenceImageDescriptorForTest(0, "https://loohii.com/Chloe-Zombie-Flora.png");

  assert.equal(descriptor.label, "Reference image #1");
  assert.equal(descriptor.baseName, "reference-1-reference-image-1");
});

test("Dreamina Web video media references include images and audio", () => {
  const media = dreaminaReferenceMediaForTest({
    imageUrls: [
      "https://loohii.com/api/uploads/public/project/storyboard.png",
      "https://loohii.com/api/uploads/public/project/storyboard.png",
      "/api/uploads/public/project/local.png",
    ],
    audioUrls: [
      "https://loohii.com/api/uploads/public/project/tiffany.wav",
      "https://loohii.com/api/uploads/public/project/leo.mp3",
      "https://loohii.com/api/uploads/public/project/tiffany.wav",
    ],
  });

  assert.deepEqual(media.imageUrls, ["https://loohii.com/api/uploads/public/project/storyboard.png"]);
  assert.deepEqual(media.audioUrls, [
    "https://loohii.com/api/uploads/public/project/tiffany.wav",
    "https://loohii.com/api/uploads/public/project/leo.mp3",
  ]);
  assert.equal(dreaminaMediaExtensionForTest("audio/wav", "", "audio"), ".wav");
  assert.equal(dreaminaMediaExtensionForTest("", "https://example.com/ref.MP3?x=1", "audio"), ".mp3");
});

test("Dreamina Web upload validation rejects missing accepted audio references", () => {
  assert.throws(() => {
    dreaminaReferenceUploadAcceptedForTest({
      imageUrls: [
        "https://loohii.com/api/uploads/public/project/storyboard.png",
        "https://loohii.com/api/uploads/public/project/chloe.png",
      ],
      audioUrls: [
        "https://loohii.com/api/uploads/public/project/tiffany.wav",
      ],
      stats: {
        itemCount: 2,
        imageCount: 2,
        audioCount: 0,
        videoCount: 0,
        placeholderCount: 1,
        unknownCount: 0,
        samples: [],
      },
    });
  }, /素材上传校验失败/);
});

test("Dreamina Web upload preflight ignores empty reference placeholders", () => {
  assert.doesNotThrow(() => {
    dreaminaReferenceUploadAcceptedForTest({
      imageUrls: [
        "https://loohii.com/api/uploads/public/project/storyboard.png",
        "https://loohii.com/api/uploads/public/project/chloe.png",
      ],
      audioUrls: [
        "https://loohii.com/api/uploads/public/project/tiffany.wav",
      ],
      stats: {
        itemCount: 3,
        imageCount: 2,
        audioCount: 1,
        videoCount: 0,
        placeholderCount: 4,
        unknownCount: 0,
        samples: [],
      },
    });
  });
});

test("Dreamina Web reference stats count current composer images and audio attachments", () => {
  const snapshots = [
    dreaminaReferenceSnapshotForTest({
      id: 1,
      tag: "DIV",
      text: "audio-1audio-2Reference",
      className: "references-EYbH7N",
      src: "blob:https://dreamina.capcut.com/image-1",
      width: 64,
      height: 80,
    }),
    dreaminaReferenceSnapshotForTest({
      id: 2,
      parentId: 1,
      tag: "DIV",
      text: "audio-1audio-2Reference",
      className: "reference-group-content-CXcjLK",
      src: "blob:https://dreamina.capcut.com/image-1",
      width: 64,
      height: 108,
    }),
    ...[1, 2, 3, 4, 5].flatMap((index) => [
      dreaminaReferenceSnapshotForTest({
        id: 10 + index,
        parentId: 2,
        tag: "DIV",
        className: "reference-item-eaLRWm",
        src: `blob:https://dreamina.capcut.com/image-${index}`,
        hasImage: true,
        width: 48,
        height: 64,
      }),
      dreaminaReferenceSnapshotForTest({
        id: 20 + index,
        parentId: 10 + index,
        tag: "DIV",
        className: "reference-CPVSqq",
        src: `blob:https://dreamina.capcut.com/image-${index}`,
        hasImage: true,
        width: 56,
        height: 70,
      }),
    ]),
    dreaminaReferenceSnapshotForTest({
      id: 40,
      parentId: 2,
      tag: "DIV",
      text: "audio-1",
      className: "reference-item-eaLRWm",
      width: 48,
      height: 64,
    }),
    dreaminaReferenceSnapshotForTest({
      id: 41,
      parentId: 40,
      tag: "DIV",
      text: "audio-1",
      className: "reference-CPVSqq reference-attachment-wRZnrO",
      width: 52,
      height: 67,
    }),
    dreaminaReferenceSnapshotForTest({
      id: 42,
      parentId: 2,
      tag: "DIV",
      text: "audio-2",
      className: "reference-item-eaLRWm",
      width: 48,
      height: 64,
    }),
    dreaminaReferenceSnapshotForTest({
      id: 43,
      parentId: 42,
      tag: "DIV",
      text: "audio-2",
      className: "reference-CPVSqq reference-attachment-wRZnrO",
      width: 55,
      height: 69,
    }),
    dreaminaReferenceSnapshotForTest({
      id: 44,
      parentId: 2,
      tag: "DIV",
      text: "Reference",
      className: "reference-item-eaLRWm",
      width: 48,
      height: 64,
    }),
    dreaminaReferenceSnapshotForTest({
      id: 45,
      parentId: 44,
      tag: "DIV",
      text: "Reference",
      className: "reference-upload-AuhJL3 mini-d90Ner",
      width: 28,
      height: 28,
    }),
    dreaminaReferenceSnapshotForTest({
      id: 80,
      tag: "DIV",
      className: "reference-item-WO0i4n",
      src: "https://p16-dreamina-sign-sg.ibyteimg.com/history-image",
      historyClosest: true,
      hasImage: true,
      width: 36,
      height: 48,
    }),
  ];

  const stats = dreaminaReferenceStatsFromSnapshotsForTest(snapshots);

  assert.equal(stats.imageCount, 5);
  assert.equal(stats.audioCount, 2);
  assert.equal(stats.videoCount, 0);
  assert.equal(stats.placeholderCount, 1);
  assert.equal(stats.itemCount, 7);
});

test("Dreamina Web reference stats ignore history images when composer only has audio", () => {
  const snapshots = [
    dreaminaReferenceSnapshotForTest({
      id: 1,
      tag: "DIV",
      text: "audio-1Reference",
      className: "references-EYbH7N",
      width: 64,
      height: 80,
    }),
    dreaminaReferenceSnapshotForTest({
      id: 2,
      parentId: 1,
      tag: "DIV",
      text: "audio-1Reference",
      className: "reference-group-content-CXcjLK",
      width: 64,
      height: 108,
    }),
    dreaminaReferenceSnapshotForTest({
      id: 3,
      parentId: 2,
      tag: "DIV",
      text: "audio-1",
      className: "reference-item-eaLRWm",
      width: 48,
      height: 64,
    }),
    dreaminaReferenceSnapshotForTest({
      id: 4,
      parentId: 3,
      tag: "DIV",
      text: "audio-1",
      className: "reference-CPVSqq reference-attachment-wRZnrO",
      width: 55,
      height: 69,
    }),
    dreaminaReferenceSnapshotForTest({
      id: 5,
      parentId: 2,
      tag: "DIV",
      text: "Reference",
      className: "reference-item-eaLRWm",
      width: 48,
      height: 64,
    }),
    ...[1, 2, 3, 4, 5, 6].map((index) => dreaminaReferenceSnapshotForTest({
      id: 20 + index,
      tag: "DIV",
      className: "reference-item-WO0i4n",
      src: `https://p16-dreamina-sign-sg.ibyteimg.com/history-image-${index}.webp`,
      historyClosest: true,
      hasImage: true,
      width: 36,
      height: 48,
    })),
  ];

  const stats = dreaminaReferenceStatsFromSnapshotsForTest(snapshots);

  assert.equal(stats.imageCount, 0);
  assert.equal(stats.audioCount, 1);
  assert.equal(stats.placeholderCount, 1);
  assert.equal(stats.itemCount, 1);
});

test("Dreamina Web bridge rejects concurrent browser tasks", async () => {
  const first = dreaminaWebExclusiveTaskForTest("first", async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return "done";
  });

  await assert.rejects(
    () => dreaminaWebExclusiveTaskForTest("second", async () => "second"),
    /Dreamina Web 正在处理另一个素材上传\/生成任务/,
  );

  assert.equal(await first, "done");
  assert.equal(await dreaminaWebExclusiveTaskForTest("third", async () => "third"), "third");
});

test("Dreamina Web video result query does not block a new browser generation task", async () => {
  let releaseQuery: () => void = () => {
    throw new Error("Query task did not start.");
  };
  const query = dreaminaWebBrowserTaskForTest("video-query", async () => {
    await new Promise<void>((resolve) => {
      releaseQuery = resolve;
    });
    return "query";
  });

  assert.equal(await dreaminaWebBrowserTaskForTest("video-generation", async () => "generation"), "generation");
  releaseQuery();
  assert.equal(await query, "query");
});

test("Dreamina Web video wait does not mark no-submit-id DOM activity as queryable running task", () => {
  const result = dreaminaWebVideoPendingStatusForTest({ bodyTail: "Generating 0 / 1" });

  assert.equal(result.submitId, undefined);
  assert.equal(result.genStatus, "missing-submit-id-timeout");
});
