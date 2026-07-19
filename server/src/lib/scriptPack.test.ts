/**
 * scriptPack 纯逻辑单测（P3-B，《P0-剧本包格式v1契约》）：
 * schema 校验 / 版本分派 / §3 分场解析 / §4.1 映射 / 平台拉取错误映射。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  episodeIdForPack,
  estimateSceneDurationSeconds,
  fallbackWholeEpisodeShot,
  fetchScriptPack,
  listScriptPacks,
  mapPackCharacters,
  parseScenesFromScript,
  parseScriptPack,
  sceneToShot,
  scenesForEpisode,
  type ScriptPackEpisode,
} from "./scriptPack";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function samplePack(overrides: Record<string, unknown> = {}) {
  return {
    format: "chaiju-script-pack/1",
    name: "沙海陨猎",
    expectedEpisodes: 2,
    incomplete: false,
    settings: "# 《沙海陨猎》新剧完整设定文档\n……",
    outline: "## 第1集（开篇）\n- 剧情：……",
    characters: [
      { name: "杰克·里德", identity: "28岁，前海军陆战队爆破手", personality: "吊儿郎当爱讲冷笑话", goal: "攒钱买房", raw: "原文块" },
      { name: "杰克·里德", identity: "重复条目应去重", personality: "", goal: "", raw: "" },
      { name: "克洛伊·怀特", identity: "26岁，地质学家", personality: "冷静", goal: "查明真相", raw: "" },
    ],
    episodes: [
      {
        episode: 1,
        title: "开篇太空设施爆炸",
        summary: "2024年近地轨道……",
        hook: "沙层下传来蠕动声……",
        payoff: "好莱坞级灾难大场面",
        script: "1-1  日  外  近地轨道\n出场人物：无\n▲ 漆黑的真空宇宙里……",
        scenes: [
          {
            id: "1-1",
            episode: 1,
            number: 1,
            time: "日",
            placeType: "外",
            location: "近地轨道",
            characters: [],
            actions: ["漆黑的真空宇宙里，蓝白相间的地球缓缓自转……"],
            dialogues: [],
            effects: [{ kind: "特效", text: "沙面涟漪扩散" }],
            raw: "1-1  日  外  近地轨道\n……",
          },
          {
            id: "1-2",
            episode: 1,
            number: 2,
            time: "日",
            placeType: "内",
            location: "猎户座7号载荷舱",
            characters: [{ name: "休斯顿地面管制员", note: "vo" }],
            actions: [],
            dialogues: [{ speaker: "休斯顿地面管制员", note: "vo，带着严重的电流杂音", text: "猎户座7号，这里是休斯顿……" }],
            effects: [],
            raw: "",
          },
        ],
      },
      {
        episode: 2,
        title: "坠落",
        script: "2-1  夜  外  索诺兰沙漠\n出场人物：杰克\n▲ 沙暴逼近。",
      },
    ],
    generator: { app: "chaiju-helper", version: "0.1.0", exportedAt: "2026-07-19T12:00:00+08:00" },
    unknownFutureField: { anything: true }, // §6：未知字段必须容忍
    ...overrides,
  };
}

// --- parseScriptPack：schema + 版本分派（§6） ---

test("parseScriptPack accepts a valid pack and tolerates unknown fields", () => {
  const pack = parseScriptPack(samplePack());
  assert.equal(pack.name, "沙海陨猎");
  assert.equal(pack.episodes.length, 2);
  assert.equal(pack.characters.length, 3);
  assert.equal(pack.episodes[0].scenes?.length, 2);
});

test("parseScriptPack rejects unknown major version with clear message", () => {
  assert.throws(
    () => parseScriptPack(samplePack({ format: "chaiju-script-pack/99" })),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 400);
      assert.match((error as Error).message, /不支持的剧本包版本：chaiju-script-pack\/99/);
      return true;
    },
  );
});

test("parseScriptPack rejects malformed format string", () => {
  assert.throws(
    () => parseScriptPack(samplePack({ format: "not-a-pack" })),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 400);
      assert.match((error as Error).message, /不是有效的剧本包格式/);
      return true;
    },
  );
});

test("parseScriptPack rejects pack without episodes", () => {
  assert.throws(
    () => parseScriptPack(samplePack({ episodes: [] })),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 400);
      assert.match((error as Error).message, /剧本包校验失败/);
      return true;
    },
  );
});

test("parseScriptPack tolerates missing optional fields (characters/outline/title)", () => {
  const pack = parseScriptPack({
    format: "chaiju-script-pack/1",
    name: "裸包",
    episodes: [{ episode: 3, script: "3-1  日  内  舱内\n▲ 灯亮。" }],
  });
  assert.equal(pack.characters.length, 0);
  assert.equal(pack.outline, "");
  assert.equal(pack.episodes[0].title, "");
  assert.equal(pack.incomplete, false);
});

// --- §3 分场解析 ---

const SAMPLE_SCRIPT = [
  "第1集 开篇", // 场头之前的内容丢弃
  "",
  "1-1  日  外  近地轨道",
  "出场人物：无",
  "▲ 漆黑的真空宇宙里，蓝白相间的地球缓缓自转。",
  "▲ 【音效：滋滋啦啦的电流爆音】舱壁夹缝里窜出电火花。",
  "【特效：镜头猛地切黑】",
  "",
  "1-2  日  内  猎户座7号载荷舱",
  "出场人物：休斯顿地面管制员(vo)、杰克·里德",
  "休斯顿地面管制员(vo，带着严重的电流杂音)：猎户座7号，这里是休斯顿。",
  "杰克·里德：收到，正在检查。",
  "无法归类的旁白行",
  "",
  "2-1  夜  外  沙漠", // 集号不符 → warning
  "▲ 沙暴。",
  "1-5  日  外  营地", // 场号跳跃 → warning
  "▲ 休整。",
].join("\n");

test("parseScenesFromScript parses headers/cast/actions/effects/dialogues", () => {
  const { scenes, warnings } = parseScenesFromScript(SAMPLE_SCRIPT, 1);
  assert.equal(scenes.length, 4);

  const s1 = scenes[0];
  assert.equal(s1.id, "1-1");
  assert.equal(s1.time, "日");
  assert.equal(s1.placeType, "外");
  assert.equal(s1.location, "近地轨道");
  assert.deepEqual(s1.characters, []); // 出场人物：无 → 空
  assert.equal(s1.actions.length, 2);
  assert.deepEqual(
    s1.effects.map((e) => `${e.kind}:${e.text}`),
    ["音效:滋滋啦啦的电流爆音", "特效:镜头猛地切黑"],
  );
  assert.ok(s1.raw.includes("1-1  日  外  近地轨道"));

  const s2 = scenes[1];
  assert.deepEqual(
    s2.characters.map((c) => `${c.name}(${c.note})`),
    ["休斯顿地面管制员(vo)", "杰克·里德()"],
  );
  assert.equal(s2.dialogues.length, 2);
  assert.equal(s2.dialogues[0].speaker, "休斯顿地面管制员");
  assert.equal(s2.dialogues[0].note, "vo，带着严重的电流杂音");
  assert.equal(s2.dialogues[1].speaker, "杰克·里德");
  assert.ok(s2.actions.includes("无法归类的旁白行")); // 兜底按动作处理

  assert.ok(warnings.some((w) => w.includes("集号"))); // 2-1 集号不符
  assert.ok(warnings.some((w) => w.includes("场号不连续"))); // 跳到 1-5
});

test("parseScenesFromScript drops content before the first header", () => {
  const { scenes } = parseScenesFromScript("标题行\n一些说明\n1-1  日  内  房间\n▲ 开始。", 1);
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].actions.join(""), "开始。");
});

test("scenesForEpisode prefers pack-provided scenes and falls back to parsing", () => {
  const pack = parseScriptPack(samplePack());
  const withScenes = scenesForEpisode(pack.episodes[0]);
  assert.equal(withScenes.scenes.length, 2);
  assert.equal(withScenes.warnings.length, 0);

  const parsed = scenesForEpisode(pack.episodes[1]); // 无 scenes → 现算
  assert.equal(parsed.scenes.length, 1);
  assert.equal(parsed.scenes[0].location, "索诺兰沙漠");

  const empty: ScriptPackEpisode = { episode: 5, title: "", summary: "", hook: "", payoff: "", script: "没有场头的散文……", originalScript: undefined, scenes: undefined };
  const degraded = scenesForEpisode(empty);
  assert.equal(degraded.scenes.length, 0);
  assert.ok(degraded.warnings.some((w) => w.includes("未识别分场")));
});

// --- §4.1 映射 ---

test("episodeIdForPack formats ep-{NNN}", () => {
  assert.equal(episodeIdForPack(1), "ep-001");
  assert.equal(episodeIdForPack(12), "ep-012");
  assert.equal(episodeIdForPack(123), "ep-123");
});

test("estimateSceneDurationSeconds clamps to [2, 15] at 4.5 chars/sec", () => {
  assert.equal(estimateSceneDurationSeconds({ dialogues: [] }), 2);
  assert.equal(estimateSceneDurationSeconds({ dialogues: [{ speaker: "a", note: "", text: "一二三四五六七八九" }] }), 2); // 9 字 → 2
  assert.equal(estimateSceneDurationSeconds({ dialogues: [{ speaker: "a", note: "", text: "x".repeat(45) }] }), 10);
  assert.equal(estimateSceneDurationSeconds({ dialogues: [{ speaker: "a", note: "", text: "x".repeat(1000) }] }), 15);
});

test("sceneToShot maps scene fields per contract §4.1", () => {
  const pack = parseScriptPack(samplePack());
  const scene = pack.episodes[0].scenes![1]; // 1-2 载荷舱
  const shot = sceneToShot(scene, 1);
  assert.equal(shot.id, "shot-002");
  assert.equal(shot.title, "1-2 日 内 猎户座7号载荷舱");
  assert.equal(shot.setting, "猎户座7号载荷舱");
  assert.deepEqual(shot.characters, ["休斯顿地面管制员"]);
  assert.equal(shot.dialogue, "休斯顿地面管制员（vo，带着严重的电流杂音）：猎户座7号，这里是休斯顿……");
  assert.equal(shot.subtitle, shot.dialogue);
  assert.equal(shot.status, "ready");
  // 专业镜头字段留空（契约坑 #2：别硬编，读时 enrich 补）
  assert.equal(shot.shotSize, "");
  assert.equal(shot.cameraAngle, "");
  assert.equal(shot.sceneAnchors.length, 0);

  const first = sceneToShot(pack.episodes[0].scenes![0], 0);
  assert.equal(first.title, "1-1 日 外 近地轨道");
  assert.equal(first.action, "漆黑的真空宇宙里，蓝白相间的地球缓缓自转……");
  assert.equal(first.sound, "特效：沙面涟漪扩散");
});

test("mapPackCharacters maps and dedupes by exact name", () => {
  const pack = parseScriptPack(samplePack());
  const characters = mapPackCharacters(pack.characters);
  assert.equal(characters.length, 2); // 重复的"杰克·里德"去重
  const jack = characters[0];
  assert.equal(jack.name, "杰克·里德");
  assert.equal(jack.description, "28岁，前海军陆战队爆破手");
  assert.equal(jack.traits, "吊儿郎当爱讲冷笑话");
  assert.equal(jack.prompt, "28岁，前海军陆战队爆破手\n吊儿郎当爱讲冷笑话\n攒钱买房");
  assert.equal(jack.source, "script-pack");
});

test("fallbackWholeEpisodeShot produces a single whole-text node shot", () => {
  const shot = fallbackWholeEpisodeShot({ episode: 4, title: "", summary: "", hook: "", payoff: "", script: "……", originalScript: undefined, scenes: undefined });
  assert.equal(shot.id, "shot-001");
  assert.match(shot.title, /第 4 集/);
  assert.match(shot.description, /未识别分场/);
  assert.equal(shot.status, "ready");
});

// --- 平台拉取（mock fetchImpl） ---

test("fetchScriptPack returns parsed JSON on success", async () => {
  const pack = samplePack();
  const result = await fetchScriptPack("sp_1", "token", async (url, init) => {
    assert.match(url, /\/v1\/library\/script-packs\/sp_1$/);
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer token");
    return jsonResponse(200, pack);
  });
  assert.equal((result as { name: string }).name, "沙海陨猎");
});

test("fetchScriptPack maps 401/404/network errors", async () => {
  await assert.rejects(fetchScriptPack("sp_1", "token", async () => jsonResponse(401, {})), (error: unknown) => {
    assert.equal((error as { status?: number }).status, 401);
    return true;
  });
  await assert.rejects(fetchScriptPack("sp_1", "token", async () => jsonResponse(404, {})), (error: unknown) => {
    assert.equal((error as { status?: number }).status, 404);
    return true;
  });
  await assert.rejects(
    fetchScriptPack("sp_1", "token", async () => {
      throw new Error("ECONNREFUSED");
    }),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 503);
      return true;
    },
  );
  await assert.rejects(fetchScriptPack("sp_1", "token", async () => jsonResponse(500, {})), (error: unknown) => {
    assert.equal((error as { status?: number }).status, 503);
    return true;
  });
});

test("fetchScriptPack rejects packs over 10MB", async () => {
  const big = `"${"x".repeat(10 * 1024 * 1024 + 16)}"`;
  await assert.rejects(fetchScriptPack("sp_big", "token", async () => new Response(big, { status: 200 })), (error: unknown) => {
    assert.equal((error as { status?: number }).status, 413);
    return true;
  });
});

test("listScriptPacks maps the platform items shape", async () => {
  const items = await listScriptPacks("token", async () =>
    jsonResponse(200, {
      items: [
        { id: "sp_1", name: "沙海陨猎", episodeCount: 3, expectedEpisodes: 52, incomplete: true, sizeBytes: 1024, createdAt: "2026-07-19" },
        { id: "", name: "坏条目" }, // 缺 id 被过滤
      ],
    }),
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "sp_1");
  assert.equal(items[0].episodeCount, 3);
  assert.equal(items[0].incomplete, true);
});
