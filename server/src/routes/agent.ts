import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { asyncRoute } from "../lib/asyncRoute";
import {
  normalizeCanvasStoryboardReferencesForScene,
  preserveExistingClipStoryboardSections,
  storyboardReferencesFromGenerationRecords,
} from "../lib/canvasStoryboardReferences";
import { config } from "../config";
import { callConfiguredTextModel } from "../ai/textModel";
import { buildEpisodeCanvasSyncScene, writeEpisodeCanvasSyncMetadata } from "../lib/episodeCanvasSync";
import { callHermesAgent, hermesAgentStatus, type HermesAgentResult } from "../lib/hermesAgent";
import { isRecord, mapProject } from "../lib/mappers";
import { prisma } from "../lib/prisma";
import { ok } from "../lib/response";
import { requireAuth } from "../middleware/auth";

const router = Router();

const messageSchema = z.object({
  content: z.string().min(1).max(12000),
  projectId: z.string().optional(),
  conversationId: z.string().max(300).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

const projectQuerySchema = z.object({
  projectId: z.string().min(1),
});

const CANVAS_SECTION_PADDING_X = 12;
const CANVAS_SECTION_HEADER_HEIGHT = 42;
const CANVAS_REFERENCE_NODE_WIDTH = 340;
const CANVAS_REFERENCE_NODE_HEIGHT = 248;
const CANVAS_REFERENCE_NODE_GAP_X = 12;
const CANVAS_REFERENCE_NODE_GAP_Y = 10;
const CANVAS_REFERENCE_ROWS_PER_COLUMN = 4;

const agentActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("call_project_api"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("POST"),
    path: z.string().min(1).max(800),
    query: z.record(z.string(), z.unknown()).optional(),
    body: z.record(z.string(), z.unknown()).optional(),
    refresh: z.enum(["none", "canvas", "records", "workflow", "project"]).optional(),
  }),
  z.object({
    type: z.literal("load_canvas"),
    sceneId: z.string().max(180).optional(),
  }),
  z.object({
    type: z.literal("save_canvas"),
    sceneId: z.string().max(180).optional(),
  }),
  z.object({
    type: z.literal("sync_episode_canvas"),
    episodeId: z.string().max(180).optional(),
  }),
  z.object({
    type: z.literal("update_canvas_node_prompt"),
    sceneId: z.string().max(180).optional(),
    nodeId: z.string().min(1).max(200),
    prompt: z.string().min(1).max(20000),
  }),
  z.object({
    type: z.literal("patch_canvas_node"),
    sceneId: z.string().max(180).optional(),
    nodeId: z.string().min(1).max(200),
    patch: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("connect_asset_to_clip"),
    sceneId: z.string().max(180).optional(),
    clipId: z.string().min(1).max(80),
    assetKind: z.enum(["characters", "scenes", "props"]).default("characters"),
    assetName: z.string().min(1).max(180),
    target: z.enum(["storyboard", "video", "all"]).optional(),
  }),
  z.object({
    type: z.literal("connect_asset_to_all_clips"),
    sceneId: z.string().max(180).optional(),
    assetKind: z.enum(["characters", "scenes", "props"]).default("characters"),
    assetName: z.string().min(1).max(180),
    target: z.enum(["storyboard", "video", "all"]).default("all"),
  }),
  z.object({
    type: z.literal("remove_asset_from_clip"),
    sceneId: z.string().max(180).optional(),
    clipId: z.string().min(1).max(80),
    assetNames: z.array(z.string().min(1).max(180)).min(1).max(12),
    assetKind: z.enum(["characters", "scenes", "props"]).optional(),
    updatePrompts: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("create_canvas_image_generation"),
    sceneId: z.string().max(180).optional(),
    nodeId: z.string().max(200).optional(),
    prompt: z.string().min(1).max(20000),
    aiModelId: z.string().max(200).optional(),
    size: z.string().max(40).optional(),
    referenceImageUrls: z.array(z.string().min(8).max(12000)).max(16).optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("create_canvas_video_generation"),
    sceneId: z.string().max(180).optional(),
    nodeId: z.string().max(200).optional(),
    prompt: z.string().min(1).max(20000),
    aiModelId: z.string().max(200).optional(),
    referenceImageUrls: z.array(z.string().min(8).max(12000)).max(16).optional(),
    resolution: z.string().max(40).optional(),
    durationSeconds: z.number().int().min(4).max(15).optional(),
    ratio: z.string().max(40).optional(),
    count: z.number().int().min(1).max(4).optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    submitId: z.string().max(160).optional(),
  }),
]);

const agentActionRequestSchema = z.object({
  projectId: z.string().min(1),
  conversationId: z.string().max(300).optional(),
  actions: z.array(agentActionSchema).min(1).max(12),
  context: z.record(z.string(), z.unknown()).optional(),
});

const MAX_AGENT_ACTION_LOOPS = 3;

router.post(
  "/messages",
  requireAuth,
  asyncRoute(async (req, res) => {
    const input = messageSchema.parse(req.body);
    let content = replyFor(input.content);
    let responseMetadata: Record<string, unknown> = {
      source: "backend-placeholder",
      agent: hermesAgentStatus(),
    };
    let assistantMessageId = crypto.randomUUID();

    if (input.projectId) {
      const project = await prisma.project.findFirst({
        where: { id: input.projectId, ownerId: req.user!.id, deletedAt: null },
        include: { coverAsset: true, _count: { select: { scenes: true } } },
      });

      if (project) {
        const conversationId = normalizeConversationId(input.conversationId, project.id);
        const userMessage = await prisma.agentMessage.create({
          data: {
            projectId: project.id,
            userId: req.user!.id,
            role: "USER",
            content: input.content,
            payload: {
              ...(input.context ?? {}),
              conversationId,
            },
          },
        });
        const recentMessages = await prisma.agentMessage.findMany({
          where: { projectId: project.id },
          orderBy: { createdAt: "desc" },
          take: 120,
          select: { role: true, content: true, payload: true, createdAt: true },
        });
        const workflow = workflowSummary(project.metadata);
        const recentConversationMessages = recentMessages
          .reverse()
          .filter((message: { payload: unknown }) => messageConversationId(message.payload, project.id) === conversationId)
          .slice(-20)
          .map((message: { role: string; content: string; createdAt: Date }) => ({
            role: message.role,
            content: message.content,
            createdAt: message.createdAt.toISOString(),
          }));
        const assistantMessage = await prisma.agentMessage.create({
          data: {
            projectId: project.id,
            userId: req.user!.id,
            parentId: userMessage.id,
            role: "ASSISTANT",
            content: "项目总控正在处理...",
            payload: {
              source: "agent-runner",
              agent: hermesAgentStatus(),
              conversationId,
              status: "RUNNING",
              startedAt: new Date().toISOString(),
            },
          },
        });
        assistantMessageId = assistantMessage.id;
        content = assistantMessage.content;
        responseMetadata = isRecord(assistantMessage.payload) ? assistantMessage.payload : {};
        const reqSnapshot = snapshotAgentRequest(req);
        void completeAgentMessage({
          req: reqSnapshot,
          userId: req.user!.id,
          projectId: project.id,
          conversationId,
          assistantMessageId,
          content: input.content,
          project: mapProject(project),
          workflow,
          recentMessages: recentConversationMessages,
          clientContext: input.context,
        }).catch(async (error) => {
          console.error(`[agent] background_failed message=${assistantMessageId}`, error);
          try {
            await prisma.agentMessage.update({
              where: { id: assistantMessageId },
              data: {
                content: `项目总控后台执行失败：${error instanceof Error ? error.message : "未知错误"}`,
                payload: {
                  source: "backend-placeholder",
                  agent: hermesAgentStatus(),
                  conversationId,
                  status: "FAILED",
                  error: error instanceof Error ? error.message : "Background agent task failed",
                  completedAt: new Date().toISOString(),
                },
              },
            });
          } catch (updateError) {
            console.error(`[agent] failed_to_persist_background_failure message=${assistantMessageId}`, updateError);
          }
        });
      }
    }

    ok(res, {
      id: assistantMessageId,
      content,
      metadata: {
        ...responseMetadata,
        conversationId: input.projectId ? normalizeConversationId(input.conversationId, input.projectId) : input.conversationId,
        actions: [
          { label: "创建分镜", action: "create_scene" },
          { label: "生成图片", action: "generate_image" },
        ],
      },
    });
  }),
);

router.post(
  "/actions",
  requireAuth,
  asyncRoute(async (req, res) => {
    const input = agentActionRequestSchema.parse(req.body);
    const results = await executeAgentActions({
      req,
      userId: req.user!.id,
      projectId: input.projectId,
      clientContext: input.context,
      userRequest: stringValue(input.context?.userRequest),
      actions: input.actions,
    });
    ok(res, { results });
  }),
);

router.get(
  "/conversations",
  requireAuth,
  asyncRoute(async (req, res) => {
    const input = projectQuerySchema.parse(req.query);
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, ownerId: req.user!.id, deletedAt: null },
      select: { id: true },
    });
    if (!project) {
      ok(res, []);
      return;
    }

    const messages = await prisma.agentMessage.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "asc" },
      take: 1000,
      select: { id: true, role: true, content: true, payload: true, createdAt: true },
    });

    const groups = new Map<string, {
      id: string;
      title: string;
      preview: string;
      messageCount: number;
      createdAt: Date;
      updatedAt: Date;
    }>();

    for (const message of messages) {
      const conversationId = messageConversationId(message.payload, project.id);
      const existing = groups.get(conversationId);
      const titleSource = message.role === "USER" ? message.content : "";
      if (!existing) {
        groups.set(conversationId, {
          id: conversationId,
          title: conversationTitle(titleSource || message.content),
          preview: compactText(message.content, 80),
          messageCount: 1,
          createdAt: message.createdAt,
          updatedAt: message.createdAt,
        });
        continue;
      }
      existing.messageCount += 1;
      existing.preview = compactText(message.content, 80);
      existing.updatedAt = message.createdAt;
      if (existing.title === "新对话" && titleSource) {
        existing.title = conversationTitle(titleSource);
      }
    }

    ok(res, Array.from(groups.values())
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 50)
      .map((conversation) => ({
        ...conversation,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
      })));
  }),
);

router.get(
  "/conversations/:conversationId/messages",
  requireAuth,
  asyncRoute(async (req, res) => {
    const input = projectQuerySchema.parse(req.query);
    const conversationId = normalizeConversationId(req.params.conversationId, input.projectId);
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, ownerId: req.user!.id, deletedAt: null },
      select: { id: true },
    });
    if (!project) {
      ok(res, []);
      return;
    }

    const messages = await prisma.agentMessage.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "asc" },
      take: 1000,
      select: { id: true, role: true, content: true, payload: true, createdAt: true },
    });

    ok(res, messages
      .filter((message: { payload: unknown }) => messageConversationId(message.payload, project.id) === conversationId)
      .map((message: { id: string; role: string; content: string; payload: unknown; createdAt: Date }) => ({
        id: message.id,
        role: message.role === "USER" ? "user" : "assistant",
        content: message.content,
        metadata: isRecord(message.payload) ? message.payload : {},
        createdAt: message.createdAt.toISOString(),
      })));
  }),
);

router.delete(
  "/conversations/:conversationId",
  requireAuth,
  asyncRoute(async (req, res) => {
    const input = projectQuerySchema.parse(req.query);
    const conversationId = normalizeConversationId(req.params.conversationId, input.projectId);
    const project = await prisma.project.findFirst({
      where: { id: input.projectId, ownerId: req.user!.id, deletedAt: null },
      select: { id: true },
    });
    if (!project) {
      ok(res, { deleted: 0 });
      return;
    }

    const messages = await prisma.agentMessage.findMany({
      where: { projectId: project.id },
      select: { id: true, payload: true },
    });
    const ids = messages
      .filter((message: { payload: unknown }) => messageConversationId(message.payload, project.id) === conversationId)
      .map((message: { id: string }) => message.id);

    if (!ids.length) {
      ok(res, { deleted: 0 });
      return;
    }

    await prisma.agentMessage.updateMany({
      where: { parentId: { in: ids } },
      data: { parentId: null },
    });
    const result = await prisma.agentMessage.deleteMany({
      where: { id: { in: ids } },
    });
    ok(res, { deleted: result.count });
  }),
);

router.get(
  "/status",
  requireAuth,
  asyncRoute(async (_req, res) => {
    ok(res, hermesAgentStatus());
  }),
);

function replyFor(input: string): string {
  if (input.includes("生成")) return "我已收到生成请求。后端任务队列已预留，下一步会把它接入真实模型适配器。";
  if (input.includes("角色")) return "我会把角色信息写入项目资产系统，并在生成任务里作为上下文使用。";
  if (input.includes("画布")) return "画布数据现在可以通过后端 API 保存和读取。";
  return "收到。当前后端已接入项目、画布、生成任务和实时事件的基础通道。";
}

function extractHermesActions(content: string): { content: string; actions: AgentAction[] } {
  const actions: AgentAction[] = [];
  let visible = content.replace(/<loohii_actions>([\s\S]*?)<\/loohii_actions>/gi, (_match, raw) => {
    pushHermesActionPayload(actions, raw);
    return "";
  });
  visible = visible.replace(/<｜｜DSML｜｜tool_(?:calls|actions)>[\s\S]*?<\/｜｜DSML｜｜tool_(?:calls|actions)>/g, (match) => {
    pushHermesDsmlToolCalls(actions, match);
    return "";
  });
  return { content: visible.trim(), actions };
}

function pushHermesActionPayload(actions: AgentAction[], raw: unknown): void {
  try {
    const parsed = JSON.parse(String(raw).trim());
    const list = Array.isArray(parsed?.actions) ? parsed.actions : Array.isArray(parsed) ? parsed : [];
    for (const item of list) pushParsedHermesAction(actions, item);
  } catch {
    // Ignore malformed hidden action blocks and keep the user-facing reply usable.
  }
}

function pushParsedHermesAction(actions: AgentAction[], item: unknown): void {
  const action = agentActionSchema.safeParse(item);
  if (action.success) actions.push(action.data);
}

function pushHermesDsmlToolCalls(actions: AgentAction[], raw: string): void {
  const toolPattern = /<｜｜DSML｜｜invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/｜｜DSML｜｜invoke>/g;
  for (const match of raw.matchAll(toolPattern)) {
    const type = match[1]?.trim();
    if (!type) continue;
    const values: Record<string, unknown> = { type };
    const body = match[2] ?? "";
    const paramPattern = /<｜｜DSML｜｜parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/｜｜DSML｜｜parameter>/g;
    for (const paramMatch of body.matchAll(paramPattern)) {
      const key = paramMatch[1]?.trim();
      if (!key) continue;
      values[key] = decodeHermesDsmlText(paramMatch[2] ?? "");
    }
    pushParsedHermesAction(actions, coerceHermesActionValues(values));
  }
}

