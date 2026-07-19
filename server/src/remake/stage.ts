import type { RemakeStage } from "@prisma/client";
import { isRemakeStage, type RemakeStageSlug } from "./types";

const PRISMA_STAGES: RemakeStage[] = [
  "INGEST",
  "ANALYZE",
  "ADAPT",
  "GENERATE",
  "ASSEMBLE",
  "DELIVER",
];

export function slugFromPrismaStage(stage: string): RemakeStageSlug {
  const slug = stage.toLowerCase();
  if (!isRemakeStage(slug)) {
    throw new Error(`未知阶段: ${stage}`);
  }
  return slug;
}

export function prismaStageFromSlug(slug: RemakeStageSlug): RemakeStage {
  const upper = slug.toUpperCase() as RemakeStage;
  if (!PRISMA_STAGES.includes(upper)) {
    throw new Error(`未知阶段: ${slug}`);
  }
  return upper;
}
