import assert from "node:assert/strict";
import test from "node:test";
import { remakeBillingAttempt, remakeBillingJobId } from "./billing";

test("remakeBillingJobId stage key without shot", () => {
  assert.equal(remakeBillingJobId("abc", "adapt"), "remake:abc:adapt");
});

test("remakeBillingJobId includes shot index and attempt for generate", () => {
  assert.equal(
    remakeBillingJobId("abc", "generate", 3, 1),
    "remake:abc:generate:shot:3:attempt:1",
  );
  assert.equal(
    remakeBillingJobId("abc", "generate", 3, 2),
    "remake:abc:generate:shot:3:attempt:2",
  );
});

test("remakeBillingAttempt maps retryCount to billing attempt", () => {
  assert.equal(remakeBillingAttempt(0), 1);
  assert.equal(remakeBillingAttempt(1), 1);
  assert.equal(remakeBillingAttempt(2), 2);
});