function decodeHermesDsmlText(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function coerceHermesActionValues(values: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...values };
  for (const key of ["query", "body", "patch", "parameters", "metadata", "referenceImageUrls"]) {
    const value = next[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    try {
      next[key] = JSON.parse(trimmed);
    } catch {
      if (key === "referenceImageUrls") next[key] = trimmed.split(/\s*,\s*/).filter(Boolean);
    }
  }
  for (const key of ["durationSeconds", "count"]) {
    if (typeof next[key] === "string" && next[key]) next[key] = Number(next[key]);
  }
  return next;
}

type AgentRunContext = {
  req: { get(name: string): string | undefined; protocol: string };
  userId: string;
  projectId: string;
  conversationId: string;
  content: string;
  project: Record<string, unknown>;
  workflow: Record<string, unknown>;
  recentMessages: Array<{ role: string; content: string; createdAt: string }>;
  clientContext?: Record<string, unknown>;
};

type AgentRunResult = {
  content: string;
  metadata: Record<string, unknown>;
  actionResults: Array<Record<string, unknown>>;
};

type AgentRequestSnapshot = {
  headers: Record<string, string | undefined>;
  protocol: string;
  get(name: string): string | undefined;
};

type CompleteAgentMessageContext = AgentRunContext & {
  assistantMessageId: string;
};

function snapshotAgentRequest(req: { get(name: string): string | undefined; protocol: string }): AgentRequestSnapshot {
  const headers: Record<string, string | undefined> = {
    authorization: req.get("authorization"),
    "x-forwarded-host": req.get("x-forwarded-host"),
    host: req.get("host"),
    "x-forwarded-proto": req.get("x-forwarded-proto"),
  };
  return {
    headers,
    protocol: req.protocol,
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  };
}

async function completeAgentMessage(context: CompleteAgentMessageContext): Promise<void> {
  let content = replyFor(context.content);
  let responseMetadata: Record<string, unknown> = {
    source: "backend-placeholder",
    agent: hermesAgentStatus(),
    conversationId: context.conversationId,
    status: "COMPLETED",
  };
  try {
    const agentRun = await runHermesAgentWithActions(context);
    if (agentRun) {
      content = agentRun.content || "我已执行项目操作。";
      responseMetadata = {
        ...agentRun.metadata,
        agent: hermesAgentStatus(),
        conversationId: context.conversationId,
        status: "COMPLETED",
        ...(agentRun.actionResults.length ? { actionResults: compactAgentActionResultsForMessage(agentRun.actionResults) } : {}),
      };
      if (shouldRunDeterministicAgentFallback(context.content, agentRun)) {
        const fallbackResults = await executeDeterministicAgentFallback({
          req: context.req,
          userId: context.userId,
          projectId: context.projectId,
          userRequest: context.content,
          clientContext: context.clientContext,
        });
        if (fallbackResults.length) {
          content = summarizeDeterministicAgentFallback(fallbackResults);
          responseMetadata = {
            ...responseMetadata,
            actionResults: compactAgentActionResultsForMessage([
              ...agentRun.actionResults,
              ...fallbackResults,
            ]),
          };
        }
      }
    }
    if (!agentRun || shouldRunLocalAgentController(context.content, agentRun)) {
      console.warn(`[agent] local_controller_fallback project=${context.projectId} conversation=${context.conversationId} hermesContent=${agentRun ? JSON.stringify(agentRun.content.slice(0, 80)) : "null"} hermesActions=${agentRun?.actionResults.length ?? 0}`);
      const localRun = await runLocalAgentController(context);
      if (localRun.actionResults.length || localRun.content) {
        content = localRun.content || content || "已尝试执行项目操作。";
        responseMetadata = {
          ...responseMetadata,
          ...localRun.metadata,
          agent: hermesAgentStatus(),
          conversationId: context.conversationId,
          status: "COMPLETED",
          ...(localRun.actionResults.length ? {
            actionResults: compactAgentActionResultsForMessage([
              ...((agentRun?.actionResults ?? []) as Array<Record<string, unknown>>),
              ...localRun.actionResults,
            ]),
          } : {}),
        };
      }
    }
  } catch (error) {
    content = `项目总控执行失败：${error instanceof Error ? error.message : "未知错误"}`;
    responseMetadata = {
      source: "backend-placeholder",
      agent: hermesAgentStatus(),
      conversationId: context.conversationId,
      status: "FAILED",
      hermesError: error instanceof Error ? error.message : "Hermes Agent failed",
    };
  }

  const guarded = applyAgentCompletionGuard(context.content, content, responseMetadata);

  await prisma.agentMessage.update({
    where: { id: context.assistantMessageId },
    data: {
      content: guarded.content,
      payload: {
        ...guarded.metadata,
        conversationId: context.conversationId,
        completedAt: new Date().toISOString(),
      },
    },
  });
}

async function runHermesAgentWithActions(context: AgentRunContext): Promise<AgentRunResult | null> {
  let content = context.content;
  let clientContext = context.clientContext;
  let finalContent = "";
  let finalMetadata: Record<string, unknown> = {};
  const allActionResults: Array<Record<string, unknown>> = [];

  for (let index = 0; index < MAX_AGENT_ACTION_LOOPS; index += 1) {
    const hermes = await callHermesAgent({
      projectId: context.projectId,
      userId: context.userId,
      conversationId: context.conversationId,
      content,
      project: context.project,
      workflow: context.workflow,
      recentMessages: context.recentMessages,
      clientContext,
    });
    if (!hermes?.content) return index === 0 ? null : { content: finalContent, metadata: finalMetadata, actionResults: allActionResults };

    const parsed = extractHermesActions(hermes.content);
    finalContent = parsed.content || finalContent || "我已执行项目操作。";
    finalMetadata = hermes.metadata;
    if (!parsed.actions.length) break;

    const actionResults = await executeAgentActions({
      req: context.req,
      userId: context.userId,
      projectId: context.projectId,
      clientContext,
      userRequest: context.content,
      actions: parsed.actions,
    });
    allActionResults.push(...actionResults);
    if (shouldStopAgentActionLoop(context.content, actionResults)) break;

    content = buildHermesContinuationInstruction(context.content, actionResults);
    clientContext = {
      ...(clientContext ?? {}),
      actionResults: summarizeAgentActionResultsForContext(allActionResults),
    };
  }

  return { content: finalContent || "我已执行项目操作。", metadata: finalMetadata, actionResults: allActionResults };
}

function shouldStopAgentActionLoop(userRequest: string, results: Array<Record<string, unknown>>): boolean {
  if (userRequestWantsGeneration(userRequest) && !results.some((result) => stringValue(result.generationId))) {
    if (results.every((result) => result.ok)) return false;
  }
  return results.some((result) => {
    if (!result.ok) return true;
    const type = stringValue(result.type);
    if (type === "load_canvas" || type === "call_project_api") return false;
    return agentActionResultChangedState(result) || agentActionResultVerifiedState(result);
  });
}

function applyAgentCompletionGuard(
  userRequest: string,
  content: string,
  metadata: Record<string, unknown>,
): { content: string; metadata: Record<string, unknown> } {
  if (metadata.status !== "COMPLETED" || !userRequestWantsCanvasMutation(userRequest)) {
    return { content, metadata };
  }
  const actionResults = Array.isArray(metadata.actionResults)
    ? metadata.actionResults.filter(isRecord)
    : [];
  const failed = actionResults.find((item) => item.ok === false);
  if (failed) {
    return {
      content: /失败|未完成|failed/i.test(content)
        ? content
        : `项目总控执行失败：${stringValue(failed.error) || "未知错误"}`,
      metadata: { ...metadata, status: "FAILED" },
    };
  }
  if (!actionResults.some(agentActionResultChangedState) && !actionResults.some(agentActionResultVerifiedState)) {
    return {
      content: /未完成|没有产生有效改动|没有检测到/i.test(content)
        ? content
        : summarizeNoopAgentActionResults(actionResults),
      metadata: { ...metadata, status: "NEEDS_ACTION" },
    };
  }
  return { content, metadata };
}

function shouldRunDeterministicAgentFallback(userRequest: string, result: AgentRunResult): boolean {
  if (!userRequestWantsGeneration(userRequest)) return false;
  if (!/故事板|storyboard/i.test(userRequest)) return false;
  if (!/气泡|speech bubble|comic bubble|漫画/i.test(userRequest)) return false;
  if (!inferClipIdFromText(userRequest)) return false;
  if (result.actionResults.some((item) => stringValue(item.generationId))) return false;
  const content = result.content.trim().toLowerCase();
  if (!content || content === "none" || content === "null") return true;
  if (/收到。我会结合项目全局设定/.test(result.content)) return true;
  return result.actionResults.some((item) => item.type === "load_canvas") && !result.actionResults.some((item) => item.type === "update_canvas_node_prompt");
}

function shouldRunLocalAgentController(userRequest: string, result: AgentRunResult): boolean {
  const content = result.content.trim().toLowerCase();
  if (!content || isInvalidAgentVisibleReply(result.content)) return true;
  if (result.actionResults.some((item) => item.ok === false)) return true;
  if (userRequestWantsCanvasMutation(userRequest) && !result.actionResults.some(agentActionResultChangedState) && !result.actionResults.some(agentActionResultVerifiedState)) return true;
  return false;
}

function isInvalidAgentVisibleReply(value: string): boolean {
  return /^(none|null|undefined|n\/a|无|空)$/i.test(value.trim());
}

function userRequestWantsCanvasMutation(value: string): boolean {
  if (/只问|只是问|不用改|不要改|不要生成|不生成|无需生成|查询|检查|看看|why|为什么|what|只需要回答/i.test(value)) return false;
  return /修改|更改|改成|改为|不要写|不写|删了|删掉|删除|移除|去掉|去除|替换|优化|生成|重新生成|生图|提交|放入画布|连接|接入|fix|update|change|remove|replace|generate|regenerate/i.test(value);
}

function agentActionResultChangedState(result: Record<string, unknown>): boolean {
  const type = stringValue(result.type);
  if (type === "save_canvas") return false;
  if (type === "call_project_api" && stringValue(result.method).toUpperCase() === "GET") return false;
  return Boolean(
    result.canvasChanged ||
    result.generationId ||
    result.videoUrl ||
    result.submitId ||
    result.workflowChanged ||
    result.projectChanged ||
    result.recordsChanged,
  );
}

function agentActionResultVerifiedState(result: Record<string, unknown>): boolean {
  return Boolean(result.stateVerified);
}

async function runLocalAgentController(context: AgentRunContext): Promise<AgentRunResult> {
  const preloaded = await executeAgentActions({
    req: context.req,
    userId: context.userId,
    projectId: context.projectId,
    clientContext: context.clientContext,
    userRequest: context.content,
    actions: [{ type: "load_canvas", sceneId: agentClientActiveSceneId(context.clientContext) || undefined }],
  });
  const deterministicActions = deterministicActionsFromUserRequest(context.content, preloaded);
  if (deterministicActions.length) {
    const actionResults = await executeAgentActions({
      req: context.req,
      userId: context.userId,
      projectId: context.projectId,
      clientContext: {
        ...(context.clientContext ?? {}),
        actionResults: summarizeAgentActionResultsForContext(preloaded),
      },
      userRequest: context.content,
      actions: deterministicActions,
    });
    return {
      content: summarizeLocalAgentActionResults(actionResults),
      metadata: { source: "local-agent-controller:deterministic" },
      actionResults: [...preloaded, ...actionResults],
    };
  }
  const local = await callLocalActionPlanner(context, preloaded);
  const parsed = extractHermesActions(local.content);
  const actions = parsed.actions.length ? parsed.actions : deterministicActionsFromUserRequest(context.content, preloaded);
  if (!actions.length) {
    return {
      content: parsed.content || local.content || "项目总控没有生成可执行动作。请选中目标节点，或明确指定 clip 编号和要修改的字段。",
      metadata: local.metadata,
      actionResults: preloaded,
    };
  }
  const actionResults = await executeAgentActions({
    req: context.req,
    userId: context.userId,
    projectId: context.projectId,
    clientContext: {
      ...(context.clientContext ?? {}),
      actionResults: summarizeAgentActionResultsForContext(preloaded),
    },
    userRequest: context.content,
    actions,
  });
  const failed = actionResults.find((item) => item.ok === false);
  const changed = actionResults.filter(agentActionResultChangedState);
  const verified = actionResults.filter(agentActionResultVerifiedState);
  const mutationRequested = userRequestWantsCanvasMutation(context.content);
  const content = failed
    ? `项目总控已尝试执行，但失败：${stringValue(failed.error) || "未知错误"}`
    : mutationRequested && !changed.length && !verified.length
      ? summarizeNoopAgentActionResults(actionResults)
      : parsed.content && !isInvalidAgentVisibleReply(parsed.content)
        ? parsed.content
        : changed.length || verified.length
          ? summarizeLocalAgentActionResults(actionResults)
          : "项目总控已读取画布，但没有产生有效改动。请选中目标节点，或明确指定 clip 编号和要改的提示词内容。";
  return {
    content,
    metadata: local.metadata,
    actionResults: [...preloaded, ...actionResults],
  };
}

async function callLocalActionPlanner(context: AgentRunContext, preloadedResults: Array<Record<string, unknown>>): Promise<HermesAgentResult> {
  const targetClipId = inferClipIdFromText(context.content) || inferClipIdFromAgentContext(context.clientContext);
  const result = await callConfiguredTextModel([
    {
      role: "system",
      content: [
        "You are Loohii's local project controller. Return only valid JSON.",
        "You may request backend actions, but only with the provided whitelist schema.",
        "Do not answer with None/null. Do not only make a plan when the user asks for an edit or generation.",
        "You can control all current-project workflow, canvas, asset, prompt, and generation-record work through these actions. You cannot modify application code, server secrets, billing, auth, or model/provider settings.",
        "If the user asks to edit a canvas prompt, choose the exact target node from actionResults.canvas and emit update_canvas_node_prompt.",
        "If the user asks to pull an asset from the asset center/library and connect it to a clip, emit connect_asset_to_clip with clipId, assetKind, and assetName.",
        "If the user asks to connect an asset to all clips, every clip, all video nodes, or all storyboard/video nodes, emit connect_asset_to_all_clips with assetKind, assetName, and target.",
        "If the user asks to remove, disconnect, or delete asset references from a clip, emit remove_asset_from_clip with clipId and assetNames. Do not only explain the steps.",
        "If the provided action types do not cover a current-project operation, emit call_project_api for /api/projects/:projectId, /api/workflows/projects/:projectId, /api/canvas, /api/characters, /api/scenes, /api/generation-records, or /api/generations within the same project.",
        "If the user asks to generate or regenerate an image, emit create_canvas_image_generation for the target generation node after updating the prompt when needed.",
        "If the user asks to modify video prompt, target video nodes and update prompt, seedancePrompt, and videoPrompt through update_canvas_node_prompt.",
        "Use the node's existing prompt as the base. Preserve unrelated story, references, and style. Apply only the user's requested change.",
        "For requests like '不写 Tiffany 和 Plastic Guards', remove those names and related mentions from the target prompt instead of changing unrelated content.",
        "Return JSON with shape {\"reply\":\"short Chinese status\",\"actions\":[...]} where actions use the same schema as Loohii backend.",
      ].join(" "),
    },
    {
      role: "user",
      content: [
        `User request: ${context.content}`,
        targetClipId ? `Inferred target clip: ${targetClipId}` : "",
        `Project: ${JSON.stringify(context.project)}`,
        `Workflow summary: ${JSON.stringify(context.workflow)}`,
        `Action results / canvas summary: ${JSON.stringify(summarizeAgentActionResultsForPlanner(preloadedResults))}`,
        "",
        "Allowed action examples:",
        '{"type":"update_canvas_node_prompt","sceneId":"episode-002","nodeId":"generation-abc","prompt":"full updated prompt"}',
        '{"type":"connect_asset_to_clip","sceneId":"episode-002","clipId":"clip-008","assetKind":"characters","assetName":"Tiffany"}',
        '{"type":"connect_asset_to_all_clips","sceneId":"episode-002","assetKind":"scenes","assetName":"Tiffany\'s beauty lab","target":"all"}',
        '{"type":"remove_asset_from_clip","sceneId":"episode-002","clipId":"clip-007","assetNames":["Tiffany","Plastic Guards"],"updatePrompts":true}',
        '{"type":"create_canvas_image_generation","sceneId":"episode-002","nodeId":"generation-abc","prompt":"full prompt","size":"16:9","parameters":{"resolution":"2k","quality":"high"}}',
      ].filter(Boolean).join("\n"),
    },
  ]);
  const text = result.rawText.trim();
  const parsed = tryParseJsonRecord(text);
  if (parsed) {
    const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
    const reply = stringValue(parsed.reply) || stringValue(parsed.content) || stringValue(parsed.message) || "";
    return {
      content: `<loohii_actions>${JSON.stringify({ actions })}</loohii_actions>${reply}`,
      metadata: {
        source: "local-agent-controller",
        model: result.model,
      },
    };
  }
  return {
    content: text,
    metadata: {
      source: "local-agent-controller",
      model: result.model,
    },
  };
}

function deterministicActionsFromUserRequest(userRequest: string, preloadedResults: Array<Record<string, unknown>>): AgentAction[] {
  const targetClipId = inferClipIdFromText(userRequest);
  const knownAssetNames = collectAgentKnownAssetNamesFromActionResults(preloadedResults);
  const removalNames = promptNamesToRemoveFromUserRequest(userRequest, knownAssetNames);
  const assetRemoval = assetRemovalFromUserRequest(userRequest, targetClipId, removalNames, knownAssetNames);
  if (assetRemoval) return [assetRemoval];
  if (targetClipId && (removalNames.length || userRequestWantsPromptRemoval(userRequest))) {
    const canvas = preloadedResults.map((result) => isRecord(result.canvas) ? result.canvas : {}).find((canvas) => Array.isArray(canvas.nodes));
    if (!canvas) return [];
    const nodes = Array.isArray(canvas.nodes) ? canvas.nodes.filter(isRecord) : [];
    const target = bestPromptNodeForUserRequest(nodes, targetClipId, userRequest);
    if (!target) return [];
    const prompt = stringValue(target.prompt);
    const withoutNames = removalNames.length ? removeNamesFromPrompt(prompt, removalNames) : prompt;
    const nextPrompt = removeRequestedPromptContentFromPrompt(withoutNames, userRequest);
    if (!nextPrompt || nextPrompt === prompt) return [];
    return [{
      type: "update_canvas_node_prompt",
      nodeId: stringValue(target.id),
      prompt: nextPrompt,
    }];
  }
  const assetConnect = assetConnectionFromUserRequest(userRequest, targetClipId, knownAssetNames);
  if (assetConnect) return [assetConnect];
  const assetConnectAll = assetConnectionToAllClipsFromUserRequest(userRequest, knownAssetNames);
  if (assetConnectAll) return [assetConnectAll];
  return [];
}

function assetConnectionToAllClipsFromUserRequest(userRequest: string, knownAssetNames: string[] = []): AgentAction | null {
  const text = String(userRequest || "");
  if (userRequestWantsPromptRemoval(text)) return null;
  if (/取消[^。.\n]*(?:资产|参考)?[^。.\n]*(?:连接|接入|连线)/i.test(text)) return null;
  if (!/(?:所有|全部|每个|每条|全量|all|every)[^。.\n]{0,80}(?:clip|视频节点|视频|故事板|分镜|节点)|(?:clip|视频节点|视频|故事板|分镜|节点)[^。.\n]{0,80}(?:所有|全部|每个|每条|全量|all|every)/i.test(text)) return null;
  if (!/资产中心|资产库|资产|参考图|角色图|场景|道具|接到|接入|连接|连到|参考|拉下来|拉下|放到|放入|传入|connect|link/i.test(text)) return null;
  const knownName = assetNamesFromUserRequestText(text, knownAssetNames)[0] || "";
  const assetName = knownName || allClipAssetNameFromUserRequestText(text);
  if (!assetName) return null;
  const mentionsVideo = /视频|video|seedance/i.test(text);
  const mentionsStoryboard = /故事板|分镜|storyboard/i.test(text);
  const mentionsAllClips = /所有|全部|每个|每条|全量|all|every/i.test(text) && /clip|镜头|分镜/i.test(text);
  return {
    type: "connect_asset_to_all_clips",
    assetKind: /场景|scene/i.test(text) ? "scenes" : /道具|prop/i.test(text) ? "props" : "characters",
    assetName,
    target: mentionsAllClips && mentionsVideo ? "all" : mentionsVideo && !mentionsStoryboard ? "video" : mentionsStoryboard && !mentionsVideo ? "storyboard" : "all",
  };
}

function allClipAssetNameFromUserRequestText(value: string): string {
  const text = String(value || "");
  const quoted = text.match(/["“'‘]([^"”'’]{1,80})["”'’]/);
  if (quoted?.[1]) return cleanAgentAssetNameCandidate(quoted[1]);
  const patterns = [
    /(?:场景资产|角色资产|道具资产|资产)\s*([^。.\n]{1,120}?)(?:传入|接入|连接|连到|放到|放入|给|到|至|for|to)\s*(?:所有|全部|每个|每条|all|every)/i,
    /(?:把|将|给|找到|选择|拉取|拉下|拉到|connect|link)\s*([^。.\n]{1,120}?)(?:资产|参考图|角色图|场景|道具)?(?:传入|接入|连接|连到|放到|放入|到|至)\s*(?:所有|全部|每个|每条|all|every)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const clean = cleanAgentAssetNameCandidate(match?.[1] ?? "");
    if (clean) return clean;
  }
  return "";
}

function assetRemovalFromUserRequest(userRequest: string, targetClipId: string, names: string[] = [], knownAssetNames: string[] = []): AgentAction | null {
  if (!targetClipId) return null;
  const text = String(userRequest || "");
  if (/已(?:经)?取消[^。.\n]{0,80}(?:资产)?(?:连接|接入|连线)/i.test(text)) return null;
  if (!/(?:资产|参考图|角色图|连接|接入|连线|节点|asset|reference|link|connect)/i.test(text)) return null;
  if (!/(?:去掉|去除|删掉|删除|移除|取消|不要|remove|disconnect|unlink|delete)/i.test(text)) return null;
  const assetNames = names.length ? names : assetNamesFromUserRequestText(text, knownAssetNames);
  if (!assetNames.length) return null;
  return {
    type: "remove_asset_from_clip",
    clipId: targetClipId,
    assetNames,
    assetKind: /场景|scene/i.test(text) ? "scenes" : /道具|prop/i.test(text) ? "props" : "characters",
    updatePrompts: true,
  };
}

function assetConnectionFromUserRequest(userRequest: string, targetClipId: string, knownAssetNames: string[] = []): AgentAction | null {
  if (!targetClipId) return null;
  const text = String(userRequest || "");
  if (userRequestWantsPromptRemoval(text)) return null;
  if (/取消[^。.\n]*(?:资产|参考)?[^。.\n]*(?:连接|接入|连线)/i.test(text)) return null;
  if (!/资产中心|资产库|接到|接入|连接|连到|参考|拉下来|拉下|放到|放入|connect|link/i.test(text)) return null;
  const knownName = assetNamesFromUserRequestText(text, knownAssetNames)[0] || "";
  const quoted = text.match(/["“'‘]([^"”'’]{1,80})["”'’]/);
  const assetName = knownName || quoted?.[1]?.trim() || "";
  if (!assetName) return null;
  return {
    type: "connect_asset_to_clip",
    clipId: targetClipId,
    assetKind: /场景|scene/i.test(text) ? "scenes" : /道具|prop/i.test(text) ? "props" : "characters",
    assetName,
    target: /视频|video|seedance/i.test(text) ? "video" : "storyboard",
  };
}

function agentActionConflictMessage(userRequest: string, action: AgentAction): string {
  if (action.type === "connect_asset_to_clip" && userRequestWantsPromptRemoval(userRequest) && !userRequestExplicitlyAsksAssetConnection(userRequest)) {
    return "当前请求是修改提示词内容，不会连接资产。";
  }
  return "";
}

function userRequestExplicitlyAsksAssetConnection(value: string): boolean {
  const text = String(value || "");
  return /(?:请|帮我|需要|把|从资产中心|资产库)[^。.\n]{0,80}(?:接到|接入|连接|连到|拉到|放到|放入|connect|link)/i.test(text) &&
    !/我已取消[^。.\n]{0,80}(?:连接|接入|连线)/i.test(text);
}

function promptNamesToRemoveFromUserRequest(value: string, knownAssetNames: string[] = []): string[] {
  const text = String(value || "");
  if (!userRequestWantsPromptRemoval(text)) return [];
  const knownNames = assetNamesMentionedInText(text, knownAssetNames);
  if (knownNames.length) return knownNames;
  const containsMatch = text.match(/包含\s*([^。.\n]{1,120}?)(?:的)?(?:去掉|去除|删掉|删除|移除|remove)/i);
  const removeMatch = text.match(/(?:不要写|不写|删了|删掉|删除|移除|remove|去掉|去除)\s*([^。.\n]+)/i);
  const raw = containsMatch?.[1] || removeMatch?.[1] || "";
  return splitAgentAssetNameList(raw);
}

const DEFAULT_AGENT_ASSET_NAMES = ["Plastic Guards", "Tiffany", "Chloe", "Leo", "Eugene", "Bob"];

function assetNamesFromUserRequestText(value: string, knownAssetNames: string[] = []): string[] {
  const text = String(value || "");
  const mentioned = assetNamesMentionedInText(text, knownAssetNames);
  if (mentioned.length) return mentioned;
  const clippedRemoval = text.match(/clip[-_\s]*\d{1,3}[^。.\n]{0,120}?的([^。.\n]{1,120}?)(?:资产|参考图|角色图|角色|道具|场景)?(?:去掉|去除|删掉|删除|移除|取消|remove|disconnect|unlink|delete)/i);
  const objectBeforeAsset = text.match(/(?:把|将|给|找到|选择|拉取|拉下|拉到|connect|link|remove|delete)\s*([^。.\n]{1,120}?)(?:资产|参考图|角色图|角色|道具|场景)(?:接到|接入|连接|连到|放到|放入|去掉|去除|删掉|删除|移除|取消|到\s*clip|remove|disconnect|unlink|delete|$)/i);
  const quoted = Array.from(text.matchAll(/["“'‘]([^"”'’]{1,80})["”'’]/g)).map((match) => match[1] ?? "");
  const raw = clippedRemoval?.[1] || objectBeforeAsset?.[1] || quoted.join("、");
  return splitAgentAssetNameList(raw);
}

function assetNamesMentionedInText(value: string, knownAssetNames: string[] = []): string[] {
  const known = uniqueAgentNames(knownAssetNames)
    .filter((name) => name.length >= 2)
    .sort((left, right) => right.length - left.length);
  const fallback = uniqueAgentNames(DEFAULT_AGENT_ASSET_NAMES)
    .filter((name) => name.length >= 2 && !known.some((knownName) => agentAssetNameMatches(knownName, name)))
    .sort((left, right) => right.length - left.length);
  const names = [...known, ...fallback];
  const matches: string[] = [];
  for (const name of names) {
    if (agentTextMentionsName(value, name)) matches.push(name);
  }
  return uniqueAgentNames(matches).slice(0, 12);
}

function agentTextMentionsName(text: string, name: string): boolean {
  const escaped = escapeRegExp(name);
  if (!escaped) return false;
  try {
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "iu").test(text);
  } catch {
    return text.toLowerCase().includes(name.toLowerCase());
  }
}

