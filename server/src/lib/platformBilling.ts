/**
 * 平台计费封装：aijiekou 统一扣点/退点（《P0-loohii积分统一接口契约》§3）。
 *
 * 时序（§3.2）：预扣 consume → 成功提交 / 失败 refund（执行不可逆，必须预扣）。
 * 幂等键（§3.3）：`gen:{generationId}`；重试换键 `gen:{generationId}:attempt:{n}`——
 * refund 之后同键再 consume 会命中平台幂等返回假成功（不扣款），所以退过点的重试必须换键。
 * 异常映射（§3.4）：402 余额不足 / 401 重新登录 / 网络·5xx → 503 计费服务不可用（未扣费）。
 */
import crypto from "node:crypto";
import { config } from "../config";
import { HttpError } from "./httpErrors";
import { isRecord } from "./mappers";
import { prisma } from "./prisma";
import type { PlatformContext } from "../middleware/auth";

export type BillingAction = "loohii_image" | "loohii_video" | "loohii_text" | "loohii_agent";

/** 一次成功预扣的结果（status=charged） */
export interface GenerationCharge {
  jobId: string;
  action: BillingAction;
  units: number;
  attempt: number;
  /** 实际扣点数（会员为 0，平台只记账） */
  points: number;
  platformToken: string;
}

/** Generation.parameters.billing 的持久化形状 */
export interface GenerationBillingRecord {
  jobId: string;
  action: string;
  units: number;
  attempt: number;
  points: number;
  status: "charged" | "refunded" | "refundPending" | "needsManual" | "unknown";
  chargedAt?: string;
  refundedAt?: string;
  /** P3-B 对账 sweep：refund 连续失败次数（达到阈值转 needsManual） */
  refundFailures?: number;
}

