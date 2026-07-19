import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { HttpError } from "../lib/httpErrors";
import { PlatformUnavailableError, type PlatformMe } from "../lib/aijiekou";
import { createAuthMiddleware, getPlatformContext } from "./auth";

const platformMe: PlatformMe = {
  id: 42,
  email: "user@example.com",
  points: 700,
  membershipExpiresAt: null,
  membershipActive: false,
};

function fakeReq(authorization?: string): Request {
  return { headers: authorization ? { authorization } : {} } as unknown as Request;
}

function runMiddleware(
  mw: (req: Request, res: Response, next: (err?: unknown) => void) => void,
  req: Request,
): Promise<unknown> {
  return new Promise((resolve) => {
    mw(req, {} as Response, (err?: unknown) => resolve(err ?? null));
  });
}

function depsWith(me: PlatformMe | null) {
  return {
    fetchMe: async (_token: string) => me,
    resolveUser: async (resolved: PlatformMe, _token: string) => ({
      id: "cuid-local-shadow",
      email: resolved.email,
    }),
  };
}

test("requireAuth rejects requests without a token", async () => {
  const { requireAuth } = createAuthMiddleware(depsWith(platformMe));
  const error = await runMiddleware(requireAuth, fakeReq());
  assert.ok(error instanceof HttpError);
  assert.equal((error as HttpError).status, 401);
});

test("requireAuth rejects an invalid platform token", async () => {
  const { requireAuth } = createAuthMiddleware(depsWith(null));
  const req = fakeReq("Bearer not-a-platform-token");
  const error = await runMiddleware(requireAuth, req);
  assert.ok(error instanceof HttpError);
  assert.equal((error as HttpError).status, 401);
  assert.equal(req.user, undefined);
});

test("requireAuth rejects legacy loohii-issued JWTs (no local verify fallback)", async () => {
  // 旧 loohii JWT（HS256、payload {id,email}）现在只会被送到平台 /v1/me，平台不认 → 401
  const legacyJwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
    Buffer.from(JSON.stringify({ id: "cuid-old", email: "old@x.com" })).toString("base64url") +
    ".legacy-signature";
  const { requireAuth } = createAuthMiddleware(depsWith(null));
  const error = await runMiddleware(requireAuth, fakeReq(`Bearer ${legacyJwt}`));
  assert.ok(error instanceof HttpError);
  assert.equal((error as HttpError).status, 401);
});

test("requireAuth resolves shadow user and exposes platform context", async () => {
  const { requireAuth } = createAuthMiddleware(depsWith(platformMe));
  const req = fakeReq("Bearer platform-token-abc");
  const error = await runMiddleware(requireAuth, req);

  assert.equal(error, null);
  assert.deepEqual(req.user, { id: "cuid-local-shadow", email: "user@example.com" });

  const platform = getPlatformContext(req);
  assert.equal(platform.platformUserId, 42);
  assert.equal(platform.platformToken, "platform-token-abc");
  assert.equal(platform.points, 700);
  assert.equal(platform.membershipActive, false);
});

test("requireAuth accepts a raw token without the Bearer prefix", async () => {
  const { requireAuth } = createAuthMiddleware(depsWith(platformMe));
  const req = fakeReq("platform-token-raw");
  const error = await runMiddleware(requireAuth, req);
  assert.equal(error, null);
  assert.equal(req.user?.id, "cuid-local-shadow");
});

test("requireAuth returns 503 when the platform is unreachable", async () => {
  const { requireAuth } = createAuthMiddleware({
    fetchMe: async () => {
      throw new PlatformUnavailableError("connect ECONNREFUSED");
    },
    resolveUser: async () => ({ id: "x", email: "x@x.com" }),
  });
  const error = await runMiddleware(requireAuth, fakeReq("Bearer t"));
  assert.ok(error instanceof HttpError);
  assert.equal((error as HttpError).status, 503);
});

test("optionalAuth passes through without a token and does not set req.user", async () => {
  const { optionalAuth } = createAuthMiddleware(depsWith(platformMe));
  const req = fakeReq();
  const error = await runMiddleware(optionalAuth, req);
  assert.equal(error, null);
  assert.equal(req.user, undefined);
  assert.equal(req.platform, undefined);
});

test("getPlatformContext throws 401 when unauthenticated", () => {
  assert.throws(() => getPlatformContext(fakeReq()), (error: unknown) => {
    return error instanceof HttpError && error.status === 401;
  });
});