function splitAgentAssetNameList(rawValue: string): string[] {
  return rawValue
    .split(/(?:和|与|、|,|，|and|&)/i)
    .map(cleanAgentAssetNameCandidate)
    .filter((item) => item && !/提示词|prompt|视频节点|视频生成|故事板|分镜|里|中|角色|人物|资产|参考图|不要|不写|存在|描述|这个|剧情|节点/.test(item))
    .slice(0, 12);
}

function cleanAgentAssetNameCandidate(value: string): string {
  return value
    .replace(/["“”‘’]/g, "")
    .replace(/clip[-_\s]*\d{1,3}/gi, "")
    .replace(/^(?:的|里|中|把|将|给|请|帮我|视频节点|故事板节点|分镜节点|资产中心|资产库)+/i, "")
    .replace(/(?:资产|参考图|角色图|角色|道具|场景|节点|连接|接入|连线)$/i, "")
    .trim();
}

function collectAgentKnownAssetNamesFromActionResults(results: Array<Record<string, unknown>>): string[] {
  const names: string[] = [];
  for (const result of results) {
    if (Array.isArray(result.assetNames)) {
      for (const name of result.assetNames) names.push(stringValue(name));
    }
    const canvas = isRecord(result.canvas) ? result.canvas : {};
    if (Array.isArray(canvas.assetNames)) {
      for (const name of canvas.assetNames) names.push(stringValue(name));
    }
    const nodes = Array.isArray(canvas.nodes) ? canvas.nodes.filter(isRecord) : [];
    for (const node of nodes) {
      const role = stringValue(node.role);
      const type = stringValue(node.type);
      const isAssetReference = role.startsWith("asset:") || type === "character" || type === "imageInput";
      if (!isAssetReference) continue;
      names.push(
        stringValue(node.assetName),
        stringValue(node.name),
        stringValue(node.title),
        stringValue(node.label).replace(/^角色参考[:：]\s*/i, ""),
      );
    }
  }
  return uniqueAgentNames(names);
}

function userRequestWantsPromptRemoval(value: string): boolean {
  const text = String(value || "");
  const hasPromptTarget = /提示词|prompt|视频节点|视频生成|故事板|分镜/i.test(text);
  const hasRemovalVerb = /不要写|不写|删了|删掉|删除|移除|remove|去掉|去除/i.test(text);
  const hasContainsRemoval = /包含[^。.\n]{1,120}(?:去掉|去除|删了|删掉|删除|移除|remove)/i.test(text);
  return hasPromptTarget && (hasRemovalVerb || hasContainsRemoval);
}

function bestPromptNodeForUserRequest(nodes: Record<string, unknown>[], targetClipId: string, userRequest: string): Record<string, unknown> | null {
  let best: { node: Record<string, unknown>; score: number } | null = null;
  for (const node of nodes) {
    const prompt = stringValue(node.prompt);
    if (!prompt || !nodeMatchesClip(node, targetClipId)) continue;
    const score = promptNodeTargetScore(node, userRequest);
    if (!best || score > best.score) best = { node, score };
  }
  return best?.node ?? null;
}

function promptNodeTargetScore(node: Record<string, unknown>, userRequest: string): number {
  const text = `${stringValue(node.id)} ${stringValue(node.type)} ${stringValue(node.title)} ${stringValue(node.label)} ${stringValue(node.role)} ${stringValue(node.kind)}`.toLowerCase();
  const wantsVideo = /视频|video|seedance/i.test(userRequest);
  const wantsStoryboard = /故事板|分镜|storyboard|生图|图片/i.test(userRequest) && !wantsVideo;
  let score = 0;
  if (text.includes("video") || text.includes("视频")) score += wantsVideo ? 100 : 10;
  if (text.includes("storyboard") || text.includes("故事板") || text.includes("分镜")) score += wantsStoryboard ? 100 : 10;
  if (stringValue(node.type) === "video") score += wantsVideo ? 80 : 0;
  if (stringValue(node.type) === "generation") score += wantsStoryboard ? 80 : 0;
  if (/^episode-sync-video-node-/i.test(stringValue(node.id))) score += wantsVideo ? 30 : 0;
  if (/^episode-sync-storyboard-/i.test(stringValue(node.id))) score += wantsStoryboard ? 30 : 0;
  if (text.includes("node")) score += 2;
  return score;
}

function removeNamesFromPrompt(prompt: string, names: string[]): string {
  let next = prompt;
  for (const name of names) {
    const escaped = escapeRegExp(name);
    next = next
      .replace(new RegExp(`\\b${escaped}(?:['’]s)?\\s+lab\\b`, "gi"), "the lab")
      .replace(new RegExp(`\\b${escaped}(?:['’]s)?\\s+`, "gi"), "")
      .replace(new RegExp(`\\b${escaped}\\b(?:\\s*(?:and|with|plus|,|，|、)\\s*)?`, "gi"), "")
      .replace(new RegExp(`(?:,|，|、|and|with)\\s*\\b${escaped}\\b`, "gi"), "");
  }
  return next
    .replace(/\breference\s+image\s+#\d+/gi, "connected reference image")
    .replace(/\bconnected\s+reference\s+image(?:\s*,\s*connected\s+reference\s+image)+/gi, "connected reference images")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function removeRequestedPromptContentFromPrompt(prompt: string, userRequest: string): string {
  let next = prompt;
  if (userRequestWantsCeilingCrawlRemoval(userRequest)) {
    next = removeCeilingCrawlActionFromPrompt(next);
  }
  return cleanupPromptAfterPromptRemoval(next);
}

function userRequestWantsCeilingCrawlRemoval(value: string): boolean {
  const text = String(value || "");
  if (!userRequestWantsPromptRemoval(text)) return false;
  const mentionsCeiling = /天花板|屋顶|ceiling|overhead/i.test(text);
  const mentionsCrawl = /爬|crawl/i.test(text);
  return mentionsCeiling && mentionsCrawl;
}

function removeCeilingCrawlActionFromPrompt(prompt: string): string {
  let next = prompt
    .replace(/\s*,?\s*(?:continues\s+)?crawls?\s+overhead\s+across\s+the\s+ceiling(?:\s+above\s+them)?(?:\s+in\s+the\s+background)?/gi, "")
    .replace(/\s*,?\s*(?:continues\s+)?crawling\s+across\s+the\s+ceiling(?:\s+above\s+them)?(?:\s+in\s+the\s+background)?/gi, "")
    .replace(/\s+and\s+(?:continues\s+)?crawls?\s+overhead(?:,\s*still\s+threatening\s+but\s+not\s+yet\s+dropping)?/gi, "")
    .replace(/\s+and\s+(?:continues\s+)?crawling\s+across\s+the\s+ceiling/gi, "")
    .replace(/\s*,?\s*(?:creating\s+)?danger\s+overhead\b\.?/gi, "")
    .replace(/,\s*eyes\s+flicking\s+between\s+[^,.]+?\s+and\s+the\s+ceiling/gi, "")
    .replace(/,\s*(?:still\s+)?overhead\b/gi, "")
    .replace(/\bstill\s+overhead\b\.?/gi, "")
    .replace(/\boverhead\b\.?(?=\s*(?:Negative:|$))/gi, "");
  next = removeSentencesMatchingPromptPattern(next, (sentence) => (
    /(?:crawl|crawling|crawls)/i.test(sentence) &&
    /(?:ceiling|overhead)/i.test(sentence)
  ));
  return next;
}

function removeSentencesMatchingPromptPattern(prompt: string, shouldRemove: (sentence: string) => boolean): string {
  return prompt.split("\n").map((line) => {
    const parts = line.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [line];
    let removed = false;
    const kept = parts.filter((part) => {
      if (!part.trim()) return true;
      const remove = shouldRemove(part);
      if (remove) removed = true;
      return !remove;
    });
    const nextLine = kept.join(" ");
    return nextLine.trim() || !removed ? nextLine : "";
  }).join("\n");
}

function cleanupPromptAfterPromptRemoval(prompt: string): string {
  return prompt
    .replace(/,\s*while\s+([A-Z][A-Za-z'’.-]+),\s+([A-Z][A-Za-z'’.-]+),\s+and\s+remain\b/g, ", while $1 and $2 remain")
    .replace(/\b([A-Z][A-Za-z'’.-]+),\s+([A-Z][A-Za-z'’.-]+),\s+and\s+remain\b/g, "$1 and $2 remain")
    .replace(/\s+and\s+\./g, ".")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ",")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.;:!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function summarizeLocalAgentActionResults(results: Array<Record<string, unknown>>): string {
  const failed = results.find((item) => item.ok === false);
  if (failed) return `项目总控执行失败：${stringValue(failed.error) || "未知错误"}`;
  const changed = results.filter(agentActionResultChangedState);
  const generations = results.filter((item) => stringValue(item.generationId));
  if (generations.length) return `项目总控已提交 ${generations.length} 个生成任务，并更新相关画布节点。`;
  const promptUpdates = changed.filter((item) => item.type === "update_canvas_node_prompt" || Array.isArray(item.updatedFields));
  if (promptUpdates.length) return `项目总控已更新 ${promptUpdates.length} 个画布节点。`;
  const assetRemovals = results.filter((item) => item.type === "remove_asset_from_clip");
  if (assetRemovals.length) {
    const messages = assetRemovals.map((item) => stringValue(item.message)).filter(Boolean);
    return messages[0] || "资产引用已从目标 Clip 移除。";
  }
  const assetConnections = results.filter((item) => item.type === "connect_asset_to_clip");
  if (assetConnections.length) {
    const messages = assetConnections.map((item) => stringValue(item.message)).filter(Boolean);
    return messages[0] || "资产已连接到目标 Clip。";
  }
  const assetConnectionsAll = results.filter((item) => item.type === "connect_asset_to_all_clips");
  if (assetConnectionsAll.length) {
    const messages = assetConnectionsAll.map((item) => stringValue(item.message)).filter(Boolean);
    return messages[0] || "资产已连接到全部目标 Clip。";
  }
  return "项目总控已执行项目操作。";
}

function summarizeNoopAgentActionResults(results: Array<Record<string, unknown>>): string {
  const attempted = results.filter((item) => item.type !== "load_canvas");
  const message = attempted.map((item) => stringValue(item.message)).find(Boolean);
  if (message) return `项目总控未完成：${message}`;
  if (attempted.some((item) => item.type === "connect_asset_to_all_clips" || item.type === "connect_asset_to_clip")) {
    return "项目总控未完成：没有检测到新增节点或连线。请确认目标资产存在，并且当前画布里有可连接的 Clip 目标节点。";
  }
  return "项目总控未完成：没有产生有效画布改动。请指定目标节点、Clip 编号或要修改的字段。";
}

async function executeDeterministicAgentFallback(context: Omit<AgentActionExecutionContext, "actions"> & { userRequest: string }): Promise<Array<Record<string, unknown>>> {
  const project = await prisma.project.findFirst({
    where: { id: context.projectId, ownerId: context.userId, deletedAt: null },
  });
  if (!project) return [];
  const clipId = inferClipIdFromText(context.userRequest);
  if (!clipId) return [];
  const sceneId = resolveAgentCanvasSceneId(project.metadata, undefined, context.clientContext);
  const scene = await loadCanvasForAgent(project.id, project.metadata, sceneId);
  const target = findStoryboardGenerationNodeForClip(scene.nodes, clipId);
  if (!target) return [];
  const data = isRecord(target.data) ? target.data : {};
  const nodeId = stringValue(target.id);
  const currentPrompt = stringValue(data.finalPrompt) || stringValue(data.prompt) || stringValue(data.seedancePrompt) || "";
  if (!nodeId || !currentPrompt) return [];
  const nextPrompt = buildComicBubbleStoryboardPrompt(currentPrompt);
  const actions: AgentAction[] = [
    { type: "update_canvas_node_prompt", sceneId, nodeId, prompt: nextPrompt },
    {
      type: "create_canvas_image_generation",
      sceneId,
      nodeId,
      prompt: nextPrompt,
      size: stringValue(data.size) || "16:9",
      aiModelId: stringValue(data.modelId) || undefined,
      parameters: {
        quality: stringValue(data.quality) || "high",
        format: stringValue(data.format) || "png",
        resolution: stringValue(data.resolution) || "1k",
      },
      metadata: {
        source: "agent-deterministic-fallback",
        clipId,
        clipTitle: stringValue(data.clipTitle) || stringValue(data.title),
        clipNodeKind: "storyboard",
        storyboardForClip: true,
      },
    },
  ];
  return await executeAgentActions({
    req: context.req,
    userId: context.userId,
    projectId: context.projectId,
    clientContext: context.clientContext,
    userRequest: context.userRequest,
    actions,
  });
}

function findStoryboardGenerationNodeForClip(nodes: unknown[], clipId: string): Record<string, unknown> | null {
  const normalized = normalizeClipId(clipId);
  const candidates = nodes.filter(isRecord).filter((node) => {
    if (stringValue(node.type) !== "generation") return false;
    const data = isRecord(node.data) ? node.data : {};
    const nodeClipId = normalizeClipId(stringValue(data.clipId) || stringValue(data.sourceClipId) || stringValue(node.id));
    const role = stringValue(data.clipSyncRole) || stringValue(data.clipNodeKind);
    const title = `${stringValue(data.title)} ${stringValue(data.label)}`.toLowerCase();
    return nodeClipId === normalized && (role === "storyboard" || title.includes("故事板") || title.includes("storyboard"));
  });
  return candidates[0] ?? null;
}

function buildComicBubbleStoryboardPrompt(currentPrompt: string): string {
  const cleanedPrompt = removeStoryboardSpeechBubbleConflicts(currentPrompt);
  const prefix = [
    "COMIC SPEECH-BUBBLE STORYBOARD OVERRIDE:",
    "Preserve the original plot, shot order, character identities, linked reference-image bindings, scene continuity, and exact dialogue meaning from the existing prompt.",
    "Render the lower storyboard panels in a polished 3D American animated dark-comedy comic-board style with readable white comic speech bubbles inside the artwork where dialogue happens.",
    "Dialogue should appear as short English speech-bubble text inside the relevant panels. Keep technical shot labels below panels as before.",
    "This override supersedes any older instruction that says no text, no speech bubbles, or no subtitles, but only for intentional dialogue bubbles and compact production labels. Do not add random text.",
  ].join("\n");
  if (cleanedPrompt.includes("COMIC SPEECH-BUBBLE STORYBOARD OVERRIDE:")) return cleanedPrompt;
  return `${prefix}\n\n${cleanedPrompt}`;
}

function removeStoryboardSpeechBubbleConflicts(prompt: string): string {
  return prompt
    .replace(/Avoid:\s*(?:\d+-panel(?:\s+or\s+\d+-panel)?\s+comic pages,\s*)?decorative explanation paragraphs,\s*speech bubbles,\s*subtitles over artwork,\s*UI chrome,\s*watermarks,\s*random text,\s*inconsistent character identity,\s*and isolated single-shot treatment\./gi,
      "Avoid: decorative explanation paragraphs, UI chrome, watermarks, random non-dialogue text, inconsistent character identity, and isolated single-shot treatment.")
    .replace(/\bno speech bubbles\b/gi, "use speech bubbles only for intentional dialogue")
    .replace(/\bNo text except the\b/gi, "Text is allowed for intentional dialogue bubbles and the");
}

function summarizeDeterministicAgentFallback(results: Array<Record<string, unknown>>): string {
  const generation = results.find((item) => stringValue(item.generationId));
  const failed = results.find((item) => item.ok === false);
  if (generation) return "已绕过 Agent 空回复，直接更新 Clip02 故事板 prompt，并提交新的故事板生图任务。";
  if (failed) return `已尝试直接执行，但操作失败：${stringValue(failed.error) || "未知错误"}`;
  return "已直接执行项目操作。";
}

function summarizeAgentActionResultsForContext(results: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return results.map((result) => compactAgentActionResultForContext(result));
}

function summarizeAgentActionResultsForPlanner(results: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return results.map((result) => {
    const compact = compactAgentActionResultForContext(result);
    if (isRecord(result.canvas) && Array.isArray(result.canvas.nodes)) {
      compact.canvas = {
        ...(isRecord(compact.canvas) ? compact.canvas : {}),
        nodes: result.canvas.nodes.filter(isRecord).slice(0, 40).map((node) => ({
          id: stringValue(node.id),
          type: stringValue(node.type),
          role: stringValue(node.role),
          clipId: stringValue(node.clipId),
          title: stringValue(node.title) || stringValue(node.label),
          status: stringValue(node.status),
          prompt: shortText(stringValue(node.prompt), 20000),
          imageUrl: shortText(stringValue(node.imageUrl), 800),
        })),
      };
    }
    return compact;
  });
}

function compactAgentActionResultForContext(result: Record<string, unknown>): Record<string, unknown> {
  const compact: Record<string, unknown> = {};
  for (const key of [
    "type",
    "ok",
    "error",
    "sceneId",
    "episodeId",
    "nodeId",
    "assetName",
    "assetNames",
    "target",
    "targetClipCount",
    "targetGroupCount",
    "targetCount",
    "connectedCount",
    "createdNodeCount",
    "updatedNodeCount",
    "edgeAddedCount",
    "changedCount",
    "message",
    "nodes",
    "edges",
    "updatedFields",
    "generationId",
    "submitId",
    "videoUrl",
    "referenceImageCount",
    "canvasChanged",
    "recordsChanged",
    "workflowChanged",
    "projectChanged",
    "stateVerified",
  ]) {
    if (result[key] !== undefined) compact[key] = result[key];
  }
  if (isRecord(result.canvas)) {
    const nodes = Array.isArray(result.canvas.nodes) ? result.canvas.nodes.filter(isRecord) : [];
    const edges = Array.isArray(result.canvas.edges) ? result.canvas.edges.filter(isRecord) : [];
    compact.canvas = {
      updatedAt: result.canvas.updatedAt,
      nodeCount: result.canvas.nodeCount,
      edgeCount: result.canvas.edgeCount,
      targetClipId: result.canvas.targetClipId,
      truncated: result.canvas.truncated,
      nodes: nodes.slice(0, 16).map((node) => ({
        id: stringValue(node.id),
        type: stringValue(node.type),
        role: stringValue(node.role),
        clipId: stringValue(node.clipId),
        title: stringValue(node.title) || stringValue(node.label),
        status: stringValue(node.status),
        prompt: shortText(stringValue(node.prompt), 600),
        imageUrl: shortText(stringValue(node.imageUrl), 240),
      })),
      edges: edges.slice(0, 24).map((edge) => ({ source: stringValue(edge.source), target: stringValue(edge.target) })),
    };
  }
  return compact;
}

function compactAgentActionResultsForMessage(results: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return results.map((result) => {
    const compact: Record<string, unknown> = {};
    for (const key of [
      "type",
      "ok",
      "error",
      "sceneId",
      "episodeId",
      "nodeId",
      "assetName",
      "assetNames",
      "removedCount",
      "removedNodeIds",
      "target",
      "targetClipCount",
      "targetGroupCount",
      "targetCount",
      "connectedCount",
      "createdNodeCount",
      "updatedNodeCount",
      "edgeAddedCount",
      "changedCount",
      "changedNodeIds",
      "message",
      "nodes",
      "edges",
      "updatedFields",
      "generationId",
      "submitId",
      "videoUrl",
      "referenceImageCount",
      "canvasChanged",
      "recordsChanged",
      "workflowChanged",
      "projectChanged",
      "stateVerified",
    ]) {
      if (result[key] !== undefined) compact[key] = result[key];
    }
    if (isRecord(result.canvas)) {
      compact.canvas = {
        nodeCount: result.canvas.nodeCount,
        edgeCount: result.canvas.edgeCount,
        compacted: true,
        targetClipId: result.canvas.targetClipId,
        updatedAt: result.canvas.updatedAt,
      };
    }
    return compact;
  });
}

function buildHermesContinuationInstruction(userRequest: string, actionResults: Array<Record<string, unknown>>): string {
  const targetClipId = inferClipIdFromText(userRequest);
  const targetSummary = summarizeActionResultsForInstruction(actionResults, targetClipId);
  const lines = [
    userRequest,
    "",
    "Backend action results are now available in client.actionResults.",
    targetClipId ? `The user target appears to be ${targetClipId}. Use the matching node ids from actionResults.` : "",
    "Continue the requested project operation now. If the user asked to edit a canvas prompt, emit update_canvas_node_prompt. If the user asked to generate or regenerate an image, emit create_canvas_image_generation for the target generation node in the same response.",
    "Use the canvas node's existing prompt as the base. Preserve its story content and only apply the requested change. For storyboard generation, include connected reference image URLs from actionResults when available.",
    "Do not answer with only a plan. Do not ask the user to paste data already present in actionResults.",
    targetSummary ? `Relevant action result summary:\n${targetSummary}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function summarizeActionResultsForInstruction(actionResults: Array<Record<string, unknown>>, targetClipId: string): string {
  const parts: string[] = [];
  for (const result of actionResults) {
    const canvas = isRecord(result.canvas) ? result.canvas : {};
    const nodes = Array.isArray(canvas.nodes) ? canvas.nodes.filter(isRecord) : [];
    const edges = Array.isArray(canvas.edges) ? canvas.edges.filter(isRecord) : [];
    const targetNodes = nodes
      .filter((node) => !targetClipId || nodeMatchesClip(node, targetClipId))
      .slice(0, 18)
      .map((node) => ({
        id: stringValue(node.id),
        type: stringValue(node.type),
        role: stringValue(node.role),
        clipId: stringValue(node.clipId),
        title: stringValue(node.title) || stringValue(node.label),
        status: stringValue(node.status),
        prompt: shortText(stringValue(node.prompt), 700),
        imageUrl: shortText(stringValue(node.imageUrl), 400),
      }));
    if (targetNodes.length) parts.push(`nodes=${JSON.stringify(targetNodes)}`);
    const targetIds = new Set(targetNodes.map((node) => node.id).filter(Boolean));
    const targetEdges = edges
      .filter((edge) => targetIds.has(stringValue(edge.source)) || targetIds.has(stringValue(edge.target)))
      .slice(0, 28)
      .map((edge) => ({ source: stringValue(edge.source), target: stringValue(edge.target) }));
    if (targetEdges.length) parts.push(`edges=${JSON.stringify(targetEdges)}`);
  }
  return parts.join("\n").slice(0, 12000);
}

type AgentAction = z.infer<typeof agentActionSchema>;

type AgentActionExecutionContext = {
  req: { get(name: string): string | undefined; protocol: string };
  userId: string;
  projectId: string;
  clientContext?: Record<string, unknown>;
  userRequest?: string;
  actions: AgentAction[];
};

async function executeAgentActions(context: AgentActionExecutionContext): Promise<Array<Record<string, unknown>>> {
  const results: Array<Record<string, unknown>> = [];
  for (const action of context.actions) {
    try {
      const result = await executeAgentAction(context, action);
      results.push({ type: action.type, ok: true, ...result });
    } catch (error) {
      results.push({
        type: action.type,
        ok: false,
        error: error instanceof Error ? error.message : "Agent action failed",
      });
    }
  }
  return results;
}

async function executeAgentAction(context: AgentActionExecutionContext, action: AgentAction): Promise<Record<string, unknown>> {
  const conflictMessage = agentActionConflictMessage(context.userRequest ?? "", action);
  if (conflictMessage) throw new Error(conflictMessage);

  const project = await prisma.project.findFirst({
    where: { id: context.projectId, ownerId: context.userId, deletedAt: null },
  });
  if (!project) throw new Error("Project not found");

  if (action.type === "call_project_api") {
    const result = await callProjectApiAction(context, project.id, action);
    const mutates = action.method !== "GET";
    return {
      ...result,
      canvasChanged: mutates && action.refresh === "canvas",
      recordsChanged: mutates && action.refresh === "records",
      workflowChanged: mutates && action.refresh === "workflow",
      projectChanged: mutates && action.refresh === "project",
    };
  }

  if (action.type === "sync_episode_canvas") {
    const records = await prisma.generation.findMany({
      where: { projectId: project.id, status: "SUCCEEDED" },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { assets: true },
    });
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${project.id} FOR UPDATE`;
      const currentProject = await tx.project.findUnique({ where: { id: project.id }, select: { metadata: true } });
      const metadata = isRecord(currentProject?.metadata) ? currentProject.metadata : {};
      const canvasScenes = getCanvasScenes(metadata);
      const episodeId = action.episodeId || stringValue(metadata.activeEpisodeId) || resolveCanvasEpisodeId(metadata, "");
      const sync = buildEpisodeCanvasSyncScene({
        metadata,
        episodeId,
        existingScene: canvasScenes[episodeId] ?? canvasScenes[resolveCanvasEpisodeId(metadata, episodeId)] ?? undefined,
        records,
      });
      const nextMetadata = writeEpisodeCanvasSyncMetadata({ metadata, sync, makeActive: true });
      await tx.project.update({ where: { id: project.id }, data: { metadata: nextMetadata as Prisma.InputJsonValue } });
      return sync;
    });
    return {
      sceneId: result.sceneId,
      episodeId: result.episodeId,
      nodes: result.nodes.length,
      edges: result.edges.length,
      canvasChanged: true,
    };
  }

  const sceneId = resolveAgentCanvasSceneId(project.metadata, "sceneId" in action ? action.sceneId : undefined, context.clientContext);
  if (action.type === "load_canvas") {
    const scene = await loadCanvasForAgent(project.id, project.metadata, sceneId);
    const targetClipId = inferClipIdFromText(context.userRequest ?? "") || inferClipIdFromAgentContext(context.clientContext);
    const episodeId = resolveCanvasEpisodeId(project.metadata, sceneId);
    const assetNames = collectWorkflowAssetNamesForAgent(project.metadata, episodeId);
    return {
      sceneId,
      nodes: scene.nodes.length,
      edges: scene.edges.length,
      assetNames,
      canvas: summarizeCanvasForAgent(scene, { targetClipId, assetNames }),
    };
  }

  if (action.type === "connect_asset_to_clip") {
    return await connectAssetToClipForAgent(project.id, project.metadata, sceneId, action);
  }

  if (action.type === "connect_asset_to_all_clips") {
    return await connectAssetToAllClipsForAgent(project.id, project.metadata, sceneId, action);
  }

  if (action.type === "remove_asset_from_clip") {
    return await removeAssetFromClipForAgent(project.id, project.metadata, sceneId, action);
  }

  if (action.type === "create_canvas_image_generation") {
    const scene = await loadCanvasForAgent(project.id, project.metadata, sceneId);
    const actionWithReferences = {
      ...action,
      referenceImageUrls: action.referenceImageUrls?.length
        ? action.referenceImageUrls
        : collectCanvasReferenceImageUrls(scene, action.nodeId, context.req).slice(0, 16),
    };
    const result = await submitCanvasImageGenerationAction(context, project.id, sceneId, actionWithReferences);
    const generation = isRecord(result.generation) ? result.generation : {};
    const generationId = stringValue(generation.id);
    const patch: Record<string, unknown> = {
      _nodeType: "generation",
      status: "generating",
      error: "项目总控已提交生图任务。",
      generationStartedAt: new Date().toISOString(),
      generationRequestId: generationId,
      finalPrompt: action.prompt,
      submittedPrompt: action.prompt,
      manualFinalPrompt: true,
      mode: "standalone",
      referenceImageUrls: actionWithReferences.referenceImageUrls,
      seedancePrompt: "",
      videoPrompt: "",
      videoStatus: "",
      videoError: "",
    };
    if (action.nodeId) {
      await patchCanvasNode(project.id, project.metadata, sceneId, action.nodeId, patch);
    }
    return {
      generationId,
      nodeId: action.nodeId ?? "",
      sceneId,
      referenceImageCount: actionWithReferences.referenceImageUrls.length,
      canvasChanged: Boolean(action.nodeId),
    };
  }

  if (action.type === "create_canvas_video_generation") {
    const result = await submitCanvasVideoGenerationAction(context, project.id, sceneId, action);
    const generation = isRecord(result.generation) ? result.generation : {};
    const asset = isRecord(result.asset) ? result.asset : {};
    const video = isRecord(result.video) ? result.video : {};
    const generationId = stringValue(generation.id);
    const videoUrl = stringValue(video.url);
    const submitId = stringValue(result.submitId) || action.submitId || "";
    const patch: Record<string, unknown> = {
      status: videoUrl ? "completed" : "generating",
      videoStatus: videoUrl ? "completed" : "submitted",
      statusLabel: videoUrl ? "视频已完成" : "即梦生成中",
      videoError: videoUrl
        ? ""
        : submitId
          ? `项目总控已提交视频任务：${submitId}。稍后可再次查询结果。`
          : "项目总控已提交视频任务，稍后可再次查询结果。",
      videoSubmitId: submitId,
      videoProviderStatus: stringValue(result.genStatus) || (videoUrl ? "success" : "submitted"),
      videoGenerationRequestId: generationId,
      finalPrompt: action.prompt,
      prompt: action.prompt,
      seedancePrompt: action.prompt,
      videoPrompt: action.prompt,
      manualFinalPrompt: true,
      ...(videoUrl ? { outputVideo: videoUrl, outputVideoAssetId: stringValue(asset.id) } : {}),
    };
    if (action.nodeId) {
      await patchCanvasNode(project.id, project.metadata, sceneId, action.nodeId, patch);
    }
    return {
      generationId,
      nodeId: action.nodeId ?? "",
      sceneId,
      submitId,
      videoUrl,
      canvasChanged: Boolean(action.nodeId),
    };
  }

  if (action.type === "save_canvas") {
    const scene = await loadCanvasForAgent(project.id, project.metadata, sceneId);
    const saved = await saveCanvasForAgent(project.id, project.metadata, sceneId, scene.nodes, scene.edges);
    return {
      sceneId,
      nodes: saved.nodes.length,
      edges: saved.edges.length,
      canvasChanged: !sameAgentJson(scene.nodes, saved.nodes) || !sameAgentJson(scene.edges, saved.edges),
    };
  }

  if (action.type === "update_canvas_node_prompt") {
    return await updateCanvasNodePromptForAgent(project.id, project.metadata, sceneId, action.nodeId, action.prompt);
  }

  if (action.type === "patch_canvas_node") {
    return await patchCanvasNode(project.id, project.metadata, sceneId, action.nodeId, sanitizeAgentNodePatch(action.patch));
  }

  throw new Error(`Unsupported action: ${(action as { type?: string }).type ?? "unknown"}`);
}

async function callProjectApiAction(
  context: AgentActionExecutionContext,
  projectId: string,
  action: Extract<AgentAction, { type: "call_project_api" }>,
): Promise<Record<string, unknown>> {
  const path = await normalizeAgentProjectApiPath(projectId, context.userId, action.method, action.path);
  const url = new URL(`http://127.0.0.1:${config.port}${path}`);
  for (const [key, value] of Object.entries(action.query ?? {})) {
    if (!key || value === undefined || value === null || typeof value === "object") continue;
    url.searchParams.set(key, String(value));
  }
  const body = action.body && Object.keys(action.body).length ? sanitizeAgentApiBody(action.body) : undefined;
  const result = await callInternalApi(context, url.toString(), {
    method: action.method,
    ...(action.method === "GET" || !body ? {} : { body }),
  });
  return {
    path,
    method: action.method,
    status: result.status,
    data: compactAgentActionData(result.data),
  };
}

async function normalizeAgentProjectApiPath(projectId: string, userId: string, method: string, rawPath: string): Promise<string> {
  const path = rawPath.trim();
  if (!path.startsWith("/api/")) throw new Error("Agent project API path must start with /api/");
  if (/\/\.\.?(?:\/|$)/.test(path) || path.includes("\\") || path.includes("#")) {
    throw new Error("Invalid agent project API path");
  }
  const [pathname] = path.split("?");
  if (pathname.includes("/auth") || pathname.includes("/billing") || pathname.includes("/models") || pathname.includes("/model-configs") || pathname.includes("/uploads")) {
    throw new Error("Agent cannot call auth, billing, model, or upload APIs");
  }
  const projectPath = `/api/projects/${projectId}`;
  const encodedProjectPath = `/api/projects/${encodeURIComponent(projectId)}`;
  if ((pathname === projectPath || pathname === encodedProjectPath) && method === "DELETE") {
    throw new Error("Agent cannot delete projects through call_project_api");
  }
  if (pathname === projectPath || pathname === encodedProjectPath) return path;
  if (pathname.startsWith(`${encodedProjectPath}/`) || pathname.startsWith(`${projectPath}/`)) {
    if (/^\/api\/projects\/[^/]+\/(?:characters|scenes|workflow)(?:\/.*)?$/.test(pathname)) return path;
  }
  if (pathname.startsWith(`/api/workflows/projects/${encodeURIComponent(projectId)}`) || pathname.startsWith(`/api/workflows/projects/${projectId}`)) return path;
  if (pathname.startsWith(`/api/canvas/scenes/${encodeURIComponent(projectId)}/`) || pathname.startsWith(`/api/canvas/scenes/${projectId}/`)) return path;
  if (pathname === `/api/canvas/projects/${projectId}/sync-episode` || pathname === `/api/canvas/projects/${encodeURIComponent(projectId)}/sync-episode`) return path;
  if (pathname === "/api/generation-records" || pathname === "/api/generations") {
    const url = new URL(`http://agent.local${path}`);
    const requestedProjectId = url.searchParams.get("projectId");
    if (requestedProjectId && requestedProjectId !== projectId) {
      throw new Error("Agent cannot read generation records from another project");
    }
    if (!requestedProjectId) url.searchParams.set("projectId", projectId);
    return `${url.pathname}?${url.searchParams.toString()}`;
  }
  const generationMatch = pathname.match(/^\/api\/(?:generation-records|generations)\/([^/]+)(?:\/retry)?$/);
  if (generationMatch) {
    const generation = await prisma.generation.findFirst({
      where: { id: generationMatch[1], userId, projectId },
      select: { id: true },
    });
    if (generation) return path;
  }
  const characterMatch = pathname.match(/^\/api\/characters\/([^/]+)$/);
  if (characterMatch) {
    const character = await prisma.character.findFirst({
      where: { id: characterMatch[1], projectId, deletedAt: null },
      select: { id: true },
    });
    if (character) return path;
  }
  const sceneMatch = pathname.match(/^\/api\/scenes\/([^/]+)(?:\/layout)?$/);
  if (sceneMatch) {
    const scene = await prisma.scene.findFirst({
      where: { id: sceneMatch[1], projectId, deletedAt: null },
      select: { id: true },
    });
    if (scene) return path;
  }
  throw new Error("Agent project API path is outside the current project scope");
}

function appendQueryParam(path: string, key: string, value: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

function sanitizeAgentApiBody(body: Record<string, unknown>): Record<string, unknown> {
  const clean = sanitizeAgentNodePatch(body);
  return clean;
}

function compactAgentActionData(data: unknown): unknown {
  const text = safeJsonString(data);
  if (text.length <= 20000) return data;
  if (Array.isArray(data)) return data.slice(0, 20).map(compactAgentActionData);
  if (isRecord(data)) {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data).slice(0, 40)) {
      clean[key] = compactAgentActionData(value);
    }
    return { ...clean, _truncated: true };
  }
  return `${text.slice(0, 20000)}...`;
}

function safeJsonString(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function tryParseJsonRecord(value: string): Record<string, unknown> | null {
  const text = value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const candidates = [text];
  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch && objectMatch[0] !== text) candidates.push(objectMatch[0]);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

async function submitCanvasImageGenerationAction(
  context: AgentActionExecutionContext,
  projectId: string,
  sceneId: string,
  action: Extract<AgentAction, { type: "create_canvas_image_generation" }>,
): Promise<Record<string, unknown>> {
  const result = await callWorkflowCanvasEndpoint(context, projectId, "generate-image", {
    prompt: action.prompt,
    aiModelId: action.aiModelId,
    size: action.size,
    referenceImageUrls: action.referenceImageUrls ?? [],
    parameters: action.parameters ?? {},
    metadata: {
      ...(action.metadata ?? {}),
      source: "agent-action",
      nodeId: action.nodeId ?? "",
      sceneId,
    },
    submitOnly: true,
  });
  return result;
}

async function submitCanvasVideoGenerationAction(
  context: AgentActionExecutionContext,
  projectId: string,
  sceneId: string,
  action: Extract<AgentAction, { type: "create_canvas_video_generation" }>,
): Promise<Record<string, unknown>> {
  const result = await callWorkflowCanvasEndpoint(context, projectId, "generate-video", {
    prompt: action.prompt,
    aiModelId: action.aiModelId,
    referenceImageUrls: action.referenceImageUrls ?? [],
    resolution: action.resolution,
    durationSeconds: action.durationSeconds,
    ratio: action.ratio,
    count: action.count,
    parameters: action.parameters ?? {},
    metadata: {
      ...(action.metadata ?? {}),
      source: "agent-action",
      nodeId: action.nodeId ?? "",
      sceneId,
    },
    submitId: action.submitId,
  });
  return result;
}

async function callWorkflowCanvasEndpoint(
  context: AgentActionExecutionContext,
  projectId: string,
  actionName: "generate-image" | "generate-video",
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const endpoint = `http://127.0.0.1:${config.port}/api/workflows/projects/${encodeURIComponent(projectId)}/workflow/canvas/${actionName}`;
  const result = await callInternalApi(context, endpoint, {
    method: "POST",
    body,
  });
  return isRecord(result.data) ? result.data : {};
}

async function callInternalApi(
  context: AgentActionExecutionContext,
  endpoint: string,
  options: { method: string; body?: Record<string, unknown> },
): Promise<{ status: number; data: unknown }> {
  const authorization = context.req.get("authorization");
  const forwardedHost = context.req.get("x-forwarded-host") || context.req.get("host");
  const forwardedProto = context.req.get("x-forwarded-proto") || context.req.protocol || "https";
  const response = await fetch(endpoint, {
    method: options.method,
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
      ...(forwardedHost ? { "X-Forwarded-Host": forwardedHost } : {}),
      "X-Forwarded-Proto": forwardedProto,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const raw = await response.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { message: raw.slice(0, 500) };
    }
  }
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.message === "string"
      ? payload.message
      : `Internal project API call failed (${response.status})`;
    throw new Error(message);
  }
  return {
    status: response.status,
    data: isRecord(payload) && "data" in payload ? payload.data : payload,
  };
}

async function patchCanvasNode(projectId: string, metadata: unknown, sceneId: string, nodeId: string, patch: Record<string, unknown>) {
  const scene = await loadCanvasForAgent(projectId, metadata, sceneId);
  const nextNodeType = stringValue(patch._nodeType);
  const cleanPatch = { ...patch };
  delete cleanPatch._nodeType;
  let changed = false;
  const nodes = scene.nodes.map((node) => {
    if (!isRecord(node) || node.id !== nodeId) return node;
    const data = isRecord(node.data) ? node.data : {};
    changed = true;
    return {
      ...node,
      ...(nextNodeType ? { type: nextNodeType } : {}),
      data: { ...data, ...cleanPatch },
    };
  });
  if (!changed) throw new Error(`Canvas node not found: ${nodeId}`);
  const saved = await saveCanvasForAgent(projectId, metadata, sceneId, nodes, scene.edges);
  return {
    sceneId,
    nodeId,
    updatedFields: Object.keys(cleanPatch),
    nodes: saved.nodes.length,
    edges: saved.edges.length,
    canvasChanged: true,
  };
}

async function updateCanvasNodePromptForAgent(projectId: string, metadata: unknown, sceneId: string, nodeId: string, prompt: string) {
  const scene = await loadCanvasForAgent(projectId, metadata, sceneId);
  const target = scene.nodes.filter(isRecord).find((node) => stringValue(node.id) === nodeId);
  if (!target) throw new Error(`Canvas node not found: ${nodeId}`);
  const type = stringValue(target.type);
  const data = isRecord(target.data) ? target.data : {};
  const patch: Record<string, unknown> = {
    prompt,
    finalPrompt: prompt,
    manualFinalPrompt: true,
  };
  if (type === "video" || stringValue(data.workflowKind) === "video") {
    patch.seedancePrompt = prompt;
    patch.videoPrompt = prompt;
  }
  if (type === "generation") {
    patch.submittedPrompt = prompt;
  }
  if (type === "scene") {
    patch.visualPrompt = prompt;
    patch.description = prompt;
  }
  if (type === "imageInput") {
    patch.sourcePrompt = prompt;
  }
  const result = await patchCanvasNode(projectId, metadata, sceneId, nodeId, patch);
  const workflowChanged = await syncAgentPromptToWorkflow(projectId, sceneId, target, prompt);
  return {
    ...result,
    ...(workflowChanged ? { workflowChanged: true } : {}),
  };
}

async function syncAgentPromptToWorkflow(
  projectId: string,
  sceneId: string,
  node: Record<string, unknown>,
  prompt: string,
): Promise<boolean> {
  const data = isRecord(node.data) ? node.data : {};
  const clipId = normalizeClipId(stringValue(data.clipId) || stringValue(data.sourceClipId) || stringValue(data.targetClipId) || stringValue(node.id));
  if (!clipId) return false;
  const type = stringValue(node.type);
  const role = stringValue(data.clipSyncRole) || stringValue(data.clipNodeKind);
  const field = type === "video" || stringValue(data.workflowKind) === "video"
    ? "video"
    : type === "generation" || role === "storyboard" || data.storyboardForClip === true
      ? "storyboard"
      : "";
  if (!field) return false;
  const latest = await prisma.project.findUnique({ where: { id: projectId }, select: { metadata: true } });
  const latestMetadata = isRecord(latest?.metadata) ? latest.metadata : {};
  const episodeId = resolveCanvasEpisodeId(latestMetadata, sceneId);
  const nextMetadata = updateWorkflowClipPromptInMetadata(latestMetadata, episodeId, clipId, field, prompt);
  if (sameAgentJson(latestMetadata, nextMetadata)) return false;
  await prisma.project.update({
    where: { id: projectId },
    data: { metadata: nextMetadata as Prisma.InputJsonValue },
  });
  return true;
}

function updateWorkflowClipPromptInMetadata(
  metadata: Record<string, unknown>,
  episodeId: string,
  clipId: string,
  field: "storyboard" | "video",
  prompt: string,
): Record<string, unknown> {
  let next = metadata;
  const updateWorkflow = (workflow: unknown): { workflow: unknown; changed: boolean } => {
    if (!isRecord(workflow) || !Array.isArray(workflow.clips)) return { workflow, changed: false };
    let changed = false;
    const clips = workflow.clips.map((clip) => {
      if (!isRecord(clip) || normalizeClipId(stringValue(clip.id)) !== clipId) return clip;
      changed = true;
      return field === "video"
        ? { ...clip, seedancePrompt: prompt, videoPrompt: prompt }
        : { ...clip, storyboardPrompt: prompt };
    });
    if (!changed) return { workflow, changed: false };
    return {
      workflow: {
        ...workflow,
        clips,
        updatedAt: new Date().toISOString(),
      },
      changed: true,
    };
  };

  const rootWorkflow = updateWorkflow(next.workflowCenter);
  if (rootWorkflow.changed) {
    next = { ...next, workflowCenter: rootWorkflow.workflow };
  }

  if (episodeId && isRecord(next.episodes)) {
    const episodes = next.episodes;
    const episode = isRecord(episodes[episodeId]) ? episodes[episodeId] : null;
    if (episode) {
      const episodeWorkflow = updateWorkflow(episode.workflowCenter);
      if (episodeWorkflow.changed) {
        next = {
          ...next,
          episodes: {
            ...episodes,
            [episodeId]: {
              ...episode,
              workflowCenter: episodeWorkflow.workflow,
              updatedAt: new Date().toISOString(),
            },
          },
        };
      }
    }
  }

  if (episodeId && isRecord(next.workflowCenterByEpisode)) {
    const byEpisode = next.workflowCenterByEpisode;
    const episodeWorkflow = updateWorkflow(byEpisode[episodeId]);
    if (episodeWorkflow.changed) {
      next = {
        ...next,
        workflowCenterByEpisode: {
          ...byEpisode,
          [episodeId]: episodeWorkflow.workflow,
        },
      };
    }
  }

  return next;
}

async function connectAssetToClipForAgent(
  projectId: string,
  metadata: unknown,
  sceneId: string,
  action: Extract<AgentAction, { type: "connect_asset_to_clip" }>,
): Promise<Record<string, unknown>> {
  const scene = await loadCanvasForAgent(projectId, metadata, sceneId);
  const nodes = scene.nodes.filter(isRecord);
  const edges = scene.edges.filter(isRecord);
  const clipId = normalizeClipId(action.clipId);
  const assetKind = action.assetKind || "characters";
  const target = action.target ?? "storyboard";
  const asset = findWorkflowAssetForAgent(metadata, assetKind, action.assetName, resolveCanvasEpisodeId(metadata, sceneId));
  if (!asset) throw new Error(`未找到资产：${action.assetName}`);
  const assetName = workflowAssetNameForAgent(asset) || action.assetName;
  const imageUrl = workflowAssetImageUrlForAgent(asset);
  if (!imageUrl) throw new Error(`资产缺少可用图片：${assetName}`);
  const targetNodes = nodes.filter((node) => nodeMatchesClip(node, clipId) && agentClipReferenceTargetType(node, target));
  if (!targetNodes.length) throw new Error(`未找到 ${action.clipId} 的目标节点`);
  const targetNodeIds = new Set(targetNodes.map((node) => stringValue(node.id)).filter(Boolean));
  const layout = canvasAssetConnectionLayout(nodes, targetNodes, clipId, assetName, agentAssetConnectionSectionKind(target));
  const existingNode = nodes.find((node) => {
    const data = isRecord(node.data) ? node.data : {};
    return (
      (stringValue(node.type) === "character" || stringValue(node.type) === "imageInput") &&
      normalizeCompareTextForAgent(stringValue(data.assetName) || stringValue(data.name)) === normalizeCompareTextForAgent(assetName) &&
      (
        nodeMatchesClip(node, clipId) ||
        (layout.parentSectionId ? stringValue(node.parentId) === layout.parentSectionId : false) ||
        edges.some((edge) => stringValue(edge.source) === stringValue(node.id) && targetNodes.some((target) => stringValue(target.id) === stringValue(edge.target)))
      )
    );
  });
  if (existingNode) {
    const patchedExistingNode = canvasAssetConnectionNode(existingNode, layout, assetKind, assetName, imageUrl, asset);
    const existingEdges = ensureOnlyCanvasEdges(edges, stringValue(existingNode.id), targetNodes);
    const nodeChanged = !sameAgentJson(existingNode, patchedExistingNode);
    const edgesChanged = !sameAgentJson(edges, existingEdges);
    if (nodeChanged || edgesChanged) {
      const beforeEdges = edges.length;
      const saved = await saveCanvasForAgent(
        projectId,
        metadata,
        sceneId,
        scene.nodes.map((node) => (isRecord(node) && stringValue(node.id) === stringValue(existingNode.id) ? patchedExistingNode : node)),
        existingEdges,
      );
      const verified = verifyCanvasAssetConnections(saved, assetName, targetNodeIds);
      if (verified.connectedTargets !== targetNodeIds.size) {
        throw new Error(`资产连接保存后未通过校验：${verified.connectedTargets}/${targetNodeIds.size} 个目标节点已连接。`);
      }
      return {
        sceneId,
        nodeId: stringValue(existingNode.id),
        assetName,
        target,
        targetCount: targetNodes.length,
        connectedCount: verified.connectedTargets,
        createdNodeCount: 0,
        updatedNodeCount: nodeChanged ? 1 : 0,
        edgeAddedCount: Math.max(0, existingEdges.length - beforeEdges),
        nodes: saved.nodes.length,
        edges: saved.edges.length,
        canvasChanged: true,
        stateVerified: true,
        message: "资产图片参考已接入目标 Clip。",
      };
    }
    const verified = verifyCanvasAssetConnections(scene, assetName, targetNodeIds);
    if (verified.connectedTargets !== targetNodeIds.size) {
      throw new Error(`资产连接未通过校验：${verified.connectedTargets}/${targetNodeIds.size} 个目标节点已连接。`);
    }
    return {
      sceneId,
      nodeId: stringValue(existingNode.id),
      assetName,
      target,
      targetCount: targetNodes.length,
      connectedCount: verified.connectedTargets,
      createdNodeCount: 0,
      updatedNodeCount: 0,
      edgeAddedCount: 0,
      canvasChanged: false,
      stateVerified: true,
      message: "资产图片参考已连接到目标 Clip。",
    };
  }

  const assetNodeId = `agent-asset-${stableAgentIdPart(assetKind)}-${stableAgentIdPart(assetName)}-${Date.now().toString(36)}`;
  const assetNode = canvasAssetConnectionNode({
    id: assetNodeId,
  }, layout, assetKind, assetName, imageUrl, asset);
  const nextEdges = ensureOnlyCanvasEdges(edges, assetNodeId, targetNodes);
  const saved = await saveCanvasForAgent(projectId, metadata, sceneId, [...scene.nodes, assetNode], nextEdges);
  const verified = verifyCanvasAssetConnections(saved, assetName, targetNodeIds);
  if (verified.connectedTargets !== targetNodeIds.size) {
    throw new Error(`资产连接保存后未通过校验：${verified.connectedTargets}/${targetNodeIds.size} 个目标节点已连接。`);
  }
  return {
    sceneId,
    nodeId: assetNodeId,
    assetName,
    target,
    targetCount: targetNodes.length,
    connectedCount: verified.connectedTargets,
    createdNodeCount: 1,
    updatedNodeCount: 0,
    edgeAddedCount: Math.max(0, nextEdges.length - edges.length),
    nodes: saved.nodes.length,
    edges: saved.edges.length,
    canvasChanged: true,
    stateVerified: true,
  };
}

async function connectAssetToAllClipsForAgent(
  projectId: string,
  metadata: unknown,
  sceneId: string,
  action: Extract<AgentAction, { type: "connect_asset_to_all_clips" }>,
): Promise<Record<string, unknown>> {
  const scene = await loadCanvasForAgent(projectId, metadata, sceneId);
  const nodes = scene.nodes.filter(isRecord);
  const edges = scene.edges.filter(isRecord);
  const assetKind = action.assetKind || "characters";
  const episodeId = resolveCanvasEpisodeId(metadata, sceneId);
  const asset = findWorkflowAssetForAgent(metadata, assetKind, action.assetName, episodeId);
  if (!asset) throw new Error(`未找到资产：${action.assetName}`);
  const assetName = workflowAssetNameForAgent(asset) || action.assetName;
  const imageUrl = workflowAssetImageUrlForAgent(asset);
  if (!imageUrl) throw new Error(`资产缺少可用图片：${assetName}`);

  const targetGroups = collectAgentClipTargetGroups(nodes, action.target);
  if (!targetGroups.length) throw new Error("未找到可连接的 Clip 目标节点");

  const nextNodes = [...scene.nodes];
  let nextEdges = [...edges];
  let createdNodeCount = 0;
  let updatedNodeCount = 0;
  const connectedClipIds = new Set<string>();
  const targetNodeIds = new Set<string>();
  const changedNodeIds = new Set<string>();

  for (const group of targetGroups) {
    if (!group.targetNodes.length) continue;
    for (const target of group.targetNodes) {
      const targetId = stringValue(target.id);
      if (targetId) targetNodeIds.add(targetId);
    }
    const layout = canvasAssetConnectionLayout(nextNodes.filter(isRecord), group.targetNodes, group.clipId, assetName, group.sectionKind);
    const existingNodeIndex = nextNodes.findIndex((node) => {
      if (!isRecord(node)) return false;
      const data = isRecord(node.data) ? node.data : {};
      const matchesAsset = agentAssetNameMatches(
        stringValue(data.assetName) || stringValue(data.name) || stringValue(data.label) || stringValue(data.title),
        assetName,
      );
      if (!matchesAsset) return false;
      const nodeId = stringValue(node.id);
      const parentMatches = Boolean(layout.parentSectionId && stringValue(node.parentId) === layout.parentSectionId);
      const connectedToGroup = nextEdges.some((edge) => (
        stringValue(edge.source) === nodeId &&
        group.targetNodes.some((target) => stringValue(target.id) === stringValue(edge.target))
      ));
      const fallbackGlobalAsset = !layout.parentSectionId && nodeMatchesClip(node, group.clipId);
      return Boolean(nodeId && (parentMatches || connectedToGroup || fallbackGlobalAsset));
    });

    let assetNodeId = "";
    if (existingNodeIndex >= 0) {
      const existingNode = nextNodes[existingNodeIndex];
      if (!isRecord(existingNode)) continue;
      assetNodeId = stringValue(existingNode.id);
      const patchedNode = canvasAssetConnectionNode(existingNode, layout, assetKind, assetName, imageUrl, asset);
      if (!sameAgentJson(existingNode, patchedNode)) {
        nextNodes[existingNodeIndex] = patchedNode;
        updatedNodeCount += 1;
        changedNodeIds.add(assetNodeId);
      }
    } else {
      assetNodeId = uniqueAgentCanvasNodeId(nextNodes, `agent-asset-${stableAgentIdPart(assetKind)}-${stableAgentIdPart(assetName)}-${stableAgentIdPart(group.clipId)}-${group.targetKind}`);
      const assetNode = canvasAssetConnectionNode({ id: assetNodeId }, layout, assetKind, assetName, imageUrl, asset);
      nextNodes.push(assetNode);
      createdNodeCount += 1;
      changedNodeIds.add(assetNodeId);
    }

    if (!assetNodeId) continue;
    const beforeEdges = nextEdges.length;
    nextEdges = ensureOnlyCanvasEdges(nextEdges, assetNodeId, group.targetNodes);
    if (nextEdges.length !== beforeEdges) changedNodeIds.add(assetNodeId);
    connectedClipIds.add(group.clipId);
  }

  const canvasChanged = createdNodeCount > 0 || updatedNodeCount > 0 || !sameAgentJson(edges, nextEdges);
  if (!canvasChanged) {
    const verified = verifyCanvasAssetConnections(scene, assetName, targetNodeIds);
    if (verified.connectedTargets !== targetNodeIds.size) {
      throw new Error(`资产连接未通过校验：${verified.connectedTargets}/${targetNodeIds.size} 个目标节点已连接。`);
    }
    return {
      sceneId,
      assetName,
      assetKind,
      target: action.target,
      targetClipCount: connectedClipIds.size,
      targetGroupCount: targetGroups.length,
      targetCount: targetNodeIds.size,
      connectedCount: verified.connectedTargets,
      createdNodeCount,
      updatedNodeCount,
      edgeAddedCount: 0,
      changedCount: 0,
      canvasChanged: false,
      stateVerified: true,
      message: `资产 ${assetName} 已经连接到 ${connectedClipIds.size} 个 Clip 的 ${targetNodeIds.size} 个目标节点。`,
    };
  }

  const saved = await saveCanvasForAgent(projectId, metadata, sceneId, nextNodes, nextEdges);
  const verified = verifyCanvasAssetConnections(saved, assetName, targetNodeIds);
  if (verified.connectedTargets !== targetNodeIds.size) {
    throw new Error(`资产连接保存后未通过校验：${verified.connectedTargets}/${targetNodeIds.size} 个目标节点已连接。`);
  }
  return {
    sceneId,
    assetName,
    assetKind,
    target: action.target,
    targetClipCount: connectedClipIds.size,
    targetGroupCount: targetGroups.length,
    targetCount: targetNodeIds.size,
    connectedCount: verified.connectedTargets,
    createdNodeCount,
    updatedNodeCount,
    edgeAddedCount: Math.max(0, nextEdges.length - edges.length),
    changedCount: createdNodeCount + updatedNodeCount + Math.max(0, nextEdges.length - edges.length),
    changedNodeIds: Array.from(changedNodeIds),
    nodes: saved.nodes.length,
    edges: saved.edges.length,
    canvasChanged: true,
    stateVerified: true,
    message: `资产 ${assetName} 已接入 ${connectedClipIds.size} 个 Clip 的 ${targetNodeIds.size} 个目标节点。`,
  };
}

async function removeAssetFromClipForAgent(
  projectId: string,
  metadata: unknown,
  sceneId: string,
  action: Extract<AgentAction, { type: "remove_asset_from_clip" }>,
): Promise<Record<string, unknown>> {
  const scene = await loadCanvasForAgent(projectId, metadata, sceneId);
  const clipId = normalizeClipId(action.clipId);
  const assetNames = uniqueAgentNames(action.assetNames);
  if (!clipId) throw new Error("缺少目标 Clip");
  if (!assetNames.length) throw new Error("缺少要移除的资产名");

  const nodes = scene.nodes.filter(isRecord);
  const edges = scene.edges.filter(isRecord);
  const targetNodes = nodes.filter((node) => nodeMatchesClip(node, clipId) && agentClipPromptTargetType(node));
  const targetNodeIds = new Set(targetNodes.map((node) => stringValue(node.id)).filter(Boolean));
  const removeNodeIds = new Set<string>();
  const removedAssetNames = new Set<string>();

  for (const node of nodes) {
    const nodeId = stringValue(node.id);
    if (!nodeId) continue;
    const data = isRecord(node.data) ? node.data : {};
    const nodeAssetName = stringValue(data.assetName) || stringValue(data.name) || stringValue(data.label) || stringValue(data.title);
    const nodeAssetKind = stringValue(data.assetKind);
    if (action.assetKind && nodeAssetKind && nodeAssetKind !== action.assetKind) continue;
    const matchesName = assetNames.some((name) => agentAssetNameMatches(nodeAssetName, name));
    if (!matchesName) continue;
    const directlyInClip = nodeMatchesClip(node, clipId);
    const connectedToTarget = edges.some((edge) => stringValue(edge.source) === nodeId && targetNodeIds.has(stringValue(edge.target)));
    const parentInClip = nodes.some((parent) => stringValue(parent.id) === stringValue(node.parentId) && nodeMatchesClip(parent, clipId));
    if (!directlyInClip && !connectedToTarget && !parentInClip) continue;
    removeNodeIds.add(nodeId);
    removedAssetNames.add(nodeAssetName || assetNames.find((name) => agentAssetNameMatches(nodeAssetName, name)) || "");
  }

  const nextNodes = nodes.filter((node) => !removeNodeIds.has(stringValue(node.id)));
  let nextEdges = edges.filter((edge) => !removeNodeIds.has(stringValue(edge.source)) && !removeNodeIds.has(stringValue(edge.target)));
  let promptUpdateCount = 0;
  const promptNames = assetNames;
  const patchedNodes = nextNodes.map((node) => {
    if (!agentClipPromptTargetType(node) || !nodeMatchesClip(node, clipId)) return node;
    const data = isRecord(node.data) ? node.data : {};
    const prompt = firstNonEmptyForAgent(data.finalPrompt, data.seedancePrompt, data.videoPrompt, data.prompt, data.sourcePrompt);
    if (!prompt) return node;
    const nextPrompt = removeNamesFromPrompt(prompt, promptNames);
    if (!nextPrompt || nextPrompt === prompt) return node;
    promptUpdateCount += 1;
    const type = stringValue(node.type);
    const patch: Record<string, unknown> = {
      prompt: nextPrompt,
      finalPrompt: nextPrompt,
      manualFinalPrompt: true,
    };
    if (type === "video" || stringValue(data.workflowKind) === "video") {
      patch.seedancePrompt = nextPrompt;
      patch.videoPrompt = nextPrompt;
    }
    if (type === "generation") {
      patch.submittedPrompt = nextPrompt;
    }
    if (type === "imageInput") {
      patch.sourcePrompt = nextPrompt;
    }
    return { ...node, data: { ...data, ...patch } };
  });

  if (!removeNodeIds.size && !promptUpdateCount) {
    throw new Error(`未发现 ${action.clipId} 中连接的 ${assetNames.join("、")} 资产引用，没有修改画布。`);
  }

  const saved = await saveCanvasForAgent(projectId, metadata, sceneId, patchedNodes, nextEdges, Array.from(removeNodeIds));
  let workflowChanged = false;
  if (action.updatePrompts !== false) {
    for (const node of patchedNodes) {
      if (!agentClipPromptTargetType(node) || !nodeMatchesClip(node, clipId)) continue;
      const data = isRecord(node.data) ? node.data : {};
      const prompt = firstNonEmptyForAgent(data.finalPrompt, data.seedancePrompt, data.videoPrompt, data.prompt, data.sourcePrompt);
      if (!prompt) continue;
      const type = stringValue(node.type);
      const field = type === "video" || stringValue(data.workflowKind) === "video" ? "video" : type === "generation" ? "storyboard" : "";
      if (!field) continue;
      workflowChanged = (await syncAgentPromptToWorkflow(projectId, sceneId, node, prompt)) || workflowChanged;
    }
  }

  return {
    sceneId,
    clipId: action.clipId,
    assetNames,
    removedNodeIds: Array.from(removeNodeIds),
    removedCount: removeNodeIds.size,
    promptUpdateCount,
    nodes: saved.nodes.length,
    edges: saved.edges.length,
    canvasChanged: removeNodeIds.size > 0 || promptUpdateCount > 0,
    workflowChanged,
    message: removeNodeIds.size || promptUpdateCount
      ? `已从 ${action.clipId} 移除 ${assetNames.join("、")} 的资产引用，并清理相关提示词。`
      : `未发现 ${action.clipId} 中连接的 ${assetNames.join("、")} 资产引用。`,
  };
}

function agentClipPromptTargetType(node: Record<string, unknown>): boolean {
  const type = stringValue(node.type);
  const data = isRecord(node.data) ? node.data : {};
  return type === "video" ||
    type === "generation" ||
    type === "imageInput" && (data.storyboardSlotForClip === true || stringValue(data.clipSyncRole) === "storyboard-slot");
}

function uniqueAgentNames(values: string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of values) {
    const clean = value.replace(/["'“”‘’]/g, "").trim();
    const key = normalizeCompareTextForAgent(clean);
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    names.push(clean);
  }
  return names;
}

function agentAssetNameMatches(candidate: string, target: string): boolean {
  const left = normalizeCompareTextForAgent(candidate);
  const right = normalizeCompareTextForAgent(target);
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}

function canvasAssetConnectionNode(
  baseNode: Record<string, unknown>,
  layout: ReturnType<typeof canvasAssetConnectionLayout>,
  assetKind: "characters" | "scenes" | "props",
  assetName: string,
  imageUrl: string,
  asset: Record<string, unknown>,
): Record<string, unknown> {
  const data = isRecord(baseNode.data) ? baseNode.data : {};
  const sourcePrompt = firstNonEmptyForAgent(asset.visualPrompt, asset.lockedVisualIdentity, asset.description, asset.function);
  const base = {
    ...baseNode,
    type: layout.parentSectionId ? "imageInput" : assetKind === "characters" ? "character" : "imageInput",
    position: layout.position,
    style: {
      ...(isRecord(baseNode.style) ? baseNode.style : {}),
      ...layout.style,
    },
    zIndex: layout.parentSectionId ? 1 : baseNode.zIndex,
    data: {
      ...data,
      label: assetKind === "characters" ? `角色参考: ${assetName}` : assetName,
      title: data.title || assetName,
      name: assetKind === "characters" ? assetName : data.name,
      assetKind,
      assetName,
      imageUrl,
      avatar: assetKind === "characters" && !layout.parentSectionId ? imageUrl : data.avatar,
      generatedImage: stringValue(asset.generatedImageUrl) || imageUrl,
      generatedImageAssetId: stringValue(asset.generatedImageAssetId) || stringValue(asset.referenceImageAssetId),
      traits: stringValue(asset.lockedVisualIdentity) || stringValue(asset.description) || stringValue(asset.role) || stringValue(data.traits) || "资产中心角色",
      finalPrompt: sourcePrompt || stringValue(data.finalPrompt),
      visualPrompt: sourcePrompt || stringValue(data.visualPrompt),
      sourcePrompt: layout.parentSectionId ? `${assetKind === "characters" ? "角色参考" : "资产参考"}: ${assetName}，由项目总控接入目标 Clip` : stringValue(data.sourcePrompt),
      fruitIdentity: stringValue(asset.fruitIdentity) || stringValue(data.fruitIdentity),
      uploadStatus: "linked",
      uploadError: "",
      imageLoadError: false,
      imageAspectRatio: 1.45,
      sourceEpisodeId: stringValue(asset._sourceEpisodeId) || stringValue(data.sourceEpisodeId),
      sourceEpisode: stringValue(asset._sourceEpisodeTitle) || stringValue(data.sourceEpisode),
      clipSyncRole: `asset:${stableAgentIdPart(assetName)}`,
      clipSyncUrl: imageUrl,
      clipSyncAssetId: stringValue(asset.generatedImageAssetId) || stringValue(asset.referenceImageAssetId) || stringValue(data.clipSyncAssetId),
    },
  };
  if (layout.parentSectionId) {
    return {
      ...base,
      parentId: layout.parentSectionId,
      extent: "parent",
      expandParent: false,
    };
  }
  const withoutParent: Record<string, unknown> = { ...base };
  delete withoutParent.parentId;
  delete withoutParent.extent;
  delete withoutParent.expandParent;
  return withoutParent;
}

function canvasAssetConnectionLayout(
  nodes: Record<string, unknown>[],
  targetNodes: Record<string, unknown>[],
  clipId: string,
  assetName: string,
  preferredSectionKind = "clip-storyboard-assets",
) {
  const storyTarget = targetNodes.find((node) => stringValue(node.type) === "generation") ?? targetNodes[0];
  const section = findCanvasClipSection(nodes, storyTarget, clipId, preferredSectionKind) ??
    (preferredSectionKind === "clip-storyboard-assets" ? null : findCanvasClipSection(nodes, storyTarget, clipId, "clip-storyboard-assets"));
  if (!section) {
    const anchorPosition = isRecord(storyTarget.position) ? storyTarget.position : {};
    return {
      parentSectionId: "",
      position: {
        x: numberValue(anchorPosition.x, 0) - 220,
        y: numberValue(anchorPosition.y, 0) + Math.min(260, 70 * targetNodes.length),
      },
      style: {},
    };
  }
  const childNodes = nodes.filter((node) => stringValue(node.parentId) === stringValue(section.id));
  const existingAssetIndex = childNodes.findIndex((node) => {
    const data = isRecord(node.data) ? node.data : {};
    return normalizeCompareTextForAgent(stringValue(data.assetName) || stringValue(data.name) || stringValue(data.label)) === normalizeCompareTextForAgent(assetName);
  });
  const referenceCount = childNodes.filter((node) => stringValue(node.type) === "imageInput").length;
  const index = existingAssetIndex >= 0
    ? childNodes.slice(0, existingAssetIndex + 1).filter((node) => stringValue(node.type) === "imageInput").length - 1
    : referenceCount;
  const position = canvasReferenceGridPositionForAgent(index);
  return {
    parentSectionId: stringValue(section.id),
    position,
    style: {
      width: preferredImageInputNodeWidthForAgent(1.45),
      height: preferredImageInputNodeHeightForAgent(1.45),
    },
  };
}

function findCanvasClipSection(nodes: Record<string, unknown>[], targetNode: Record<string, unknown> | undefined, clipId: string, sectionKind: string): Record<string, unknown> | null {
  const targetParentId = stringValue(targetNode?.parentId);
  const parent = targetParentId ? nodes.find((node) => stringValue(node.id) === targetParentId) : undefined;
  if (parent && stringValue(parent.type) === "section") {
    const data = isRecord(parent.data) ? parent.data : {};
    if (stringValue(data.sectionKind) === sectionKind && normalizeClipId(stringValue(data.clipId)) === clipId) return parent;
  }
  return nodes.find((node) => {
    const data = isRecord(node.data) ? node.data : {};
    return stringValue(node.type) === "section" &&
      stringValue(data.sectionKind) === sectionKind &&
      normalizeClipId(stringValue(data.clipId)) === clipId;
  }) ?? null;
}

function canvasReferenceGridPositionForAgent(index: number): { x: number; y: number } {
  const row = Math.max(0, index) % CANVAS_REFERENCE_ROWS_PER_COLUMN;
  const column = Math.floor(Math.max(0, index) / CANVAS_REFERENCE_ROWS_PER_COLUMN);
  return {
    x: CANVAS_SECTION_PADDING_X + column * (CANVAS_REFERENCE_NODE_WIDTH + CANVAS_REFERENCE_NODE_GAP_X),
    y: CANVAS_SECTION_HEADER_HEIGHT + row * (CANVAS_REFERENCE_NODE_HEIGHT + CANVAS_REFERENCE_NODE_GAP_Y),
  };
}

function preferredImageInputNodeHeightForAgent(imageAspectRatio: number): number {
  const safeRatio = Number.isFinite(imageAspectRatio) && imageAspectRatio > 0 ? imageAspectRatio : 1.45;
  return Math.round(34 + 16 + preferredImageInputNodeWidthForAgent(safeRatio) / safeRatio);
}

function preferredImageInputNodeWidthForAgent(imageAspectRatio: number): number {
  return imageAspectRatio > 1.15 ? 340 : 260;
}

function ensureOnlyCanvasEdges(edges: Record<string, unknown>[], sourceId: string, targetNodes: Record<string, unknown>[]): Record<string, unknown>[] {
  const allowedTargets = new Set(targetNodes.map((target) => stringValue(target.id)).filter(Boolean));
  const nextEdges = edges.filter((edge) => (
    stringValue(edge.source) !== sourceId ||
    allowedTargets.has(stringValue(edge.target))
  ));
  for (const target of targetNodes) {
    const targetId = stringValue(target.id);
    if (!targetId) continue;
    if (nextEdges.some((edge) => stringValue(edge.source) === sourceId && stringValue(edge.target) === targetId)) continue;
    nextEdges.push({
      id: `agent-edge-${sourceId}-${targetId}`,
      source: sourceId,
      sourceHandle: null,
      target: targetId,
      targetHandle: null,
      type: "smoothstep",
    });
  }
  return nextEdges;
}

type AgentClipTargetKind = "storyboard" | "video";
type AgentClipTargetGroup = {
  clipId: string;
  targetKind: AgentClipTargetKind;
  sectionKind: "clip-storyboard-assets" | "clip-video-assets";
  targetNodes: Record<string, unknown>[];
};

function collectAgentClipTargetGroups(nodes: Record<string, unknown>[], target: "storyboard" | "video" | "all"): AgentClipTargetGroup[] {
  const byKey = new Map<string, AgentClipTargetGroup>();
  for (const node of nodes) {
    const clipId = agentNodeClipId(node);
    if (!clipId) continue;
    const kinds: AgentClipTargetKind[] = [];
    if (target !== "video" && agentClipStoryboardReferenceTargetType(node)) kinds.push("storyboard");
    if (target !== "storyboard" && agentClipVideoReferenceTargetType(node)) kinds.push("video");
    for (const targetKind of kinds) {
      const key = `${clipId}:${targetKind}`;
      const group = byKey.get(key) ?? {
        clipId,
        targetKind,
        sectionKind: targetKind === "video" ? "clip-video-assets" : "clip-storyboard-assets",
        targetNodes: [],
      };
      group.targetNodes.push(node);
      byKey.set(key, group);
    }
  }
  return Array.from(byKey.values())
    .sort((left, right) => left.clipId.localeCompare(right.clipId, undefined, { numeric: true }) || left.targetKind.localeCompare(right.targetKind))
    .map((group) => ({ ...group, targetNodes: sortAgentClipTargetNodes(group.targetNodes) }));
}

function sortAgentClipTargetNodes(nodes: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...nodes].sort((left, right) => {
    const leftScore = stringValue(left.type) === "generation" ? 0 : stringValue(left.type) === "video" ? 1 : 2;
    const rightScore = stringValue(right.type) === "generation" ? 0 : stringValue(right.type) === "video" ? 1 : 2;
    return leftScore - rightScore || stringValue(left.id).localeCompare(stringValue(right.id));
  });
}

function verifyCanvasAssetConnections(
  scene: { nodes: unknown[]; edges: unknown[] },
  assetName: string,
  targetNodeIds: Set<string>,
): { connectedTargets: number } {
  const nodes = scene.nodes.filter(isRecord);
  const assetNodeIds = new Set(nodes
    .filter((node) => {
      const data = isRecord(node.data) ? node.data : {};
      return agentAssetNameMatches(
        stringValue(data.assetName) || stringValue(data.name) || stringValue(data.label) || stringValue(data.title),
        assetName,
      );
    })
    .map((node) => stringValue(node.id))
    .filter(Boolean));
  const connectedTargets = new Set<string>();
  for (const edge of scene.edges.filter(isRecord)) {
    const source = stringValue(edge.source);
    const target = stringValue(edge.target);
    if (assetNodeIds.has(source) && targetNodeIds.has(target)) connectedTargets.add(target);
  }
  return { connectedTargets: connectedTargets.size };
}

function agentClipStoryboardReferenceTargetType(node: Record<string, unknown>): boolean {
  const type = stringValue(node.type);
  const data = isRecord(node.data) ? node.data : {};
  const role = stringValue(data.clipSyncRole) || stringValue(data.clipNodeKind);
  return type === "generation" && (role === "storyboard" || data.storyboardForClip === true || data.clipNodeKind === "storyboard");
}

function agentClipReferenceTargetType(node: Record<string, unknown>, target: "storyboard" | "video" | "all"): boolean {
  return (target !== "video" && agentClipStoryboardReferenceTargetType(node)) ||
    (target !== "storyboard" && agentClipVideoReferenceTargetType(node));
}

function agentClipVideoReferenceTargetType(node: Record<string, unknown>): boolean {
  const type = stringValue(node.type);
  const data = isRecord(node.data) ? node.data : {};
  const role = stringValue(data.clipSyncRole) || stringValue(data.clipNodeKind);
  return type === "video" && (role === "video" || stringValue(data.workflowKind) === "video" || stringValue(data.kind) === "video");
}

function agentAssetConnectionSectionKind(target: "storyboard" | "video" | "all"): string {
  return target === "video" ? "clip-video-assets" : "clip-storyboard-assets";
}

function uniqueAgentCanvasNodeId(nodes: unknown[], preferredId: string): string {
  const ids = new Set(nodes.filter(isRecord).map((node) => stringValue(node.id)).filter(Boolean));
  if (!ids.has(preferredId)) return preferredId;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${preferredId}-${index}`;
    if (!ids.has(candidate)) return candidate;
  }
  return `${preferredId}-${Date.now().toString(36)}`;
}

function agentNodeClipId(node: Record<string, unknown>): string {
  const data = isRecord(node.data) ? node.data : {};
  return normalizeClipId(
    stringValue(data.clipId) ||
    stringValue(data.sourceClipId) ||
    stringValue(data.targetClipId) ||
    stringValue(node.id),
  );
}

function findWorkflowAssetForAgent(metadata: unknown, assetKind: "characters" | "scenes" | "props", assetName: string, episodeId = ""): Record<string, unknown> | null {
  const record = isRecord(metadata) ? metadata : {};
  const candidates: Array<Record<string, unknown>> = [];
  const pushAssets = (workflow: unknown, sourceEpisodeId = "", sourceEpisodeTitle = "") => {
    const workflowRecord = isRecord(workflow) ? workflow : {};
    const assets = isRecord(workflowRecord.assets) ? workflowRecord.assets : {};
    const list = Array.isArray(assets[assetKind]) ? assets[assetKind] : [];
    for (const item of list.filter(isRecord)) {
      candidates.push({ ...item, _sourceEpisodeId: sourceEpisodeId, _sourceEpisodeTitle: sourceEpisodeTitle });
    }
  };
  const episodes = isRecord(record.episodes) ? record.episodes : {};
  if (episodeId && isRecord(episodes[episodeId])) {
    const episode = episodes[episodeId];
    pushAssets(episode.workflowCenter, episodeId, stringValue(episode.title));
  }
  for (const [id, episode] of Object.entries(episodes)) {
    if (!isRecord(episode)) continue;
    pushAssets(episode.workflowCenter, id, stringValue(episode.title));
  }
  pushAssets(record.workflowCenter, stringValue(record.activeEpisodeId), "");
  const target = normalizeCompareTextForAgent(assetName);
  return candidates.find((item) => normalizeCompareTextForAgent(workflowAssetNameForAgent(item)) === target) ??
    candidates.find((item) => normalizeCompareTextForAgent(workflowAssetNameForAgent(item)).includes(target) || target.includes(normalizeCompareTextForAgent(workflowAssetNameForAgent(item)))) ??
    null;
}

function collectWorkflowAssetNamesForAgent(metadata: unknown, episodeId = ""): string[] {
  const record = isRecord(metadata) ? metadata : {};
  const names: string[] = [];
  const pushAssets = (workflow: unknown) => {
    const workflowRecord = isRecord(workflow) ? workflow : {};
    const assets = isRecord(workflowRecord.assets) ? workflowRecord.assets : {};
    for (const key of ["characters", "scenes", "props"]) {
      const list = Array.isArray(assets[key]) ? assets[key] : [];
      for (const item of list.filter(isRecord)) names.push(workflowAssetNameForAgent(item));
    }
  };
  const episodes = isRecord(record.episodes) ? record.episodes : {};
  if (episodeId && isRecord(episodes[episodeId])) pushAssets(episodes[episodeId].workflowCenter);
  for (const episode of Object.values(episodes)) {
    if (isRecord(episode)) pushAssets(episode.workflowCenter);
  }
  pushAssets(record.workflowCenter);
  return uniqueAgentNames(names);
}

function workflowAssetNameForAgent(asset: Record<string, unknown>): string {
  return firstNonEmptyForAgent(asset.name, asset.title, asset.assetName, asset.id);
}

function workflowAssetImageUrlForAgent(asset: Record<string, unknown>): string {
  return firstNonEmptyForAgent(asset.generatedImageUrl, asset.referenceImageUrl, asset.imageUrl, asset.url);
}

function firstNonEmptyForAgent(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return "";
}

function stableAgentIdPart(value: string): string {
  return String(value || "asset")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "asset";
}

function normalizeCompareTextForAgent(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sameAgentJson(left: unknown, right: unknown): boolean {
  return stableAgentJson(left) === stableAgentJson(right);
}

function stableAgentJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableAgentJson).join(",")}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableAgentJson(value[key])}`)
    .join(",")}}`;
}

function sanitizeAgentNodePatch(patch: Record<string, unknown>): Record<string, unknown> {
  const denied = new Set([
    "__proto__",
    "constructor",
    "prototype",
    "dangerouslySetInnerHTML",
    "innerHTML",
    "html",
    "script",
    "onClick",
    "onChange",
    "onLoad",
    "onError",
    "token",
    "apiKey",
    "authorization",
    "password",
    "secret",
  ]);
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!key || denied.has(key) || key.startsWith("on")) continue;
    if (!isJsonSafeValue(value, 0)) continue;
    clean[key] = value;
  }
  if (!Object.keys(clean).length) throw new Error("No allowed canvas node fields to patch");
  return clean;
}

function isJsonSafeValue(value: unknown, depth: number): boolean {
  if (depth > 6) return false;
  if (value === null) return true;
  if (typeof value === "string") return value.length <= 50000;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length <= 64 && value.every((item) => isJsonSafeValue(item, depth + 1));
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 120 && entries.every(([key, item]) => (
    key !== "__proto__" &&
    key !== "constructor" &&
    key !== "prototype" &&
    !key.startsWith("on") &&
    isJsonSafeValue(item, depth + 1)
  ));
}

async function loadCanvasForAgent(projectId: string, metadata: unknown, sceneId: string): Promise<{ nodes: unknown[]; edges: unknown[]; updatedAt?: string }> {
  const record = isRecord(metadata) ? metadata : {};
  const canvasScenes = getCanvasScenes(record);
  const scene = canvasScenes[sceneId];
  const episodeId = resolveCanvasEpisodeId(record, sceneId);
  const storyboardRefs = await getStoryboardGenerationReferences(projectId, record, episodeId);
  const normalized = normalizeCanvasStoryboardReferencesForScene(
    Array.isArray(scene?.nodes) ? scene.nodes : [],
    Array.isArray(scene?.edges) ? scene.edges : [],
    record,
    storyboardRefs,
    episodeId,
  );
  return {
    nodes: normalized.nodes,
    edges: normalized.edges,
    updatedAt: scene?.updatedAt,
  };
}

function summarizeCanvasForAgent(
  scene: { nodes: unknown[]; edges: unknown[]; updatedAt?: string },
  options: { targetClipId?: string; assetNames?: string[] } = {},
) {
  const targetClipId = options.targetClipId || "";
  const compactNodes = scene.nodes.filter(isRecord);
  const relevantNodeIds = targetClipId ? relevantCanvasNodeIdsForClip(compactNodes, scene.edges, targetClipId) : undefined;
  const sourceNodes = relevantNodeIds
    ? compactNodes.filter((node) => relevantNodeIds.has(stringValue(node.id)))
    : compactNodes;
  const nodes = sourceNodes
    .filter(isRecord)
    .map((node) => {
      const data = isRecord(node.data) ? node.data : {};
      const prompt = stringValue(data.finalPrompt) || stringValue(data.seedancePrompt) || stringValue(data.videoPrompt) || stringValue(data.prompt);
      return {
        id: stringValue(node.id),
        type: stringValue(node.type),
        parentId: stringValue(node.parentId) || undefined,
        title: shortText(stringValue(data.title), 160),
        label: shortText(stringValue(data.label), 120),
        name: shortText(stringValue(data.name), 120),
        kind: shortText(stringValue(data.kind) || stringValue(data.workflowKind), 80),
        clipId: shortText(stringValue(data.clipId) || stringValue(data.sourceClipId) || stringValue(data.targetClipId), 80),
        clipTitle: shortText(stringValue(data.clipTitle) || stringValue(data.sourceClipTitle), 160),
        status: shortText(stringValue(data.status) || stringValue(data.videoStatus), 80),
        prompt: shortText(prompt, targetClipId ? 20000 : 1200),
        imageUrl: shortText(stringValue(data.outputImage) || stringValue(data.imageUrl) || stringValue(data.avatar) || stringValue(data.generatedImage), 600),
        outputVideo: shortText(stringValue(data.outputVideo), 600),
        role: shortText(stringValue(data.clipSyncRole) || stringValue(data.clipNodeKind), 100),
      };
    })
    .filter((node) => node.id)
    .slice(0, 140);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = scene.edges
    .filter(isRecord)
    .filter((edge) => nodeIds.has(stringValue(edge.source)) || nodeIds.has(stringValue(edge.target)))
    .map((edge) => ({
      id: stringValue(edge.id),
      source: stringValue(edge.source),
      target: stringValue(edge.target),
      sourceHandle: stringValue(edge.sourceHandle),
      targetHandle: stringValue(edge.targetHandle),
    }))
    .slice(0, 220);
  return {
    updatedAt: scene.updatedAt,
    nodes,
    edges,
    nodeCount: scene.nodes.length,
    edgeCount: scene.edges.length,
    targetClipId: targetClipId || undefined,
    assetNames: options.assetNames?.slice(0, 80),
    truncated: nodes.length < scene.nodes.length,
  };
}

function relevantCanvasNodeIdsForClip(nodes: Record<string, unknown>[], edges: unknown[], targetClipId: string): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (nodeMatchesClip(node, targetClipId)) {
      const id = stringValue(node.id);
      if (id) ids.add(id);
    }
  }
  for (const edge of edges.filter(isRecord)) {
    const source = stringValue(edge.source);
    const target = stringValue(edge.target);
    if (!source || !target) continue;
    if (ids.has(source)) ids.add(target);
    if (ids.has(target)) ids.add(source);
  }
  return ids;
}

function nodeMatchesClip(node: Record<string, unknown>, targetClipId: string): boolean {
  if (!targetClipId) return true;
  const data = isRecord(node.data) ? node.data : node;
  const fields = [
    stringValue(node.id),
    stringValue(data.clipId),
    stringValue(data.sourceClipId),
    stringValue(data.targetClipId),
    stringValue(data.clipTitle),
    stringValue(data.sourceClipTitle),
    stringValue(data.title),
    stringValue(data.label),
  ];
  const normalizedTarget = normalizeClipId(targetClipId);
  return fields.some((field) => {
    const normalized = normalizeClipId(field);
    return normalized === normalizedTarget || Boolean(normalizedTarget && normalized.includes(normalizedTarget));
  });
}

function collectCanvasReferenceImageUrls(
  scene: { nodes: unknown[]; edges: unknown[] },
  nodeId: string | undefined,
  req: { get(name: string): string | undefined; protocol: string },
): string[] {
  if (!nodeId) return [];
  const nodes = scene.nodes.filter(isRecord);
  const nodeById = new Map(nodes.map((node) => [stringValue(node.id), node]));
  const target = nodeById.get(nodeId);
  const refs: string[] = [];
  const seen = new Set<string>();
  const incomingEdges = scene.edges
    .filter(isRecord)
    .filter((edge) => stringValue(edge.target) === nodeId)
    .map((edge, index) => ({ edge, index, source: nodeById.get(stringValue(edge.source)) }))
    .sort((a, b) => canvasReferenceSourcePriority(a.source) - canvasReferenceSourcePriority(b.source) || a.index - b.index);
  for (const { source } of incomingEdges) {
    if (shouldSkipCanvasGenerationReference(source, target)) continue;
    const url = canvasNodeImageUrl(source, req);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    refs.push(url);
  }
  return refs;
}

function shouldSkipCanvasGenerationReference(
  source: Record<string, unknown> | undefined,
  target: Record<string, unknown> | undefined,
): boolean {
  if (!source || !target) return false;
  const sourceData = isRecord(source.data) ? source.data : {};
  const targetData = isRecord(target.data) ? target.data : {};
  const targetClipId = normalizeClipId(stringValue(targetData.clipId) || stringValue(targetData.sourceClipId) || stringValue(targetData.targetClipId) || stringValue(target.id));
  if (!targetClipId) return false;
  const sourceRole = stringValue(sourceData.clipSyncRole) || stringValue(sourceData.clipNodeKind);
  const isStoryboardSlot = stringValue(source.type) === "imageInput" && (
    sourceData.storyboardSlotForClip === true ||
    sourceRole === "storyboard-slot"
  );
  if (!isStoryboardSlot) return false;
  const sourceClipId = normalizeClipId(
    stringValue(sourceData.clipId) ||
    stringValue(sourceData.sourceClipId) ||
    stringValue(sourceData.targetClipId),
  );
  return Boolean(sourceClipId && sourceClipId === targetClipId);
}

function canvasReferenceSourcePriority(node: Record<string, unknown> | undefined): number {
  if (!node) return 50;
  const data = isRecord(node.data) ? node.data : {};
  const role = stringValue(data.clipSyncRole) || stringValue(data.clipNodeKind);
  if (role === "storyboard-reference") return 0;
  if (role === "storyboard") return 1;
  if (role.startsWith("asset:")) return 2;
  if (stringValue(node.type) === "imageInput") return 3;
  if (stringValue(node.type) === "character") return 4;
  if (stringValue(node.type) === "generation") return 5;
  return 20;
}

function canvasNodeImageUrl(node: Record<string, unknown> | undefined, req: { get(name: string): string | undefined; protocol: string }): string {
  if (!node) return "";
  const data = isRecord(node.data) ? node.data : {};
  const type = stringValue(node.type);
  const raw = type === "imageInput"
    ? stringValue(data.imageUrl)
    : type === "character"
      ? stringValue(data.avatar)
      : type === "generation"
        ? stringValue(data.outputImage)
        : stringValue(data.outputImage) || stringValue(data.imageUrl) || stringValue(data.avatar) || stringValue(data.generatedImage);
  return publicAgentImageUrl(raw, req);
}

function publicAgentImageUrl(value: string, req: { get(name: string): string | undefined; protocol: string }): string {
  const text = value.trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (!text.startsWith("/")) return "";
  const forwardedHost = req.get("x-forwarded-host") || req.get("host");
  if (!forwardedHost) return text;
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  return `${proto}://${forwardedHost}${text}`;
}

