/**
 * 剧本包角色上画布（P4-B / P3C-2，契约 §4.2 形态补齐）。
 *
 * episodeCanvasSync 的产物（section/generation/imageInput/video/audio）之上，
 * 每集画布补一列"角色资产"：character 节点 + 角色→出场 Clip 视频节点的虚线关联边。
 *
 * 共存约定：
 *  - 节点/边 id 统一 `script-pack-cast-` 前缀 + `stableCanvasIdPart`（与 sync 同一 key 体系）；
 *  - 每次导入先按前缀清掉旧的剧本包角色节点/边再重建 → 重复导入幂等、不翻倍；
 *  - sync 的重跑（sync-episode）只清 `episode-sync-*` 节点，不动本列；
 *  - 角色节点带 assetKind/assetName/sourceEpisodeId，「生成形象图」直接接入既有资产管线。
 */
import { stableCanvasIdPart } from "./episodeCanvasSync";
import { isRecord } from "./mappers";
import type { ScriptPackAssetCharacter } from "./scriptPack";

const CAST_ID_PREFIX = "script-pack-cast-";
const CAST_COLUMN_GAP = 640; // 契约 §4.2：角色列放内容第 1 列左侧
const CAST_SECTION_WIDTH = 400;
const CAST_SECTION_HEADER_HEIGHT = 42;
const CAST_SECTION_PADDING_X = 20;
const CAST_SECTION_PADDING_BOTTOM = 20;
const CHARACTER_NODE_WIDTH = 360;
const CHARACTER_NODE_HEIGHT = 560; // 对齐 canvasUtils CANVAS_SINGLE_ASSET_NODE_HEIGHT
const CHARACTER_NODE_GAP_Y = 16;
const DEFAULT_SYNC_START_X = 120;
const DEFAULT_SYNC_START_Y = 120;

export interface ScriptPackCastShot {
  id: string;
  characters: string[];
}

export interface ScriptPackCastClip {
  id?: unknown;
  title?: unknown;
  shotIds?: unknown;
}

interface CanvasNodeLike {
  id: string;
  type?: string;
  position?: { x?: unknown; y?: unknown };
  [key: string]: unknown;
}

interface CanvasEdgeLike {
  id: string;
  source: string;
  target: string;
  [key: string]: unknown;
}

function asNode(value: unknown): CanvasNodeLike | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) return null;
  return value as CanvasNodeLike;
}

function asEdge(value: unknown): CanvasEdgeLike | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.source !== "string" || typeof value.target !== "string") return null;
  return value as CanvasEdgeLike;
}

function nodeX(node: CanvasNodeLike): number {
  const x = isRecord(node.position) ? Number(node.position.x) : NaN;
  return Number.isFinite(x) ? x : DEFAULT_SYNC_START_X;
}

