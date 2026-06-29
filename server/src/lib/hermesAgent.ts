import { spawn } from "node:child_process";
import { config } from "../config";

export type HermesAgentContext = {
  projectId: string;
  userId: string;
  conversationId?: string;
  content: string;
  project: Record<string, unknown>;
  workflow?: Record<string, unknown>;
  recentMessages: Array<{ role: string; content: string; createdAt: string }>;
  modelId?: string;
  clientContext?: Record<string, unknown>;
};

export type HermesAgentResult = {
  content: string;
  metadata: Record<string, unknown>;
};

export function hermesAgentStatus() {
  return {
    enabled: config.hermesAgent.enabled,
    mode: config.hermesAgent.url ? "url" : config.hermesAgent.command ? "cli" : "unconfigured",
    memoryProvider: config.hermesAgent.honchoMemoryConfigured ? "honcho" : "none",
    honchoProjectPrefix: config.hermesAgent.honchoProjectPrefix,
  };
}

export async function callHermesAgent(context: HermesAgentContext): Promise<HermesAgentResult | null> {
  if (!config.hermesAgent.enabled) return null;
  if (config.hermesAgent.url) return callHermesAgentUrl(context);
  if (config.hermesAgent.command) return callHermesAgentCommand(context);
  return null;
}

async function callHermesAgentUrl(context: HermesAgentContext): Promise<HermesAgentResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.hermesAgent.timeoutMs);
  try {
    const response = await fetch(config.hermesAgent.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildHermesPayload(context)),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Hermes Agent HTTP ${response.status}`);
    const data = await response.json().catch(() => ({}));
    return normalizeHermesResponse(data);
  } finally {
    clearTimeout(timeout);
  }
}

async function callHermesAgentCommand(context: HermesAgentContext): Promise<HermesAgentResult | null> {
  const command = config.hermesAgent.command.trim();
  if (!command) return null;
  const [binary, ...args] = command.split(/\s+/);
  const stdout = await runCommandWithInput(binary, args, JSON.stringify(buildHermesPayload(context)), {
    HONCHO_PROJECT_ID: `${config.hermesAgent.honchoProjectPrefix}:${context.projectId}`,
  });
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  if (isInvalidHermesContent(trimmed)) return null;
  try {
    return normalizeHermesResponse(JSON.parse(trimmed));
  } catch {
    return {
      content: trimmed,
      metadata: {
        source: "hermes-agent",
        mode: "cli",
        memoryProvider: config.hermesAgent.honchoMemoryConfigured ? "honcho" : "none",
      },
    };
  }
}

function runCommandWithInput(binary: string, args: string[], input: string, env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Hermes Agent CLI timed out"));
    }, config.hermesAgent.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024 * 4) {
        child.kill("SIGTERM");
        reject(new Error("Hermes Agent CLI output exceeded 4MB"));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code && code !== 0) {
        reject(new Error(stderr.trim() || `Hermes Agent CLI exited with ${code}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin.end(input);
  });
}