function inferClipIdFromAgentContext(clientContext?: Record<string, unknown>): string {
  const context = isRecord(clientContext) ? clientContext : {};
  const selected = Array.isArray(context.selectedNodeIds) ? context.selectedNodeIds : [];
  for (const value of selected) {
    const clipId = inferClipIdFromText(String(value ?? ""));
    if (clipId) return clipId;
  }
  const canvas = isRecord(context.canvas) ? context.canvas : {};
  const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : Array.isArray(context.nodes) ? context.nodes : [];
  for (const node of nodes.filter(isRecord)) {
    const selectedNode = node.selected === true;
    const text = [
      stringValue(node.id),
      stringValue(node.clipId),
      stringValue(node.title),
      stringValue(node.label),
    ].join(" ");
    if (selectedNode) {
      const clipId = inferClipIdFromText(text);
      if (clipId) return clipId;
    }
  }
  return "";
}

function inferClipIdFromText(value: string): string {
  const text = String(value || "");
  const explicit = text.match(/\bclip[-_\s]*(\d{1,3})\b/i);
  if (explicit) return `clip-${explicit[1].padStart(3, "0")}`;
  const compact = text.match(/\bclip(\d{1,3})\b/i);
  if (compact) return `clip-${compact[1].padStart(3, "0")}`;
  return "";
}

