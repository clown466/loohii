/**
 * aijiekou 平台（api.aijiekou.online）客户端：/v1/me 验真 + 短 TTL 缓存。
 * 契约：《P0-loohii积分统一接口契约》§2.2 方案 A（调 me 验签，不扩散 CLOUD_JWT_SECRET）。
 */
import { config } from "../config";

/** 平台 /v1/me 返回的用户信息（user_public + public_balance） */
export interface PlatformMe {
  id: number;
  email: string;
  points: number;
  membershipExpiresAt: string | null;
  membershipActive: boolean;
}

/** 平台不可达（网络错误/超时/5xx）——与"token 无效"区分开，前者应 503，后者 401 */
export class PlatformUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformUnavailableError";
  }
}

interface CacheEntry {
  me: PlatformMe | null; // null 表示平台已明确判定 token 无效（401）
  expiresAt: number;
}

/**
 * /v1/me 验证结果缓存上限（P2-D R4）：匿名随机 token 每个都是一条缓存项 + 一次平台调用，
 * 无上限会内存单调膨胀。LRU 淘汰最久未用项；写入时顺手清扫过期项。
 */
export const PLATFORM_ME_CACHE_MAX_ENTRIES = 10_000;

const meCache = new Map<string, CacheEntry>();

/** 清空缓存（测试用） */
export function clearPlatformMeCache() {
  meCache.clear();
}

/** 当前缓存条目数（测试/观测用） */
export function platformMeCacheSize(): number {
  return meCache.size;
}

function writeCache(token: string, entry: CacheEntry) {
  const now = Date.now();
  // 顺手清扫已过期项，防止过期条目长期滞留
  for (const [key, value] of meCache) {
    if (value.expiresAt <= now) meCache.delete(key);
  }
  // delete+set 保持插入序即 LRU 顺序（新写/命中刷新到最新）
  meCache.delete(token);
  meCache.set(token, entry);
  while (meCache.size > PLATFORM_ME_CACHE_MAX_ENTRIES) {
    const oldest = meCache.keys().next().value;
    if (oldest === undefined) break;
    meCache.delete(oldest);
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * 拿平台 token 调 GET /v1/me 验真。
 * 返回 PlatformMe；token 无效返回 null；平台不可达抛 PlatformUnavailableError。
 * 成功与 401 结果都按 config.aijiekou.meCacheTtlMs 缓存。
 */
export async function fetchPlatformMe(
  token: string,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<PlatformMe | null> {
  const ttl = config.aijiekou.meCacheTtlMs;
  const now = Date.now();
  if (ttl > 0) {
    const cached = meCache.get(token);
    if (cached && cached.expiresAt > now) {
      // 命中刷新 LRU 顺序，热点 token 不被淘汰
      meCache.delete(token);
      meCache.set(token, cached);
      return cached.me;
    }
  }

  const me = await requestMe(token, fetchImpl);

  if (ttl > 0) {
    writeCache(token, { me, expiresAt: now + ttl });
  }
  return me;
}

async function requestMe(token: string, fetchImpl: FetchLike): Promise<PlatformMe | null> {
  let response: Response;
  try {
    response = await fetchImpl(`${config.aijiekou.apiBase}/v1/me`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(config.aijiekou.timeoutMs),
    });
  } catch (error) {
    throw new PlatformUnavailableError(
      `aijiekou /v1/me 请求失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (response.status === 401) return null;
  if (!response.ok) {
    throw new PlatformUnavailableError(`aijiekou /v1/me 返回 ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PlatformUnavailableError("aijiekou /v1/me 返回了非 JSON 内容");
  }

  return normalizeMe(body);
}

function normalizeMe(body: unknown): PlatformMe | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  const id = Number(raw.id);
  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  if (!Number.isInteger(id) || id <= 0 || !email) return null;
  return {
    id,
    email,
    points: Number.isFinite(Number(raw.points)) ? Number(raw.points) : 0,
    membershipExpiresAt:
      typeof raw.membership_expires_at === "string" ? raw.membership_expires_at : null,
    membershipActive: raw.membership_active === true,
  };
}