function buildHermesPayload(context: HermesAgentContext) {
  const projectGlobalSettings = projectGlobalSettingsFromProject(context.project);
  const clientContext = compactHermesClientContext(context.clientContext);
  return {
    message: context.content,
    projectId: context.projectId,
    userId: context.userId,
    conversationId: context.conversationId ?? `${context.projectId}:${context.userId}`,
    preferredTextModelId: context.modelId || "",
    memory: {
      provider: config.hermesAgent.honchoMemoryConfigured ? "honcho" : "none",
      projectId: `${config.hermesAgent.honchoProjectPrefix}:${context.projectId}`,
    },
    authority: {
      role: "project-controller",
      permissions: [
        "read_project",
        "read_workflow",
        "read_canvas",
        "write_project_settings",
        "write_workflow",
        "write_canvas",
        "edit_prompts",
        "submit_image_generations",
        "submit_video_generations",
        "manage_assets",
        "manage_agent_conversations",
      ],
      denied: [
        "modify_application_code",
        "run_shell_commands",
        "read_server_secrets",
        "change_server_configuration",
        "delete_user_accounts",
        "delete_projects_without_explicit_user_request",
      ],
      note: "Loohii backend owns execution through whitelisted agent actions. Hermes may request any current-project workflow, canvas, asset, prompt, and generation-record operation except code/server/secret/auth/billing/model-provider changes. Return action requests when the user asks for an operation.",
    },
    actionProtocol: {
      format: "Append a hidden JSON block exactly between <loohii_actions> and </loohii_actions> when you want Loohii backend to execute actions. Keep user-facing text outside the block.",
      flow: "If you need data first, request load_canvas or call_project_api. When backend returns actionResults in client context, immediately continue with the next concrete action instead of asking the user to paste the data or only saying you will inspect it.",
      schema: {
        actions: [
          {
            type: "call_project_api | update_canvas_node_prompt | patch_canvas_node | connect_asset_to_clip | connect_asset_to_all_clips | remove_asset_from_clip | create_canvas_image_generation | create_canvas_video_generation | save_canvas | load_canvas | sync_episode_canvas",
            method: "optional for call_project_api: GET | POST | PUT | PATCH | DELETE",
            path: "optional for call_project_api: current-project Loohii API path under /api/workflows, /api/canvas, /api/projects/:projectId, /api/characters, /api/scenes, /api/generation-records, or /api/generations",
            sceneId: "optional canvas scene id, usually the active episode canvas scene id",
            nodeId: "optional canvas node id",
            clipId: "optional target clip id, for connect_asset_to_clip",
            assetKind: "optional for connect asset actions: characters | scenes | props",
            assetName: "optional target asset name, for connect asset actions",
            target: "optional for connect_asset_to_all_clips: storyboard | video | all",
            assetNames: "optional target asset names, for remove_asset_from_clip",
            prompt: "new prompt or generation prompt",
            patch: "object of node data fields to merge",
            referenceImageUrls: "optional image references",
            aiModelId: "optional model id",
            size: "optional image size",
            resolution: "optional video or image resolution",
            durationSeconds: "optional video duration, 4-15",
            ratio: "optional video ratio",
            parameters: "optional generation parameters",
            metadata: "optional generation metadata",
            refresh: "optional for call_project_api: none | canvas | records | workflow | project",
          },
        ],
      },
      examples: [
        '<loohii_actions>{"actions":[{"type":"update_canvas_node_prompt","sceneId":"episode-001","nodeId":"generation-abc","prompt":"new final prompt"},{"type":"create_canvas_image_generation","sceneId":"episode-001","nodeId":"generation-abc","prompt":"new final prompt","size":"16:9","parameters":{"resolution":"2k","quality":"high"}}]}</loohii_actions>',
        '<loohii_actions>{"actions":[{"type":"connect_asset_to_all_clips","sceneId":"episode-002","assetKind":"scenes","assetName":"Tiffany\'s beauty lab","target":"all"}]}</loohii_actions>',
        '<loohii_actions>{"actions":[{"type":"remove_asset_from_clip","sceneId":"episode-002","clipId":"clip-007","assetNames":["Tiffany","Plastic Guards"],"updatePrompts":true}]}</loohii_actions>',
      ],
    },
    context: {
      project: {
        ...context.project,
        globalSettings: projectGlobalSettings,
      },
      workflow: context.workflow ?? {},
      recentMessages: context.recentMessages,
      client: clientContext,
    },
  };
}

function compactHermesClientContext(value: unknown): Record<string, unknown> {
  const context = isRecord(value) ? value : {};
  const compact: Record<string, unknown> = {};
  for (const key of ["path", "projectTitle", "activeSceneId", "activeProjectId", "available", "nodeCount", "edgeCount", "selectedNodeIds", "conversationId"]) {
    if (context[key] !== undefined) compact[key] = compactHermesValue(context[key], 0);
  }
  const canvas = isRecord(context.canvas) ? context.canvas : {};
  if (Object.keys(canvas).length) {
    compact.canvas = compactHermesCanvasSummary(canvas);
  }
  if (Array.isArray(context.actionResults)) {
    compact.actionResults = context.actionResults.slice(-6).map((item) => compactHermesValue(item, 0));
  }
  for (const [key, value] of Object.entries(context)) {
    if (key in compact || key === "canvas" || key === "actionResults") continue;
    if (Object.keys(compact).length >= 18) break;
    compact[key] = compactHermesValue(value, 0);
  }
  return compact;
}

