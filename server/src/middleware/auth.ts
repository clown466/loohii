/**
 * 认证中间件：全站只认 aijiekou 平台 JWT（用户已拍板，契约 §2.2 方案 A）。
 * Bearer token → GET {AIJIEKOU_API_BASE}/v1/me 验真（60s 缓存）→ 解析/创建本地影子用户。
 * req.user 保持 {id, email}（本地 cuid），所有既有路由零改动；
 * req.platform 携带平台 user_id + 原始平台 token，供计费透传（P2-B）使用。
 */
import type { NextFunction, Request, Response } from "express";
import { asyncRoute } from "../lib/asyncRoute";
import { fetchPlatformMe, PlatformUnavailableError, type PlatformMe } from "../lib/aijiekou";
import { HttpError, unauthorized } from "../lib/httpErrors";
import { resolveLocalUser, type LocalUserRef } from "../lib/shadowUser";

export interface AuthUser {
  id: string;
  email: string;
}

/** 当前请求对应的平台身份 + 平台 token 透传（P2-B 扣点调 consume 时用） */
export interface PlatformContext {
  platformUserId: number;
  platformToken: string;
  email: string;
  points: number;
  membershipActive: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      platform?: PlatformContext;
    }
  }
}

/** 取当前请求的平台上下文；未认证抛 401。P2-B 统一从这里拿 platformToken 调 consume/refund。 */
export function getPlatformContext(req: Request): PlatformContext {
  if (!req.platform) {
    unauthorized("未登录或平台令牌无效");
  }
  return req.platform!;
}

export interface AuthDeps {
  fetchMe: (token: string) => Promise<PlatformMe | null>;
  resolveUser: (me: PlatformMe, token: string) => Promise<LocalUserRef>;
}

const defaultDeps: AuthDeps = {
  fetchMe: (token) => fetchPlatformMe(token),
  resolveUser: (me, token) => resolveLocalUser(me, token),
};

/** 可注入依赖的中间件工厂（测试用）；业务代码用下方默认实例 */
export function createAuthMiddleware(deps: AuthDeps = defaultDeps) {
  const optional = asyncRoute(async (req: Request, _res: Response, next: NextFunction) => {
    const token = readToken(req);
    if (!token) return next();

    let me: PlatformMe | null;
    try {
      me = await deps.fetchMe(token);
    } catch (error) {
      if (error instanceof PlatformUnavailableError) {
        // 平台不可达：认证状态无法判定，按 503 拒绝（宁可不可用，不可放行）
        throw new HttpError(503, "平台认证服务暂不可用，请稍后重试");
      }
      throw error;
    }

    if (!me) return next();

    const local = await deps.resolveUser(me, token);
    req.user = { id: local.id, email: local.email };
    req.platform = {
      platformUserId: me.id,
      platformToken: token,
      email: me.email,
      points: me.points,
      membershipActive: me.membershipActive,
    };
    return next();
  });

  const required = asyncRoute(async (req: Request, res: Response, next: NextFunction) => {
    await new Promise<void>((resolve, reject) => {
      optional(req, res, (err?: unknown) => (err ? reject(err) : resolve()));
    });
    if (!req.user?.id) {
      unauthorized("未登录或平台令牌无效");
    }
    return next();
  });

  return { optionalAuth: optional, requireAuth: required };
}

const { optionalAuth, requireAuth } = createAuthMiddleware();
export { optionalAuth, requireAuth };

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return header.trim();
}
