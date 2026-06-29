import assert from "node:assert/strict";
import test from "node:test";
import { hoistRepeatedShotRules } from "./workflowPromptDedupe";

test("hoistRepeatedShotRules moves repeated same-scene rules out of S beats", () => {
  const prompt = [
    "Clip video prompt for Clip 12.",
    "Global shot rules: maintain one continuous scene geography.",
    "S1: Shot: close-up; blocking: Cafeteria listens to Flora PA announcement, trio tense in corner, cultists rigid. Same setting and character blocking, natural reaction or angle change.; Exact dialogue: Flora: \"Line one.\"",
    "S2: Shot: close-up; blocking: Cafeteria listens to Flora PA announcement, trio tense in corner, cultists rigid. Same setting and character blocking, natural reaction or angle change.; reaction/cutaway detail, same scene geography, same character positions; Chloe reacts.",
    "S3: Shot: close-up; blocking: Cafeteria listens to Flora PA announcement, trio tense in corner, cultists rigid. Same setting and character blocking, natural reaction or angle change.; Bob reacts.",
    "No subtitles, speech bubbles, UI, panel borders, watermarks, random text, gore, or identity drift.",
  ].join("\n");

  const result = hoistRepeatedShotRules(prompt);

  assert.match(result, /Clip blocking: Cafeteria listens to Flora PA announcement, trio tense in corner, cultists rigid\./);
  assert.equal((result.match(/Same setting and character blocking/g) ?? []).length, 0);
  assert.equal((result.match(/same scene geography/g) ?? []).length, 0);
  assert.match(result, /^S1: Shot: close-up; Exact dialogue: Flora: “Line one\.”/m);
  assert.match(result, /^S2: Shot: close-up; Chloe reacts\./m);
  assert.match(result, /^S3: Shot: close-up; Bob reacts\./m);
});

test("hoistRepeatedShotRules drops known half-word truncation residue without truncating lines", () => {
  const prompt = [
    "Header",
    "S1: Shot: close-up; Performance: Flora shows ceremonial delivery; Cultists s.",
    "S2: Shot: close-up; Performance: Flora shows ceremonial delivery; Cultists sit r.",
    "S3: Shot: close-up; Performance: Flora shows ceremonial delivery; del.",
  ].join("\n");

  const result = hoistRepeatedShotRules(prompt);

  assert.doesNotMatch(result, /\bCultists s\b|\bdel\.\b|\bsit r\b/);
  assert.match(result, /Performance: Flora shows ceremonial delivery/);
});

test("hoistRepeatedShotRules removes repeated old prompt filler while preserving exact dialogue", () => {
  const prompt = [
    "Header",
    'S1: Exact dialogue: Chloe: "Move."; Shot: close-up; Performance: Chloe shows story-specific emotion matching the current beat, readable through face and body language; delivery natural to the line\'s intent, not monotone, with clear emotional subtext; Chloe racks her Shotgun with a smooth, practiced motion.',
    "S2: Shot: close-up; Performance: Chloe shows story-specific emotion matching the current beat, readable through face and body language; Chloe racks her Shotgun with a smooth, practiced motion.",
    "S3: Shot: close-up; Chloe racks her Shotgun with a smooth, practiced motion.",
  ].join("\n");

  const result = hoistRepeatedShotRules(prompt);

  assert.match(result, /Exact dialogue: Chloe: “Move\.”/);
  assert.equal((result.match(/story-specific emotion matching/g) ?? []).length, 0);
  assert.equal((result.match(/delivery natural/g) ?? []).length, 0);
  assert.equal((result.match(/Chloe racks her Shotgun/g) ?? []).length, 1);
});
