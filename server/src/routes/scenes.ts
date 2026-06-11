import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../lib/asyncRoute";
import { notFound, routeParam } from "../lib/httpErrors";
import { prisma } from "../lib/prisma";
import { assertProject } from "../lib/projectOwnership";
import { created, ok } from "../lib/response";
import { requireAuth } from "../middleware/auth";

const router = Router();

const sceneSchema = z.object({
  title: z.string().min(1).max(180),
  summary: z.string().max(4000).optional(),
  prompt: z.string().max(12000).optional(),
  orderIndex: z.number().int().min(0).optional(),
  position: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

router.use(requireAuth);

router.get(
  "/projects/:projectId/scenes",
  asyncRoute(async (req, res) => {
    const projectId = routeParam(req.params.projectId, "projectId");
    await assertProject(projectId, req.user!.id);
    const scenes = await prisma.scene.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { orderIndex: "asc" },
    });
    ok(res, scenes);
  }),
);

router.post(
  "/projects/:projectId/scenes",
  asyncRoute(async (req, res) => {
    const projectId = routeParam(req.params.projectId, "projectId");
    await assertProject(projectId, req.user!.id);
    const input = sceneSchema.parse(req.body);
    const scene = await prisma.scene.create({
      data: {
        projectId,
        createdById: req.user!.id,
        title: input.title,
        summary: input.summary,
        prompt: input.prompt,
        orderIndex: input.orderIndex ?? 0,
        position: input.position ?? {},
        metadata: input.metadata ?? {},
      },
    });
    created(res, scene);
  }),
);

router.get(
  "/scenes/:sceneId",
  asyncRoute(async (req, res) => {
    const scene = await findOwnedScene(routeParam(req.params.sceneId, "sceneId"), req.user!.id);
    ok(res, scene);
  }),
);

router.put(
  "/scenes/:sceneId/layout",
  asyncRoute(async (req, res) => {
    const input = z.object({ position: z.record(z.string(), z.unknown()) }).parse(req.body);
    const scene = await findOwnedScene(routeParam(req.params.sceneId, "sceneId"), req.user!.id);
    const updated = await prisma.scene.update({
      where: { id: scene.id },
      data: { position: input.position },
    });
    ok(res, updated);
  }),
);

router.patch(
  "/scenes/:sceneId",
  asyncRoute(async (req, res) => {
    const scene = await findOwnedScene(routeParam(req.params.sceneId, "sceneId"), req.user!.id);
    const input = sceneSchema.partial().parse(req.body);
    const updated = await prisma.scene.update({
      where: { id: scene.id },
      data: input,
    });
    ok(res, updated);
  }),
);

router.delete(
  "/scenes/:sceneId",
  asyncRoute(async (req, res) => {
    const scene = await findOwnedScene(routeParam(req.params.sceneId, "sceneId"), req.user!.id);
    await prisma.scene.update({
      where: { id: scene.id },
      data: { deletedAt: new Date() },
    });
    ok(res, { deleted: true });
  }),
);

async function findOwnedScene(sceneId: string, ownerId: string) {
  const scene = await prisma.scene.findFirst({
    where: { id: sceneId, deletedAt: null, project: { ownerId, deletedAt: null } },
  });
  if (!scene) notFound("Scene not found");
  return scene;
}

export const scenesRouter = router;
