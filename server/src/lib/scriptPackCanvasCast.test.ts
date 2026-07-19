/**
 * 剧本包角色上画布单测（P4-B / P3C-2，契约 §4.2）：
 * 角色列布局、关联边、幂等重建、空角色降级、缺目标节点不建边。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { withScriptPackCastOnCanvas } from "./scriptPackCanvasCast";
import { mapPackCharacters } from "./scriptPack";

const CHARACTERS = mapPackCharacters([
  { name: "杰克·里德", identity: "28岁，爆破手", personality: "吊儿郎当", goal: "买房", raw: "" },
  { name: "休斯顿地面管制员", identity: "NASA 管制员", personality: "专业", goal: "保住舱", raw: "" },
  { name: "克洛伊·怀特", identity: "26岁，地质学家", personality: "冷静", goal: "查明真相", raw: "" },
]);

function syncNodesFixture() {
  return {
    nodes: [
      { id: "episode-sync-ep-001-clip-001", type: "section", position: { x: 120, y: 120 }, data: {} },
      { id: "episode-sync-video-node-ep-001-clip-001", type: "video", position: { x: 740, y: 162 }, data: {} },
      { id: "episode-sync-ep-001-clip-002", type: "section", position: { x: 120, y: 1420 }, data: {} },
      { id: "episode-sync-video-node-ep-001-clip-002", type: "video", position: { x: 740, y: 1462 }, data: {} },
      { id: "user-doodle-1", type: "imageInput", position: { x: 2000, y: 300 }, data: {} }, // 用户节点必须保留
    ],
    edges: [
      { id: "episode-sync-edge-1", source: "episode-sync-ep-001-clip-001", target: "episode-sync-video-node-ep-001-clip-001" },
      { id: "user-edge-1", source: "user-doodle-1", target: "episode-sync-video-node-ep-001-clip-001" },
    ],
  };
}

const SHOTS = [
  { id: "shot-001", characters: [] }, // 1-1 出场人物：无 → 无边
  { id: "shot-002", characters: ["休斯顿地面管制员"] },
  { id: "shot-003", characters: ["杰克·里德", "克洛伊·怀特"] },
];

const CLIPS = [
  { id: "clip-001", title: "Clip 01", shotIds: ["shot-001", "shot-002"] },
  { id: "clip-002", title: "Clip 02", shotIds: ["shot-003"] },
];

function run(input?: Partial<Parameters<typeof withScriptPackCastOnCanvas>[0]>) {
  const fixture = syncNodesFixture();
  return withScriptPackCastOnCanvas({
    nodes: fixture.nodes,
    edges: fixture.edges,
    episodeId: "ep-001",
    episodeTitle: "第 1 集",
    characters: CHARACTERS,
    shots: SHOTS,
    clips: CLIPS,
    ...input,
  });
}

test("adds a cast section + one character node per pack character, left of content", () => {
  const { nodes } = run();
  const section = nodes.find((n) => (n as { id: string }).id === "script-pack-cast-section-ep-001") as {
    type: string; position: { x: number; y: number }; data: Record<string, unknown>;
  };
  assert.ok(section, "cast section exists");
  assert.equal(section.type, "section");
  assert.equal(section.position.x, 120 - 640); // 内容最左列左侧（契约 §4.2）
  assert.equal(section.position.y, 120);
  assert.equal(section.data.itemCount, 3);
  assert.equal(section.data.sectionKind, "script-pack-cast");

  const characterNodes = nodes.filter((n) => (n as { type?: string }).type === "character") as Array<{
    id: string; parentId: string; extent: string; data: Record<string, unknown>;
  }>;
  assert.equal(characterNodes.length, 3);
  for (const node of characterNodes) {
    assert.equal(node.parentId, "script-pack-cast-section-ep-001");
    assert.equal(node.extent, "parent");
    assert.equal(node.data.assetKind, "characters"); // 生成形象图接入既有资产管线
    assert.equal(node.data.sourceEpisodeId, "ep-001");
  }
  const jack = characterNodes.find((n) => n.data.name === "杰克·里德")!;
  assert.equal(jack.data.traits, "吊儿郎当");
  assert.equal(jack.data.finalPrompt, "28岁，爆破手\n吊儿郎当\n买房");
});

test("builds dashed cast edges only for shots with cast, deduped per clip", () => {
  const { edges } = run();
  const castEdges = edges.filter((e) => (e as { id: string }).id.startsWith("script-pack-cast-edge-")) as Array<{
    id: string; source: string; target: string; style: { strokeDasharray?: string };
  }>;
  // shot-001 出场人物：无 → 无边；管制员→clip-001；杰克/克洛伊→clip-002
  assert.equal(castEdges.length, 3);
  assert.ok(castEdges.some((e) => e.target === "episode-sync-video-node-ep-001-clip-001"), "管制员连 clip-001 视频节点");
  assert.equal(castEdges.filter((e) => e.target === "episode-sync-video-node-ep-001-clip-001").length, 1, "shot-001 无出场不重复建边");
  assert.equal(castEdges.filter((e) => e.target === "episode-sync-video-node-ep-001-clip-002").length, 2, "杰克+克洛伊连 clip-002");
  for (const edge of castEdges) assert.ok(edge.style.strokeDasharray, "关联边为虚线");
});

test("keeps user nodes/edges and all sync nodes untouched", () => {
  const { nodes, edges } = run();
  assert.ok(nodes.some((n) => (n as { id: string }).id === "user-doodle-1"));
  assert.ok(edges.some((e) => (e as { id: string }).id === "user-edge-1"));
  assert.ok(nodes.some((n) => (n as { id: string }).id === "episode-sync-video-node-ep-001-clip-001"));
});

test("re-applying is idempotent: old cast nodes/edges are replaced, not duplicated", () => {
  const first = run();
  const second = withScriptPackCastOnCanvas({
    nodes: first.nodes,
    edges: first.edges,
    episodeId: "ep-001",
    episodeTitle: "第 1 集",
    characters: CHARACTERS,
    shots: SHOTS,
    clips: CLIPS,
  });
  const castNodeCount = second.nodes.filter((n) => (n as { id: string }).id.startsWith("script-pack-cast-")).length;
  const castEdgeCount = second.edges.filter((e) => (e as { id: string }).id.startsWith("script-pack-cast-")).length;
  assert.equal(castNodeCount, 4); // 1 section + 3 characters
  assert.equal(castEdgeCount, 3);
  assert.equal(second.nodes.length, first.nodes.length);
  assert.equal(second.edges.length, first.edges.length);
});

test("empty character table still builds a minor-cast column from scene appearances", () => {
  // 包没有人物表时降级：旧角色列被替换为纯次要角色列（全部由场次出场人物推出）。
  const first = run();
  const rebuilt = withScriptPackCastOnCanvas({
    nodes: first.nodes,
    edges: first.edges,
    episodeId: "ep-001",
    characters: [],
    shots: SHOTS,
    clips: CLIPS,
  });
  const characterNodes = rebuilt.nodes.filter((n) => (n as { type?: string }).type === "character") as Array<{
    data: Record<string, unknown>;
  }>;
  assert.equal(characterNodes.length, 3); // 管制员 + 杰克·里德 + 克洛伊·怀特，全部次要角色
  assert.ok(characterNodes.every((n) => n.data.minorCast === true));
  assert.equal(rebuilt.edges.filter((e) => (e as { id: string }).id.startsWith("script-pack-cast-edge-")).length, 3);
  assert.ok(rebuilt.nodes.some((n) => (n as { id: string }).id === "user-doodle-1"));
});

test("empty character table and empty shots only cleans old cast artifacts", () => {
  const first = run();
  const cleaned = withScriptPackCastOnCanvas({
    nodes: first.nodes,
    edges: first.edges,
    episodeId: "ep-001",
    characters: [],
    shots: [],
    clips: CLIPS,
  });
  assert.equal(cleaned.nodes.filter((n) => (n as { id: string }).id.startsWith("script-pack-cast-")).length, 0);
  assert.equal(cleaned.edges.filter((e) => (e as { id: string }).id.startsWith("script-pack-cast-")).length, 0);
  assert.ok(cleaned.nodes.some((n) => (n as { id: string }).id === "user-doodle-1"));
});

test("skips edges whose clip video node does not exist on canvas", () => {
  const fixture = syncNodesFixture();
  fixture.nodes = fixture.nodes.filter((n) => n.id !== "episode-sync-video-node-ep-001-clip-002");
  const { edges } = run({ nodes: fixture.nodes });
  assert.equal(edges.filter((e) => (e as { id: string }).id.startsWith("script-pack-cast-")).length, 1); // 只剩 clip-001 的管制员边
});

test("minor cast appearing in shots but not in pack gets a minimal node and an edge", () => {
  // 契约 §4.3/§8#5：仅在场次出场人物中出现的角色（如"国民警卫队飞行员"）也要建关联边，
  // 因此次要角色同样上节点——minimal 档案，data.minorCast = true。
  const { nodes, edges } = run({
    shots: [{ id: "shot-002", characters: ["临时群演"] }],
    clips: [{ id: "clip-001", title: "Clip 01", shotIds: ["shot-002"] }],
  });
  const characterNodes = nodes.filter((n) => (n as { type?: string }).type === "character") as Array<{
    data: Record<string, unknown>;
  }>;
  assert.equal(characterNodes.length, 4); // 包内 3 人 + 次要角色 1 人
  const minor = characterNodes.find((n) => n.data.name === "临时群演")!;
  assert.equal(minor.data.minorCast, true);
  assert.equal(minor.data.description, "未列入人物表的次要角色（来自本集出场人物）");
  const castEdges = edges.filter((e) => (e as { id: string }).id.startsWith("script-pack-cast-edge-"));
  assert.equal(castEdges.length, 1);
  assert.equal((castEdges[0] as { target: string }).target, "episode-sync-video-node-ep-001-clip-001");
  // 包内角色不被误标
  const jack = characterNodes.find((n) => n.data.name === "杰克·里德")!;
  assert.equal(jack.data.minorCast, undefined);
});

test("cast matching tolerates English-paren suffix in pack names (real 52-集形态)", () => {
  // 人物表条目为"杰克·里德（Jake Reed）"，出场人物行只写"杰克·里德"（P3-A 真实组包形态）
  const { edges } = run({
    characters: mapPackCharacters([
      { name: "杰克·里德（Jake Reed）", identity: "爆破手", personality: "吊儿郎当", goal: "买房", raw: "" },
    ]),
    shots: [{ id: "shot-001", characters: ["杰克·里德"] }],
    clips: [{ id: "clip-001", title: "Clip 01", shotIds: ["shot-001"] }],
  });
  const castEdges = edges.filter((e) => (e as { id: string }).id.startsWith("script-pack-cast-edge-"));
  assert.equal(castEdges.length, 1);
  assert.equal((castEdges[0] as { target: string }).target, "episode-sync-video-node-ep-001-clip-001");
});
