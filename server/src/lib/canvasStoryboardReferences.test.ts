import assert from "node:assert/strict";
import test from "node:test";
import { buildEpisodeCanvasSyncScene } from "./episodeCanvasSync";
import { normalizeCanvasStoryboardReferencesForScene, removeCanvasStoryboardNodesForMultiReference, storyboardReferencesFromGenerationRecords, type CanvasStoryboardGenerationRecord } from "./canvasStoryboardReferences";

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

test("episode canvas sync does not connect characters mentioned only in dialogue", () => {
  const sync = buildEpisodeCanvasSyncScene({
    episodeId: "episode-012",
    generationStrategy: "seedance-multi-ref",
    metadata: {
      activeEpisodeId: "episode-012",
      generationStrategy: "seedance-multi-ref",
      episodes: {
        "episode-012": {
          title: "第 12 集",
          workflowCenter: {
            selectedEpisode: "第 12 集",
            breakdownScenes: [
              {
                id: "shot-001",
                characters: ["Chloe", "Flora"],
                action: "Chloe lies bound center while Flora watches at the head of the bed.",
                dialogue: "Chloe: Help... Bob... Leo...",
                setting: "Living Vine Hospital Bed",
                references: "Chloe remains connected to tubing; Flora watches closely.",
              },
            ],
            assets: {
              characters: [
                { name: "Chloe", referenceImageUrl: "/api/uploads/public/user/generated/project/chloe.png", referenceImageAssetId: "asset-chloe" },
                { name: "Flora", referenceImageUrl: "/api/uploads/public/user/generated/project/flora.png", referenceImageAssetId: "asset-flora" },
                { name: "Bob", referenceImageUrl: "/api/uploads/public/user/generated/project/bob.png", referenceImageAssetId: "asset-bob" },
                { name: "Leo", referenceImageUrl: "/api/uploads/public/user/generated/project/leo.png", referenceImageAssetId: "asset-leo" },
              ],
              scenes: [
                { name: "Living Vine Hospital Bed", referenceImageUrl: "/api/uploads/public/user/generated/project/bed.png", referenceImageAssetId: "asset-scene" },
              ],
              props: [],
            },
            clips: [{
              id: "clip-001",
              title: "Clip 01 · Chloe calls for help",
              characters: ["Chloe", "Flora"],
              shotIds: ["shot-001"],
              setting: "Living Vine Hospital Bed",
              seedancePrompt: "Chloe calls for help while Flora watches.",
            }],
          },
        },
      },
    },
  });

  const incomingSourceIds = sync.edges
    .filter((edge) => edge.target === "episode-sync-video-node-episode-012-clip-001")
    .map((edge) => String(edge.source));
  const incomingRefs = sync.nodes.filter((node) => incomingSourceIds.includes(node.id) && node.type === "imageInput");
  const characterRefs = incomingRefs
    .filter((node) => node.data?.assetKind === "characters")
    .map((node) => String(node.data?.assetName || ""))
    .sort();

  assert.deepEqual(characterRefs, ["Chloe", "Flora"]);
  assert.equal(incomingRefs.some((node) => node.data?.assetName === "Bob"), false);
  assert.equal(incomingRefs.some((node) => node.data?.assetName === "Leo"), false);
});

test("episode canvas sync does not use broad video prompt mentions to add unseen character references", () => {
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

  assert.deepEqual(assetNames, ["Chloe"]);
});