function normalizeClipId(value: string): string {
  const inferred = inferClipIdFromText(value);
  if (inferred) return inferred;
  return value.trim().toLowerCase();
}

function userRequestWantsGeneration(value: string): boolean {
  if (/不要生成|不生成|无需生成|别生成|禁止生成|do not generate|without generating/i.test(value)) return false;
  return /生成|重新生成|再生成|生图|generate|regenerate/i.test(value);
}

function shortText(value: string, limit: number): string | undefined {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

async function saveCanvasForAgent(projectId: string, metadata: unknown, sceneId: string, nodes: unknown[], edges: unknown[], deletedNodeIds: string[] = []) {
  const record = isRecord(metadata) ? metadata : {};
  const canvasScenes = getCanvasScenes(record);
  const existingScene = canvasScenes[sceneId];
  const preserved = preserveExistingClipStoryboardSections(
    nodes,
    edges,
    Array.isArray(existingScene?.nodes) ? existingScene.nodes : [],
    Array.isArray(existingScene?.edges) ? existingScene.edges : [],
    deletedNodeIds,
  );
  const episodeId = resolveCanvasEpisodeId(record, sceneId);
  const storyboardRefs = await getStoryboardGenerationReferences(projectId, record, episodeId);
  const normalized = normalizeCanvasStoryboardReferencesForScene(preserved.nodes, preserved.edges, record, storyboardRefs, episodeId);
  const nextScene = {
    nodes: normalized.nodes,
    edges: normalized.edges,
    updatedAt: new Date().toISOString(),
  };
  await prisma.project.update({
    where: { id: projectId },
    data: {
      metadata: {
        ...record,
        canvasScenes: {
          ...canvasScenes,
          [sceneId]: nextScene,
        },
      },
    },
  });
  return nextScene;
}

function getCanvasScenes(metadata: unknown): Record<string, { nodes?: unknown[]; edges?: unknown[]; updatedAt?: string }> {
  if (!isRecord(metadata) || !isRecord(metadata.canvasScenes)) return {};
  return metadata.canvasScenes as Record<string, { nodes?: unknown[]; edges?: unknown[]; updatedAt?: string }>;
}

async function getStoryboardGenerationReferences(projectId: string, metadata: unknown, episodeId: string) {
  const records = await prisma.generation.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { assets: true },
  });
  return storyboardReferencesFromGenerationRecords(records, metadata, episodeId);
}