interface ConsumeApiResponse {
  ok?: boolean;
  idempotent?: boolean;
  points_delta?: number;
  points?: number;
  detail?: string;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// 平台 entitlements 原始调用
// ---------------------------------------------------------------------------

/** 调平台 consume；成功返回响应体；失败抛映射后的 HttpError（402/401/400/503）。 */
export async function consumePoints(
  platformToken: string,
  body: { job_id: string; action: BillingAction; units?: number; meta?: Record<string, unknown> },
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<ConsumeApiResponse> {
  const response = await callEntitlements(platformToken, "/v1/entitlements/consume", {
    job_id: body.job_id,
    action: body.action,
    units: body.units ?? 1,
    ...(body.meta ? { meta: body.meta } : {}),
  }, fetchImpl);

  if (response.status === 402) {
    throw new HttpError(402, await responseDetail(response, "积分不足，请充值或开通会员"));
  }
  if (response.status === 401) {
    throw new HttpError(401, "平台登录已过期，请重新登录");
  }
  if (response.status === 400) {
    throw new HttpError(400, await responseDetail(response, "计费请求被拒绝"));
  }
  if (!response.ok) {
    throw new HttpError(503, "计费服务暂不可用，请稍后重试（未扣费）");
  }
  return (await response.json()) as ConsumeApiResponse;
}

/** 调平台 refund；永不抛异常（退点失败进对账），返回是否成功。 */
export async function refundPoints(
  platformToken: string,
  jobId: string,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<boolean> {
  try {
    const response = await callEntitlements(platformToken, "/v1/entitlements/refund", { job_id: jobId }, fetchImpl);
    if (!response.ok) {
      console.warn(`[billing] refund job=${jobId} http_${response.status}`);
      return false;
    }
    const body = (await response.json().catch(() => null)) as { ok?: boolean } | null;
    return body?.ok !== false;
  } catch (error) {
    console.warn(`[billing] refund job=${jobId} failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/** refundPoints 的别名，语义更贴合"失败不阻断主流程"的调用点 */
export const refundPointsQuietly = refundPoints;

async function callEntitlements(
  platformToken: string,
  path: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(`${config.aijiekou.apiBase}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${platformToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.aijiekou.timeoutMs),
    });
  } catch {
    throw new HttpError(503, "计费服务暂不可用，请稍后重试（未扣费）");
  }
  return response;
}

async function responseDetail(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { detail?: string } | null;
  return typeof body?.detail === "string" && body.detail ? body.detail : fallback;
}

// ---------------------------------------------------------------------------
// 幂等键
// ---------------------------------------------------------------------------

/** §3.3：首次 `gen:{id}`；第 n 次重试 `gen:{id}:attempt:{n}` */
export function billingJobIdFor(generationId: string, attempt: number): string {
  return attempt > 0 ? `gen:${generationId}:attempt:${attempt}` : `gen:${generationId}`;
}

/** 一次性扣点（文本/无 Generation 的场景）的幂等键：每次请求独立 */
export function newChargeJobId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

// ---------------------------------------------------------------------------
// Generation 计费状态（存 Generation.parameters.billing）
// ---------------------------------------------------------------------------

export function billingRecordOf(parameters: unknown): GenerationBillingRecord | null {
  if (!isRecord(parameters) || !isRecord(parameters.billing)) return null;
  const raw = parameters.billing;
  if (typeof raw.jobId !== "string" || !raw.jobId) return null;
  return {
    jobId: raw.jobId,
    action: typeof raw.action === "string" ? raw.action : "",
    units: Number.isFinite(Number(raw.units)) ? Number(raw.units) : 1,
    attempt: Number.isFinite(Number(raw.attempt)) ? Number(raw.attempt) : 0,
    points: Number.isFinite(Number(raw.points)) ? Number(raw.points) : 0,
    status: typeof raw.status === "string" ? (raw.status as GenerationBillingRecord["status"]) : "unknown",
    chargedAt: typeof raw.chargedAt === "string" ? raw.chargedAt : undefined,
    refundedAt: typeof raw.refundedAt === "string" ? raw.refundedAt : undefined,
    refundFailures: Number.isFinite(Number(raw.refundFailures)) ? Number(raw.refundFailures) : undefined,
  };
}

export function billingRecordFor(charge: GenerationCharge): GenerationBillingRecord {
  return {
    jobId: charge.jobId,
    action: charge.action,
    units: charge.units,
    attempt: charge.attempt,
    points: charge.points,
    status: "charged",
    chargedAt: new Date().toISOString(),
  };
}

/**
 * 预扣：consume 成功返回 GenerationCharge；失败把 billing 状态标 unknown（表示"扣没扣上不确定"，
 * 重试沿用同键——利用平台幂等避免重复扣）后抛映射错误。状态持久化由调用方合并进 parameters。
 */
export async function chargeGeneration(
  platform: PlatformContext,
  opts: {
    generationId: string;
    action: BillingAction;
    units?: number;
    existingParameters?: unknown;
    meta?: Record<string, unknown>;
    fetchImpl?: FetchLike;
  },
): Promise<GenerationCharge> {
  const existing = billingRecordOf(opts.existingParameters);
  const attempt = existing?.attempt ?? 0;
  const jobId = billingJobIdFor(opts.generationId, attempt);
  const units = Math.max(1, Math.floor(opts.units ?? 1));

  const response = await consumePoints(platform.platformToken, {
    job_id: jobId,
    action: opts.action,
    units,
    meta: { generationId: opts.generationId, ...(opts.meta ?? {}) },
  }, opts.fetchImpl);

  return {
    jobId,
    action: opts.action,
    units,
    attempt,
    points: -Number(response.points_delta ?? 0) || 0,
    platformToken: platform.platformToken,
  };
}

/**
 * 退点（生成失败/取消时调用）。charge 可空（空则从 DB 读 billing 状态）。
 * 平台 refund 按 `refund:{job_id}` 幂等，重复调用安全；失败标 refundPending 待对账。
 */
export async function refundGeneration(
  platformToken: string,
  generationId: string,
  charge?: GenerationCharge | null,
): Promise<void> {
  const generation = await prisma.generation.findUnique({ where: { id: generationId } });
  if (!generation) return;
  const existing = billingRecordOf(generation.parameters);
  const jobId = charge?.jobId ?? existing?.jobId;
  if (!jobId) return;
  if (!charge && existing?.status !== "charged") return; // 无成功预扣记录，不退

  const refunded = await refundPoints(platformToken, jobId);
  const parameters = isRecord(generation.parameters) ? generation.parameters : {};
  const base = existing ?? billingRecordFor(charge as GenerationCharge);
  await prisma.generation
    .update({
      where: { id: generationId },
      data: {
        parameters: {
          ...parameters,
          billing: {
            ...base,
            status: refunded ? "refunded" : "refundPending",
            ...(refunded ? { refundedAt: new Date().toISOString() } : {}),
          },
        },
      },
    })
    .catch((error: unknown) => {
      console.warn(`[billing] generation=${generationId} refund_state_persist_failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  if (!refunded) {
    console.warn(`[billing] generation=${generationId} refund_pending job=${jobId}`);
  }
}

/**
 * 重试换键（§3.3）：已扣过/已退过的 generation 重试时 attempt+1；
 * 扣点结果不确定（unknown）时沿用原键（平台幂等防重复扣）。返回更新后的 parameters。
 */
export function billingParametersForRetry(parameters: unknown): Record<string, unknown> {
  const base = isRecord(parameters) ? { ...parameters } : {};
  const billing = billingRecordOf(base);
  if (!billing) return base;
  const shouldRotate = billing.status === "charged" || billing.status === "refunded" || billing.status === "refundPending";
  return {
    ...base,
    billing: {
      ...billing,
      attempt: shouldRotate ? billing.attempt + 1 : billing.attempt,
    },
  };
}

/**
 * 续跑已有记录前是否需要重新预扣（P2-D R2）：
 * 已退款（refunded）/退款待对账（refundPending）的记录重新执行前必须重新扣点，
 * 否则存在"退点后免费续跑"窗口。charged 不重复扣（已付过）；unknown/无记录不动
 * （沿用平台幂等防"503 不确定扣没扣"时重复扣）。
 */
export function needsRechargeOnResume(parameters: unknown): boolean {
  const billing = billingRecordOf(parameters);
  return billing?.status === "refunded" || billing?.status === "refundPending";
}

/**
 * 预扣并落库（P2-D R1）：consume 成功后由调用方持久化 billing；
 * **落库失败立即退点**，保证"扣了必能退"（退点由平台幂等兜底，调用方 catch 再退一次也安全）。
 * charge 本身失败（402/503 等）不退不吞，原样抛出。
 */
export async function chargeGenerationAndPersist(
  platform: PlatformContext,
  opts: {
    generationId: string;
    action: BillingAction;
    units?: number;
    existingParameters?: unknown;
    meta?: Record<string, unknown>;
    persist: (charge: GenerationCharge) => Promise<void>;
    refund: (charge: GenerationCharge) => Promise<void>;
    fetchImpl?: FetchLike;
  },
): Promise<GenerationCharge> {
  const charge = await chargeGeneration(platform, opts);
  try {
    await opts.persist(charge);
  } catch (error) {
    await opts.refund(charge);
    throw error;
  }
  return charge;
}

// ---------------------------------------------------------------------------
// 一次性扣点（文本小任务 / Agent 运行）
// ---------------------------------------------------------------------------

export interface OnceCharge {
  jobId: string;
  action: BillingAction;
  points: number;
  platformToken: string;
}

/** 一次性预扣：成功返回 OnceCharge；失败抛映射错误（402/401/503）。 */
export async function chargeOnce(
  platform: PlatformContext,
  opts: { action: BillingAction; jobId: string; units?: number; meta?: Record<string, unknown>; fetchImpl?: FetchLike },
): Promise<OnceCharge> {
  const response = await consumePoints(platform.platformToken, {
    job_id: opts.jobId,
    action: opts.action,
    units: opts.units ?? 1,
    meta: opts.meta,
  }, opts.fetchImpl);
  const charge = {
    jobId: opts.jobId,
    action: opts.action,
    points: -Number(response.points_delta ?? 0) || 0,
    platformToken: platform.platformToken,
  };
  // P3-B 对账：一次性扣点没有 Generation 记录，落本地账本供 sweep 兜底；best-effort 不阻断主流程
  try {
    await recordBillingCharge({ platformUserId: platform.platformUserId, jobId: charge.jobId, action: charge.action, points: charge.points });
  } catch (error) {
    console.warn(`[billing] charge ledger persist failed job=${charge.jobId}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return charge;
}

/**
 * P3-B 对账账本（BillingCharge 表）：一次性扣点（txt:/agent:）落账。
 * 无库环境（单测）直接跳过；幂等（jobId 唯一，重复写空操作）。
 */
export async function recordBillingCharge(entry: {
  platformUserId: number;
  jobId: string;
  action: BillingAction;
  points: number;
}): Promise<void> {
  if (!config.databaseUrl) return;
  if (!Number.isInteger(entry.platformUserId) || entry.platformUserId <= 0) return;
  await prisma.billingCharge.upsert({
    where: { jobId: entry.jobId },
    create: {
      jobId: entry.jobId,
      platformUserId: entry.platformUserId,
      action: entry.action,
      points: entry.points,
      status: "charged",
    },
    update: {},
  });
}

/**
 * 一次性扣点的退点并记账（P3-B）：平台 refund 按 `refund:{job_id}` 幂等；
 * 成功账本标 refunded，失败标 refundPending 并累加 failCount，留给 sweep 兜底。
 */
export async function refundOnceCharge(charge: Pick<OnceCharge, "jobId" | "platformToken">, opts?: { fetchImpl?: FetchLike }): Promise<boolean> {
  const refunded = await refundPoints(charge.platformToken, charge.jobId, opts?.fetchImpl);
  if (config.databaseUrl) {
    try {
      await prisma.billingCharge.update({
        where: { jobId: charge.jobId },
        data: refunded
          ? { status: "refunded", lastError: null }
          : { status: "refundPending", failCount: { increment: 1 }, lastError: "refund_failed" },
      });
    } catch (error) {
      console.warn(`[billing] charge ledger refund-state persist failed job=${charge.jobId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return refunded;
}

/** 从 Authorization 头还原平台 token（后台任务里没有 req.platform，用快照头透传） */
export function platformTokenFromAuthorization(header: string | undefined): string | null {
  if (!header) return null;
  const value = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
  return value || null;
}
