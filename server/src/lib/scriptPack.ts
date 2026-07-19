/**
 * 剧本包（chaiju-script-pack）消费侧纯逻辑（P3-B，《P0-剧本包格式v1契约》）。
 *
 * 职责：
 *  - zod 校验 + format major 版本分派（§6：major=1 兼容，未知 major 400）
 *  - 平台作品库拉取（§5.1 GET /v1/library/script-packs[/{id}]，用户 token 转发）
 *  - 剧本正文分场解析（§3，拆剧助手 app/script_format.py 的 TS 移植，同一组正则）
 *  - 场 → shot（breakdownScenes）/ 角色 → assets.characters 映射（§4.1）
 *
 * 全部为纯函数/可注入 fetchImpl，路由层（routes/scriptPacks.ts）只做编排。
 */
import { z } from "zod";
import { config } from "../config";
import { HttpError } from "./httpErrors";
import { isRecord } from "./mappers";

export const SCRIPT_PACK_FORMAT = "chaiju-script-pack/1";
export const SCRIPT_PACK_MAX_BYTES = 10 * 1024 * 1024; // §2：整包 ≤ 10MB
export const EPISODE_SCRIPT_MAX_CHARS = 300_000; // §7：对齐 workflowDraftSchema.sourceText 上限

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// §2 Schema（未知字段一律容忍/忽略，major 内向后兼容；
// 可选字段同时容忍缺失与 null——平台作品库存储会把缺省规范化为 null）
// ---------------------------------------------------------------------------

/** 可选文本：缺失/null → "" */
const optionalText = () => z.string().nullish().transform((value) => value ?? "");
/** 可选文本（保留 undefined 语义）：缺失/null → undefined */
const optionalTextOrUndefined = () => z.string().nullish().transform((value) => value ?? undefined);

const packCharacterSchema = z
  .object({
    name: z.string().min(1),
    identity: optionalText(),
    personality: optionalText(),
    goal: optionalText(),
    raw: optionalText(),
  })
  .passthrough();

const packSceneCharacterSchema = z
  .object({
    name: z.string(),
    note: optionalText(),
  })
  .passthrough();

const packDialogueSchema = z
  .object({
    speaker: z.string(),
    note: optionalText(),
    text: z.string(),
  })
  .passthrough();

const packEffectSchema = z
  .object({
    kind: optionalText(),
    text: z.string(),
  })
  .passthrough();

const packSceneSchema = z
  .object({
    id: optionalText(),
    episode: z.number().int().nullish().transform((value) => value ?? undefined),
    number: z.number().int().nullish().transform((value) => value ?? undefined),
    time: optionalText(),
    placeType: optionalText(),
    location: optionalText(),
    characters: z.array(packSceneCharacterSchema).nullish().transform((value) => value ?? []),
    actions: z.array(z.string()).nullish().transform((value) => value ?? []),
    dialogues: z.array(packDialogueSchema).nullish().transform((value) => value ?? []),
    effects: z.array(packEffectSchema).nullish().transform((value) => value ?? []),
    raw: optionalText(),
  })
  .passthrough();

const packEpisodeSchema = z
  .object({
    episode: z.number().int().positive(),
    title: optionalText(),
    summary: optionalText(),
    hook: optionalText(),
    payoff: optionalText(),
    script: optionalText(),
    originalScript: optionalTextOrUndefined(),
    scenes: z.array(packSceneSchema).nullish().transform((value) => value ?? undefined),
  })
  .passthrough();

export const scriptPackSchema = z
  .object({
    format: z.string(),
    name: z.string().min(1),
    style: optionalText(),
    expectedEpisodes: z.number().int().nonnegative().nullish().transform((value) => value ?? undefined),
    incomplete: z.boolean().nullish().transform((value) => value ?? false),
    settings: optionalText(),
    outline: optionalText(),
    analysis: optionalTextOrUndefined(),
    characters: z.array(packCharacterSchema).nullish().transform((value) => value ?? []),
    episodes: z.array(packEpisodeSchema).min(1),
    generator: z
      .object({
        app: optionalTextOrUndefined(),
        version: optionalTextOrUndefined(),
        exportedAt: optionalTextOrUndefined(),
      })
      .passthrough()
      .nullish()
      .transform((value) => value ?? undefined),
  })
  .passthrough();

export type ScriptPack = z.infer<typeof scriptPackSchema>;
export type ScriptPackEpisode = z.infer<typeof packEpisodeSchema>;
export type ScriptPackScene = z.infer<typeof packSceneSchema>;
export type ScriptPackCharacter = z.infer<typeof packCharacterSchema>;

