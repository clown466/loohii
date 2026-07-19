import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../lib/httpErrors";
import {
  billingJobIdFor,
  billingParametersForRetry,
  billingRecordFor,
  billingRecordOf,
  chargeGeneration,
  chargeGenerationAndPersist,
  chargeOnce,
  consumePoints,
  needsRechargeOnResume,
  newChargeJobId,
  platformTokenFromAuthorization,
  refundPoints,
} from "./platformBilling";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const platform = {
  platformUserId: 1,
  platformToken: "platform-token",
  email: "u@b.com",
  points: 700,
  membershipActive: false,
};

// --- consume 错误映射（§3.4） ---

test("consumePoints returns the platform response on success", async () => {
  const body = await consumePoints("token", { job_id: "gen:g1", action: "loohii_image", units: 2 }, async (url, init) => {
    assert.match(url, /\/v1\/entitlements\/consume$/);
    const payload = JSON.parse(String(init.body));
    assert.equal(payload.job_id, "gen:g1");
    assert.equal(payload.action, "loohii_image");
    assert.equal(payload.units, 2);
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer token");
    return jsonResponse(200, { ok: true, idempotent: false, points_delta: -16, points: 684 });
  });
  assert.equal(body.points_delta, -16);
  assert.equal(body.points, 684);
});

test("consumePoints maps 402 to a friendly 402", async () => {
  await assert.rejects(
    consumePoints("token", { job_id: "gen:g1", action: "loohii_image" }, async () =>
      jsonResponse(402, { detail: "积分不足，请充值或开通会员" })),
    (error: unknown) => error instanceof HttpError && error.status === 402 && error.message.includes("积分不足"),
  );
});

test("consumePoints maps 401 to re-login guidance", async () => {
  await assert.rejects(
    consumePoints("token", { job_id: "gen:g1", action: "loohii_image" }, async () => jsonResponse(401, {})),
    (error: unknown) => error instanceof HttpError && error.status === 401,
  );
});

test("consumePoints maps 5xx and network failures to 503 (not charged)", async () => {
  await assert.rejects(
    consumePoints("token", { job_id: "gen:g1", action: "loohii_image" }, async () => jsonResponse(500, {})),
    (error: unknown) => error instanceof HttpError && error.status === 503,
  );
  await assert.rejects(
    consumePoints("token", { job_id: "gen:g1", action: "loohii_image" }, async () => {
      throw new Error("ECONNREFUSED");
    }),
    (error: unknown) => error instanceof HttpError && error.status === 503,
  );
});

// --- refund 不抛异常 ---

test("refundPoints returns true on success and false on failure without throwing", async () => {
  assert.equal(await refundPoints("token", "gen:g1", async () => jsonResponse(200, { ok: true })), true);
  assert.equal(await refundPoints("token", "gen:g1", async () => jsonResponse(500, {})), false);
  assert.equal(
    await refundPoints("token", "gen:g1", async () => {
      throw new Error("timeout");
    }),
    false,
  );
});

// --- 幂等键（§3.3） ---

test("billingJobIdFor rotates keys per attempt", () => {
  assert.equal(billingJobIdFor("abc123", 0), "gen:abc123");
  assert.equal(billingJobIdFor("abc123", 1), "gen:abc123:attempt:1");
  assert.equal(billingJobIdFor("abc123", 3), "gen:abc123:attempt:3");
  assert.ok(billingJobIdFor("abc123", 3).length <= 128);
});

test("newChargeJobId produces unique prefixed keys", () => {
  const a = newChargeJobId("txt");
  const b = newChargeJobId("txt");
  assert.notEqual(a, b);
  assert.match(a, /^txt:[0-9a-f-]{36}$/);
});

// --- 重试换键 ---

test("billingParametersForRetry rotates attempt after a settled charge", () => {
  const charged = billingParametersForRetry({
    billing: { jobId: "gen:g1", action: "loohii_image", units: 1, attempt: 0, points: 8, status: "charged" },
  });
  assert.equal((charged.billing as { attempt: number }).attempt, 1);

  const refunded = billingParametersForRetry({
    billing: { jobId: "gen:g1", action: "loohii_image", units: 1, attempt: 1, points: 8, status: "refunded" },
  });
  assert.equal((refunded.billing as { attempt: number }).attempt, 2);
});

