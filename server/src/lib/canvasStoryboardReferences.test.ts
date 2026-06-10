import assert from "node:assert/strict";
import test from "node:test";
import { buildEpisodeCanvasSyncScene } from "./episodeCanvasSync";
import { normalizeCanvasStoryboardReferencesForScene, storyboardReferencesFromGenerationRecords, type CanvasStoryboardGenerationRecord } from "./canvasStoryboardReferences";

const metadata = {
  episodes: {
    "episode-002": {
      title: "第 2 集",
      workflowCenter: {
        clips: [
          {
            id: "clip-001",
            title: "Clip 01 · Needles Against Pan",
            storyboardPrompt: "Panel 1: show Leo blocking Tiffany.",
          },
        ],
      },
    },
  },
};

test("legacy technical-label storyboard generations are not restored as current storyboard images", () => {
  const legacyRecord: CanvasStoryboardGenerationRecord = {
    status: "SUCCEEDED",
    createdAt: "2026-06-03T12:51:10.000Z",
    prompt:
      "Create one 16:9 clip-level director board image. Each panel must include an image area and a compact technical label strip below it. Panel 1: camera=wide | action=Leo blocks Tiffany | exact dialogue=Tiffany: ugly chef.",
    input: {
      kind: "canvas-image-generation",
      metadata: {
        sourceEpisodeId: "episode-002",
        clipId: "clip-001",
        clipNodeKind: "storyboard",
        storyboardForClip: true,
      },
    },
    assets: [{
      id: "old-image",
      type: "IMAGE",
      url: "https://loohii.com/api/uploads/public/user/generated/project/old.png",
      metadata: {
        sourceEpisodeId: "episode-002",
        clipId: "clip-001",
        clipNodeKind: "storyboard",
        storyboardForClip: true,
      },
    }],
  };

  assert.deepEqual(storyboardReferencesFromGenerationRecords([legacyRecord], metadata, "episode-002"), []);
});

test("comic storyboard generations can still be restored", () => {
  const comicRecord: CanvasStoryboardGenerationRecord = {
    status: "SUCCEEDED",
    createdAt: "2026-06-03T13:20:10.000Z",
    prompt:
      "Create one 16:9 multi-panel 3D American comic storyboard image. Storyboard layout: one 16:9 multi-panel comic page using 8 large sequential panels. Panel 1: show Leo blocking Tiffany; speech bubble: Tiffany: ugly chef.",
    input: {
      kind: "canvas-image-generation",
      metadata: {
        sourceEpisodeId: "episode-002",
        clipId: "clip-001",
        clipNodeKind: "storyboard",
        storyboardForClip: true,
      },
    },
    assets: [{
      id: "new-image",
      type: "IMAGE",
      url: "https://loohii.com/api/uploads/public/user/generated/project/new.png",
      metadata: {
        sourceEpisodeId: "episode-002",
        clipId: "clip-001",
        clipNodeKind: "storyboard",
        storyboardForClip: true,
      },
    }],
  };

  const refs = storyboardReferencesFromGenerationRecords([comicRecord], metadata, "episode-002");
  assert.equal(refs.length, 1);
  assert.equal(refs[0].clipId, "clip-001");
  assert.equal(refs[0].assetId, "new-image");
});

test("episode canvas sync keeps storyboard layout after reference map cleanup", () => {
  const sync = buildEpisodeCanvasSyncScene({
    episodeId: "episode-002",
    metadata: {
      episodes: {
        "episode-002": {
          title: "第 2 集",
          workflowCenter: {
            selectedEpisode: "第 2 集",
            breakdownScenes: [],
            assets: {},
            clips: [{
              id: "clip-001",
              title: "Clip 01 · Needles Against Pan",
              characters: [],
              storyboardPrompt: [
                "Reference image map:",
                "#1: Character (Chloe); identity source for Chloe.",
                "Character bindings: Chloe=Reference image #1.",
                "",
                "Storyboard layout: one 16:9 multi-panel comic page using 8 large sequential panels in left-to-right, top-to-bottom reading order.",
                "Comic panels in reading order:",
                "Panel 1: show Leo blocking Tiffany; speech bubble: Tiffany: ugly chef.",
              ].join("\n"),
            }],
          },
        },
      },
    },
  });

  const storyNode = sync.nodes.find((node) => node.id === "episode-sync-storyboard-episode-002-clip-001");
  const prompt = String(storyNode?.data?.prompt || "");
  assert.match(prompt, /Storyboard layout: one 16:9 multi-panel comic page/i);
  assert.match(prompt, /Panel 1: show Leo blocking Tiffany/i);
  assert.doesNotMatch(prompt, /^Reference image map:[\s\S]*Reference image map:/i);
  assert.doesNotMatch(prompt, /^Reference image map:[\s\S]*\beach panel\. Show/i);
});

