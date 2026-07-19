/**
 * 剧本包消费路由（P3-B，《P0-剧本包格式v1契约》§5.3）：
 *  - POST /api/projects/:projectId/import-script-pack  从平台作品库（或内联 JSON）导入剧本包
 *  - GET  /api/script-packs                            代理列当前用户的平台剧本包
 *
 * 导入策略（§4.1 推荐路径）：双写 workflow 结构 + 复用 episodeCanvasSync 建画布，
 * 不手搓节点坐标。逐集 try/catch，单集失败不阻断整包；全部失败则整体不写库。
 */
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { asyncRoute } from "../lib/asyncRoute";
import { buildEpisodeCanvasSyncScene, writeEpisodeCanvasSyncMetadata } from "../lib/episodeCanvasSync";
import { HttpError, notFound, routeParam } from "../lib/httpErrors";
import { isRecord } from "../lib/mappers";
import { prisma } from "../lib/prisma";
import { metadataWithProjectSettings } from "../lib/projectGenerationStrategy";
import { ok } from "../lib/response";
import { withScriptPackCastOnCanvas } from "../lib/scriptPackCanvasCast";
import {
  EPISODE_SCRIPT_MAX_CHARS,
  SCRIPT_PACK_MAX_BYTES,
  episodeIdForPack,
  fallbackWholeEpisodeShot,
  fetchScriptPack,
  listScriptPacks,
  mapPackCharacters,
  parseScriptPack,
  sceneToShot,
  scenesForEpisode,
  type ScriptPackShot,
} from "../lib/scriptPack";
import { getPlatformContext, requireAuth } from "../middleware/auth";
import { workflowMaintenanceInternals } from "./workflows";

const router = Router();

const importBodySchema = z
  .object({
    packId: z.string().min(1).max(120).optional(),
    pack: z.unknown().optional(),
  })
  .refine((value) => Boolean(value.packId) || value.pack !== undefined, { message: "packId 或 pack 至少提供一个" });

router.use(requireAuth);

router.get(
  "/script-packs",
  asyncRoute(async (req, res) => {
    const platform = getPlatformContext(req);
    const items = await listScriptPacks(platform.platformToken);
    ok(res, { items });
  }),
);

