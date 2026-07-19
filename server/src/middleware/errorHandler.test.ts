/**
 * errorHandler 单测（P4-B / P3C-1）：
 * zod 入参校验失败映射 400 + 干净文案（不再 500、不塞 zod JSON）；
 * HttpError 原样透传；未知错误仍 500。
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import { z } from "zod";
import { errorHandler } from "./errorHandler";
import { HttpError } from "../lib/httpErrors";

function fakeReq(): Request {
  return { method: "POST", originalUrl: "/api/projects/p1/import-script-pack" } as Request;
}

function fakeRes() {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, captured };
}

const importBodySchema = z
  .object({
    packId: z.string().min(1).max(120).optional(),
    pack: z.unknown().optional(),
  })
  .refine((value) => Boolean(value.packId) || value.pack !== undefined, { message: "packId 或 pack 至少提供一个" });

test("zod root refine error maps to 400 with the refine message verbatim", () => {
  const { res, captured } = fakeRes();
  try {
    importBodySchema.parse({});
  } catch (error) {
    errorHandler(error, fakeReq(), res, () => {});
  }
  assert.equal(captured.status, 400);
  assert.deepEqual(captured.body, { message: "packId 或 pack 至少提供一个" });
});

test("zod nested field error maps to 400 with path-prefixed message", () => {
  const { res, captured } = fakeRes();
  const schema = z.object({ episodes: z.array(z.object({ script: z.string().min(1) })) });
  try {
    schema.parse({ episodes: [{ script: "" }] });
  } catch (error) {
    errorHandler(error, fakeReq(), res, () => {});
  }
  assert.equal(captured.status, 400);
  const message = (captured.body as { message: string }).message;
  assert.ok(message.startsWith("episodes.0.script: "), message);
  assert.ok(!message.includes("[{"), "message must not contain raw zod JSON");
});

test("HttpError keeps its own status and message", () => {
  const { res, captured } = fakeRes();
  errorHandler(new HttpError(404, "Project not found"), fakeReq(), res, () => {});
  assert.equal(captured.status, 404);
  assert.deepEqual(captured.body, { message: "Project not found" });
});

test("unknown errors still map to 500", () => {
  const { res, captured } = fakeRes();
  errorHandler(new Error("boom"), fakeReq(), res, () => {});
  assert.equal(captured.status, 500);
  assert.deepEqual(captured.body, { message: "boom" });
});