/**
 * 校验剧本包：format major=1 之外的版本 400（§6）；schema 不合 400。
 * 未知字段不报错（passthrough 后忽略）。
 */
export function parseScriptPack(raw: unknown): ScriptPack {
  const format = isRecord(raw) && typeof raw.format === "string" ? raw.format : "";
  if (format) {
    const match = /^chaiju-script-pack\/(\d+)$/.exec(format);
    if (!match) {
      throw new HttpError(400, `不是有效的剧本包格式：${format}`);
    }
    if (match[1] !== "1") {
      throw new HttpError(400, `不支持的剧本包版本：${format}，请升级对应客户端`);
    }
  }
  const parsed = scriptPackSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path?.length ? `（${issue.path.join(".")}）` : "";
    throw new HttpError(400, `剧本包校验失败${where}：${issue?.message ?? "格式不符"}`);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// §5.1 平台作品库拉取（用户 token 转发，与积分契约 §2.1 同模式）
// ---------------------------------------------------------------------------

async function callPlatformLibrary(
  platformToken: string,
  path: string,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(`${config.aijiekou.apiBase}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${platformToken}` },
      signal: AbortSignal.timeout(config.aijiekou.timeoutMs),
    });
  } catch {
    throw new HttpError(503, "平台作品库暂不可用，请稍后重试");
  }
  if (response.status === 401) {
    throw new HttpError(401, "平台登录已过期，请重新登录后再导入");
  }
  if (response.status === 404) {
    throw new HttpError(404, "剧本包不存在或已被删除");
  }
  if (!response.ok) {
    throw new HttpError(503, `平台作品库返回异常（${response.status}），请稍后重试`);
  }
  return response;
}

/** 拉取完整剧本包 JSON（>10MB 拒收，§2 大小约束） */
export async function fetchScriptPack(packId: string, platformToken: string, fetchImpl?: FetchLike): Promise<unknown> {
  const response = await callPlatformLibrary(platformToken, `/v1/library/script-packs/${encodeURIComponent(packId)}`, fetchImpl);
  const text = await response.text();
  if (text.length > SCRIPT_PACK_MAX_BYTES) {
    throw new HttpError(413, "剧本包超过 10MB 上限");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(502, "平台作品库返回了无法解析的内容");
  }
}

export interface ScriptPackListItem {
  id: string;
  name: string;
  episodeCount: number;
  expectedEpisodes?: number;
  incomplete?: boolean;
  sizeBytes?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** 列当前用户的平台剧本包（不含正文） */
export async function listScriptPacks(platformToken: string, fetchImpl?: FetchLike): Promise<ScriptPackListItem[]> {
  const response = await callPlatformLibrary(platformToken, "/v1/library/script-packs", fetchImpl);
  const body = (await response.json().catch(() => null)) as { items?: unknown } | unknown;
  const items = isRecord(body) && Array.isArray(body.items) ? body.items : Array.isArray(body) ? body : [];
  return items
    .filter(isRecord)
    .map((item) => ({
      id: String(item.id ?? ""),
      name: String(item.name ?? ""),
      episodeCount: Number.isFinite(Number(item.episodeCount)) ? Number(item.episodeCount) : 0,
      expectedEpisodes: Number.isFinite(Number(item.expectedEpisodes)) ? Number(item.expectedEpisodes) : undefined,
      incomplete: typeof item.incomplete === "boolean" ? item.incomplete : undefined,
      sizeBytes: Number.isFinite(Number(item.sizeBytes)) ? Number(item.sizeBytes) : undefined,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : undefined,
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : undefined,
    }))
    .filter((item) => item.id && item.name);
}

// ---------------------------------------------------------------------------
// §3 剧本正文分场解析（script_format.py TS 移植；scenes 缺失/为空时降级用）
// ---------------------------------------------------------------------------

const SCENE_RE = /^(\d+)-(\d+)\s+(\S+)\s+(内外|内|外)\s+(\S.*)$/;
const CAST_RE = /^出场人物[:：]\s*(.*)$/;
const EFFECT_RE = /^【(音效|特效|音乐|字幕)[:：](.*)】\s*$/;
const INLINE_EFFECT_RE = /【(音效|特效|音乐|字幕)[:：]([^】]*)】/g;
const DIALOGUE_RE = /^([^：:▲【\s][^：:（(]{0,19})(?:[（(]([^）)]*)[）)])?[:：]\s*(.+)$/;
const CAST_NOTE_RE = /[（(]([^）)]*)[）)]\s*$/;

