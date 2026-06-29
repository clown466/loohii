import assert from "node:assert/strict";
import test from "node:test";
import { agentTestInternals } from "./agent";

test("agent prompt-removal request is not mistaken for asset connection", () => {
  const request = "clip04视频节点我已取消Tiffany 资产连接，此节点剧情中不涉及Tiffany 。请把clip04视频生成提示词里包含Tiffany 的去掉";
  const preloaded = [{
    canvas: {
      nodes: [
        {
          id: "episode-sync-storyboard-episode-002-clip-004",
          type: "generation",
          clipId: "clip-004",
          title: "Clip 04 storyboard",
          role: "storyboard",
          prompt: "Storyboard still mentions Tiffany.",
        },
        {
          id: "episode-sync-video-node-episode-002-clip-004",
          type: "video",
          clipId: "clip-004",
          title: "Clip 04 video",
          prompt: "Use Chloe, Leo, Tiffany, Eugene, Bob. Scene continuity: Tiffany's lab.",
        },
      ],
      edges: [],
    },
  }];

  assert.equal(agentTestInternals.assetConnectionFromUserRequest(request, "clip-004"), null);
  assert.match(agentTestInternals.agentActionConflictMessage(request, {
    type: "connect_asset_to_clip",
    clipId: "clip-004",
    assetKind: "characters",
    assetName: "Tiffany",
    target: "storyboard",
  }), /不会连接资产/);
  const actions = agentTestInternals.deterministicActionsFromUserRequest(request, preloaded);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "update_canvas_node_prompt");
  assert.equal(actions[0].nodeId, "episode-sync-video-node-episode-002-clip-004");
  assert.doesNotMatch(actions[0].prompt, /Tiffany/);
  assert.match(actions[0].prompt, /the lab/);
});

test("agent parses prompt text removal from connected prompt request", () => {
  const request = "去掉提示词里的frying pan and delivery bag，其他不变。";

  assert.deepEqual(agentTestInternals.promptNamesToRemoveFromUserRequest(request), ["frying pan", "delivery bag"]);
});

test("draft-only agent removes requested text from linked node full prompt", () => {
  const request = "去掉提示词里的frying pan and delivery bag，其他不变。";
  const longPrefix = "Intro rules. ".repeat(180);
  const prompt = `${longPrefix}Chloe exits with a frying pan and delivery bag while Flora watches.\nExact dialogue: Flora: \"Go.\"`;
  const linkedContext = agentTestInternals.linkedNodePromptContextForDraftAgent({
    linkedNodeIds: ["video-clip-010"],
    linkedNodePrompts: [{
      id: "video-clip-010",
      type: "video",
      title: "Clip 10 · Flock Exits 视频任务",
      clipId: "clip-010",
      prompt,
    }],
  }, []);

  const result = agentTestInternals.draftOnlyPromptRemovalResult(request, linkedContext);

  assert.match(result, /Clip 10/);
  assert.doesNotMatch(result, /frying pan/i);
  assert.doesNotMatch(result, /delivery bag/i);
  assert.match(result, /Exact dialogue: Flora: “Go\.”/);
});

test("agent asset removal request emits remove asset action for target clip", () => {
  const request = "把clip07的视频节点的Tiffany和Plastic Guards资产去掉，并在视频提示词里去掉这两个角色的存在描述";

  const actions = agentTestInternals.deterministicActionsFromUserRequest(request, []);

  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "remove_asset_from_clip");
  assert.equal(actions[0].clipId, "clip-007");
  assert.deepEqual([...actions[0].assetNames].sort(), ["Plastic Guards", "Tiffany"].sort());
  assert.equal(actions[0].updatePrompts, true);
});

test("agent wrapped canvas-agent request does not infer asset removal from linked node summary", () => {
  const request = [
    "你是画布智能体节点。请在当前项目内执行用户要求。",
    "",
    "用户要求：稍微修改这个提示词，把其中可能涉及到不过审的描述修改下，不要修改任何对白内容",
    "",
    "智能体节点ID：agent-1",
    "连接节点：[{\"id\":\"episode-sync-video-node-episode-001-clip-001\",\"type\":\"video\",\"title\":\"Clip 01 · Shotgun at the dock 视频任务\",\"clipId\":\"clip-001\",\"prompt\":\"Characters: Chloe, Flora, Bob, Zombie. Setting: Underground Loading Dock. Chloe fires a shotgun.\"}]",
  ].join("\n");
  const preloaded = [{
    canvas: {
      assetNames: ["Underground Loading Dock", "Shotgun", "Zombie", "Chloe", "Flora", "Bob"],
      nodes: [
        {
          id: "episode-sync-video-node-episode-001-clip-001",
          type: "video",
          clipId: "clip-001",
          title: "Clip 01 · Shotgun at the dock 视频任务",
          prompt: "Characters: Chloe, Flora, Bob, Zombie. Setting: Underground Loading Dock. Chloe fires a shotgun.",
        },
      ],
      edges: [],
    },
  }];

  assert.equal(agentTestInternals.agentEffectiveUserRequest(request), "稍微修改这个提示词，把其中可能涉及到不过审的描述修改下，不要修改任何对白内容");
  assert.equal(agentTestInternals.userRequestExplicitlyAsksAssetRemoval(request), false);
  const actions = agentTestInternals.deterministicActionsFromUserRequest(agentTestInternals.agentEffectiveUserRequest(request), preloaded);
  assert.equal(actions.some((action: any) => action.type === "remove_asset_from_clip"), false);
});

