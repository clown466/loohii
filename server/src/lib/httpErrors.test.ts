import assert from "node:assert/strict";
import test from "node:test";
import { HttpError, notFound, badRequest, unauthorized, routeParam } from "./httpErrors";

test("HttpError stores status and message", () => {
  const err = new HttpError(418, "I'm a teapot");
  assert.equal(err.status, 418);
  assert.equal(err.message, "I'm a teapot");
  assert.ok(err instanceof Error);
});

test("notFound throws 404 with default message", () => {
  assert.throws(() => notFound(), (err: unknown) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 404);
    assert.equal(err.message, "Not found");
    return true;
  });
});

test("notFound throws 404 with custom message", () => {
  assert.throws(() => notFound("Project missing"), (err: unknown) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 404);
    assert.equal(err.message, "Project missing");
    return true;
  });
});

test("badRequest throws 400 with default message", () => {
  assert.throws(() => badRequest(), (err: unknown) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 400);
    assert.equal(err.message, "Bad request");
    return true;
  });
});

test("badRequest throws 400 with custom message", () => {
  assert.throws(() => badRequest("Invalid input"), (err: unknown) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 400);
    assert.equal(err.message, "Invalid input");
    return true;
  });
});

test("unauthorized throws 401 with default message", () => {
  assert.throws(() => unauthorized(), (err: unknown) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 401);
    assert.equal(err.message, "Unauthorized");
    return true;
  });
});

test("unauthorized throws 401 with custom message", () => {
  assert.throws(() => unauthorized("Token expired"), (err: unknown) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 401);
    assert.equal(err.message, "Token expired");
    return true;
  });
});

test("routeParam returns valid string", () => {
  assert.equal(routeParam("abc", "id"), "abc");
});

test("routeParam throws on undefined", () => {
  assert.throws(() => routeParam(undefined, "id"), (err: unknown) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 400);
    assert.match(err.message, /id/);
    return true;
  });
});

test("routeParam throws on empty string", () => {
  assert.throws(() => routeParam("", "slug"), (err: unknown) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 400);
    assert.match(err.message, /slug/);
    return true;
  });
});

test("routeParam throws on string array", () => {
  assert.throws(() => routeParam(["a", "b"], "ids"), (err: unknown) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 400);
    assert.match(err.message, /ids/);
    return true;
  });
});