function splitCast(raw: string): { name: string; note: string }[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "无") return [];
  return trimmed
    .split(/[、，,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const note = CAST_NOTE_RE.exec(entry);
      const name = note ? entry.slice(0, note.index).trim() : entry;
      return { name, note: note?.[1]?.trim() ?? "" };
    })
    .filter((entry) => entry.name);
}

export interface ParsedScenesResult {
  scenes: ScriptPackScene[];
  warnings: string[];
}

/**
 * 逐行状态机解析剧本正文（§3）。场号不连续/集号不符只记 warnings 不报错；
 * 场头之前的内容（标题等）丢弃；无法归类的行按动作兜底。
 */
export function parseScenesFromScript(script: string, expectedEpisode: number): ParsedScenesResult {
  const scenes: ScriptPackScene[] = [];
  const warnings: string[] = [];
  let current: ScriptPackScene | null = null;
  let currentRawLines: string[] = [];
  let previousNumber = 0;

  const flushRaw = () => {
    if (current) current.raw = currentRawLines.join("\n");
    currentRawLines = [];
  };

  for (const rawLine of script.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const header = SCENE_RE.exec(line);
    if (header) {
      flushRaw();
      const sceneEpisode = Number(header[1]);
      const sceneNumber = Number(header[2]);
      if (sceneEpisode !== expectedEpisode) {
        warnings.push(`场 ${header[1]}-${header[2]} 集号与第 ${expectedEpisode} 集不符，已照常导入`);
      }
      if (previousNumber > 0 && sceneNumber !== previousNumber + 1) {
        warnings.push(`场号不连续（${previousNumber} → ${sceneNumber}），已照常导入`);
      }
      previousNumber = sceneNumber;
      current = {
        id: `${header[1]}-${header[2]}`,
        episode: sceneEpisode,
        number: sceneNumber,
        time: header[3],
        placeType: header[4],
        location: header[5].trim(),
        characters: [],
        actions: [],
        dialogues: [],
        effects: [],
        raw: "",
      };
      scenes.push(current);
      currentRawLines = [rawLine.trimEnd()];
      continue;
    }
    if (!current) continue; // 场头之前的内容丢弃
    currentRawLines.push(rawLine.trimEnd());

    const cast = CAST_RE.exec(line);
    if (cast) {
      current.characters = splitCast(cast[1]);
      continue;
    }
    if (line.startsWith("▲")) {
      const body = line.replace(/^▲\s*/, "").trim();
      INLINE_EFFECT_RE.lastIndex = 0;
      for (const match of body.matchAll(INLINE_EFFECT_RE)) {
        current.effects.push({ kind: match[1], text: match[2].trim() });
      }
      if (body) current.actions.push(body);
      continue;
    }
    const effect = EFFECT_RE.exec(line);
    if (effect) {
      current.effects.push({ kind: effect[1], text: effect[2].trim() });
      continue;
    }
    const dialogue = DIALOGUE_RE.exec(line);
    if (dialogue) {
      current.dialogues.push({ speaker: dialogue[1].trim(), note: dialogue[2]?.trim() ?? "", text: dialogue[3].trim() });
      continue;
    }
    current.actions.push(line); // 兜底：无法归类按动作处理
  }
  flushRaw();
  return { scenes, warnings };
}

/**
 * 取一集的分场：包内 scenes 非空直接用；否则跑 §3 解析现算；再为空记降级 warning（§7）。
 */
