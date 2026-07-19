/**
 * 计费对账 sweep（P3-B）：兜底"扣了点但退点失败"的两类记录。
 *
 * 两类键空间：
 *  - gen: 键 → Generation.parameters.billing.status = "refundPending"（P2 已有标记，无扫尾）
 *  - txt:/agent: 键 → BillingCharge 表 status = "refundPending"（P3-B 新增本地账本）
 *
 * token 来源：不存平台 token，按 Account(provider=AIJIEKOU) 查 accessToken（每次登录会刷新，
 * shadowUser.resolveLocalUser）；token 缺失/过期本轮跳过计数，下一轮再试。
 * 连续失败 maxFailures 次 → needsManual（转人工，不再自动重试）。
 */
import { billingRecordOf, refundPoints } from "./platformBilling";
import { isRecord } from "./mappers";
import { prisma as defaultPrisma } from "./prisma";
import { AIJIEKOU_PROVIDER } from "./shadowUser";

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** 可注入的最小 DB 面（单测用假实现；生产传默认 prisma） */
export interface ReconciliationDb {
  generation: {
    findMany(args: unknown): Promise<Array<{ id: string; userId: string; parameters: unknown }>>;
    update(args: unknown): Promise<unknown>;
  };
  billingCharge: {
    findMany(args: unknown): Promise<Array<{ id: string; jobId: string; platformUserId: number; failCount: number }>>;
    update(args: unknown): Promise<unknown>;
  };
  account: {
    findFirst(args: unknown): Promise<{ accessToken: string | null } | null>;
  };
}

export interface SweepCategoryStats {
  scanned: number;
  refunded: number;
  failed: number;
  skippedNoToken: number;
  needsManual: number;
}

export interface SweepStats {
  generations: SweepCategoryStats;
  charges: SweepCategoryStats;
  startedAt: string;
  durationMs: number;
}

export interface SweepDeps {
  prisma?: ReconciliationDb;
  fetchImpl?: FetchLike;
  now?: Date;
  maxFailures?: number;
  batchSize?: number;
}

function emptyCategoryStats(): SweepCategoryStats {
  return { scanned: 0, refunded: 0, failed: 0, skippedNoToken: 0, needsManual: 0 };
}

export const BILLING_SWEEP_MAX_FAILURES = 10;
export const BILLING_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** 跑一轮对账：refundPending →（平台 refund 幂等）→ refunded / 失败累加 / 超阈值 needsManual */
export async function sweepRefundPending(deps: SweepDeps = {}): Promise<SweepStats> {
  const db = deps.prisma ?? (defaultPrisma as unknown as ReconciliationDb);
  const maxFailures = deps.maxFailures ?? BILLING_SWEEP_MAX_FAILURES;
  const batchSize = deps.batchSize ?? 50;
  const now = deps.now ?? new Date();
  const startedAt = Date.now();
  const stats: SweepStats = {
    generations: emptyCategoryStats(),
    charges: emptyCategoryStats(),
    startedAt: now.toISOString(),
    durationMs: 0,
  };

  // ---- gen: 键：Generation.parameters.billing.status = refundPending ----
  const generations = await db.generation.findMany({
    where: { parameters: { path: ["billing", "status"], equals: "refundPending" } },
    orderBy: { updatedAt: "asc" },
    take: batchSize,
  });
  for (const generation of generations) {
    stats.generations.scanned += 1;
    const billing = billingRecordOf(generation.parameters);
    if (!billing?.jobId) {
      stats.generations.skippedNoToken += 1;
      continue;
    }
    const account = await db.account.findFirst({
      where: { userId: generation.userId, provider: AIJIEKOU_PROVIDER },
      select: { accessToken: true },
    });
    if (!account?.accessToken) {
      stats.generations.skippedNoToken += 1;
      continue;
    }
    const refunded = await refundPoints(account.accessToken, billing.jobId, deps.fetchImpl);
    const parameters = isRecord(generation.parameters) ? generation.parameters : {};
    if (refunded) {
      await db.generation.update({
        where: { id: generation.id },
        data: {
          parameters: {
            ...parameters,
            billing: { ...billing, status: "refunded", refundedAt: now.toISOString(), refundFailures: 0 },
          },
        },
      });
      stats.generations.refunded += 1;
    } else {
      const refundFailures = (billing.refundFailures ?? 0) + 1;
      const needsManual = refundFailures >= maxFailures;
      await db.generation.update({
        where: { id: generation.id },
        data: {
          parameters: {
            ...parameters,
            billing: { ...billing, status: needsManual ? "needsManual" : "refundPending", refundFailures },
          },
        },
      });
      stats.generations.failed += 1;
      if (needsManual) stats.generations.needsManual += 1;
    }
  }

  // ---- txt:/agent: 键：BillingCharge.status = refundPending ----
  const charges = await db.billingCharge.findMany({
    where: { status: "refundPending" },
    orderBy: { updatedAt: "asc" },
    take: batchSize,
  });
  for (const charge of charges) {
    stats.charges.scanned += 1;
    const account = await db.account.findFirst({
      where: { provider: AIJIEKOU_PROVIDER, providerAccountId: String(charge.platformUserId) },
      select: { accessToken: true },
    });
    if (!account?.accessToken) {
      stats.charges.skippedNoToken += 1;
      continue;
    }
    const refunded = await refundPoints(account.accessToken, charge.jobId, deps.fetchImpl);
    if (refunded) {
      await db.billingCharge.update({
        where: { id: charge.id },
        data: { status: "refunded", lastError: null },
      });
      stats.charges.refunded += 1;
    } else {
      const failCount = charge.failCount + 1;
      const needsManual = failCount >= maxFailures;
      await db.billingCharge.update({
        where: { id: charge.id },
        data: {
          status: needsManual ? "needsManual" : "refundPending",
          failCount,
          lastError: "refund_failed",
        },
      });
      stats.charges.failed += 1;
      if (needsManual) stats.charges.needsManual += 1;
    }
  }

  stats.durationMs = Date.now() - startedAt;
  return stats;
}

function logSweepResult(stats: SweepStats) {
  const { generations, charges } = stats;
  const total = generations.scanned + charges.scanned;
  if (total === 0) return; // 无事可报，保持安静
  console.log(
    `[billing] reconciliation sweep: gen ${generations.refunded}/${generations.scanned} refunded` +
      ` (fail ${generations.failed}, noToken ${generations.skippedNoToken}, manual ${generations.needsManual});` +
      ` charges ${charges.refunded}/${charges.scanned} refunded` +
      ` (fail ${charges.failed}, noToken ${charges.skippedNoToken}, manual ${charges.needsManual});` +
      ` ${stats.durationMs}ms`,
  );
}

/** 服务启动时挂周期对账（无 Redis，进程内 setInterval + unref，不阻塞退出） */
export function startBillingReconciliation(intervalMs: number = BILLING_SWEEP_INTERVAL_MS): NodeJS.Timeout {
  const timer = setInterval(() => {
    sweepRefundPending()
      .then(logSweepResult)
      .catch((error: unknown) => {
        console.warn(`[billing] reconciliation sweep failed: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, intervalMs);
  timer.unref();
  return timer;
}
