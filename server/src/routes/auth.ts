import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { asyncRoute } from "../lib/asyncRoute";
import { badRequest, unauthorized } from "../lib/httpErrors";
import { prisma } from "../lib/prisma";
import { ok } from "../lib/response";
import { ensureDefaultTeam } from "../lib/defaults";
import { mapUser } from "../lib/mappers";
import { requireAuth, signToken } from "../middleware/auth";

const router = Router();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const signUpSchema = credentialsSchema.extend({
  name: z.string().min(1).max(80),
});

router.post(
  "/sign-up",
  asyncRoute(async (req, res) => {
    const input = signUpSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      badRequest("Email is already registered");
    }

    const user = await prisma.user.create({
      data: {
        email: input.email,
        displayName: input.name,
        passwordHash: await bcrypt.hash(input.password, 12),
        creditBalance: 1250,
      },
    });
    await ensureDefaultTeam(user.id);

    const token = signToken({ id: user.id, email: user.email });
    ok(res, { user: mapUser(user), token }, 201);
  }),
);

router.post(
  "/register",
  asyncRoute(async (req, res) => {
    const input = signUpSchema.parse({
      ...req.body,
      name: req.body.name ?? req.body.displayName,
    });
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      badRequest("Email is already registered");
    }

    const user = await prisma.user.create({
      data: {
        email: input.email,
        displayName: input.name,
        passwordHash: await bcrypt.hash(input.password, 12),
        creditBalance: 1250,
      },
    });
    await ensureDefaultTeam(user.id);

    const token = signToken({ id: user.id, email: user.email });
    ok(res, { user: mapUser(user), token }, 201);
  }),
);

router.post(
  "/sign-in",
  asyncRoute(async (req, res) => {
    const input = credentialsSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user?.passwordHash) {
      unauthorized("Invalid email or password");
    }

    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) {
      unauthorized("Invalid email or password");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = signToken({ id: user.id, email: user.email });
    ok(res, { user: mapUser(user), token });
  }),
);

router.post(
  "/login",
  asyncRoute(async (req, res) => {
    const input = credentialsSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user?.passwordHash) {
      unauthorized("Invalid email or password");
    }

    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) {
      unauthorized("Invalid email or password");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = signToken({ id: user.id, email: user.email });
    ok(res, { user: mapUser(user), token });
  }),
);

router.get(
  "/me",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    ok(res, { user: mapUser(user) });
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
