/**
 * 计费对账 sweep 单测（P3-B）：
 * refundPending → refunded / 失败累加 / 超阈值 needsManual / 无 token 跳过。
 * DB 与平台 fetch 全部注入假实现，不触真库真网。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { sweepRefundPending, type ReconciliationDb } from "./billingReconciliation";

type FakeGeneration = { id: string; userId: string; parameters: Record<string, unknown> };
type FakeCharge = { id: string; jobId: string; platformUserId: number; failCount: number; status: string; lastError: string | null };
type FakeAccount = { userId?: string; providerAccountId?: string; accessToken: string | null };

function fakeDb(input: { generations?: FakeGeneration[]; charges?: FakeCharge[]; accounts?: FakeAccount[] }) {
  const generations = input.generations ?? [];
  const charges = input.charges ?? [];
  const accounts = input.accounts ?? [];
  const db: ReconciliationDb = {
    generation: {
      findMany: async () => generations,
      update: async (args: unknown) => {
        const { where, data } = args as { where: { id: string }; data: { parameters: Record<string, unknown> } };
        const generation = generations.find((item) => item.id === where.id);
        if (generation) generation.parameters = data.parameters;
        return generation;
      },
    },
    billingCharge: {
      findMany: async () => charges,
      update: async (args: unknown) => {
        const { where, data } = args as { where: { id: string }; data: Partial<FakeCharge> };
        const charge = charges.find((item) => item.id === where.id);
        if (charge) Object.assign(charge, data);
        return charge;
      },
    },
    account: {
      findFirst: async (args: unknown) => {
        const where = (args as { where: { userId?: string; providerAccountId?: string } }).where;
        const account = accounts.find(
          (item) =>
            (where.userId && item.userId === where.userId) ||
            (where.providerAccountId && item.providerAccountId === where.providerAccountId),
        );
        return account ? { accessToken: account.accessToken } : null;
      },
    },
  };
  return { db, generations, charges };
}

function billingOf(generation: FakeGeneration): Record<string, unknown> {
  return (generation.parameters as { billing: Record<string, unknown> }).billing;
}

function refundOkFetch(captured: { jobIds: string[]; tokens: string[] }) {
  return async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { job_id: string };
    captured.jobIds.push(body.job_id);
    captured.tokens.push(String((init.headers as Record<string, string>).Authorization));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
}

const refundFailFetch = async () => new Response(JSON.stringify({ detail: "down" }), { status: 500 });

function generationFixture(overrides: Record<string, unknown> = {}): FakeGeneration {
  const { billing, ...rest } = overrides;
  return {
    id: "g1",
    userId: "user-1",
    parameters: {
      ...rest,
      billing: { jobId: "gen:g1", action: "loohii_image", units: 1, attempt: 0, points: 10, status: "refundPending", ...((billing as object) ?? {}) },
    },
  };
}

test("sweep refunds a refundPending generation via account token", async () => {
  const captured = { jobIds: [] as string[], tokens: [] as string[] };
  const generation = generationFixture();
  const { db, generations } = fakeDb({
    generations: [generation],
    accounts: [{ userId: "user-1", accessToken: "plat-token" }],
  });
  const stats = await sweepRefundPending({ prisma: db, fetchImpl: refundOkFetch(captured), now: new Date("2026-07-20T00:00:00Z") });

  assert.equal(stats.generations.scanned, 1);
  assert.equal(stats.generations.refunded, 1);
  assert.deepEqual(captured.jobIds, ["gen:g1"]);
  assert.deepEqual(captured.tokens, ["Bearer plat-token"]);
  assert.equal(billingOf(generations[0]).status, "refunded");
  assert.equal(billingOf(generations[0]).refundedAt, "2026-07-20T00:00:00.000Z");
});

test("sweep keeps generation refundPending and counts failures when refund fails", async () => {
  const generation = generationFixture();
  const { db, generations } = fakeDb({
    generations: [generation],
    accounts: [{ userId: "user-1", accessToken: "plat-token" }],
  });
  const stats = await sweepRefundPending({ prisma: db, fetchImpl: refundFailFetch });

  assert.equal(stats.generations.failed, 1);
  assert.equal(stats.generations.needsManual, 0);
  assert.equal(billingOf(generations[0]).status, "refundPending");
  assert.equal(billingOf(generations[0]).refundFailures, 1);
});

test("sweep marks generation needsManual at the failure threshold", async () => {
  const generation = generationFixture({ billing: { refundFailures: 9 } });
  const { db, generations } = fakeDb({
    generations: [generation],
    accounts: [{ userId: "user-1", accessToken: "plat-token" }],
  });
  const stats = await sweepRefundPending({ prisma: db, fetchImpl: refundFailFetch, maxFailures: 10 });

  assert.equal(stats.generations.needsManual, 1);
  assert.equal(billingOf(generations[0]).status, "needsManual");
  assert.equal(billingOf(generations[0]).refundFailures, 10);
});

test("sweep skips generations whose user has no platform token", async () => {
  const generation = generationFixture();
  const { db, generations } = fakeDb({ generations: [generation], accounts: [] });
  const before = JSON.stringify(generation.parameters);
  const stats = await sweepRefundPending({ prisma: db, fetchImpl: refundOkFetch({ jobIds: [], tokens: [] }) });

  assert.equal(stats.generations.skippedNoToken, 1);
  assert.equal(stats.generations.refunded, 0);
  assert.equal(JSON.stringify(generations[0].parameters), before); // 未动
});

function chargeFixture(overrides: Partial<FakeCharge> = {}): FakeCharge {
  return {
    id: "c1",
    jobId: "txt:abc-123",
    platformUserId: 42,
    failCount: 0,
    status: "refundPending",
    lastError: "refund_failed",
    ...overrides,
  };
}

test("sweep refunds a refundPending once-charge via platformUserId account lookup", async () => {
  const captured = { jobIds: [] as string[], tokens: [] as string[] };
  const { db, charges } = fakeDb({
    charges: [chargeFixture()],
    accounts: [{ providerAccountId: "42", accessToken: "plat-token-42" }],
  });
  const stats = await sweepRefundPending({ prisma: db, fetchImpl: refundOkFetch(captured) });

  assert.equal(stats.charges.scanned, 1);
  assert.equal(stats.charges.refunded, 1);
  assert.deepEqual(captured.jobIds, ["txt:abc-123"]);
  assert.deepEqual(captured.tokens, ["Bearer plat-token-42"]);
  assert.equal(charges[0].status, "refunded");
  assert.equal(charges[0].lastError, null);
});

test("sweep increments charge failCount on refund failure", async () => {
  const { db, charges } = fakeDb({
    charges: [chargeFixture({ failCount: 2 })],
    accounts: [{ providerAccountId: "42", accessToken: "tok" }],
  });
  const stats = await sweepRefundPending({ prisma: db, fetchImpl: refundFailFetch });

  assert.equal(stats.charges.failed, 1);
  assert.equal(charges[0].status, "refundPending");
  assert.equal(charges[0].failCount, 3);
});

test("sweep marks charge needsManual when failCount reaches the threshold", async () => {
  const { db, charges } = fakeDb({
    charges: [chargeFixture({ failCount: 9 })],
    accounts: [{ providerAccountId: "42", accessToken: "tok" }],
  });
  const stats = await sweepRefundPending({ prisma: db, fetchImpl: refundFailFetch, maxFailures: 10 });

  assert.equal(stats.charges.needsManual, 1);
  assert.equal(charges[0].status, "needsManual");
  assert.equal(charges[0].failCount, 10);
});

test("sweep skips charges without a matching account token", async () => {
  const { db, charges } = fakeDb({
    charges: [chargeFixture()],
    accounts: [{ providerAccountId: "42", accessToken: null }], // token 被清空/未刷新
  });
  const stats = await sweepRefundPending({ prisma: db, fetchImpl: refundOkFetch({ jobIds: [], tokens: [] }) });

  assert.equal(stats.charges.skippedNoToken, 1);
  assert.equal(charges[0].status, "refundPending");
});

test("sweep processes both categories in one run", async () => {
  const { db } = fakeDb({
    generations: [generationFixture()],
    charges: [chargeFixture()],
    accounts: [
      { userId: "user-1", accessToken: "tok-a" },
      { providerAccountId: "42", accessToken: "tok-b" },
    ],
  });
  const stats = await sweepRefundPending({ prisma: db, fetchImpl: refundOkFetch({ jobIds: [], tokens: [] }) });

  assert.equal(stats.generations.refunded, 1);
  assert.equal(stats.charges.refunded, 1);
});