function nodeY(node: CanvasNodeLike): number {
  const y = isRecord(node.position) ? Number(node.position.y) : NaN;
  return Number.isFinite(y) ? y : DEFAULT_SYNC_START_Y;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 出场匹配名归一：人物表条目常带英文括号后缀（"杰克·里德（Jake Reed）"），
 * 而剧本「出场人物」/对白里只用中文名（"杰克·里德"）——建边按去括号后缀的名字匹配。
 */
export function normalizeCastName(name: string): string {
  return name
    .trim()
    .replace(/[（(][^（）()]*[）)]\s*$/, "")
    .trim()
    .toLowerCase();
}

/**
 * 在 sync 产物上叠加剧本包角色列。输入为 buildEpisodeCanvasSyncScene 的 nodes/edges，
 * 输出替换后的 nodes/edges（sync 其余字段不变，由调用方 spread 回 sync result）。
 */
export function withScriptPackCastOnCanvas<N, E>(input: {
  nodes: N[];
  edges: E[];
  episodeId: string;
  episodeTitle?: string;
  characters: ScriptPackAssetCharacter[];
  shots: ScriptPackCastShot[];
  clips: ScriptPackCastClip[];
}): { nodes: N[]; edges: E[] } {
  const episodeKey = stableCanvasIdPart(input.episodeId, "episode");

  // ① 幂等：清掉旧的剧本包角色节点/边（含指向已删节点的边）
  const keptNodes = (Array.isArray(input.nodes) ? input.nodes : []).filter((value) => {
    const node = asNode(value);
    return !node || !node.id.startsWith(CAST_ID_PREFIX);
  });
  const keptNodeIds = new Set(keptNodes.map((value) => asNode(value)?.id).filter(Boolean) as string[]);
  const keptEdges = (Array.isArray(input.edges) ? input.edges : []).filter((value) => {
    const edge = asEdge(value);
    if (!edge) return true;
    if (edge.id.startsWith(CAST_ID_PREFIX)) return false;
    return keptNodeIds.has(edge.source) && keptNodeIds.has(edge.target);
  });

  const packCharacters = input.characters.filter((character) => character.name.trim());

  // ② 出场全集 = 人物表角色（完整档案）∪ 仅在场次出场人物中出现的次要角色（名字档案）。
  // 契约 §4.3 示例明确要求非人物表角色（国民警卫队飞行员）也建关联边，故次要角色同样上节点。
  const knownNames = new Map<string, string>(); // normalizeCastName → charKey
  const displayCharacters: Array<ScriptPackAssetCharacter & { minorCast?: boolean }> = [];
  packCharacters.forEach((character, index) => {
    const normalized = normalizeCastName(character.name);
    if (normalized && !knownNames.has(normalized)) {
      knownNames.set(normalized, stableCanvasIdPart(character.name, `character-${index + 1}`));
      displayCharacters.push(character);
    }
  });
  for (const shot of input.shots) {
    for (const rawName of shot.characters) {
      const name = rawName.trim();
      const normalized = normalizeCastName(name);
      if (!name || !normalized || knownNames.has(normalized)) continue;
      knownNames.set(normalized, stableCanvasIdPart(name, `minor-${knownNames.size + 1}`));
      displayCharacters.push({
        name,
        description: "未列入人物表的次要角色（来自本集出场人物）",
        traits: "",
        prompt: name,
        source: "script-pack-scene-cast",
        minorCast: true,
      });
    }
  }
  if (displayCharacters.length === 0) return { nodes: keptNodes, edges: keptEdges };

  // ③ 布局：角色列 = 内容最左列左侧 640（契约 §4.2），顶部与首行对齐
  const positioned = keptNodes.map(asNode).filter(Boolean) as CanvasNodeLike[];
  const minX = positioned.length > 0 ? Math.min(...positioned.map(nodeX)) : DEFAULT_SYNC_START_X;
  const minY = positioned.length > 0 ? Math.min(...positioned.map(nodeY)) : DEFAULT_SYNC_START_Y;
  const sectionId = `${CAST_ID_PREFIX}section-${episodeKey}`;
  const sectionHeight =
    CAST_SECTION_HEADER_HEIGHT +
    displayCharacters.length * CHARACTER_NODE_HEIGHT +
    Math.max(0, displayCharacters.length - 1) * CHARACTER_NODE_GAP_Y +
    CAST_SECTION_PADDING_BOTTOM;

  const sectionNode = {
    id: sectionId,
    type: "section",
    position: { x: minX - CAST_COLUMN_GAP, y: minY },
    style: { width: CAST_SECTION_WIDTH, height: sectionHeight },
    zIndex: 0,
    data: {
      title: "角色资产",
      description: "剧本包角色 · 虚线连到出场的视频镜头",
      tone: "amber",
      itemCount: displayCharacters.length,
      sourceEpisode: input.episodeTitle || input.episodeId,
      sourceEpisodeId: input.episodeId,
      sectionKind: "script-pack-cast",
      scriptPackCast: true,
    },
  };

  const characterNodes = displayCharacters.map((character, index) => {
    const charKey = knownNames.get(normalizeCastName(character.name)) ?? stableCanvasIdPart(character.name, `character-${index + 1}`);
    return {
      id: `${CAST_ID_PREFIX}node-${episodeKey}-${charKey}`,
      type: "character",
      parentId: sectionId,
      extent: "parent",
      expandParent: false,
      position: {
        x: CAST_SECTION_PADDING_X,
        y: CAST_SECTION_HEADER_HEIGHT + index * (CHARACTER_NODE_HEIGHT + CHARACTER_NODE_GAP_Y),
      },
      style: { width: CHARACTER_NODE_WIDTH, height: CHARACTER_NODE_HEIGHT },
      zIndex: 1,
      data: {
        name: character.name,
        assetName: character.name,
        assetKind: "characters",
        traits: character.traits,
        description: character.description,
        finalPrompt: character.prompt,
        avatar: "",
        ...(character.minorCast ? { minorCast: true } : {}),
        sourceEpisode: input.episodeTitle || input.episodeId,
        sourceEpisodeId: input.episodeId,
        scriptPackCast: true,
      },
    };
  });

  // ④ 关联边：角色 → 出场 shot 所属 Clip 的视频节点（同 Clip 去重；目标节点不存在不建）
  const nodeIds = new Set([...keptNodeIds, sectionNode.id, ...characterNodes.map((node) => node.id)]);
  const shotClipPairs: { charKey: string; clipKey: string }[] = [];
  const seenPair = new Set<string>();

  input.clips.forEach((clip, clipIndex) => {
    const clipKey = stableCanvasIdPart(stringValue(clip.id) || stringValue(clip.title), `clip-${clipIndex + 1}`);
    const shotIds = new Set((Array.isArray(clip.shotIds) ? clip.shotIds : []).map(String));
    if (shotIds.size === 0) return;
    const videoNodeId = `episode-sync-video-node-${episodeKey}-${clipKey}`;
    if (!nodeIds.has(videoNodeId)) return;
    for (const shot of input.shots) {
      if (!shotIds.has(shot.id)) continue;
      for (const name of shot.characters) {
        const charKey = knownNames.get(normalizeCastName(name));
        if (!charKey) continue;
        const pairKey = `${charKey}→${clipKey}`;
        if (seenPair.has(pairKey)) continue;
        seenPair.add(pairKey);
        shotClipPairs.push({ charKey, clipKey });
      }
    }
  });

  const castEdges = shotClipPairs.map(({ charKey, clipKey }) => ({
    id: `${CAST_ID_PREFIX}edge-${episodeKey}-${charKey}-${clipKey}`,
    source: `${CAST_ID_PREFIX}node-${episodeKey}-${charKey}`,
    target: `episode-sync-video-node-${episodeKey}-${clipKey}`,
    type: "smoothstep",
    animated: false,
    style: { strokeDasharray: "6 4", stroke: "#F5A623", strokeWidth: 1.5, opacity: 0.75 },
    data: { scriptPackCast: true, relation: "cast-appearance" },
  }));

  return {
    nodes: [...keptNodes, sectionNode, ...characterNodes] as N[],
    edges: [...keptEdges, ...castEdges] as E[],
  };
}
