import assert from "node:assert/strict";
import test from "node:test";
import { remakeBillingJobId } from "./billing";

test("remakeBillingJobId stage key without shot", () => {
  assert.equal(remakeBillingJobId("abc", "adapt"), "remake:abc:adapt");
});

test("remakeBillingJobId includes shot index for generate", () => {
  assert.equal(remakeBillingJobId("abc", "generate", 3), "remake:abc:generate:shot:3");
});
