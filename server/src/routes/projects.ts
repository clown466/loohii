import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../lib/asyncRoute";
import { ensureDefaultTeam } from "../lib/defaults";
import { notFound, routeParam } from "../lib/httpErrors";
import { isRecord, mapProject } from "../lib/mappers";
import { prisma } from "../lib/prisma";
import { created, ok } from "../lib/response";
import { requireAuth } from "../middleware/auth";

const router = Router();

const projectSummarySelect = {
  id: true,
  name: true,
  aspectRatio: true,
  description: true,
  settings: true,
  createdAt: true,
  coverAsset: { select: { url: true } },
  _count: { select: { scenes: true } },
} as const;

const projectInputSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  name: z.string().min(1).max(160).optional(),
  ratio: z.string().min(1).max(32).optional(),
  aspectRatio: z.string().min(1).max(32).optional(),
  style: z.string().max(120).optional(),
  cover: z.string().optional(),
  description: z.string().max(2000).optional(),
  globalPrompt: z.string().max(12000).optional(),
  negativePrompt: z.string().max(12000).optional(),
  setupSettings: z
    .object({
      customStyleName: z.string().max(120).optional(),
      customStylePrompt: z.string().max(2000).optional(),
      generationStrategy: z.string().max(80).optional(),
      projectTone: z.string().max(4000).optional(),
      directorNotes: z.string().max(4000).optional(),
      characterIdentityRules: z.string().max(4000).optional(),
      globalPrompt: z.string().max(12000).optional(),
      scriptRules: z.record(z.string(), z.string().max(4000)).optional(),
    })
    .optional(),
  scenes: z.number().int().min(0).optional(),
  completedScenes: z.number().int().min(0).optional(),
});

router.use(requireAuth);

router.get(
  "/",
  asyncRoute(async (req, res) => {
    const projects = await prisma.project.findMany({
      where: {
        ownerId: req.user!.id,
        deletedAt: null,
      },
      select: projectSummarySelect,
      orderBy: { updatedAt: "desc" },
    });
    ok(res, projects.map(mapProject));
  }),
);

router.post(
  "/",
  asyncRoute(async (req, res) => {
    const input = projectInputSchema.parse(req.body);
    const team = await ensureDefaultTeam(req.user!.id);
    const settings = {
      style: input.style,
      cover: input.cover,
      globalPrompt: input.globalPrompt,
      negativePrompt: input.negativePrompt,
      setupSettings: input.setupSettings,
      completedScenes: input.completedScenes ?? 0,
    };

    const project = await prisma.project.create({
      data: {
        teamId: team.id,
        ownerId: req.user!.id,
        name: input.title ?? input.name ?? "未命名项目",
        description: input.description,
        aspectRatio: input.ratio ?? input.aspectRatio ?? "16:9",
        status: "ACTIVE",
        settings,
      },
      select: projectSummarySelect,
    });
    created(res, mapProject(project));
  }),
);

router.get(
  "/:projectId",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    ok(res, mapProject(project));
  }),
);

router.patch(
  "/:projectId",
  asyncRoute(async (req, res) => {
    const input = projectInputSchema.parse(req.body);
    const current = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    const currentSettings = isRecord(current.settings) ? current.settings : {};

    const project = await prisma.project.update({
      where: { id: current.id },
      data: {
        name: input.title ?? input.name ?? current.name,
        description: input.description ?? current.description,
        aspectRatio: input.ratio ?? input.aspectRatio ?? current.aspectRatio,
        settings: {
          ...currentSettings,
          ...(input.style !== undefined ? { style: input.style } : {}),
          ...(input.cover !== undefined ? { cover: input.cover } : {}),
          ...(input.globalPrompt !== undefined ? { globalPrompt: input.globalPrompt } : {}),
          ...(input.negativePrompt !== undefined ? { negativePrompt: input.negativePrompt } : {}),
          ...(input.setupSettings !== undefined ? { setupSettings: input.setupSettings } : {}),
          ...(input.completedScenes !== undefined ? { completedScenes: input.completedScenes } : {}),
        },
      },
      select: projectSummarySelect,
    });
    ok(res, mapProject(project));
  }),
);

router.delete(
  "/:projectId",
  asyncRoute(async (req, res) => {
    const project = await findOwnedProject(routeParam(req.params.projectId, "projectId"), req.user!.id);
    await prisma.project.update({
      where: { id: project.id },
      data: { deletedAt: new Date(), status: "ARCHIVED" },
    });
    ok(res, { deleted: true });
  }),
);

async function findOwnedProject(projectId: string, ownerId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId, deletedAt: null },
    select: projectSummarySelect,
  });
  if (!project) notFound("Project not found");
  return project;
}

export const projectsRouter = router;