test("episode canvas sync finalizes legacy workflow storyboard prompts before canvas import", () => {
  const sync = buildEpisodeCanvasSyncScene({
    episodeId: "episode-002",
    metadata: {
      episodes: {
        "episode-002": {
          title: "第 2 集",
          workflowCenter: {
            selectedEpisode: "第 2 集",
            breakdownScenes: [],
            assets: {},
            clips: [{
              id: "clip-001",
              title: "Clip 01 · Pan Versus Needles",
              characters: ["Leo", "Tiffany"],
              storyboardPanelCount: 8,
              storyboardPrompt: [
                "Create one 16:9 clip-level director board image.",
                "Shots to cover across the panels:",
                "Shot 01 (4s) | title=Pan Versus Needles | camera=wide, eye-level, slow push-in, 24mm | action=Leo raises Leo's Magic Pan against Tiffany's giant toxic needles. | dialogue=Tiffany: Is that stupid pan all you have? You ugly chef!",
                "Panel beats to render in order:",
                "Panel 1: camera=wide, eye-level, slow push-in, 24mm | action=Leo raises Leo's Magic Pan against Tiffany's giant toxic needles. | exact dialogue=Tiffany: Is that stupid pan all you have? You ugly chef!; technical label strip includes shot size, angle, movement, lens, action, key prop, and exact dialogue if any.",
                "Technical labels under each panel: shot size, camera angle, camera movement, lens/focal length, character action, key prop, exact dialogue line if any.",
              ].join("\n"),
            }],
          },
        },
      },
    },
  });

  const storyNode = sync.nodes.find((node) => node.id === "episode-sync-storyboard-episode-002-clip-001");
  const prompt = String(storyNode?.data?.prompt || "");
  assert.match(prompt, /Storyboard layout: one 16:9 compact multi-panel comic page using 8 sequential panels/i);
  assert.match(prompt, /vertical-video-friendly frames/i);
  assert.match(prompt, /do not duplicate the same character multiple times inside one panel/i);
  assert.match(prompt, /Story beats to show across the comic panels:/);
  assert.match(prompt, /Comic panels in reading order:/);
  assert.match(prompt, /speech bubble: Tiffany: Is that stupid pan all you have\? You ugly chef!/);
  assert.doesNotMatch(prompt, /\bcamera\s*=/i);
  assert.doesNotMatch(prompt, /\bexact dialogue\s*=/i);
  assert.doesNotMatch(prompt, /technical label strip/i);
  assert.doesNotMatch(prompt, /Technical labels under each panel/i);
});

test("localhost generated storyboard URLs are converted to public site URLs", () => {
  const comicRecord: CanvasStoryboardGenerationRecord = {
    status: "SUCCEEDED",
    createdAt: "2026-06-03T13:20:10.000Z",
    prompt:
      "Create one 16:9 multi-panel 3D American comic storyboard image. Storyboard layout: one 16:9 multi-panel comic page using 8 large sequential panels. Panel 1: show Leo blocking Tiffany; speech bubble: Tiffany: ugly chef.",
    input: {
      kind: "canvas-image-generation",
      metadata: {
        sourceEpisodeId: "episode-002",
        clipId: "clip-001",
        clipNodeKind: "storyboard",
        storyboardForClip: true,
      },
    },
    assets: [{
      id: "new-image",
      type: "IMAGE",
      url: "http://127.0.0.1:3021/api/uploads/public/user/generated/project/new.png",
      metadata: {
        sourceEpisodeId: "episode-002",
        clipId: "clip-001",
        clipNodeKind: "storyboard",
        storyboardForClip: true,
      },
    }],
  };

  const refs = storyboardReferencesFromGenerationRecords([comicRecord], metadata, "episode-002");
  assert.equal(refs.length, 1);
  assert.equal(refs[0].url, "https://loohii.com/api/uploads/public/user/generated/project/new.png");
});