function resolveAgentCanvasSceneId(metadata: unknown, requested = "", clientContext?: Record<string, unknown>): string {
  if (requested) return requested;
  const contextSceneId = agentClientActiveSceneId(clientContext);
  if (contextSceneId) return contextSceneId;
  const record = isRecord(metadata) ? metadata : {};
  const activeEpisodeId = stringValue(record.activeEpisodeId);
  if (activeEpisodeId) return workflowEpisodeCanvasSceneId(activeEpisodeId);
  const episodes = isRecord(record.episodes) ? Object.keys(record.episodes).filter(Boolean) : [];
  if (episodes.length) return workflowEpisodeCanvasSceneId(episodes[0]);
  const canvasScenes = getCanvasScenes(record);
  const sceneIds = Object.keys(canvasScenes).filter(Boolean);
  if (sceneIds.length === 1) return sceneIds[0];
  return "default";
}

function agentClientActiveSceneId(clientContext?: Record<string, unknown>): string {
  const context = isRecord(clientContext) ? clientContext : {};
  const direct = stringValue(context.activeSceneId);
  if (direct) return direct;
  const canvas = isRecord(context.canvas) ? context.canvas : {};
  return stringValue(canvas.activeSceneId);
}

function resolveCanvasEpisodeId(metadata: unknown, sceneId: string): string {
  if (!sceneId || sceneId === "default") return "";
  if (!isRecord(metadata) || !isRecord(metadata.episodes)) return sceneId;
  if (isRecord(metadata.episodes[sceneId])) return sceneId;
  for (const [episodeId, episode] of Object.entries(metadata.episodes)) {
    if (isRecord(episode) && episode.canvasSceneId === sceneId) return episodeId;
  }
  return sceneId;
}