function compactHermesCanvasSummary(canvas: Record<string, unknown>): Record<string, unknown> {
  const nodes = Array.isArray(canvas.nodes) ? canvas.nodes.filter(isRecord) : [];
  const selectedNodes = nodes.filter((node) => node.selected === true);
  const sourceNodes = (selectedNodes.length ? selectedNodes : nodes).slice(0, selectedNodes.length ? 12 : 24);
  const compactNodes = sourceNodes.map((node) => {
    const item: Record<string, unknown> = {};
    for (const key of ["id", "type", "selected", "parentId", "title", "label", "name", "kind", "workflowKind", "clipId", "clipTitle", "status", "role"]) {
      if (node[key] !== undefined) item[key] = compactHermesValue(node[key], 1);
    }
    if (node.prompt !== undefined) item.prompt = shortHermesString(stringFromUnknown(node.prompt), selectedNodes.length ? 500 : 180);
    if (node.outputImage || node.imageUrl || node.avatar || node.generatedImage || node.hasImage) item.hasImage = true;
    if (node.outputVideo || node.hasVideo) item.hasVideo = true;
    return item;
  });
  const nodeIds = new Set(compactNodes.map((node) => stringFromUnknown(node.id)).filter(Boolean));
  const edges = Array.isArray(canvas.edges)
    ? canvas.edges
      .filter(isRecord)
      .filter((edge) => nodeIds.has(stringFromUnknown(edge.source)) || nodeIds.has(stringFromUnknown(edge.target)))
      .slice(0, selectedNodes.length ? 48 : 36)
      .map((edge) => ({ source: stringFromUnknown(edge.source), target: stringFromUnknown(edge.target) }))
    : [];
  return {
    available: canvas.available,
    activeProjectId: compactHermesValue(canvas.activeProjectId, 1),
    activeSceneId: compactHermesValue(canvas.activeSceneId, 1),
    nodeCount: canvas.nodeCount,
    edgeCount: canvas.edgeCount,
    selectedNodeIds: compactHermesValue(canvas.selectedNodeIds, 1),
    nodes: compactNodes,
    edges,
    truncated: true,
    note: "Compact client summary only. Use load_canvas for authoritative canvas nodes, prompts, images, and edges before changing project state.",
  };
}

function compactHermesValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return shortHermesString(value, depth <= 1 ? 500 : 180);
  if (Array.isArray(value)) return value.slice(0, depth <= 1 ? 24 : 8).map((item) => compactHermesValue(item, depth + 1));
  if (!isRecord(value)) return undefined;
  if (depth >= 3) return "[object]";
  const clean: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 24)) {
    clean[key] = compactHermesValue(item, depth + 1);
  }
  return clean;
}

function shortHermesString(value: string, limit: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function projectGlobalSettingsFromProject(project: Record<string, unknown>): Record<string, unknown> {
  const setupSettings = isRecord(project.setupSettings) ? project.setupSettings : {};
  const metadata = isRecord(project.metadata) ? project.metadata : {};
  const metadataGlobalSettings = isRecord(metadata.globalSettings) ? metadata.globalSettings : {};
  const globalSettings = isRecord(project.globalSettings) ? project.globalSettings : {};
  return {
    ...metadataGlobalSettings,
    ...globalSettings,
    ...(stringFrom(project.globalPrompt) ? { globalPrompt: stringFrom(project.globalPrompt) } : {}),
    ...(stringFrom(project.negativePrompt) ? { negativePrompt: stringFrom(project.negativePrompt) } : {}),
    ...(stringFrom(project.style) ? { style: stringFrom(project.style) } : {}),
    ...(stringFrom(project.description) ? { description: stringFrom(project.description) } : {}),
    ...(Object.keys(setupSettings).length ? { setupSettings } : {}),
  };
}

function normalizeHermesResponse(value: unknown): HermesAgentResult | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const content = stringFrom(record.content) || stringFrom(record.message) || stringFrom(record.response) || stringFrom(record.text);
  if (!content) return null;
  if (isInvalidHermesContent(content)) return null;
  return {
    content,
    metadata: {
      ...(isRecord(record.metadata) ? record.metadata : {}),
      source: "hermes-agent",
      memoryProvider: config.hermesAgent.honchoMemoryConfigured ? "honcho" : "none",
      mode: config.hermesAgent.url ? "url" : "cli",
    },
  };
}

function isInvalidHermesContent(value: string): boolean {
  return /^(none|null|undefined|n\/a)$/i.test(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringFrom(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringFromUnknown(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