export function scenesForEpisode(episode: ScriptPackEpisode): ParsedScenesResult {
  if (Array.isArray(episode.scenes) && episode.scenes.length > 0) {
    return { scenes: episode.scenes, warnings: [] };
  }
  const parsed = parseScenesFromScript(episode.script, episode.episode);
  if (parsed.scenes.length === 0) {
    parsed.warnings.push("未识别分场，已保留原文；该集将只建 1 个全文节点，可导入后手动拆分");
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// §4.1 映射：场 → shot；角色 → assets.characters
// ---------------------------------------------------------------------------

/** workflowEpisode / canvasScene 的统一 id（契约坑 #3：两者必须同 key） */
export function episodeIdForPack(episodeNumber: number): string {
  return `ep-${String(episodeNumber).padStart(3, "0")}`;
}

/** 对白字数 ÷ 4.5 字/秒（竖屏剧语速经验值），clamp [2, 15]（§4.1） */
export function estimateSceneDurationSeconds(scene: Pick<ScriptPackScene, "dialogues">): number {
  const chars = scene.dialogues.reduce((total, line) => total + line.text.length, 0);
  return Math.min(15, Math.max(2, Math.round(chars / 4.5)));
}

function sceneHeaderTitle(scene: ScriptPackScene, index: number): string {
  const head = [scene.id, scene.time, scene.placeType, scene.location].filter(Boolean).join(" ").trim();
  return head || `场 ${index + 1}`;
}

/**
 * breakdownScenes 的 shot（结构与 workflows.ts NormalizedStoryboardShot 对齐）。
 * 专业镜头字段（shotSize/cameraAngle 等）一律留空——契约坑 #2：别硬编，
 * 读时由 enrichWorkflowScene / inferProfessionalShotFields 自动补。
 */
export interface ScriptPackShot {
  id: string;
  title: string;
  description: string;
  action: string;
  dialogue: string;
  durationSeconds: number;
  shotSize: string;
  cameraAngle: string;
  cameraMove: string;
  composition: string;
  lens: string;
  aperture: string;
  shutter: string;
  iso: string;
  sound: string;
  music: string;
  subtitle: string;
  characters: string[];
  setting: string;
  references: string;
  canonicalSceneId: string;
  sceneVisualLock: string;
  sceneZone: string;
  sceneAnchors: string[];
  visualPrompt: string;
  directorBoardPrompt: string;
  status: string;
}

/** 场 → breakdownScenes 的 shot（§4.1 映射表；镜头专业字段留空，读时自动补） */
export function sceneToShot(scene: ScriptPackScene, index: number): ScriptPackShot {
  const action = scene.actions.join("\n");
  const dialogue = scene.dialogues
    .map((line) => `${line.speaker}${line.note ? `（${line.note}）` : ""}：${line.text}`)
    .join("\n");
  const sound = scene.effects.map((effect) => (effect.kind ? `${effect.kind}：${effect.text}` : effect.text)).join("\n");
  return {
    id: `shot-${String(index + 1).padStart(3, "0")}`,
    title: sceneHeaderTitle(scene, index),
    description: action,
    action,
    dialogue,
    durationSeconds: estimateSceneDurationSeconds(scene),
    shotSize: "",
    cameraAngle: "",
    cameraMove: "",
    composition: "",
    lens: "",
    aperture: "",
    shutter: "",
    iso: "",
    sound,
    music: "",
    subtitle: dialogue,
    characters: scene.characters.map((entry) => entry.name).filter(Boolean),
    setting: scene.location,
    references: "",
    canonicalSceneId: "",
    sceneVisualLock: "",
    sceneZone: "",
    sceneAnchors: [],
    visualPrompt: "",
    directorBoardPrompt: "",
    status: "ready",
  };
}

export interface ScriptPackAssetCharacter {
  name: string;
  description: string;
  traits: string;
  prompt: string;
  source: string;
}

/** characters[] → assets.characters[]（§4.1；按 name 精确去重，§7） */
export function mapPackCharacters(characters: ScriptPackCharacter[]): ScriptPackAssetCharacter[] {
  const seen = new Set<string>();
  const mapped: ScriptPackAssetCharacter[] = [];
  for (const character of characters) {
    const name = character.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    mapped.push({
      name,
      description: character.identity,
      traits: character.personality,
      prompt: [character.identity, character.personality, character.goal].filter(Boolean).join("\n"),
      source: "script-pack",
    });
  }
  return mapped;
}

/** 未识别分场时的降级 shot（§7：单集退化为 1 个全文节点） */
export function fallbackWholeEpisodeShot(episode: ScriptPackEpisode): ScriptPackShot {
  return {
    id: "shot-001",
    title: episode.title || `第 ${episode.episode} 集（未分场）`,
    description: "未识别分场，原文已保留在「原文导入」中，可手动拆分。",
    action: "",
    dialogue: "",
    durationSeconds: 2,
    shotSize: "",
    cameraAngle: "",
    cameraMove: "",
    composition: "",
    lens: "",
    aperture: "",
    shutter: "",
    iso: "",
    sound: "",
    music: "",
    subtitle: "",
    characters: [],
    setting: "",
    references: "",
    canonicalSceneId: "",
    sceneVisualLock: "",
    sceneZone: "",
    sceneAnchors: [],
    visualPrompt: "",
    directorBoardPrompt: "",
    status: "ready",
  };
}