test("Seedance multi-reference video sync connects completed positioning board as spatial authority", () => {
  const metadata = {
    setupSettings: { generationStrategy: "seedance-multi-ref" },
    episodes: {
      "episode-010": {
        title: "第 10 集",
        workflowCenter: {
          selectedEpisode: "第 10 集",
          breakdownScenes: [{
            id: "shot-001",
            title: "Flora ritual",
            setting: "Sanctuary Cafeteria",
            characters: ["Chloe", "Flora"],
            action: "Chloe watches Flora address the cafeteria.",
          }],
          assets: {
            characters: [
              { name: "Chloe", referenceImageUrl: "/api/uploads/public/user/generated/project/chloe.png", referenceImageAssetId: "asset-chloe" },
              { name: "Flora", referenceImageUrl: "/api/uploads/public/user/generated/project/flora.png", referenceImageAssetId: "asset-flora" },
            ],
            scenes: [],
            props: [],
          },
          clips: [{
            id: "clip-012",
            title: "Clip 12",
            setting: "Sanctuary Cafeteria",
            characters: ["Chloe", "Flora"],
            shotIds: ["shot-001"],
            seedancePrompt: "Generate one continuous 15s video.",
          }],
        },
      },
    },
    canvasScenes: {
      "episode-010": {
        nodes: [{
          id: "positioning-generation-episode-010-clip-012",
          type: "generation",
          data: {
            positioningBoardFlow: true,
            clipId: "clip-012",
            sourceEpisodeId: "episode-010",
            outputImage: "https://example.com/positioning-board.png",
            outputImageAssetId: "asset-positioning-board",
            status: "completed",
            finalPrompt: "Create ONE static keyframe positioning-board image.",
          },
        }],
        edges: [],
      },
    },
  };

  const sync = buildEpisodeCanvasSyncScene({
    metadata,
    episodeId: "episode-010",
    generationStrategy: "seedance-multi-ref",
    existingScene: metadata.canvasScenes["episode-010"],
    records: [],
  } as any);

  const boardRef = sync.nodes.find((node) =>
    node.type === "imageInput" &&
    node.data?.assetKind === "positioning-board" &&
    node.data?.clipId === "clip-012"
  );
  const videoNode = sync.nodes.find((node) => node.type === "video" && node.data?.clipId === "clip-012");

  assert.ok(boardRef, "expected positioning board imageInput");
  assert.ok(videoNode, "expected video node");
  assert.equal(boardRef?.data?.spatialAuthority, true);
  assert.ok(sync.edges.some((edge) => edge.source === boardRef?.id && edge.target === videoNode?.id));
  assert.match(String(videoNode?.data?.prompt || ""), /connected positioning board as the spatial layout authority/i);
  assert.equal(videoNode?.data?.referenceCount, 3);
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

test("seedance multi-reference sync skips non-visual voice characters and keeps shot props", () => {
  const sync = buildEpisodeCanvasSyncScene({
    episodeId: "episode-010",
    generationStrategy: "seedance-multi-ref",
    metadata: {
      setupSettings: { generationStrategy: "seedance-multi-ref" },
      episodes: {
        "episode-010": {
          title: "第 10 集",
          workflowCenter: {
            selectedEpisode: "第 10 集",
            breakdownScenes: [{
              id: "shot-001",
              characters: ["Chloe", "Celery Cultist", "Fungus Wall Voice"],
              setting: "Sanctuary Corridor",
              action: "Chloe holds a recycled paper cup filled with concentrated veggie juice near her mouth while Celery Cultist watches.",
              visualPrompt: "Chloe pauses with cup near lips, ghostly fungus flash behind her.",
              references: "Use Chloe and Celery Cultist linked character images. Fungus Wall Voice appears as a quick memory echo only.",
            }],
            assets: {
              characters: [
                { id: "char-chloe", name: "Chloe" },
                { id: "char-cultist", name: "Celery Cultist" },
                { id: "char-fungus-voice", name: "Fungus Wall Voice" },
              ],
              scenes: [{ id: "scene-corridor", name: "Sanctuary Corridor" }],
              props: [
                { id: "prop-cup", name: "Recycled Paper Cup" },
                { id: "prop-juice", name: "Concentrated Veggie Juice" },
              ],
            },
            clips: [{
              id: "clip-001",
              title: "Clip 01 · Purification begins",
              characters: ["Chloe", "Celery Cultist", "Fungus Wall Voice"],
              setting: "Sanctuary Corridor",
              shotIds: ["shot-001"],
              storyboardPrompt: "Panel 1: legacy storyboard should not enter multi-reference canvas.",
              seedancePrompt: "Chloe holds a recycled paper cup while the cultist offers concentrated veggie juice.",
            }],
          },
        },
      },
    },
  });

  const videoNode = sync.nodes.find((node) => node.id === "episode-sync-video-node-episode-010-clip-001");
  const videoSectionId = String(videoNode?.parentId || "");
  const referenceNodes = sync.nodes.filter((node) => node.parentId === videoSectionId && node.type === "imageInput");
  const assetNames = referenceNodes.map((node) => String(node.data?.assetName || "")).sort();

  assert.ok(assetNames.includes("Chloe"));
  assert.ok(assetNames.includes("Celery Cultist"));
  assert.ok(assetNames.includes("Recycled Paper Cup"));
  assert.ok(assetNames.includes("Concentrated Veggie Juice"));
  assert.equal(assetNames.includes("Fungus Wall Voice"), false);
});

test("seedance multi-reference cleanup removes legacy storyboard branches while keeping video branches", () => {
  const nodes = [
    {
      id: "episode-sync-episode-002-clip-001",
      type: "section",
      data: { sectionKind: "clip-storyboard-assets", clipId: "clip-001" },
    },
    {
      id: "episode-sync-storyboard-episode-002-clip-001",
      type: "generation",
      parentId: "episode-sync-episode-002-clip-001",
      data: { clipId: "clip-001", clipSyncRole: "storyboard", storyboardForClip: true },
    },
    {
      id: "episode-sync-video-storyboard-slot-episode-002-clip-001",
      type: "imageInput",
      parentId: "episode-sync-video-episode-002-clip-001",
      data: { clipId: "clip-001", clipSyncRole: "storyboard-slot", storyboardSlotForClip: true },
    },
    {
      id: "episode-sync-video-episode-002-clip-001",
      type: "section",
      data: { sectionKind: "clip-video-assets", clipId: "clip-001" },
    },
    {
      id: "episode-sync-video-node-episode-002-clip-001",
      type: "video",
      parentId: "episode-sync-video-episode-002-clip-001",
      data: { clipId: "clip-001", clipSyncRole: "video" },
    },
    {
      id: "agent-node-1",
      type: "agent",
      data: { title: "Agent" },
    },
  ];
  const edges = [
    { id: "story-to-slot", source: "episode-sync-storyboard-episode-002-clip-001", target: "episode-sync-video-storyboard-slot-episode-002-clip-001" },
    { id: "slot-to-video", source: "episode-sync-video-storyboard-slot-episode-002-clip-001", target: "episode-sync-video-node-episode-002-clip-001" },
    { id: "video-to-agent", source: "episode-sync-video-node-episode-002-clip-001", target: "agent-node-1" },
  ];

  const cleaned = removeCanvasStoryboardNodesForMultiReference(nodes, edges);

  assert.equal(cleaned.changed, true);
  assert.deepEqual(cleaned.nodes.map((node) => node.id).sort(), [
    "agent-node-1",
    "episode-sync-video-episode-002-clip-001",
    "episode-sync-video-node-episode-002-clip-001",
  ]);
  assert.deepEqual(cleaned.edges, [
    { id: "video-to-agent", source: "episode-sync-video-node-episode-002-clip-001", target: "agent-node-1" },
  ]);
});

test("seedance multi-reference sync does not emit dangling storyboard edges across clips", () => {
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
            breakdownScenes: [
              {
                id: "shot-001",
                characters: ["Chloe"],
                setting: "Underground Loading Dock",
                action: "Chloe runs through Underground Loading Dock.",
              },
              {
                id: "shot-002",
                characters: ["Chloe"],
                setting: "Underground Loading Dock",
                action: "Chloe exits with the Shotgun.",
              },
            ],
            assets: {
              characters: [{ id: "char-chloe", name: "Chloe" }],
              scenes: [{ id: "scene-dock", name: "Underground Loading Dock" }],
              props: [{ id: "prop-shotgun", name: "Shotgun" }],
            },
            clips: [
              {
                id: "clip-001",
                title: "Clip 01 · Dock Entry",
                characters: ["Chloe"],
                setting: "Underground Loading Dock",
                shotIds: ["shot-001"],
                seedancePrompt: "Chloe runs through Underground Loading Dock.",
              },
              {
                id: "clip-002",
                title: "Clip 02 · Dock Exit",
                characters: ["Chloe"],
                setting: "Underground Loading Dock",
                shotIds: ["shot-002"],
                seedancePrompt: "Chloe exits with the Shotgun.",
              },
            ],
          },
        },
      },
    },
  });

  const nodeIds = new Set(sync.nodes.map((node) => node.id));
  const danglingEdges = sync.edges.filter((edge) => !nodeIds.has(String(edge.source)) || !nodeIds.has(String(edge.target)));

  assert.equal(sync.storyboardCount, 0);
  assert.equal(sync.nodes.some((node) => node.id.startsWith("episode-sync-storyboard-")), false);
  assert.deepEqual(danglingEdges, []);
  assert.equal(sync.edges.some((edge) => String(edge.id || "").includes("episode-storyboard-prev")), false);
});

