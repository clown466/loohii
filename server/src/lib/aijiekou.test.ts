import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../config";
import {
  clearPlatformMeCache,
  fetchPlatformMe,
  PLATFORM_ME_CACHE_MAX_ENTRIES,
  platformMeCacheSize,
  PlatformUnavailableError,
} from "./aijiekou";

const meBody = {
  id: 42,
  email: "User@Example.com",
  points: 700,
  membership_expires_at: null,
  membership_active: false,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("fetchPlatformMe returns normalized profile for a valid platform token", async () => {
  clearPlatformMeCache();
  let calls = 0;
  const me = await fetchPlatformMe("token-valid", async (url, init) => {
    calls += 1;
    assert.match(url, /\/v1\/me$/);
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer token-valid");
    return jsonResponse(200, meBody);
  });

  assert.equal(calls, 1);
  assert.deepEqual(me, {
    id: 42,
    email: "user@example.com",
    points: 700,
    membershipExpiresAt: null,
    membershipActive: false,
  });
});

test("fetchPlatformMe returns null when platform rejects the token (401)", async () => {
  clearPlatformMeCache();
  const me = await fetchPlatformMe("token-expired", async () => jsonResponse(401, { detail: "未登录或令牌无效" }));
  assert.equal(me, null);
});

test("fetchPlatformMe throws PlatformUnavailableError on platform 5xx", async () => {
  clearPlatformMeCache();
  await assert.rejects(
    fetchPlatformMe("token-x", async () => jsonResponse(500, {})),
    PlatformUnavailableError,
  );
});

test("fetchPlatformMe throws PlatformUnavailableError on network failure", async () => {
  clearPlatformMeCache();
  await assert.rejects(
    fetchPlatformMe("token-x", async () => {
      throw new Error("ECONNREFUSED");
    }),
    PlatformUnavailableError,
  );
});

test("fetchPlatformMe returns null on malformed success payload", async () => {
  clearPlatformMeCache();
  const me = await fetchPlatformMe("token-x", async () => jsonResponse(200, { hello: "world" }));
  assert.equal(me, null);
});

test("fetchPlatformMe caches successful and 401 results within TTL", async () => {
  clearPlatformMeCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(200, meBody);
  };

  const first = await fetchPlatformMe("token-cached", fetchImpl);
  const second = await fetchPlatformMe("token-cached", fetchImpl);
  assert.equal(calls, 1);
  assert.deepEqual(second, first);

  let rejectCalls = 0;
  const rejectImpl = async () => {
    rejectCalls += 1;
    return jsonResponse(401, {});
  };
  assert.equal(await fetchPlatformMe("token-bad", rejectImpl), null);
  assert.equal(await fetchPlatformMe("token-bad", rejectImpl), null);
  assert.equal(rejectCalls, 1);
});

// --- P2-D R4：缓存容量上限 + TTL 淘汰 ---

test("me cache is capped: oldest tokens are evicted beyond PLATFORM_ME_CACHE_MAX_ENTRIES", async () => {
  clearPlatformMeCache();
  const callsPerToken = new Map<string, number>();
  const fetchImpl = async (_url: string, init: RequestInit) => {
    const token = (init.headers as Record<string, string>).Authorization.replace("Bearer ", "");
    callsPerToken.set(token, (callsPerToken.get(token) ?? 0) + 1);
    return jsonResponse(200, meBody);
  };

  const total = PLATFORM_ME_CACHE_MAX_ENTRIES + 25;
  for (let i = 0; i < total; i += 1) {
    await fetchPlatformMe(`token-${i}`, fetchImpl);
  }
  assert.equal(platformMeCacheSize(), PLATFORM_ME_CACHE_MAX_ENTRIES);

  // 最早写入的 token-0 已被淘汰：再访问会重新打平台
  await fetchPlatformMe("token-0", fetchImpl);
  assert.equal(callsPerToken.get("token-0"), 2);
  // 最新写入的仍在缓存：不再打平台
  await fetchPlatformMe(`token-${total - 1}`, fetchImpl);
  assert.equal(callsPerToken.get(`token-${total - 1}`), 1);
});

test("me cache treats a cache hit as recently used (LRU refresh)", async () => {
  clearPlatformMeCache();
  const fetchImpl = async () => jsonResponse(200, meBody);

  for (let i = 0; i < PLATFORM_ME_CACHE_MAX_ENTRIES; i += 1) {
    await fetchPlatformMe(`token-${i}`, fetchImpl);
  }
  // 热点 token-0 命中一次刷新到最新，再写入 1 个新 token 时淘汰的是 token-1
  await fetchPlatformMe("token-0", fetchImpl);
  await fetchPlatformMe("token-new", fetchImpl);
  assert.equal(platformMeCacheSize(), PLATFORM_ME_CACHE_MAX_ENTRIES);

  const callsPerToken = new Map<string, number>();
  const countingImpl = async (_url: string, init: RequestInit) => {
    const token = (init.headers as Record<string, string>).Authorization.replace("Bearer ", "");
    callsPerToken.set(token, (callsPerToken.get(token) ?? 0) + 1);
    return jsonResponse(200, meBody);
  };
  await fetchPlatformMe("token-0", countingImpl);
  assert.equal(callsPerToken.get("token-0") ?? 0, 0); // token-0 仍在缓存
  await fetchPlatformMe("token-1", countingImpl);
  assert.equal(callsPerToken.get("token-1"), 1); // token-1 已被淘汰
});

test("me cache sweeps expired entries on write", async () => {
  clearPlatformMeCache();
  const originalTtl = config.aijiekou.meCacheTtlMs;
  config.aijiekou.meCacheTtlMs = 5; // 5ms TTL，测试用
  try {
    const fetchImpl = async () => jsonResponse(200, meBody);
    for (let i = 0; i < 10; i += 1) {
      await fetchPlatformMe(`token-stale-${i}`, fetchImpl);
    }
    assert.equal(platformMeCacheSize(), 10);
    await new Promise((resolve) => setTimeout(resolve, 20)); // 等全部过期
    await fetchPlatformMe("token-fresh", fetchImpl); // 写入时顺手清扫过期项
    assert.equal(platformMeCacheSize(), 1);
  } finally {
    config.aijiekou.meCacheTtlMs = originalTtl;
    clearPlatformMeCache();
  }
});
