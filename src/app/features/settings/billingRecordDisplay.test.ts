import assert from "node:assert/strict";
import test from "node:test";
import { chargeDisplayOf } from "./billingRecordDisplay";

// P2-D R3：FAILED + 已退款记录不得显示为实扣

test("charged record shows the plain deduction", () => {
  const display = chargeDisplayOf({
    creditCost: 8,
    parameters: { billing: { status: "charged" } },
  });
  assert.equal(display.amountText, "-8");
  assert.equal(display.refunded, false);
  assert.equal(display.refundPending, false);
  assert.equal(display.refundText, null);
});

test("refunded record shows strikethrough deduction plus the returned amount", () => {
  const display = chargeDisplayOf({
    creditCost: 8,
    parameters: { billing: { status: "refunded" } },
  });
  assert.equal(display.amountText, "-8");
  assert.equal(display.refunded, true);
  assert.equal(display.refundPending, false);
  assert.equal(display.refundText, "+8");
});

test("refundPending record keeps the deduction but flags the pending refund", () => {
  const display = chargeDisplayOf({
    creditCost: 40,
    parameters: { billing: { status: "refundPending" } },
  });
  assert.equal(display.amountText, "-40");
  assert.equal(display.refunded, false);
  assert.equal(display.refundPending, true);
  assert.equal(display.refundText, null);
});

test("records without billing state fall back to plain deduction", () => {
  for (const parameters of [undefined, null, {}, { billing: {} }, { billing: { status: "unknown" } }] as const) {
    const display = chargeDisplayOf({ creditCost: 3, parameters });
    assert.equal(display.amountText, "-3");
    assert.equal(display.refunded, false);
    assert.equal(display.refundPending, false);
  }
});

test("non-positive or malformed creditCost is clamped to 0", () => {
  assert.equal(chargeDisplayOf({ creditCost: Number.NaN }).amountText, "-0");
  assert.equal(chargeDisplayOf({ creditCost: -5 }).amountText, "-0");
});