test("episode canvas sync connects clip character references into video nodes", () => {
  const sync = buildEpisodeCanvasSyncScene({
    episodeId: "episode-002",
    metadata: {
      episodes: {
        "episode-002": {
          title: "第 2 集",
          workflowCenter: {
            selectedEpisode: "第 2 集",
            breakdownScenes: [{
              id: "shot-001",
              characters: ["Chloe", "Tiffany"],
              action: "Chloe confronts Tiffany in the boss room.",
              dialogue: "Chloe: Freeze.",
            }],
            assets: {
              characters: [
                { name: "Chloe", referenceImageUrl: "/api/uploads/public/user/generated/project/chloe.png", referenceImageAssetId: "asset-chloe" },
                { name: "Tiffany", referenceImageUrl: "/api/uploads/public/user/generated/project/tiffany.png", referenceImageAssetId: "asset-tiffany" },
              ],
              scenes: [
                { name: "Boss Room", referenceImageUrl: "/api/uploads/public/user/generated/project/boss-room.png", referenceImageAssetId: "asset-scene" },
              ],
              props: [
                { name: "Needle", referenceImageUrl: "/api/uploads/public/user/generated/project/needle.png", referenceImageAssetId: "asset-prop" },
              ],
            },
            clips: [{
              id: "clip-001",
              title: "Clip 01 · Boss Room Reveal",
              characters: ["Chloe"],
              shotIds: ["shot-001"],
              storyboardPrompt: "Panel 1: Chloe enters and sees Tiffany.",
              seedancePrompt: "Follow the connected storyboard and character references.",
            }],
          },
        },
      },
    },
  });

  const videoNodeId = "episode-sync-video-node-episode-002-clip-001";
  const incomingSourceIds = sync.edges
    .filter((edge) => edge.target === videoNodeId)
    .map((edge) => String(edge.source));
  const incomingNodes = sync.nodes.filter((node) => incomingSourceIds.includes(node.id));
  const imageRefs = incomingNodes.filter((node) => node.type === "imageInput");
  const assetNames = imageRefs.map((node) => String(node.data?.assetName || "")).filter(Boolean).sort();

  assert.ok(incomingSourceIds.includes("episode-sync-video-storyboard-slot-episode-002-clip-001"));
  assert.equal(incomingSourceIds.includes("episode-sync-storyboard-episode-002-clip-001"), false);
  assert.deepEqual(assetNames, ["Chloe", "Tiffany"]);
  assert.equal(sync.nodes.find((node) => node.id === videoNodeId)?.data?.referenceCount, 3);
  assert.equal(imageRefs.some((node) => node.data?.assetKind === "scenes"), false);
  assert.equal(imageRefs.some((node) => node.data?.assetKind === "props"), false);
});

test("episode canvas sync uses video prompt mentions to fill missing character references", () => {
  const sync = buildEpisodeCanvasSyncScene({
    episodeId: "episode-002",
    metadata: {
      episodes: {
        "episode-002": {
          title: "第 2 集",
          workflowCenter: {
            selectedEpisode: "第 2 集",
            breakdownScenes: [{
              id: "shot-001",
              characters: ["Chloe"],
              action: "Chloe enters the boss room.",
            }],
            assets: {
              characters: [
                { name: "Chloe", referenceImageUrl: "/api/uploads/public/user/generated/project/chloe.png", referenceImageAssetId: "asset-chloe" },
                { name: "Tiffany", referenceImageUrl: "/api/uploads/public/user/generated/project/tiffany.png", referenceImageAssetId: "asset-tiffany" },
              ],
            },
            clips: [{
              id: "clip-001",
              title: "Clip 01 · Boss Room Reveal",
              characters: ["Chloe"],
              shotIds: ["shot-001"],
              storyboardPrompt: "Panel 1: Chloe enters.",
              seedancePrompt: "Use Chloe and Tiffany references. Tiffany towers in the boss room and speaks.",
            }],
          },
        },
      },
    },
  });

  const videoNodeId = "episode-sync-video-node-episode-002-clip-001";
  const incomingSourceIds = sync.edges
    .filter((edge) => edge.target === videoNodeId)
    .map((edge) => String(edge.source));
  const incomingNodes = sync.nodes.filter((node) => incomingSourceIds.includes(node.id));
  const assetNames = incomingNodes
    .filter((node) => node.type === "imageInput")
    .map((node) => String(node.data?.assetName || ""))
    .filter(Boolean)
    .sort();

  assert.deepEqual(assetNames, ["Chloe", "Tiffany"]);
});

