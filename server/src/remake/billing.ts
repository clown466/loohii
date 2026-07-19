import type { PlatformContext } from "../middleware/auth";
import { AIJIEKOU_PROVIDER } from "../lib/shadowUser";
import { prisma } from "../lib/prisma";
import {
  chargeOnce,
  refundOnceCharge,
  type BillingAction,
  type OnceCharge,
} from "../lib/platformBilling";
import type { RemakeStageSlug } from "./types";

export function remakeBillingAttempt(retryCount = 0): number {
  return retryCount > 0 ? retryCount : 1;
}

export function remakeBillingJobId(
  jobId: string,
  stage: RemakeStageSlug,
  shotIndex?: number,
  attempt?: number,
): string {
  const base = `remake:${jobId}:${stage}`;
  if (shotIndex === undefined) return base;
  const shotKey = `${base}:shot:${shotIndex}`;
  if (attempt === undefined) return shotKey;
  return `${shotKey}:attempt:${attempt}`;
}

export async function loadRemakePlatform(userId: string): Promise<PlatformContext | null> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: AIJIEKOU_PROVIDER },
    orderBy: { updatedAt: "desc" },
  });
  if (!account?.accessToken) return null;
  const platformUserId = Number(account.providerAccountId);
  if (!Number.isInteger(platformUserId) || platformUserId <= 0) return null;
  return {
    platformUserId,
    platformToken: account.accessToken,
    email: account.email ?? "",
    points: 0,
    membershipActive: false,
  };
}

export async function chargeRemakeStage(
  platform: PlatformContext,
  jobId: string,
  stage: RemakeStageSlug,
  action: BillingAction,
  units = 1,
  shotIndex?: number,
  attempt?: number,
): Promise<OnceCharge> {
  const billingAttempt =
    stage === "generate" && shotIndex !== undefined
      ? (attempt ?? remakeBillingAttempt(0))
      : undefined;
  return chargeOnce(platform, {
    jobId: remakeBillingJobId(jobId, stage, shotIndex, billingAttempt),
    action,
    units,
    meta: {
      remakeJobId: jobId,
      stage,
      ...(shotIndex !== undefined ? { shotIndex } : {}),
      ...(billingAttempt !== undefined ? { attempt: billingAttempt } : {}),
    },
  });
}

export async function refundRemakeStage(charge: OnceCharge): Promise<boolean> {
  return refundOnceCharge(charge);
}
