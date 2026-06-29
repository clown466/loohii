import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateClipDialogueToBeats,
  extractDialogueSpeakerNames,
  restoreMissingDialogueFragments,
} from "./clipDialogueAllocator";

test("single-character shot without prefix gets speaker prefix", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "Murder! Cold-blooded murder!", characters: ["Flora"] },
  ]);
  assert.deepEqual(result.beats, [["Flora: Murder! Cold-blooded murder!"]]);
  assert.equal(result.restoredCount, 0);
});

test("existing speaker prefix is preserved", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "Chloe: Lady, I just saved your life.", characters: ["Chloe", "Flora"] },
  ]);
  assert.deepEqual(result.beats, [["Chloe: Lady, I just saved your life."]]);
});

test("multi-character shot without context keeps raw text without guessing", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "What was that noise?", characters: ["Bob", "Leo"] },
  ]);
  assert.deepEqual(result.beats, [["What was that noise?"]]);
});

test("multi-character shot infers speaker from action context", () => {
  const result = allocateClipDialogueToBeats([
    {
      dialogue: "This is aggressively gross!",
      characters: ["Chloe", "Bob"],
      title: "Chloe's Disgust",
      action: "Chloe pumps shotgun, swings leg over motorcycle, wipes face.",
      description: "Chloe yells in disgust while blasting a path with her shotgun.",
    },
    {
      dialogue: "Hold on!",
      characters: ["Bob", "Chloe", "Leo"],
      title: "Through the Glass Doors",
      action: "Motorcycle accelerates and crashes through glass doors.",
      description: "Bob yells 'Hold on!' and cranks the throttle.",
    },
  ]);
  assert.deepEqual(result.beats, [
    ["Chloe: This is aggressively gross!"],
    ["Bob: Hold on!"],
  ]);
});

test("multi-character shot infers short directional dialogue from gesture context", () => {
  const result = allocateClipDialogueToBeats([
    {
      dialogue: "Look over there,",
      characters: ["Leo", "Chloe", "Bob"],
      title: "Pointing to Terminal",
      action: "Leo points.",
      description: "Leo points to a circular reception terminal in the center of the lobby.",
    },
  ]);
  assert.deepEqual(result.beats, [["Leo: Look over there,"]]);
});

test("multi-character shot infers speaker from title-leading character name", () => {
  const result = allocateClipDialogueToBeats([
    {
      dialogue: "Nobody's home?",
      characters: ["Bob", "Chloe", "Leo"],
      title: "Bob Checks Room",
      action: "Bob steps gingerly onto marble, scans room.",
      description: "Bob keeps weapon raised, steps onto marble.",
    },
    {
      dialogue: "According to Omega Corp's logistics protocol, this floor is out of bounds.",
      characters: ["Leo", "Chloe", "Bob"],
      title: "Leo Cites Protocol",
      action: "Leo pats pan against his chest.",
      description: "Leo deadpans delivery protocol while patting his cast-iron pan.",
    },
  ]);
  assert.deepEqual(result.beats, [
    ["Bob: Nobody's home?"],
    ["Leo: According to Omega Corp's logistics protocol, this floor is out of bounds."],
  ]);
});

test("fragmented sentence merges into the starting beat", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "Chloe: Well, if you'd rather go breathe", characters: ["Chloe", "Flora"] },
    { dialogue: "with that pile of rot, I'm happy to toss you outside.", characters: ["Chloe", "Flora"] },
  ]);
  assert.deepEqual(result.beats, [
    ["Chloe: Well, if you'd rather go breathe with that pile of rot, I'm happy to toss you outside."],
    [],
  ]);
  assert.equal(result.restoredCount, 0);
});

test("a different speaker stops fragment merging", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "Flora: How could you", characters: ["Flora", "Chloe"] },
    { dialogue: "Chloe: Easily.", characters: ["Chloe"] },
  ]);
  assert.deepEqual(result.beats, [["Flora: How could you"], ["Chloe: Easily."]]);
});