test("billingParametersForRetry keeps the key when charge outcome is unknown", () => {
  const result = billingParametersForRetry({
    billing: { jobId: "gen:g1", action: "loohii_image", units: 1, attempt: 0, points: 0, status: "unknown" },
  });
  assert.equal((result.billing as { attempt: number }).attempt, 0);
});

test("billingParametersForRetry passes through when no billing state", () => {
  assert.deepEqual(billingParametersForRetry({ n: 1 }), { n: 1 });
  assert.deepEqual(billingParametersForRetry(null), {});
});

// --- billing 状态读写 ---

test("billingRecord round-trips through generation parameters", () => {
  const charge = {
    jobId: "gen:g1",
    action: "loohii_video" as const,
    units: 1,
    attempt: 0,
    points: 40,
    platformToken: "t",
  };
  const record = billingRecordFor(charge);
  const parsed = billingRecordOf({ other: 1, billing: record });
  assert.equal(parsed?.jobId, "gen:g1");
  assert.equal(parsed?.points, 40);
  assert.equal(parsed?.status, "charged");
  assert.equal(billingRecordOf({}), null);
  assert.equal(billingRecordOf({ billing: { nope: 1 } }), null);
});

// --- chargeGeneration / chargeOnce ---

test("chargeGeneration uses attempt from existing billing state", async () => {
  let seenJobId = "";
  const charge = await chargeGeneration(platform, {
    generationId: "g9",
    action: "loohii_video",
    existingParameters: {
      billing: { jobId: "gen:g9", action: "loohii_video", units: 1, attempt: 2, points: 40, status: "refunded" },
    },
    fetchImpl: async (_url, init) => {
      seenJobId = JSON.parse(String(init.body)).job_id;
      return jsonResponse(200, { ok: true, points_delta: -40, points: 660 });
    },
  });
  assert.equal(seenJobId, "gen:g9:attempt:2");
  assert.equal(charge.points, 40);
});

test("chargeGeneration propagates 402 without charging", async () => {
  await assert.rejects(
    chargeGeneration(platform, {
      generationId: "g9",
      action: "loohii_image",
      fetchImpl: async () => jsonResponse(402, { detail: "积分不足，请充值或开通会员" }),
    }),
    (error: unknown) => error instanceof HttpError && error.status === 402,
  );
});

test("chargeOnce returns actual charged points (membership = 0)", async () => {
  const charge = await chargeOnce(platform, {
    action: "loohii_agent",
    jobId: "agent:m1",
    fetchImpl: async () => jsonResponse(200, { ok: true, points_delta: 0, points: 700 }),
  });
  assert.equal(charge.points, 0);
  assert.equal(charge.jobId, "agent:m1");
});

// --- token 还原 ---

test("platformTokenFromAuthorization handles Bearer, raw and empty", () => {
  assert.equal(platformTokenFromAuthorization("Bearer abc"), "abc");
  assert.equal(platformTokenFromAuthorization("abc"), "abc");
  assert.equal(platformTokenFromAuthorization(undefined), null);
  assert.equal(platformTokenFromAuthorization(""), null);
});

// --- P2-D R2：续跑前是否需要重新预扣 ---

test("needsRechargeOnResume only flags refunded / refundPending records", () => {
  assert.equal(
    needsRechargeOnResume({ billing: { jobId: "gen:g1", action: "loohii_video", units: 1, attempt: 1, points: 40, status: "refunded" } }),
    true,
  );
  assert.equal(
    needsRechargeOnResume({ billing: { jobId: "gen:g1", action: "loohii_video", units: 1, attempt: 0, points: 40, status: "refundPending" } }),
    true,
  );
  // charged 已付过，不重复扣
  assert.equal(
    needsRechargeOnResume({ billing: { jobId: "gen:g1", action: "loohii_video", units: 1, attempt: 0, points: 40, status: "charged" } }),
    false,
  );
  // unknown（扣没扣上不确定）不动，靠平台幂等防双扣
  assert.equal(
    needsRechargeOnResume({ billing: { jobId: "gen:g1", action: "loohii_video", units: 1, attempt: 0, points: 0, status: "unknown" } }),
    false,
  );
  // 无记录 / 畸形记录不扣
  assert.equal(needsRechargeOnResume({}), false);
  assert.equal(needsRechargeOnResume(null), false);
  assert.equal(needsRechargeOnResume({ billing: { nope: 1 } }), false);
});

