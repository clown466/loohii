/**
 * 消费记录的扣点展示派生（P2-D R3）：
 *  FAILED + 已退款（billing.status=refunded）的记录不能仍显示为实扣，
 *  必须标识"已退款 / 金额退回"；退款待对账（refundPending）单独标识。
 */

export interface ChargeDisplay {
  /** 主扣点文案，如 "-8" */
  amountText: string;
  /** 已退款：展示退款标识与退回金额，扣点金额划线 */
  refunded: boolean;
  /** 退款处理中（平台退点未成功，待对账） */
  refundPending: boolean;
  /** 退回金额文案（仅 refunded 时有值），如 "+8" */
  refundText: string | null;
}

export function chargeDisplayOf(record: {
  creditCost: number;
  parameters?: { billing?: { status?: string } } | null;
}): ChargeDisplay {
  const cost = Math.max(0, Math.floor(Number(record.creditCost) || 0));
  const status = record.parameters?.billing?.status;
  if (status === "refunded") {
    return { amountText: `-${cost}`, refunded: true, refundPending: false, refundText: `+${cost}` };
  }
  if (status === "refundPending") {
    return { amountText: `-${cost}`, refunded: false, refundPending: true, refundText: null };
  }
  return { amountText: `-${cost}`, refunded: false, refundPending: false, refundText: null };
}
