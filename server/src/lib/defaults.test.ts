import assert from "node:assert/strict";
import test from "node:test";
import { slugify } from "./defaults";

test("slugify lowercases and replaces non-alphanumeric with hyphens", () => {
  assert.equal(slugify("Hello World"), "hello-world");
});

test("slugify collapses multiple non-alphanumeric chars", () => {
  assert.equal(slugify("foo---bar___baz"), "foo-bar-baz");
});

test("slugify trims leading and trailing hyphens", () => {
  assert.equal(slugify("--hello--"), "hello");
});

test("slugify truncates to 48 characters", () => {
  const long = "a".repeat(60);
  const result = slugify(long);
  assert.ok(result.length <= 48);
  assert.equal(result, "a".repeat(48));
});

test("slugify returns 'loohii' for empty result", () => {
  assert.equal(slugify(""), "loohii");
  assert.equal(slugify("!!!"), "loohii");
  assert.equal(slugify("---"), "loohii");
});

test("slugify handles email prefix style input", () => {
  assert.equal(slugify("john.doe+test"), "john-doe-test");
});

test("slugify handles Chinese characters by removing them", () => {
  assert.equal(slugify("用户abc"), "abc");
});

test("slugify handles mixed content", () => {
  assert.equal(slugify("My Project (v2)"), "my-project-v2");
});