test("canvas storyboard normalization removes duplicate previous storyboard reference nodes", () => {
  const duplicateMetadata = {
    episodes: {
      "episode-002": {
        title: "第 2 集",
        workflowCenter: {
          selectedEpisode: "第 2 集",
          clips: [
            { id: "clip-003", title: "Clip 03", storyboardPrompt: "Panel 1: previous." },
            { id: "clip-004", title: "Clip 04", storyboardPrompt: "Panel 1: next." },
          ],
        },
      },
    },
  };
  const previousUrl = "https://loohii.com/api/uploads/public/user/generated/project/clip03.png";
  const nodes = [
    {
      id: "episode-sync-episode-002-clip-003",
      type: "section",
      data: { sectionKind: "clip-storyboard-assets", clipId: "clip-003" },
    },
    {
      id: "episode-sync-storyboard-episode-002-clip-003",
      type: "generation",
      parentId: "episode-sync-episode-002-clip-003",
      data: { clipId: "clip-003", clipNodeKind: "storyboard", outputImage: previousUrl, outputImageAssetId: "asset-clip-003" },
    },
    {
      id: "episode-sync-episode-002-clip-004",
      type: "section",
      data: { sectionKind: "clip-storyboard-assets", clipId: "clip-004" },
    },
    {
      id: "episode-sync-storyboard-episode-002-clip-004",
      type: "generation",
      parentId: "episode-sync-episode-002-clip-004",
      data: { clipId: "clip-004", clipNodeKind: "storyboard", prompt: "Panel 1: next.", finalPrompt: "Panel 1: next." },
    },
    {
      id: "storyboard-prev-episode-sync-storyboard-episode-002-clip-004-asset-clip-003",
      type: "imageInput",
      parentId: "episode-sync-episode-002-clip-004",
      data: {
        clipNodeKind: "storyboard-reference",
        sourceClipId: "clip-003",
        targetClipId: "clip-004",
        imageUrl: previousUrl,
        assetId: "asset-clip-003",
      },
    },
    {
      id: "episode-sync-story-ref-episode-002-clip-004-previous-clip-003",
      type: "imageInput",
      parentId: "episode-sync-episode-002-clip-004",
      data: {
        clipNodeKind: "storyboard-reference",
        clipSyncRole: "previous:clip-003",
        sourceClipId: "clip-003",
        targetClipId: "clip-004",
        imageUrl: previousUrl,
        assetId: "asset-clip-003",
      },
    },
  ];
  const edges = [
    { id: "legacy", source: "storyboard-prev-episode-sync-storyboard-episode-002-clip-004-asset-clip-003", target: "episode-sync-storyboard-episode-002-clip-004" },
    { id: "stable", source: "episode-sync-story-ref-episode-002-clip-004-previous-clip-003", target: "episode-sync-storyboard-episode-002-clip-004" },
  ];

  const normalized = normalizeCanvasStoryboardReferencesForScene(nodes, edges, duplicateMetadata, [], "episode-002");
  const previousNodes = normalized.nodes.filter((node) => node.parentId === "episode-sync-episode-002-clip-004" && node.data?.clipNodeKind === "storyboard-reference");
  const previousEdges = normalized.edges.filter((edge) => edge.target === "episode-sync-storyboard-episode-002-clip-004" && previousNodes.some((node) => node.id === edge.source));

  assert.equal(normalized.changed, true);
  assert.deepEqual(previousNodes.map((node) => node.id), ["episode-sync-story-ref-episode-002-clip-004-previous-clip-003"]);
  assert.equal(previousEdges.length, 1);
  assert.equal(previousEdges[0].source, "episode-sync-story-ref-episode-002-clip-004-previous-clip-003");
});