test("episode canvas sync preserves external edges connected to rebuilt video nodes", () => {
  const sync = buildEpisodeCanvasSyncScene({
    episodeId: "episode-002",
    generationStrategy: "seedance-multi-ref",
    existingScene: {
      nodes: [
        {
          id: "episode-sync-video-node-episode-002-clip-001",
          type: "video",
          data: { clipId: "clip-001", clipSyncRole: "video" },
        },
        {
          id: "agent-node-1",
          type: "agent",
          data: { title: "Agent" },
        },
      ],
      edges: [
        {
          id: "video-to-agent",
          source: "episode-sync-video-node-episode-002-clip-001",
          target: "agent-node-1",
        },
      ],
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
              setting: "Underground Loading Dock",
              action: "Chloe watches the loading dock door.",
            }],
            assets: {},
            clips: [{
              id: "clip-001",
              title: "Clip 01 · Dock Watch",
              characters: ["Chloe"],
              setting: "Underground Loading Dock",
              shotIds: ["shot-001"],
            }],
          },
        },
      },
    },
  });

  assert.ok(sync.nodes.some((node) => node.id === "agent-node-1"));
  assert.ok(sync.edges.some((edge) => edge.id === "video-to-agent" && edge.source === "episode-sync-video-node-episode-002-clip-001" && edge.target === "agent-node-1"));
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
  assert.match(String(videoNode?.data?.prompt || ""), /S1: Shot: .*Chloe enters the boss room\./);
  assert.deepEqual(videoNode?.data?.referenceImageUrls, [
    "https://loohii.com/api/uploads/public/user/generated/project/chloe.png",
  ]);
});

