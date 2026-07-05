import test from "node:test";
import assert from "node:assert/strict";
import { thumbUrl } from "./thumbUrl";

test("appends thumb suffix for local upload images", () => {
  assert.equal(
    thumbUrl("https://loohii.com/api/uploads/public/u1/a.png", 300),
    "https://loohii.com/api/uploads/public/u1/a.png.thumb300.webp",
  );
  assert.equal(
    thumbUrl("/api/uploads/public/u1/gen/b.jpg", 1024),
    "/api/uploads/public/u1/gen/b.jpg.thumb1024.webp",
  );
});

test("returns external and non-image urls unchanged", () => {
  assert.equal(thumbUrl("https://cdn.example.com/x.png", 300), "https://cdn.example.com/x.png");
  assert.equal(thumbUrl("/api/uploads/public/u1/v.mp4", 300), "/api/uploads/public/u1/v.mp4");
});

test("handles empty and already-thumbnailed urls", () => {
  assert.equal(thumbUrl(undefined, 300), "");
  assert.equal(thumbUrl(null, 300), "");
  assert.equal(
    thumbUrl("/api/uploads/public/u1/a.png.thumb300.webp", 300),
    "/api/uploads/public/u1/a.png.thumb300.webp",
  );
});

test("ignores data and blob urls", () => {
  assert.equal(thumbUrl("data:image/png;base64,AAAA", 300), "data:image/png;base64,AAAA");
  assert.equal(thumbUrl("blob:https://loohii.com/xyz", 300), "blob:https://loohii.com/xyz");
});