// --- P2-D R1：chargeGenerationAndPersist 落库失败必退点 ---

test("chargeGenerationAndPersist persists billing after a successful charge without refunding", async () => {
  const persisted: string[] = [];
  const refunded: string[] = [];
  const charge = await chargeGenerationAndPersist(platform, {
    generationId: "g1",
    action: "loohii_video",
    units: 1,
    fetchImpl: async () => jsonResponse(200, { ok: true, points_delta: -40, points: 660 }),
    persist: async (c) => {
      persisted.push(c.jobId);
    },
    refund: async (c) => {
      refunded.push(c.jobId);
    },
  });
  assert.deepEqual(persisted, ["gen:g1"]);
  assert.deepEqual(refunded, []);
  assert.equal(charge.points, 40);
});

test("chargeGenerationAndPersist refunds immediately when the billing DB write fails (R1 money path)", async () => {
  const refunded: string[] = [];
  const dbError = new Error("stub: generation update failed");
  await assert.rejects(
    chargeGenerationAndPersist(platform, {
      generationId: "g1",
      action: "loohii_video",
      units: 1,
      fetchImpl: async (url, init) => {
        if (url.endsWith("/v1/entitlements/consume")) {
          return jsonResponse(200, { ok: true, points_delta: -40, points: 660 });
        }
        throw new Error(`unexpected platform call: ${url} ${String(init.body)}`);
      },
      persist: async () => {
        throw dbError;
      },
      refund: async (c) => {
        refunded.push(c.jobId);
      },
    }),
    (error: unknown) => error === dbError,
  );
  // 扣了 40 但落库失败 → 必须退同一笔（gen:g1）
  assert.deepEqual(refunded, ["gen:g1"]);
});

test("chargeGenerationAndPersist does not refund or persist when the charge itself fails (402)", async () => {
  let persistCalls = 0;
  let refundCalls = 0;
  await assert.rejects(
    chargeGenerationAndPersist(platform, {
      generationId: "g1",
      action: "loohii_video",
      fetchImpl: async () => jsonResponse(402, { detail: "积分不足，请充值或开通会员" }),
      persist: async () => {
        persistCalls += 1;
      },
      refund: async () => {
        refundCalls += 1;
      },
    }),
    (error: unknown) => error instanceof HttpError && error.status === 402,
  );
  assert.equal(persistCalls, 0);
  assert.equal(refundCalls, 0);
});

test("recharge after refund uses the rotated attempt key and persists again (R2 money path)", async () => {
  const seenJobIds: string[] = [];
  const persisted: string[] = [];
  const refunded: string[] = [];
  const charge = await chargeGenerationAndPersist(platform, {
    generationId: "g9",
    action: "loohii_video",
    units: 1,
    // retry 已把 attempt 轮换到 1，旧键 gen:g9 已退款
    existingParameters: {
      raw: { submitId: "stub-1" },
      billing: { jobId: "gen:g9", action: "loohii_video", units: 1, attempt: 1, points: 40, status: "refunded" },
    },
    fetchImpl: async (_url, init) => {
      seenJobIds.push(JSON.parse(String(init.body)).job_id);
      return jsonResponse(200, { ok: true, points_delta: -40, points: 660 });
    },
    persist: async (c) => {
      persisted.push(c.jobId);
    },
    refund: async (c) => {
      refunded.push(c.jobId);
    },
  });
  // 退款后重跑：用新键 gen:g9:attempt:1 真正再扣一次，且重新落库、不退款
  assert.deepEqual(seenJobIds, ["gen:g9:attempt:1"]);
  assert.deepEqual(persisted, ["gen:g9:attempt:1"]);
  assert.deepEqual(refunded, []);
  assert.equal(charge.attempt, 1);
  assert.equal(charge.points, 40);
});