function workflowEpisodeCanvasSceneId(episodeId: string): string {
  return episodeId || "default";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function defaultConversationId(projectId: string): string {
  return `project:${projectId}`;
}

function normalizeConversationId(value: unknown, projectId: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, 300) : defaultConversationId(projectId);
}

function messageConversationId(payload: unknown, projectId: string): string {
  const record = isRecord(payload) ? payload : {};
  return normalizeConversationId(record.conversationId, projectId);
}

function compactText(value: string, limit: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text || "暂无内容";
  return `${text.slice(0, limit)}...`;
}

function conversationTitle(value: string): string {
  const text = compactText(value, 28);
  return text === "暂无内容" ? "新对话" : text;
}

function workflowSummary(metadata: unknown): Record<string, unknown> {
  const record = isRecord(metadata) ? metadata : {};
  const workflowCenter = isRecord(record.workflowCenter) ? record.workflowCenter : {};
  const activeEpisodeId = typeof workflowCenter.activeEpisodeId === "string" ? workflowCenter.activeEpisodeId : "";
  const episodes = isRecord(workflowCenter.episodes) ? workflowCenter.episodes : {};
  const episodeState = activeEpisodeId && isRecord(episodes[activeEpisodeId]) ? episodes[activeEpisodeId] : workflowCenter;
  return {
    activeEpisodeId,
    selectedEpisode: typeof episodeState.selectedEpisode === "string" ? episodeState.selectedEpisode : undefined,
    sourceName: typeof episodeState.sourceName === "string" ? episodeState.sourceName : undefined,
    clipCount: Array.isArray(episodeState.clips) ? episodeState.clips.length : 0,
    sceneCount: Array.isArray(episodeState.breakdownScenes) ? episodeState.breakdownScenes.length : 0,
    stageStatuses: isRecord(episodeState.stageStatuses) ? episodeState.stageStatuses : {},
  };
}

export const agentTestInternals = {
  agentActionConflictMessage,
  agentActionResultChangedState,
  applyAgentCompletionGuard,
  assetConnectionToAllClipsFromUserRequest,
  assetConnectionFromUserRequest,
  collectAgentClipTargetGroups,
  collectAgentKnownAssetNamesFromActionResults,
  bestPromptNodeForUserRequest,
  deterministicActionsFromUserRequest,
  verifyCanvasAssetConnections,
  promptNamesToRemoveFromUserRequest,
  removeRequestedPromptContentFromPrompt,
  removeNamesFromPrompt,
  updateWorkflowClipPromptInMetadata,
};

export const agentRouter = router;
