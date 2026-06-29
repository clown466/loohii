import assert from "node:assert/strict";
import test from "node:test";
import { buildClipPositioningBoardPrompt, positioningBoardReferenceMetadata } from "./workflowPositioningBoards";

test("buildClipPositioningBoardPrompt creates static keyframe, not video prompt", () => {
  const prompt = buildClipPositioningBoardPrompt({
    projectName: "美式漫剧",
    clip: {
      id: "clip-012",
      title: "Clip 12 · Flora announces ritual",
      setting: "Sanctuary Cafeteria",
      startState: "Starts with cultists rigid while the trio listens from the corner.",
      endState: "Ends with the same cafeteria layout, alarm rising.",
    },
    shots: [
      {
        id: "shot-001",
        action: "Cultists sit rigid while Chloe, Bob, and Leo listen from the corner.",
        dialogue: "Flora: Tonight, we will hold our first Pre-Harvest Ritual.",
        references: "Flora voice over PA; PA speaker on screen-right wall.",
        characters: ["Chloe", "Bob", "Leo", "Celery Cultist", "Flora"],
      },
    ],
    referenceLabels: ["Chloe", "Bob", "Leo", "Celery Cultist", "Flora", "Sanctuary Cafeteria"],
    visibleCharacterNames: ["Chloe", "Bob", "Leo", "Celery Cultist", "Flora"],
    mode: "positioning",
  });

  assert.match(prompt, /Create ONE static keyframe positioning-board image/);
  assert.match(prompt, /single 16:9 still frame/);
  assert.match(prompt, /Visible characters for this still frame only: Chloe, Bob, Leo, Celery Cultist, Flora/);
  assert.doesNotMatch(prompt, /Generate one continuous/i);
  assert.doesNotMatch(prompt, /S1:/);
});

test("buildClipPositioningBoardPrompt creates storyboard grid when requested", () => {
  const prompt = buildClipPositioningBoardPrompt({
    projectName: "美式漫剧",
    clip: {
      id: "clip-006",
      title: "Clip 06 · Flora Chooses Chloe",
      setting: "Gutted Produce Section Ritual Hall",
    },
    shots: [
      {
        id: "S1",
        shotSize: "close-up",
        cameraAngle: "eye-level",
        cameraMove: "static hold",
        lens: "85mm",
        action: "Flora addresses Chloe from the ritual stage.",
        dialogue: "Flora: You are the perfect beating core for our Sanctuary.",
        characters: ["Flora", "Chloe"],
      },
      {
        id: "S2",
        shotSize: "medium",
        cameraAngle: "over-shoulder",
        action: "Chloe stays restrained in the front row, glaring back.",
        characters: ["Chloe"],
      },
    ],
    referenceLabels: ["Flora", "Chloe", "Gutted Produce Section Ritual Hall"],
    visibleCharacterNames: ["Flora", "Chloe"],
    mode: "storyboard",
  });

  assert.match(prompt, /comic storyboard board/);
  assert.match(prompt, /1x2/);
  assert.match(prompt, /upper-left corner/);
  assert.match(prompt, /Panel 1 \(S1\)/);
  assert.match(prompt, /Panel 2 \(S2\)/);
  assert.doesNotMatch(prompt, /Create ONE static keyframe positioning-board image/);
});

test("buildClipPositioningBoardPrompt keeps full scene lock and removes conflicting warm light", () => {
  const prompt = buildClipPositioningBoardPrompt({
    projectName: "美式漫剧",
    clip: {
      id: "clip-009",
      title: "Clip 09 · Notepad close-up",
      setting: "Wasteland Highway",
    },
    shots: [
      {
        id: "S1",
        action: "The chopper recedes under warm morning light.",
        visualPrompt: "Wide highway shot, golden dawn light, morning sky.",
        characters: ["Chloe", "Bob", "Leo"],
      },
    ],
    referenceLabels: ["Chloe", "Bob", "Leo", "Wasteland Highway"],
    visibleCharacterNames: ["Chloe", "Bob", "Leo"],
    sceneLockName: "Wasteland Highway",
    sceneVisualLock: "Scene visual authority: Wasteland Highway. Maintain cold night wasteland highway, black-blue horizon, no warm sunset or orange dusk.",
    mode: "storyboard",
  });

  assert.match(prompt, /Scene visual continuity details:/);
  assert.match(prompt, /cold night wasteland highway/);
  assert.match(prompt, /No warm sunrise, no golden daylight, no orange dusk/);
  assert.doesNotMatch(prompt, /warm morning light/i);
  assert.doesNotMatch(prompt, /golden dawn light/i);
  assert.doesNotMatch(prompt, /morning sky/i);
});

test("positioningBoardReferenceMetadata marks image as spatial authority for Seedance", () => {
  const metadata = positioningBoardReferenceMetadata({
    clipId: "clip-012",
    episodeId: "episode-010",
    assetId: "asset-position-board",
    imageUrl: "https://example.com/board.png",
  });

  assert.equal(metadata.assetKind, "positioning-board");
  assert.equal(metadata.clipNodeKind, "positioning-board-reference");
  assert.equal(metadata.positioningBoardForClip, true);
  assert.equal(metadata.spatialAuthority, true);
  assert.equal(metadata.sourceEpisodeId, "episode-010");
});
