import { Router } from "express";
import { asyncRoute } from "../lib/asyncRoute";
import { mapUser } from "../lib/mappers";
import { prisma } from "../lib/prisma";
import { ok } from "../lib/response";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.use(requireAuth);

router.get(
  "/balance",
  asyncRoute(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    ok(res, { user: mapUser(user), credits: user.creditBalance });
  }),
);

router.get(
  "/transactions",
  asyncRoute(async (req, res) => {
    const transactions = await prisma.transaction.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    ok(res, transactions);
  }),
);

export const billingRouter = router;