test("episode canvas sync connects dialogue character audio references into video nodes", () => {
  const sync = buildEpisodeCanvasSyncScene({
    episodeId: "episode-002",
    metadata: {
      episodes: {
        "episode-002": {
          title: "第 2 集",
          workflowCenter: {
            selectedEpisode: "第 2 集",
            breakdownScenes: [{
              id: "shot-001",
              characters: ["Chloe", "Leo"],
              action: "Chloe and Leo argue in the lab.",
              dialogue: "Chloe: Freeze.\nLeo: It is a non-stick defense system.",
            }],
            assets: {
              characters: [
                {
                  name: "Chloe",
                  referenceImageUrl: "/api/uploads/public/user/generated/project/chloe.png",
                  referenceImageAssetId: "asset-chloe-image",
                  referenceAudioUrl: "/api/uploads/public/user/audio/chloe.wav",
                  referenceAudioAssetId: "asset-chloe-audio",
                  voiceReferenceFileName: "chloe.wav",
                },
                {
                  name: "Leo",
                  referenceImageUrl: "/api/uploads/public/user/generated/project/leo.png",
                  referenceImageAssetId: "asset-leo-image",
                  referenceAudioUrl: "/api/uploads/public/user/audio/leo.wav",
                  referenceAudioAssetId: "asset-leo-audio",
                  voiceReferenceFileName: "leo.wav",
                },
              ],
            },
            clips: [{
              id: "clip-001",
              title: "Clip 01 · Lab Argument",
              characters: ["Chloe", "Leo"],
              shotIds: ["shot-001"],
              storyboardPrompt: "Panel 1: Chloe and Leo argue.",
              seedancePrompt: "Chloe says Freeze. Leo replies with a dry line.",
            }],
          },
        },
      },
    },
  });

  const videoNodeId = "episode-sync-video-node-episode-002-clip-001";
  const incomingSourceIds = sync.edges
    .filter((edge) => edge.target === videoNodeId)
    .map((edge) => String(edge.source));
  const incomingNodes = sync.nodes.filter((node) => incomingSourceIds.includes(node.id));
  const audioRefs = incomingNodes.filter((node) => node.type === "audio");
  const audioNames = audioRefs.map((node) => String(node.data?.characterName || "")).sort();
  const videoNode = sync.nodes.find((node) => node.id === videoNodeId);

  assert.deepEqual(audioNames, ["Chloe", "Leo"]);
  assert.deepEqual(videoNode?.data?.dialogueCharacterNames, ["Chloe", "Leo"]);
  assert.deepEqual(videoNode?.data?.referenceAudioUrls, [
    "https://loohii.com/api/uploads/public/user/audio/chloe.wav",
    "https://loohii.com/api/uploads/public/user/audio/leo.wav",
  ]);
  assert.equal(videoNode?.data?.referenceAudioCount, 2);
  assert.equal(videoNode?.data?.audioReferenceCount, 2);
});

