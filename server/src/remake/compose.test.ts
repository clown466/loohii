import assert from "node:assert/strict";
import test from "node:test";
import { buildConcatDemuxerList, buildSubtitleBurnFilter } from "./compose";

test("buildConcatDemuxerList escapes single quotes", () => {
  const list = buildConcatDemuxerList(["/tmp/a's.mp4", "/tmp/b.mp4"]);
  assert.ok(list.includes("a'\\''s.mp4"));
  assert.ok(list.includes("file '/tmp/b.mp4'"));
});

test("buildSubtitleBurnFilter escapes windows paths", () => {
  const filter = buildSubtitleBurnFilter("C:\\sub\\title.srt");
  assert.ok(filter.includes("subtitles="));
  assert.ok(filter.includes("C\\:/sub/title.srt"));
});
