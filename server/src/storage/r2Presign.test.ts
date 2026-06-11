import assert from "node:assert/strict";
import test from "node:test";
import { R2PresignService, r2PresignTestInternals as t } from "./r2Presign";

// --- encodeKeyPath ---

test("encodeKeyPath encodes path segments individually", () => {
  assert.equal(t.encodeKeyPath("uploads/my file.png"), "uploads/my%20file.png");
});

test("encodeKeyPath preserves slashes", () => {
  assert.equal(t.encodeKeyPath("a/b/c"), "a/b/c");
});

test("encodeKeyPath encodes special characters", () => {
  assert.equal(t.encodeKeyPath("dir/file name (1).jpg"), "dir/file%20name%20(1).jpg");
});

test("encodeKeyPath handles single segment without slashes", () => {
  assert.equal(t.encodeKeyPath("simple.txt"), "simple.txt");
});

test("encodeKeyPath encodes unicode characters", () => {
  const result = t.encodeKeyPath("uploads/图片.png");
  assert.match(result, /^uploads\//);
  assert.doesNotMatch(result, /图片/);
});

// --- R2PresignService.publicUrlForKey ---

test("publicUrlForKey returns undefined when no publicBaseUrl", () => {
  const svc = new R2PresignService({
    accountId: "acc",
    accessKeyId: "key",
    secretAccessKey: "secret",
    bucket: "bucket",
  });

  assert.equal(svc.publicUrlForKey("uploads/test.png"), undefined);
});

test("publicUrlForKey builds URL with encoded key", () => {
  const svc = new R2PresignService({
    accountId: "acc",
    accessKeyId: "key",
    secretAccessKey: "secret",
    bucket: "bucket",
    publicBaseUrl: "https://cdn.example.com",
  });

  assert.equal(svc.publicUrlForKey("uploads/test.png"), "https://cdn.example.com/uploads/test.png");
});

test("publicUrlForKey strips trailing slash from base URL", () => {
  const svc = new R2PresignService({
    accountId: "acc",
    accessKeyId: "key",
    secretAccessKey: "secret",
    bucket: "bucket",
    publicBaseUrl: "https://cdn.example.com/",
  });

  assert.equal(svc.publicUrlForKey("uploads/test.png"), "https://cdn.example.com/uploads/test.png");
});

test("publicUrlForKey encodes special characters in key", () => {
  const svc = new R2PresignService({
    accountId: "acc",
    accessKeyId: "key",
    secretAccessKey: "secret",
    bucket: "bucket",
    publicBaseUrl: "https://cdn.example.com",
  });

  const url = svc.publicUrlForKey("uploads/my file (1).png");
  assert.equal(url, "https://cdn.example.com/uploads/my%20file%20(1).png");
});