test("agent removable asset guard never treats core clip nodes as asset references", () => {
  assert.equal(agentTestInternals.agentRemovableAssetReferenceNode({
    id: "episode-sync-video-episode-001-clip-001",
    type: "section",
    data: { title: "Clip 01 · Shotgun Blast · 视频板", clipId: "clip-001" },
  }), false);
  assert.equal(agentTestInternals.agentRemovableAssetReferenceNode({
    id: "episode-sync-video-node-episode-001-clip-001",
    type: "video",
    data: { title: "Clip 01 · Shotgun Blast 视频任务", clipId: "clip-001", assetName: "Shotgun" },
  }), false);
  assert.equal(agentTestInternals.agentRemovableAssetReferenceNode({
    id: "episode-sync-video-ref-episode-001-clip-001-asset-shotgun",
    type: "imageInput",
    data: { assetName: "Shotgun", assetKind: "props", clipSyncRole: "video-asset:shotgun" },
  }), true);
});

test("agent asset removal uses asset names from loaded canvas", () => {
  const request = "把clip07的视频节点的Velvet Needle Swarm资产去掉，并在视频提示词里去掉这个道具的存在描述";
  const preloaded = [{
    canvas: {
      nodes: [
        {
          id: "episode-sync-video-ref-episode-002-clip-007-asset-needle",
          type: "imageInput",
          clipId: "clip-007",
          role: "asset:velvet-needle-swarm",
          assetName: "Velvet Needle Swarm",
          title: "Velvet Needle Swarm",
          prompt: "asset ref",
        },
        {
          id: "episode-sync-video-node-episode-002-clip-007",
          type: "video",
          clipId: "clip-007",
          prompt: "Velvet Needle Swarm appears in the frame.",
        },
      ],
      edges: [],
    },
  }];

  const actions = agentTestInternals.deterministicActionsFromUserRequest(request, preloaded);

  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "remove_asset_from_clip");
  assert.deepEqual(actions[0].assetNames, ["Velvet Needle Swarm"]);
});

test("agent asset connection uses asset names from loaded canvas", () => {
  const request = "从资产中心给我找到 Velvet Needle Swarm 并连接到 clip-08";
  const preloaded = [{
    canvas: {
      assetNames: ["Velvet Needle Swarm"],
      nodes: [],
      edges: [],
    },
  }];

  const actions = agentTestInternals.deterministicActionsFromUserRequest(request, preloaded);

  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "connect_asset_to_clip");
  assert.equal(actions[0].clipId, "clip-008");
  assert.equal(actions[0].assetName, "Velvet Needle Swarm");
});

test("agent asset connection to all video nodes emits bulk connection action", () => {
  const request = "场景资产 Tiffany's beauty lab 传入所有 clip，给所有视频节点接入";
  const preloaded = [{
    canvas: {
      assetNames: ["Tiffany's beauty lab"],
      nodes: [
        { id: "episode-sync-video-node-episode-002-clip-001", type: "video", clipId: "clip-001", role: "video" },
        { id: "episode-sync-video-node-episode-002-clip-002", type: "video", clipId: "clip-002", role: "video" },
      ],
      edges: [],
    },
  }];

  const actions = agentTestInternals.deterministicActionsFromUserRequest(request, preloaded);

  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "connect_asset_to_all_clips");
  assert.equal(actions[0].assetKind, "scenes");
  assert.equal(actions[0].assetName, "Tiffany's beauty lab");
  assert.equal(actions[0].target, "all");
});

test("agent bulk connection target grouping separates storyboard and video slots", () => {
  const groups = agentTestInternals.collectAgentClipTargetGroups([
    {
      id: "episode-sync-storyboard-episode-002-clip-001",
      type: "generation",
      data: { clipId: "clip-001", clipSyncRole: "storyboard" },
    },
    {
      id: "episode-sync-video-node-episode-002-clip-001",
      type: "video",
      data: { clipId: "clip-001", clipSyncRole: "video" },
    },
    {
      id: "episode-sync-storyboard-episode-002-clip-002",
      type: "generation",
      data: { clipId: "clip-002", clipSyncRole: "storyboard" },
    },
  ], "all");

  assert.deepEqual(groups.map((group: any) => `${group.clipId}:${group.targetKind}:${group.sectionKind}:${group.targetNodes.length}`), [
    "clip-001:storyboard:clip-storyboard-assets:1",
    "clip-001:video:clip-video-assets:1",
    "clip-002:storyboard:clip-storyboard-assets:1",
  ]);
});