test("episode canvas sync rebuilds video prompt from current scenes instead of stale clip prompt", () => {
  const sync = buildEpisodeCanvasSyncScene({
    episodeId: "episode-002",
    generationStrategy: "seedance-multi-ref",
    metadata: {
      episodes: {
        "episode-002": {
          title: "第 2 集",
          workflowCenter: {
            selectedEpisode: "第 2 集",
            breakdownScenes: [
              {
                id: "shot-001",
                title: "Fresh Line Start",
                characters: ["Chloe", "Flora"],
                setting: "Underground Loading Dock",
                action: "Chloe keeps Flora away from the corpse.",
                dialogue: "Chloe: Well, if you'd rather go breathe with that pile of rotten meat, I'm happy to toss you outside.",
                durationSeconds: 3,
              },
              {
                id: "shot-002",
                title: "Bob Reacts",
                characters: ["Bob", "Flora"],
                setting: "Underground Loading Dock",
                action: "Bob hesitates while Flora turns.",
                dialogue: "Bob: Wow, everyone first.",
                durationSeconds: 2,
              },
            ],
            assets: {},
            clips: [{
              id: "clip-001",
              title: "Clip 01 · Fresh Breakdown",
              characters: ["Chloe", "Flora", "Bob"],
              shotIds: ["shot-001", "shot-002"],
              setting: "Underground Loading Dock",
              seedancePrompt: "OLD PROMPT THAT MUST NOT SURVIVE",
            }],
          },
        },
      },
    },
  });

  const videoNode = sync.nodes.find((node) => node.id === "episode-sync-video-node-episode-002-clip-001");
  const prompt = String(videoNode?.data?.prompt || "");

  assert.doesNotMatch(prompt, /OLD PROMPT/);
  assert.match(prompt, /S1: Shot: .*Exact dialogue: Chloe: “Well, if you'd rather go breathe with that pile of rotten meat, I'm happy to toss you outside\.”/);
  assert.match(prompt, /S2: Shot: .*Exact dialogue: Bob: “Wow, everyone first\.”/);
  assert.doesNotMatch(prompt, /Flora: Bob:/);
});