test("episode canvas sync does not treat called names inside dialogue as audio speakers", () => {
  const sync = buildEpisodeCanvasSyncScene({
    episodeId: "episode-002",
    metadata: {
      episodes: {
        "episode-002": {
          title: "第 2 集",
          workflowCenter: {
            selectedEpisode: "第 2 集",
            breakdownScenes: [{
              id: "shot-001",
              characters: ["Chloe", "Eugene"],
              action: "Eugene panics behind the control desk.",
              dialogue: "Eugene: Chloe! I can't hack the lasers! The firewall is too strong!",
            }],
            assets: {
              characters: [
                {
                  name: "Chloe",
                  referenceImageUrl: "/api/uploads/public/user/generated/project/chloe.png",
                  referenceImageAssetId: "asset-chloe-image",
                  referenceAudioUrl: "/api/uploads/public/user/audio/chloe.wav",
                  referenceAudioAssetId: "asset-chloe-audio",
                  voiceReferenceFileName: "chloe.wav",
                },
                {
                  name: "Eugene",
                  referenceImageUrl: "/api/uploads/public/user/generated/project/eugene.png",
                  referenceImageAssetId: "asset-eugene-image",
                  referenceAudioUrl: "/api/uploads/public/user/audio/eugene.wav",
                  referenceAudioAssetId: "asset-eugene-audio",
                  voiceReferenceFileName: "eugene.wav",
                },
              ],
            },
            clips: [{
              id: "clip-001",
              title: "Clip 01 · Firewall Panic",
              characters: ["Chloe", "Eugene"],
              shotIds: ["shot-001"],
              storyboardPrompt: "Panel 1: Eugene panics.",
              seedancePrompt: "Eugene delivers the spoken dialogue exactly: \"Chloe! I can't hack the lasers! The firewall is too strong!\"",
            }],
          },
        },
      },
    },
  });

  const videoNodeId = "episode-sync-video-node-episode-002-clip-001";
  const incomingSourceIds = sync.edges
    .filter((edge) => edge.target === videoNodeId)
    .map((edge) => String(edge.source));
  const incomingNodes = sync.nodes.filter((node) => incomingSourceIds.includes(node.id));
  const audioNames = incomingNodes
    .filter((node) => node.type === "audio")
    .map((node) => String(node.data?.characterName || ""))
    .sort();
  const videoNode = sync.nodes.find((node) => node.id === videoNodeId);

  assert.deepEqual(audioNames, ["Eugene"]);
  assert.deepEqual(videoNode?.data?.dialogueCharacterNames, ["Eugene"]);
  assert.deepEqual(videoNode?.data?.referenceAudioUrls, [
    "https://loohii.com/api/uploads/public/user/audio/eugene.wav",
  ]);
});

test("seedance multi-reference sync skips storyboard nodes and connects missing asset placeholders", () => {
  const sync = buildEpisodeCanvasSyncScene({
    episodeId: "episode-002",
    generationStrategy: "seedance-multi-ref",
    metadata: {
      setupSettings: { generationStrategy: "seedance-multi-ref" },
      episodes: {
        "episode-002": {
          title: "第 2 集",
          workflowCenter: {
            selectedEpisode: "第 2 集",
            breakdownScenes: [{
              id: "shot-001",
              characters: ["Chloe"],
              setting: "Underground Loading Dock",
              action: "Chloe runs through Underground Loading Dock with Shotgun.",
            }],
            assets: {
              characters: [{ id: "char-chloe", name: "Chloe" }],
              scenes: [{ id: "scene-dock", name: "Underground Loading Dock" }],
              props: [{ id: "prop-shotgun", name: "Shotgun" }],
            },
            clips: [{
              id: "clip-001",
              title: "Clip 01 · Shotgun Blast",
              characters: ["Chloe"],
              setting: "Underground Loading Dock",
              shotIds: ["shot-001"],
              storyboardPrompt: "Panel 1: legacy storyboard should not enter multi-reference canvas.",
              seedancePrompt: "Chloe runs through Underground Loading Dock with Shotgun.",
            }],
          },
        },
      },
    },
  });

  const videoNode = sync.nodes.find((node) => node.id === "episode-sync-video-node-episode-002-clip-001");
  const videoSectionId = String(videoNode?.parentId || "");
  const referenceNodes = sync.nodes.filter((node) => node.parentId === videoSectionId && node.type === "imageInput");
  const referenceKinds = referenceNodes.map((node) => String(node.data?.assetKind || "")).sort();
  const connectedReferenceIds = new Set(sync.edges.filter((edge) => edge.target === videoNode?.id).map((edge) => String(edge.source)));

  assert.equal(sync.storyboardCount, 0);
  assert.ok(!sync.nodes.some((node) => /storyboard|故事板/.test([node.id, node.data?.title, node.data?.label, node.data?.sectionKind].map(String).join(" "))));
  assert.deepEqual(referenceKinds, ["characters", "props", "scenes"]);
  assert.equal(referenceNodes.every((node) => node.data?.uploadStatus === "missing"), true);
  assert.equal(referenceNodes.every((node) => connectedReferenceIds.has(node.id)), true);
  assert.equal(videoNode?.data?.storyboardImageUrl, "");
  assert.deepEqual(videoNode?.data?.referenceImageUrls, []);
  assert.equal(videoNode?.data?.referenceCount, 3);
});

