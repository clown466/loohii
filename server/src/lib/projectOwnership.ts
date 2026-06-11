/**
 * Shared ownership-checking queries for projects.
 */

import { notFound } from "./httpErrors";
import { prisma } from "./prisma";

export async function findOwnedProject(projectId: string, ownerId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId, deletedAt: null },
  });
  if (!project) notFound("Project not found");
  return project;
}

export async function assertProject(projectId: string, ownerId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId, deletedAt: null },
  });
  if (!project) notFound("Project not found");
  return project;
}