test("same-speaker labelled spoken turns do not merge across source quote boundaries", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "Chloe: Having an all-you-can-eat buffet,", characters: ["Chloe", "Leo"] },
    {
      dialogue:
        "Chloe: With Flora's control gone, the fungus's base instinct took over: consume any available nutrients. And right now, she’s the biggest protein shake in the room.",
      characters: ["Chloe", "Leo"],
    },
  ]);
  assert.deepEqual(result.beats, [
    ["Chloe: Having an all-you-can-eat buffet,"],
    [
      "Chloe: With Flora's control gone, the fungus's base instinct took over: consume any available nutrients. And right now, she’s the biggest protein shake in the room.",
    ],
  ]);
});

test("multiple speakers inside one shot split into separate lines", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "Chloe: Run. Bob: Where?!", characters: ["Chloe", "Bob"] },
  ]);
  assert.deepEqual(result.beats, [["Chloe: Run.", "Bob: Where?!"]]);
});

test("empty dialogue yields empty beats", () => {
  const result = allocateClipDialogueToBeats([{ dialogue: "", characters: ["A"] }]);
  assert.deepEqual(result.beats, [[]]);
  assert.equal(result.restoredCount, 0);
});

test("Chinese dialogue with Chinese colon prefix works", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "弗洛拉：谋杀！这是冷血的谋杀！", characters: ["弗洛拉", "克洛伊"] },
  ]);
  assert.deepEqual(result.beats, [["弗洛拉: 谋杀！这是冷血的谋杀！"]]);
});

test("restoreMissingDialogueFragments appends unmatched source lines to their own beat", () => {
  const beats: string[][] = [[], []];
  const restored = restoreMissingDialogueFragments(
    [
      { dialogue: "Flora: Murder!", characters: ["Flora"] },
      { dialogue: "", characters: [] },
    ],
    beats,
  );
  assert.equal(restored, 1);
  assert.deepEqual(beats, [["Flora: Murder!"], []]);
});

test("input shots array is not mutated", () => {
  const shots = [{ dialogue: "Chloe: Hi.", characters: ["Chloe"] }];
  const snapshot = JSON.stringify(shots);
  allocateClipDialogueToBeats(shots);
  assert.equal(JSON.stringify(shots), snapshot);
});

test("capitalized word with colon inside dialogue is not treated as a speaker", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "Chloe: Remember: never trust him.", characters: ["Chloe", "Flora"] },
  ]);
  assert.deepEqual(result.beats, [["Chloe: Remember: never trust him."]]);
});

test("non-character prefix in single-character shot still gets the inferred speaker", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "Warning: the bridge is out!", characters: ["Flora"] },
  ]);
  assert.deepEqual(result.beats, [["Flora: Warning: the bridge is out!"]]);
});

test("Chinese imperative with colon inside dialogue is not split", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "弗洛拉：听好了。记住：别相信他。", characters: ["弗洛拉", "克洛伊"] },
  ]);
  assert.deepEqual(result.beats, [["弗洛拉: 听好了。记住：别相信他。"]]);
});

test("restore uses word boundaries so substrings do not mask missing lines", () => {
  const beats: string[][] = [["Flora: she keeps running away."], []];
  const restored = restoreMissingDialogueFragments(
    [
      { dialogue: "Flora: she keeps running away.", characters: ["Flora"] },
      { dialogue: "Run", characters: ["Chloe"] },
    ],
    beats,
  );
  assert.equal(restored, 1);
  assert.deepEqual(beats[1], ["Chloe: Run"]);
});

test("main API keeps restoredCount at 0 for normal allocations", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "Chloe: Run. Bob: Where?!", characters: ["Chloe", "Bob"] },
    { dialogue: "Flora: Murder!", characters: ["Flora"] },
  ]);
  assert.equal(result.restoredCount, 0);
});

test("speaker extraction finds multiple speakers in one dialogue field", () => {
  assert.deepEqual(extractDialogueSpeakerNames("Flora: Hey. Bob: Wow, everyone first."), ["Flora", "Bob"]);
});

test("embedded speaker prefix is honored even when characters list is incomplete", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "Bob: Wow, everyone first.", characters: ["Flora", "Bob"] },
  ]);
  assert.deepEqual(result.beats, [["Bob: Wow, everyone first."]]);
});
