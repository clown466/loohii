import assert from "node:assert/strict";
import test from "node:test";
import { errorHandler } from "./errorHandler";
import { HttpError } from "../lib/httpErrors";

function mockReqRes() {
  let statusCode = 0;
  let jsonBody: unknown = undefined;
  const req = {
    method: "GET",
    originalUrl: "/api/test",
  } as any;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: unknown) {
      jsonBody = body;
      return res;
    },
  } as any;
  const next = () => {};
  return { req, res, next, getStatus: () => statusCode, getBody: () => jsonBody };
}

test("errorHandler handles HttpError with correct status and message", () => {
  const { req, res, next, getStatus, getBody } = mockReqRes();
  const error = new HttpError(404, "Not found");

  errorHandler(error, req, res, next);

  assert.equal(getStatus(), 404);
  assert.deepEqual(getBody(), { message: "Not found" });
});

test("errorHandler handles HttpError 400", () => {
  const { req, res, next, getStatus, getBody } = mockReqRes();
  const error = new HttpError(400, "Bad request");

  errorHandler(error, req, res, next);

  assert.equal(getStatus(), 400);
  assert.deepEqual(getBody(), { message: "Bad request" });
});

test("errorHandler handles PrismaClientKnownRequestError", () => {
  const { req, res, next, getStatus, getBody } = mockReqRes();
  const error = Object.assign(new Error("Unique constraint failed"), {
    name: "PrismaClientKnownRequestError",
    code: "P2002",
  });

  errorHandler(error, req, res, next);

  assert.equal(getStatus(), 400);
  assert.deepEqual(getBody(), { message: "Database request failed", code: "P2002" });
});

test("errorHandler handles PrismaClientInitializationError", () => {
  const { req, res, next, getStatus, getBody } = mockReqRes();
  const error = Object.assign(new Error("Can't reach database"), {
    name: "PrismaClientInitializationError",
  });

  errorHandler(error, req, res, next);

  assert.equal(getStatus(), 503);
  const body = getBody() as { message: string };
  assert.match(body.message, /Database is not ready/);
});

test("errorHandler handles DATABASE_URL not configured error", () => {
  const { req, res, next, getStatus, getBody } = mockReqRes();
  const error = new Error("DATABASE_URL is not configured. Add it before using database-backed API routes.");

  errorHandler(error, req, res, next);

  assert.equal(getStatus(), 503);
  const body = getBody() as { message: string };
  assert.match(body.message, /DATABASE_URL is not configured/);
});

test("errorHandler handles Prisma Client not generated error", () => {
  const { req, res, next, getStatus, getBody } = mockReqRes();
  const error = new Error("Prisma Client is not generated");

  errorHandler(error, req, res, next);

  assert.equal(getStatus(), 503);
});

test("errorHandler handles generic Error with 500", () => {
  const { req, res, next, getStatus, getBody } = mockReqRes();
  const error = new Error("Something went wrong");

  errorHandler(error, req, res, next);

  assert.equal(getStatus(), 500);
  assert.deepEqual(getBody(), { message: "Something went wrong" });
});

test("errorHandler handles non-Error with 500 and default message", () => {
  const { req, res, next, getStatus, getBody } = mockReqRes();

  errorHandler("string error", req, res, next);

  assert.equal(getStatus(), 500);
  assert.deepEqual(getBody(), { message: "Internal server error" });
});
