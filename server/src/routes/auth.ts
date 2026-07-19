import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../lib/asyncRoute";
import { prisma } from "../lib/prisma";
import { ok } from "../lib/response";
import { mapUser } from "../lib/mappers";
import { requireAuth } from "../middleware/auth";

/**
 * 认证路由：全站只认 aijiekou 平台 JWT（用户已拍板，契约 §2）。
 * 密码注册/登录通道已删除——注册/登录统一走平台 /v1/auth/*（前端直连），
 * loohii 服务端只负责验真 + 影子用户映射（middleware/auth.ts）。
 */
const router = Router();

router.get(
  "/me",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    ok(res, {
      user: mapUser(user),
      platform: {
        id: req.platform!.platformUserId,
        email: req.platform!.email,
        points: req.platform!.points,
        membershipActive: req.platform!.membershipActive,
      },
    });
  }),
);

router.patch(
  "/me",
  requireAuth,
  asyncRoute(async (req, res) => {
    const input = z
      .object({
        name: z.string().min(1).max(80).optional(),
        avatar: z.string().url().optional(),
      })
      .parse(req.body);

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        displayName: input.name,
        avatarUrl: input.avatar,
      },
    });
    ok(res, { user: mapUser(user) });
  }),
);

export const authRouter = router;