test("episode canvas sync keeps video prompts under Dreamina Web limit while preserving ordered beats", () => {
  const longPanels = Array.from({ length: 12 }, (_, index) => (
    `Panel ${index + 1}: ${"Chloe, Leo, Tiffany, Bob, and Eugene keep acting in exact order with fast dialogue and visual continuity. ".repeat(22)}`
  )).join("\n");

  const sync = buildEpisodeCanvasSyncScene({
    episodeId: "episode-002",
    metadata: {
      episodes: {
        "episode-002": {
          title: "第 2 集",
          workflowCenter: {
            selectedEpisode: "第 2 集",
            breakdownScenes: [],
            assets: {},
            clips: [{
              id: "clip-001",
              title: "Clip 01 · Long Storyboard",
              characters: ["Chloe", "Leo", "Tiffany", "Bob", "Eugene"],
              setting: "boss room",
              storyboardPrompt: [
                "Create one 16:9 multi-panel 3D American comic storyboard image.",
                "Comic panels in reading order:",
                longPanels,
              ].join("\n"),
            }],
          },
        },
      },
    },
  });

  const videoNode = sync.nodes.find((node) => node.id === "episode-sync-video-node-episode-002-clip-001");
  const prompt = String(videoNode?.data?.prompt || "");

  assert.ok(prompt.length <= 3900, `prompt length ${prompt.length} exceeds Dreamina target`);
  assert.match(prompt, /^P1:/m);
  assert.match(prompt, /^P12:/m);
  assert.ok(prompt.indexOf("P1:") < prompt.indexOf("P12:"));
});

test("episode canvas sync preserves completed video outputs while refreshing prompt and references", () => {
  const oldVideoUrl = "https://loohii.com/api/uploads/public/project/generated/clip-001-old.mp4";
  const sync = buildEpisodeCanvasSyncScene({
    episodeId: "episode-002",
    existingScene: {
      nodes: [{
        id: "episode-sync-video-node-episode-002-clip-001",
        type: "video",
        data: {
          status: "completed",
          videoStatus: "succeeded",
          statusLabel: "视频已生成",
          outputVideo: oldVideoUrl,
          outputVideoAssetId: "old-video-asset",
          generationId: "old-generation",
          videoSubmitId: "old-submit",
          videoProviderStatus: "succeeded",
          prompt: "old prompt",
          referenceImageUrls: ["https://loohii.com/old-ref.png"],
        },
      }],
      edges: [],
    },
    metadata: {
      episodes: {
        "episode-002": {
          title: "第 2 集",
          workflowCenter: {
            selectedEpisode: "第 2 集",
            breakdownScenes: [{
              id: "shot-001",
              characters: ["Chloe"],
              action: "Chloe enters the boss room.",
            }],
            assets: {
              characters: [
                { name: "Chloe", referenceImageUrl: "/api/uploads/public/user/generated/project/chloe.png", referenceImageAssetId: "asset-chloe" },
              ],
            },
            clips: [{
              id: "clip-001",
              title: "Clip 01 · Refreshed Video",
              characters: ["Chloe"],
              shotIds: ["shot-001"],
              storyboardPrompt: "Panel 1: Chloe enters.",
              seedancePrompt: "fresh prompt from current workflow",
            }],
          },
        },
      },
    },
  });

  const videoNode = sync.nodes.find((node) => node.id === "episode-sync-video-node-episode-002-clip-001");

  assert.equal(videoNode?.data?.outputVideo, oldVideoUrl);
  assert.equal(videoNode?.data?.generationId, "old-generation");
  assert.equal(videoNode?.data?.videoSubmitId, "old-submit");
  assert.equal(videoNode?.data?.prompt, "fresh prompt from current workflow");
  assert.deepEqual(videoNode?.data?.referenceImageUrls, [
    "https://loohii.com/api/uploads/public/user/generated/project/chloe.png",
  ]);
});