test("agent asset connection verification only passes connected target nodes", () => {
  const result = agentTestInternals.verifyCanvasAssetConnections({
    nodes: [
      { id: "asset-1", type: "imageInput", data: { assetName: "Tiffany's beauty lab" } },
      { id: "target-1", type: "generation", data: { clipId: "clip-001", clipSyncRole: "storyboard" } },
      { id: "target-2", type: "video", data: { clipId: "clip-001", clipSyncRole: "video" } },
    ],
    edges: [
      { id: "edge-1", source: "asset-1", target: "target-1" },
    ],
  }, "Tiffany's beauty lab", new Set(["target-1", "target-2"]));

  assert.equal(result.connectedTargets, 1);
});

test("agent completion guard marks mutation no-op as needs action", () => {
  const guarded = agentTestInternals.applyAgentCompletionGuard("把资产接入所有 clip", "已完成", {
    status: "COMPLETED",
    actionResults: [
      { type: "load_canvas", ok: true },
      { type: "save_canvas", ok: true, canvasChanged: false },
    ],
  });

  assert.equal(guarded.metadata.status, "NEEDS_ACTION");
  assert.match(guarded.content, /未完成/);
});

test("agent completion guard treats verified state as completed", () => {
  const guarded = agentTestInternals.applyAgentCompletionGuard("把资产接入所有 clip", "已完成", {
    status: "COMPLETED",
    actionResults: [
      { type: "connect_asset_to_all_clips", ok: true, canvasChanged: false, stateVerified: true },
    ],
  });

  assert.equal(guarded.metadata.status, "COMPLETED");
});

test("agent save canvas result is not considered a real mutation", () => {
  assert.equal(agentTestInternals.agentActionResultChangedState({
    type: "save_canvas",
    ok: true,
    canvasChanged: true,
  }), false);
});

test("agent prompt removal removes multi-word asset names", () => {
  const prompt = "Chloe runs while Tiffany crawls overhead and Plastic Guards remain in scene positions. Tiffany's lab shakes.";
  const result = agentTestInternals.removeNamesFromPrompt(prompt, ["Tiffany", "Plastic Guards"]);

  assert.doesNotMatch(result, /Tiffany/);
  assert.doesNotMatch(result, /Plastic Guards/);
  assert.match(result, /the lab shakes/);
});

test("agent prompt removal handles requested ceiling crawl action", () => {
  const request = "clip07视频提示词里还保留着tiffany天花板爬的动作。帮我删了。";
  const prompt = [
    "Scene: Chloe holds Chloe's shotgun, crawls overhead across the ceiling, while Eugene, Bob, and remain consistent with their reference identities.",
    "P1: Leo reacts with nervous determination while gripping his pan. continues crawling across the ceiling above them in the background, creating danger overhead. Leo says exactly: “I can try.”",
    "P2: Chloe keeps her attention on Leo and crawls overhead, still threatening but not yet dropping.",
    "P3: Shift lower to emphasize the looming toxic tea tank above and crawling across the ceiling.",
    "Performance direction: Keep Chloe with Chloe's shotgun, Leo with Leo's pan, overhead.",
  ].join("\n");
  const preloaded = [{
    canvas: {
      nodes: [{
        id: "episode-sync-video-node-episode-002-clip-007",
        type: "video",
        clipId: "clip-007",
        title: "Clip 07 video",
        prompt,
      }],
      edges: [],
    },
  }];

  const actions = agentTestInternals.deterministicActionsFromUserRequest(request, preloaded);

  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "update_canvas_node_prompt");
  assert.equal(actions[0].nodeId, "episode-sync-video-node-episode-002-clip-007");
  assert.doesNotMatch(actions[0].prompt, /crawl/i);
  assert.doesNotMatch(actions[0].prompt, /ceiling/i);
  assert.doesNotMatch(actions[0].prompt, /overhead/i);
  assert.doesNotMatch(actions[0].prompt, /and remain/);
  assert.match(actions[0].prompt, /gripping his pan\. Leo says exactly/);
  assert.match(actions[0].prompt, /Leo says exactly/);
});

test("agent workflow prompt update writes video prompts to root and episode workflow", () => {
  const metadata = {
    workflowCenter: {
      clips: [
        { id: "clip-004", seedancePrompt: "old", videoPrompt: "old", storyboardPrompt: "story" },
      ],
    },
    episodes: {
      "episode-002": {
        canvasSceneId: "episode-002",
        workflowCenter: {
          clips: [
            { id: "clip-004", seedancePrompt: "old", videoPrompt: "old", storyboardPrompt: "story" },
          ],
        },
      },
    },
  };

  const next = agentTestInternals.updateWorkflowClipPromptInMetadata(metadata, "episode-002", "clip-004", "video", "new video prompt") as typeof metadata;
  assert.equal(next.workflowCenter.clips[0].seedancePrompt, "new video prompt");
  assert.equal(next.workflowCenter.clips[0].videoPrompt, "new video prompt");
  assert.equal(next.episodes["episode-002"].workflowCenter.clips[0].seedancePrompt, "new video prompt");
  assert.equal(next.episodes["episode-002"].workflowCenter.clips[0].videoPrompt, "new video prompt");
  assert.equal(next.workflowCenter.clips[0].storyboardPrompt, "story");
});
