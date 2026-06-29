import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clipStoryboardBoardLayoutStrategy, ensureClipStoryboardBoardLayoutPrompt, finalizeClipStoryboardImagePrompt } from "./storyboardPrompt";

test("legacy director-board prompt is rewritten into comic storyboard prompt", () => {
  const legacyPrompt = readFileSync(new URL("./__fixtures__/legacyStoryboardPrompt.txt", import.meta.url), "utf8");
  const cleaned = ensureClipStoryboardBoardLayoutPrompt(legacyPrompt);

  assert.match(cleaned, /compact multi-panel comic page/i);
  assert.match(cleaned, /vertical-video-friendly frames/i);
  assert.match(cleaned, /medium close-ups, close-ups, reaction close-ups/i);
  assert.match(cleaned, /do not duplicate the same character multiple times inside one panel/i);
  assert.match(cleaned, /Comic panels in reading order:/);
  assert.equal(Array.from(cleaned.matchAll(/\bPanel\s+\d{1,2}\s*:/g)).length, 8);

  assert.doesNotMatch(cleaned, /\bcamera\s*=/i);
  assert.doesNotMatch(cleaned, /\bexact dialogue\s*=/i);
  assert.doesNotMatch(cleaned, /\bkey prop\s*=/i);
  assert.doesNotMatch(cleaned, /technical label strip/i);
  assert.doesNotMatch(cleaned, /Technical labels under each panel/i);
  assert.doesNotMatch(cleaned, /shot size, angle, movement, lens/i);

  assert.match(cleaned, /speech bubble: Tiffany: Is that stupid pan all you have\? You ugly chef!/);
  assert.match(cleaned, /speech bubble: Leo: It is a non-stick defense system\./);
  assert.match(cleaned, /speech bubble: Eugene: Chloe! I can't hack the lasers! The firewall is too strong!/);
  assert.equal((cleaned.match(/speech bubble: Tiffany: Is that stupid pan all you have\? You ugly chef!/g) ?? []).length, 1);
  assert.equal((cleaned.match(/speech bubble: Leo: It is a non-stick defense system\./g) ?? []).length, 1);
  assert.equal((cleaned.match(/speech bubble: Eugene: Chloe! I can't hack the lasers! The firewall is too strong!/g) ?? []).length, 1);
});

test("single-line legacy storyboard prompt still keeps panel beats", () => {
  const legacyPrompt = readFileSync(new URL("./__fixtures__/legacyStoryboardPrompt.txt", import.meta.url), "utf8").replace(/\s*\n\s*/g, " ");
  const cleaned = ensureClipStoryboardBoardLayoutPrompt(legacyPrompt);

  assert.match(cleaned, /Comic panels in reading order:/);
  assert.equal(Array.from(cleaned.matchAll(/\bPanel\s+\d{1,2}\s*:/g)).length, 8);
  assert.doesNotMatch(cleaned, /\bcamera\s*=/i);
  assert.doesNotMatch(cleaned, /\bexact dialogue\s*=/i);
  assert.doesNotMatch(cleaned, /technical label strip/i);
});

test("damaged comic storyboard prompt is repaired with full layout rules", () => {
  const damaged = [
    "Reference image map:",
    "#1: Character (Chloe); identity source for Chloe.",
    "Character bindings: Chloe=Reference image #1.",
    "",
    "each panel. Show spoken dialogue as clean white comic speech bubbles inside the relevant panels. Visible text stays to panel labels and speech bubbles.",
    "Reference image map: #1: Character (Chloe); identity source for Chloe. Character bindings: Chloe=Reference image #1.",
    "Required continuity characters: Chloe, Leo.",
    "Create one 16:9 multi-panel 3D American comic storyboard image.",
    "Comic panels in reading order:",
    "Panel 1: show Chloe aiming upward; speech bubble: Chloe: Move.",
  ].join("\n");

  const cleaned = ensureClipStoryboardBoardLayoutPrompt(damaged, 5);

  assert.match(cleaned, /Storyboard layout: one 16:9 compact multi-panel comic page using 5 sequential panels/i);
  assert.match(cleaned, /Show spoken dialogue as clean white comic speech bubbles/i);
  assert.match(cleaned, /Panel 1: show Chloe aiming upward/);
  assert.equal(Array.from(cleaned.matchAll(/Reference image map:/g)).length, 0);
  assert.doesNotMatch(cleaned, /(?:^|\n)\s*each panel\. Show spoken dialogue/i);
});

test("final storyboard prompt removes legacy technical fields from new workflow prompts", () => {
  const prompt = [
    "Create one 16:9 clip-level director board image.",
    "Shots to cover across the panels:",
    "Shot 01 (4s) | title=Pan Versus Needles | camera=wide, eye-level, slow push-in, 24mm | action=Leo raises Leo's Magic Pan. | dialogue=Tiffany: Is that stupid pan all you have? | visual cue=Lab wall fight",
    "Panel beats to render in order:",
    "Panel 1: camera=wide, eye-level, slow push-in, 24mm | action=Leo raises Leo's Magic Pan. | exact dialogue=Tiffany: Is that stupid pan all you have?; technical label strip includes shot size, angle, movement, lens, action, key prop, and exact dialogue if any.",
    "Technical labels under each panel: shot size, camera angle, camera movement, lens/focal length, character action, key prop, exact dialogue line if any.",
  ].join("\n");

  const cleaned = finalizeClipStoryboardImagePrompt(prompt, 5);

  assert.match(cleaned, /Storyboard layout: one 16:9 compact multi-panel comic page using 5 sequential panels/i);
  assert.match(cleaned, /vertical-video-friendly frames/i);
  assert.match(cleaned, /do not duplicate the same character multiple times inside one panel/i);
  assert.match(cleaned, /Story beats to show across the comic panels:/);
  assert.match(cleaned, /Comic panels in reading order:/);
  assert.match(cleaned, /speech bubble: Tiffany: Is that stupid pan all you have\?/);
  assert.doesNotMatch(cleaned, /\bcamera\s*=/i);
  assert.doesNotMatch(cleaned, /\bexact dialogue\s*=/i);
  assert.doesNotMatch(cleaned, /technical label strip/i);
  assert.doesNotMatch(cleaned, /Technical labels under each panel/i);
  assert.doesNotMatch(cleaned, /shot size, camera angle/i);
});

test("final storyboard prompt upgrades old wide comic layout to compact vertical-friendly layout", () => {
  const prompt = [
    "Create one 16:9 multi-panel 3D American comic storyboard image.",
    "Storyboard layout: one 16:9 multi-panel comic page using 6 large sequential panels in left-to-right, top-to-bottom reading order.",
    "Use a full-page comic grid with thin black gutters and large cinematic 3D American comic frames.",
    "Place a small readable panel number label such as P1, P2, P3 in a corner of each panel.",
    "Show spoken dialogue as clean white comic speech bubbles inside the relevant panels.",
    "Use only panel numbers and intentional speech bubbles as visible text; camera, lens, movement, and shot metadata belong to the video prompt, not the image.",
    "Comic panels in reading order:",
    "Panel 1: show Chloe reacting; speech bubble: Chloe: Move.",
  ].join("\n");

  const cleaned = finalizeClipStoryboardImagePrompt(prompt, 6);

  assert.match(cleaned, /Storyboard layout: one 16:9 compact multi-panel comic page using 6 sequential panels/i);
  assert.match(cleaned, /vertical-video-friendly frames/i);
  assert.match(cleaned, /do not duplicate the same character multiple times inside one panel/i);
  assert.doesNotMatch(cleaned, /large sequential panels/i);
  assert.doesNotMatch(cleaned, /large cinematic 3D American comic frames/i);
});

test("final storyboard prompt keeps repeated panel actions but does not repeat the same speech bubble", () => {
  const prompt = [
    "Create one 16:9 multi-panel 3D American comic storyboard image.",
    "Comic panels in reading order:",
    "Panel 1: show Tiffany taunts Leo; speech bubble: Tiffany: Is that stupid pan all you have? You ugly chef!; small corner label P1.",
    "Panel 2: show Leo reacts to Tiffany; speech bubble: Tiffany: Is that stupid pan all you have? You ugly chef!; small corner label P2.",
    "Panel 3: show Leo raises the pan; speech bubble: Tiffany: Is that stupid pan all you have? You ugly chef!; small corner label P3.",
    "Panel 4: show Leo answers; speech bubble: Leo: It is a non-stick defense system.; small corner label P4.",
    "Panel 5: show the pan blocks needles; speech bubble: Leo: It is a non-stick defense system.; small corner label P5.",
  ].join("\n");

  const cleaned = finalizeClipStoryboardImagePrompt(prompt, 5);

  assert.equal((cleaned.match(/speech bubble: Tiffany: Is that stupid pan all you have\? You ugly chef!/g) ?? []).length, 1);
  assert.equal((cleaned.match(/speech bubble: Leo: It is a non-stick defense system\./g) ?? []).length, 1);
  assert.equal((cleaned.match(/\bPanel\s+\d{1,2}:[^\n.]*no speech bubble/g) ?? []).length, 3);
});

test("clipStoryboardBoardLayoutStrategy uses provided aspect ratio", () => {
  const landscape = clipStoryboardBoardLayoutStrategy(6, "16:9");
  assert.match(landscape, /one 16:9 compact multi-panel comic page/i);

  const portrait = clipStoryboardBoardLayoutStrategy(6, "9:16");
  assert.match(portrait, /one 9:16 compact multi-panel comic page/i);

  const square = clipStoryboardBoardLayoutStrategy(6, "1:1");
  assert.match(square, /one 1:1 compact multi-panel comic page/i);
});

test("clipStoryboardBoardLayoutStrategy defaults to 16:9 without aspect ratio", () => {
  const result = clipStoryboardBoardLayoutStrategy(6);
  assert.match(result, /one 16:9 compact multi-panel comic page/i);
});

test("ensureClipStoryboardBoardLayoutPrompt passes aspect ratio through", () => {
  const prompt = "Panel 1: show action; Panel 2: reaction.";
  const result = ensureClipStoryboardBoardLayoutPrompt(prompt, 6, "9:16");
  assert.match(result, /one 9:16 compact multi-panel comic page/i);
});

test("finalizeClipStoryboardImagePrompt passes aspect ratio through", () => {
  const prompt = "Panel 1: show action; Panel 2: reaction.";
  const result = finalizeClipStoryboardImagePrompt(prompt, 6, "9:16");
  assert.match(result, /one 9:16 compact multi-panel comic page/i);
});