router.post(
  "/projects/:projectId/import-script-pack",
  asyncRoute(async (req, res) => {
    const projectId = routeParam(req.params.projectId, "projectId");
    const project = await findOwnedProject(projectId, req.user!.id);
    const body = importBodySchema.parse(req.body);

    let packRaw: unknown;
    if (body.packId) {
      const platform = getPlatformContext(req);
      packRaw = await fetchScriptPack(body.packId, platform.platformToken);
    } else {
      packRaw = body.pack;
      if (JSON.stringify(packRaw ?? null).length > SCRIPT_PACK_MAX_BYTES) {
        throw new HttpError(413, "剧本包超过 10MB 上限");
      }
    }
    const pack = parseScriptPack(packRaw);

    const warnings: string[] = [];
    const failed: { episode: number; error: string }[] = [];
    const characters = mapPackCharacters(pack.characters);
    const now = new Date().toISOString();
    let episodesImported = 0;
    let scenesImported = 0;
    let firstEpisodeId: string | null = null;

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${project.id} FOR UPDATE`;
      const current = await tx.project.findUnique({ where: { id: project.id }, select: { metadata: true, settings: true } });
      let metadata: Record<string, unknown> = isRecord(current?.metadata) ? { ...(current!.metadata as Record<string, unknown>) } : {};

      // §4.1：整包留底（settings/outline/各集大纲信息，供 agent/生成引用）
      metadata.scriptPack = {
        libraryProjectId: body.packId ?? null,
        name: pack.name,
        style: pack.style,
        expectedEpisodes: pack.expectedEpisodes ?? pack.episodes.length,
        incomplete: pack.incomplete,
        settings: pack.settings,
        outline: pack.outline,
        episodeMeta: Object.fromEntries(
          pack.episodes.map((episode) => [
            String(episode.episode),
            { title: episode.title, summary: episode.summary, hook: episode.hook, payoff: episode.payoff },
          ]),
        ),
        importedAt: now,
      };

      for (const episode of pack.episodes) {
        const episodeId = episodeIdForPack(episode.episode);
        try {
          if (!episode.script.trim()) throw new Error("剧本正文为空");
          if (episode.script.length > EPISODE_SCRIPT_MAX_CHARS) {
            throw new Error(`剧本超过 ${EPISODE_SCRIPT_MAX_CHARS} 字符上限`);
          }
          const parsed = scenesForEpisode(episode);
          warnings.push(...parsed.warnings.map((warning) => `第 ${episode.episode} 集：${warning}`));
          const shots: ScriptPackShot[] =
            parsed.scenes.length > 0 ? parsed.scenes.map((scene, index) => sceneToShot(scene, index)) : [fallbackWholeEpisodeShot(episode)];
          const clips = workflowMaintenanceInternals.deriveWorkflowClipsFromShots(shots);
          const workflow = {
            sourceText: episode.script,
            sourceName: pack.name,
            selectedEpisode: `第 ${episode.episode} 集`,
            activeStage: "storyboard", // §4.1：跳过"提取资产"，角色资产随包带来
            breakdownScenes: shots,
            clips,
            sceneVisualBibles: [],
            assets: { characters, scenes: [], props: [] },
            stageStatuses: { source: "done", assets: "done", storyboard: "idle", video: "idle", voice: "idle", preview: "idle", edit: "idle" },
            updatedAt: now,
            lastRun: undefined,
          };
          const makeActive = firstEpisodeId === null;
          let nextMetadata = workflowMaintenanceInternals.writeWorkflowEpisode(metadata, episodeId, workflow, makeActive);

          // 画布同步：复用 episodeCanvasSync 从 clips 建节点（重复导入由 removeEpisodeSyncNodes 幂等）
          const syncInputMetadata = metadataWithProjectSettings(nextMetadata, current?.settings);
          const canvasScenes = isRecord(nextMetadata.canvasScenes) ? nextMetadata.canvasScenes : {};
          const sync = buildEpisodeCanvasSyncScene({
            metadata: syncInputMetadata,
            episodeId,
            existingScene: isRecord(canvasScenes[episodeId]) ? (canvasScenes[episodeId] as { nodes?: unknown[]; edges?: unknown[] }) : { nodes: [], edges: [] },
            aspectRatio: project.aspectRatio,
          });
          // P4-B（P3C-2，契约 §4.2）：叠加角色资产列 + 角色→出场镜头的虚线关联边（幂等重建）
          const castAugmented = withScriptPackCastOnCanvas({
            nodes: sync.nodes,
            edges: sync.edges,
            episodeId,
            episodeTitle: `第 ${episode.episode} 集`,
            characters,
            shots,
            clips,
          });
          const syncWithCast = { ...sync, nodes: castAugmented.nodes, edges: castAugmented.edges };
          nextMetadata = writeEpisodeCanvasSyncMetadata({ metadata: nextMetadata, sync: syncWithCast, makeActive });
          metadata = nextMetadata;

          firstEpisodeId ??= episodeId;
          episodesImported += 1;
          scenesImported += shots.length;
        } catch (error) {
          failed.push({ episode: episode.episode, error: error instanceof Error ? error.message : String(error) });
        }
      }

      if (episodesImported === 0) {
        // 整包无一集成功：不写任何 metadata（契约 §8：不写半成品）
        throw new HttpError(422, `剧本包导入失败：${failed[0]?.error ?? "没有可导入的剧集"}`);
      }

      await tx.project.update({
        where: { id: project.id },
        data: { metadata: metadata as Prisma.InputJsonValue },
      });
    });

    ok(res, {
      imported: { episodes: episodesImported, scenes: scenesImported, characters: characters.length },
      failed,
      warnings,
      firstEpisodeId,
      incomplete: pack.incomplete,
      expectedEpisodes: pack.expectedEpisodes ?? pack.episodes.length,
      packName: pack.name,
    });
  }),
);

async function findOwnedProject(projectId: string, ownerId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId, deletedAt: null },
  });
  if (!project) notFound("Project not found");
  return project;
}

export const scriptPacksRouter = router;
