# Seedance 多参提示词缺陷修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Seedance 多参视频提示词的 5 个缺陷（垃圾尾巴、模式指令混入、台词截断/说话人丢失/碎句、节拍复读、镜头节奏），并部署 + 批量重算存量 Clip。

**Architecture:** 全部在提示词组装层（确定性代码）：新建台词分配器纯函数库；修改 `workflows.ts` 的节拍构造与 `composeSeedancePrompt` 模板；同步修复前后端本地兜底构建器。规格见 `docs/superpowers/specs/2026-06-12-seedance-prompt-fixes-design.md`。

**Tech Stack:** TypeScript, Express 5, node:test（运行 `npx tsx --test <file>`）

**仓库铁律（每个任务都适用）：**
- **禁止 `git add` / `git commit`**——工作区有另一项进行中的未提交重构，本计划只改工作区。每个任务的"提交"步骤替换为"验证步骤"。
- `server/src/routes/workflows.ts`、`src/app/pages/ProjectCanvasPage.tsx`、`src/app/features/canvas/canvasUtils.tsx` 都有他人在途改动：只做最小插入/替换，绝不重排既有代码。
- 不碰 `src/app/features/canvas/canvasHelpers.ts`（无引用副本）。
- 行号是写计划时的快照，可能漂移 ±10 行，以函数名定位为准。

---

## 文件结构

| 文件 | 职责 | 改动 |
|------|------|------|
| `server/src/lib/clipDialogueAllocator.ts` | 台词分配纯函数（说话人补全、碎句合并、逐字校验） | 新建 |
| `server/src/lib/clipDialogueAllocator.test.ts` | 分配器单测 | 新建 |
| `server/src/routes/workflows.ts` | 节拍构造、`composeSeedancePrompt` 模板、镜头节奏常量、LLM 时长文案、testInternals 导出 | 修改 |
| `server/src/routes/workflows.test.ts` | 追加模板测试（不覆盖既有 12 个） | 修改 |
| `server/src/lib/episodeCanvasSync.ts` | 本地兜底构建器 `buildLocalClipVideoPrompt` | 修改 |
| `src/app/features/canvas/canvasUtils.tsx` | 前端镜像 `buildLocalClipVideoPrompt`（1704 行） | 修改 |

---

### Task 1: 台词分配器（`clipDialogueAllocator.ts`）

**Files:**
- Create: `server/src/lib/clipDialogueAllocator.ts`
- Create: `server/src/lib/clipDialogueAllocator.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `server/src/lib/clipDialogueAllocator.test.ts`：

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateClipDialogueToBeats,
  restoreMissingDialogueFragments,
} from "./clipDialogueAllocator";

test("single-character shot without prefix gets speaker prefix", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "Murder! Cold-blooded murder!", characters: ["Flora"] },
  ]);
  assert.deepEqual(result.beats, [["Flora: Murder! Cold-blooded murder!"]]);
  assert.equal(result.restoredCount, 0);
});

test("existing speaker prefix is preserved", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "Chloe: Lady, I just saved your life.", characters: ["Chloe", "Flora"] },
  ]);
  assert.deepEqual(result.beats, [["Chloe: Lady, I just saved your life."]]);
});

test("multi-character shot without prefix keeps raw text without guessing", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "What was that noise?", characters: ["Bob", "Leo"] },
  ]);
  assert.deepEqual(result.beats, [["What was that noise?"]]);
});

test("fragmented sentence merges into the starting beat", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "Chloe: Well, if you'd rather go breathe", characters: ["Chloe", "Flora"] },
    { dialogue: "with that pile of rot, I'm happy to toss you outside.", characters: ["Chloe", "Flora"] },
  ]);
  assert.deepEqual(result.beats, [
    ["Chloe: Well, if you'd rather go breathe with that pile of rot, I'm happy to toss you outside."],
    [],
  ]);
  assert.equal(result.restoredCount, 0);
});

test("a different speaker stops fragment merging", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "Flora: How could you", characters: ["Flora", "Chloe"] },
    { dialogue: "Chloe: Easily.", characters: ["Chloe"] },
  ]);
  assert.deepEqual(result.beats, [["Flora: How could you"], ["Chloe: Easily."]]);
});

test("multiple speakers inside one shot split into separate lines", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "Chloe: Run. Bob: Where?!", characters: ["Chloe", "Bob"] },
  ]);
  assert.deepEqual(result.beats, [["Chloe: Run.", "Bob: Where?!"]]);
});

test("empty dialogue yields empty beats", () => {
  const result = allocateClipDialogueToBeats([{ dialogue: "", characters: ["A"] }]);
  assert.deepEqual(result.beats, [[]]);
  assert.equal(result.restoredCount, 0);
});

test("Chinese dialogue with Chinese colon prefix works", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "弗洛拉：谋杀！这是冷血的谋杀！", characters: ["弗洛拉", "克洛伊"] },
  ]);
  assert.deepEqual(result.beats, [["弗洛拉: 谋杀！这是冷血的谋杀！"]]);
});

test("restoreMissingDialogueFragments appends unmatched source lines to their own beat", () => {
  const beats: string[][] = [[], []];
  const restored = restoreMissingDialogueFragments(
    [
      { dialogue: "Flora: Murder!", characters: ["Flora"] },
      { dialogue: "", characters: [] },
    ],
    beats,
  );
  assert.equal(restored, 1);
  assert.deepEqual(beats, [["Flora: Murder!"], []]);
});

test("input shots array is not mutated", () => {
  const shots = [{ dialogue: "Chloe: Hi.", characters: ["Chloe"] }];
  const snapshot = JSON.stringify(shots);
  allocateClipDialogueToBeats(shots);
  assert.equal(JSON.stringify(shots), snapshot);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /projects/loohii && npx tsx --test server/src/lib/clipDialogueAllocator.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

创建 `server/src/lib/clipDialogueAllocator.ts`：

```typescript
export type ClipShotDialogueInput = {
  /** 镜头原始台词：可能被上游切成半句、可能带 "Speaker:" 前缀、可能为空 */
  dialogue: string;
  /** 该镜头出场角色名 */
  characters: string[];
};

export type ClipDialogueAllocation = {
  /** 下标 = 镜头/节拍索引；每项为该节拍的台词行（已补说话人、已合并碎句） */
  beats: string[][];
  /** 逐字校验后补回的台词条数 */
  restoredCount: number;
};

type DialogueFragment = {
  shotIndex: number;
  speaker: string;
  text: string;
};

const SPEAKER_SPLIT_PATTERN = /\s+(?=[A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}\s*[:：])|(?<=[。！？.!?])\s*(?=[一-龥·]{1,12}[:：])/g;
const SPEAKER_PREFIX_PATTERN = /^\s*([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}|[一-龥·]{1,12})\s*[:：]\s*(\S[\s\S]*)$/;
const SENTENCE_END_PATTERN = /[.!?。！？…]["'”’」』)]*\s*$/;

export function allocateClipDialogueToBeats(shots: ClipShotDialogueInput[]): ClipDialogueAllocation {
  const beats: string[][] = shots.map(() => []);
  const fragments = shots.flatMap((shot, shotIndex) => splitShotDialogue(shot, shotIndex));
  let pending: DialogueFragment | null = null;

  const flush = (fragment: DialogueFragment) => {
    const line = fragment.speaker ? `${fragment.speaker}: ${fragment.text}` : fragment.text;
    beats[fragment.shotIndex]?.push(line.replace(/\s+/g, " ").trim());
  };

  for (const fragment of fragments) {
    if (pending && canContinue(pending, fragment)) {
      pending = { ...pending, text: `${pending.text} ${fragment.text}` };
    } else {
      if (pending) flush(pending);
      pending = fragment;
    }
    if (SENTENCE_END_PATTERN.test(pending.text.trim())) {
      flush(pending);
      pending = null;
    }
  }
  if (pending) flush(pending);

  const restoredCount = restoreMissingDialogueFragments(shots, beats);
  return { beats, restoredCount };
}

/** 逐字校验：每条源台词必须出现在输出里，缺失的补回所属节拍。返回补回条数。 */
export function restoreMissingDialogueFragments(shots: ClipShotDialogueInput[], beats: string[][]): number {
  const joined = normalizeDialogueKey(beats.flat().join(" "));
  let restored = 0;
  shots.forEach((shot, shotIndex) => {
    for (const fragment of splitShotDialogue(shot, shotIndex)) {
      const key = normalizeDialogueKey(fragment.text);
      if (!key || joined.includes(key)) continue;
      const line = fragment.speaker ? `${fragment.speaker}: ${fragment.text}` : fragment.text;
      beats[shotIndex]?.push(line.replace(/\s+/g, " ").trim());
      restored += 1;
    }
  });
  return restored;
}

function splitShotDialogue(shot: ClipShotDialogueInput, shotIndex: number): DialogueFragment[] {
  const raw = (shot.dialogue || "").replace(/\s+/g, " ").trim();
  if (!raw) return [];
  const inferredSpeaker = shot.characters.length === 1 ? shot.characters[0].trim() : "";
  return raw
    .split(SPEAKER_SPLIT_PATTERN)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      const match = piece.match(SPEAKER_PREFIX_PATTERN);
      if (match) return { shotIndex, speaker: match[1].trim(), text: match[2].trim() };
      return { shotIndex, speaker: inferredSpeaker, text: piece };
    });
}

/** 半句延续条件：上一片段未以句末标点结束，且说话人相同或后续片段无说话人标注。 */
function canContinue(pending: DialogueFragment, next: DialogueFragment): boolean {
  if (SENTENCE_END_PATTERN.test(pending.text.trim())) return false;
  if (!next.speaker) return true;
  return normalizeDialogueKey(next.speaker) === normalizeDialogueKey(pending.speaker);
}

function normalizeDialogueKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/["'“”‘’「」『』]/g, "")
    .replace(/[\s.,!?;:，。！？；：/\\-]+/g, " ")
    .trim();
}
```

注意：`splitShotDialogue` 里无前缀片段也带上 `inferredSpeaker`，但 `canContinue` 用的是**标注前缀**判断——所以实现时把"是否原文标注"区分开：`match` 命中才算有标注。上面代码已满足：无标注片段的 `speaker` 是推断值，但合并判断只需"同名或空"，推断值与 pending 同名时合并依然正确（同一镜头序列单角色场景）；测试 4 覆盖（第二个镜头双角色 → `inferredSpeaker` 为空 → 无条件延续）。

- [ ] **Step 4: 运行确认全绿**

Run: `npx tsx --test server/src/lib/clipDialogueAllocator.test.ts`
Expected: 10 tests, 10 pass。若 lookbehind 正则报错（不会，Node 22 支持），改用手动扫描分割。

- [ ] **Step 5: 类型检查（替代提交步骤）**

Run: `npm run server:check`
Expected: 无错误。**不要 git commit。**

---

### Task 2: workflows.ts 节拍与模板修复（D1 / D2 / D4 / D3 接线）

**Files:**
- Modify: `server/src/routes/workflows.ts` — `ClipVideoStoryboardBeat`（:342）、`buildShotOrderVideoBeats`（:5702）、`formatStoryboardVideoBeats`（:5721）、`cleanStoryboardPanelText`（:5693）、`composeSeedancePrompt`（:5431）、`workflowsTestInternals`（:8254）
- Modify: `server/src/routes/workflows.test.ts`（只追加）

- [ ] **Step 1: 写失败测试（追加到 workflows.test.ts 末尾）**

```typescript
import { workflowsTestInternals as internals } from "./workflows";

const sampleShots = [
  {
    id: "s1", title: "Blast", description: "Chloe fires.", action: "Chloe fires. The zombie bursts.",
    dialogue: "Murder! Cold-blooded murder!", durationSeconds: 3,
    shotSize: "medium shot", cameraAngle: "eye level", cameraMove: "handheld", composition: "", lens: "50mm",
    aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
    characters: ["Flora"], setting: "Underground Loading Dock", references: "",
  },
  {
    id: "s2", title: "Rack", description: "Flora points.", action: "Flora points, hands shaking.",
    dialogue: "Chloe: Lady, I just saved your life.", durationSeconds: 3,
    shotSize: "close-up", cameraAngle: "eye level", cameraMove: "static", composition: "", lens: "85mm",
    aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
    characters: ["Flora", "Chloe"], setting: "Underground Loading Dock", references: "",
  },
  {
    id: "s3", title: "Rack2", description: "Flora points.", action: "Flora points, hands shaking.",
    dialogue: "Chloe: Well, if you'd rather go breathe", durationSeconds: 2,
    shotSize: "close-up", cameraAngle: "over shoulder", cameraMove: "static", composition: "", lens: "85mm",
    aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
    characters: ["Flora", "Chloe"], setting: "Underground Loading Dock", references: "",
  },
  {
    id: "s4", title: "Rack3", description: "Flora points.", action: "Flora points, hands shaking.",
    dialogue: "with that pile of rot, I'm happy to toss you outside.", durationSeconds: 2,
    shotSize: "close-up", cameraAngle: "eye level", cameraMove: "static", composition: "", lens: "85mm",
    aperture: "", shutter: "", iso: "", sound: "", music: "", subtitle: "",
    characters: ["Flora", "Chloe"], setting: "Underground Loading Dock", references: "",
  },
] as any[];

test("shot-order beats carry dialogue separately and leave no dialogue/reaction label", () => {
  const beats = internals.buildShotOrderVideoBeats(sampleShots);
  const formatted = internals.formatStoryboardVideoBeats(beats);
  assert.equal(formatted.length, 4);
  assert.doesNotMatch(formatted.join("\n"), /dialogue\/reaction/i);
  assert.doesNotMatch(formatted.join("\n"), /;\s*dialogue\s*;\s*reaction/i);
  assert.match(formatted[0], /^S1: dialogue Flora: Murder! Cold-blooded murder!/);
});

test("fragmented dialogue merges into the beat where the sentence starts", () => {
  const beats = internals.buildShotOrderVideoBeats(sampleShots);
  assert.match(beats[2].dialogue ?? "", /Chloe: Well, if you'd rather go breathe with that pile of rot, I'm happy to toss you outside\./);
  assert.equal(beats[3].dialogue ?? "", "");
});

test("repeated adjacent action text is not repeated in formatted beats", () => {
  const beats = internals.buildShotOrderVideoBeats(sampleShots);
  const formatted = internals.formatStoryboardVideoBeats(beats);
  const repeats = formatted.filter((line) => /Flora points, hands shaking\./.test(line));
  assert.equal(repeats.length, 1);
});

test("composeSeedancePrompt with S beats omits storyboard-image and P-beat instructions", () => {
  const beats = internals.buildShotOrderVideoBeats(sampleShots);
  const prompt = internals.composeSeedancePrompt({
    estimatedDuration: 10, aspectRatio: "9:16", visualStyle: "dark comedy",
    characterIdentities: {}, setting: "Underground Loading Dock",
    characters: ["Chloe", "Flora"], plotGoal: "Chloe blasts the zombie.",
    startState: "Chloe fires", endState: "Chloe racks the shotgun",
    actions: [], dialogue: [], storyboardBeats: beats,
    layoutMemory: "", storyboardControlLevel: "hard", storyboardType: "multi_panel",
    directorFreedom: "",
  });
  assert.doesNotMatch(prompt, /storyboard image/i);
  assert.doesNotMatch(prompt, /animate P1 first/i);
  assert.match(prompt, /Do not skip, merge, or reorder the shot beats; play S1 first, then S2/);
  assert.match(prompt, /Shot beats, follow in this exact order:/);
});

test("composeSeedancePrompt with P beats keeps storyboard instructions", () => {
  const prompt = internals.composeSeedancePrompt({
    estimatedDuration: 10, aspectRatio: "16:9", visualStyle: "dark comedy",
    characterIdentities: {}, setting: "dock", characters: ["Chloe"], plotGoal: "goal",
    startState: "", endState: "", actions: [], dialogue: [],
    storyboardBeats: [{ label: "P1", text: "Chloe fires." }, { label: "P2", text: "Flora reacts." }],
    layoutMemory: "", storyboardControlLevel: "hard", storyboardType: "multi_panel",
    directorFreedom: "",
  });
  assert.match(prompt, /Use the connected storyboard image as the main visual reference/);
  assert.match(prompt, /animate P1 first, then P2/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx tsx --test server/src/routes/workflows.test.ts`
Expected: 新增 5 个失败（internals 缺导出 / 行为未实现），既有 12 个仍 pass。

- [ ] **Step 3: 实现**

3a. `ClipVideoStoryboardBeat`（:342）加两个可选字段：

```typescript
type ClipVideoStoryboardBeat = {
  label: string;
  text: string;
  dialogue?: string;
  camera?: string;
  action?: string;
};
```

3b. 顶部 import 区加：

```typescript
import { allocateClipDialogueToBeats } from "../lib/clipDialogueAllocator";
```

3c. 整体替换 `buildShotOrderVideoBeats`（:5702-5719）：

```typescript
function buildShotOrderVideoBeats(shots: NormalizedStoryboardShot[]): ClipVideoStoryboardBeat[] {
  const allocation = allocateClipDialogueToBeats(
    shots.map((shot) => ({ dialogue: shot.dialogue || "", characters: shot.characters || [] })),
  );
  return shots
    .map((shot, index) => {
      const camera = [shot.shotSize, shot.cameraAngle, shot.cameraMove, shot.lens].filter(Boolean).join(", ");
      const action = cleanVideoBeat(shot.action || shot.description || shot.visualPrompt || "");
      const dialogue = cleanVideoDialogue(allocation.beats[index]?.join(" ") ?? "");
      return {
        label: `S${index + 1}`,
        camera,
        action,
        text: [camera ? `camera ${camera}` : "", action].filter(Boolean).join("; "),
        dialogue,
      };
    })
    .filter((beat) => beat.text || beat.dialogue)
    .slice(0, MAX_CLIP_STORYBOARD_PANEL_COUNT);
}
```

注意 `NormalizedStoryboardShot` 没有 `visualPrompt` 字段——保留原实现的取值链时去掉它（原实现 :5706 用了 `shot.visualPrompt`，TS 能过是因为类型上确实有则保留；以 `server:check` 为准）。

3d. 整体替换 `formatStoryboardVideoBeats`（:5721-5732）：

```typescript
function formatStoryboardVideoBeats(beats: ClipVideoStoryboardBeat[]): string[] {
  let previousActionKey = "";
  return beats
    .map((beat) => {
      const label = beat.label || "Beat";
      const dialogue = cleanVideoDialogue(beat.dialogue || "");
      const dialoguePrefix = dialogue ? `dialogue ${dialogue}; ` : "";
      let core: string;
      if (beat.camera !== undefined || beat.action !== undefined) {
        const actionKey = normalizeCompareText(beat.action || "");
        const repeatedAction = Boolean(actionKey) && actionKey === previousActionKey;
        if (actionKey) previousActionKey = actionKey;
        core = [beat.camera ? `camera ${beat.camera}` : "", repeatedAction ? "" : beat.action || ""]
          .filter(Boolean)
          .join("; ");
      } else {
        previousActionKey = "";
        core = cleanVideoLine(cleanStoryboardPanelText(removeVideoDialogueFragments(beat.text, dialogue)));
      }
      const text = cleanVideoLine(`${dialoguePrefix}${core}`.trim());
      return text ? `${label}: ${text}` : "";
    })
    .filter(Boolean);
}
```

3e. `cleanStoryboardPanelText`（:5693）第一个 replace 之前插入一行（防御性剥除标签残留，覆盖 P 面板路径）：

```typescript
    .replace(/\bdialogue\s*\/\s*reaction\b/gi, "")
```

3f. `composeSeedancePrompt`（:5431）三处修改：

函数体开头 `orderedStoryboardBeats` 之后加：

```typescript
  const panelBeatMode = (input.storyboardBeats ?? []).some((beat) => /^P\d+$/i.test(beat.label || ""));
```

`beatBlock`（:5453-5457）的 header 改为按 `panelBeatMode` 区分：

```typescript
  const beatBlock = orderedStoryboardBeats.length
    ? `${panelBeatMode ? "Storyboard beats" : "Shot beats"}, follow in this exact order:\n${orderedStoryboardBeats.join("\n")}`
    : beats.length
      ? `Shot beats, follow in this exact order:\n${beats.join("\n")}`
      : "";
```

分镜图行（:5464）与顺序指令行（:5467）替换为：

```typescript
    panelBeatMode
      ? "Use the connected storyboard image as the main visual reference; turn its story beats into natural motion, not comic panels."
      : "Turn the shot beats into natural continuous motion, using the connected character and scene reference images for identity.",
```

```typescript
    orderedStoryboardBeats.length
      ? panelBeatMode
        ? "Do not skip, merge, or reorder the P beats; animate P1 first, then P2, then P3, continuing through the listed storyboard panels."
        : "Do not skip, merge, or reorder the shot beats; play S1 first, then S2, continuing in order."
      : "",
```

3g. `workflowsTestInternals`（:8254）追加导出（按字母序插入）：

```typescript
  buildShotOrderVideoBeats,
  composeSeedancePrompt,
  formatStoryboardVideoBeats,
```

- [ ] **Step 4: 运行确认全绿**

Run: `npx tsx --test server/src/routes/workflows.test.ts && npx tsx --test server/src/lib/clipDialogueAllocator.test.ts`
Expected: 17（12+5）pass / 10 pass。

- [ ] **Step 5: 类型检查（替代提交步骤）**

Run: `npm run server:check`
Expected: 无错误。**不要 git commit。**

---

### Task 3: 镜头节奏 1-3 秒（D5）

**Files:**
- Modify: `server/src/routes/workflows.ts` — `clampShotDuration`（:4757）、`MAX_DIALOGUE_WORDS_PER_SHOT`（:4640）、密度分支（:4658）、4 处 LLM 文案（:3303、:3306、:3394、:3606）
- Modify: `server/src/routes/workflows.test.ts`（追加）

- [ ] **Step 1: 写失败测试（追加）**

```typescript
test("clampShotDuration clamps to 1-3 seconds with default 2", () => {
  assert.equal(internals.clampShotDuration(Number.NaN), 2);
  assert.equal(internals.clampShotDuration(0), 1);
  assert.equal(internals.clampShotDuration(2), 2);
  assert.equal(internals.clampShotDuration(5), 3);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx tsx --test server/src/routes/workflows.test.ts`
Expected: 新测试失败（缺导出）。

- [ ] **Step 3: 实现**

3a. `clampShotDuration`（:4757）：

```typescript
function clampShotDuration(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.max(1, Math.min(3, Math.round(value)));
}
```

3b. 常量（:4640）：`const MAX_DIALOGUE_WORDS_PER_SHOT = 12;` → `= 9;`（3 秒 × 3.2 词/秒，向下取整）

3c. 密度分支（:4658）：`(words <= MAX_DIALOGUE_WORDS_PER_SHOT && requiredDuration <= 4)` → `requiredDuration <= 3`

3d. 4 处 LLM 文案精确替换：
- :3303 `The backend will expand dense dialogue into 2-4 second shots.` → `into 1-3 second shots.`
- :3306 `- Prefer 2-4 seconds per beat.` → `- Prefer 1-3 seconds per beat.`
- :3394 `- Prefer 2-4 seconds per shot.` → `- Prefer 1-3 seconds per shot.`
- :3606 `- Prefer 2-4 seconds per shot for fast short-drama pacing` → `- Prefer 1-3 seconds per shot for fast short-drama pacing`

3e. `workflowsTestInternals` 追加 `clampShotDuration,`

- [ ] **Step 4: 运行确认全绿 + 文案核对**

Run: `npx tsx --test server/src/routes/workflows.test.ts && grep -n "2-4 second" server/src/routes/workflows.ts`
Expected: 测试全绿；grep 无结果（4 处全部替换干净）。

- [ ] **Step 5: 类型检查（替代提交步骤）**

Run: `npm run server:check`，无错误。**不要 git commit。**

---

### Task 4: 本地兜底构建器同步修复（前后端）

**Files:**
- Modify: `server/src/lib/episodeCanvasSync.ts` — `buildLocalClipVideoPrompt`
- Modify: `src/app/features/canvas/canvasUtils.tsx` — `buildLocalClipVideoPrompt`（:1704，节拍行在 :1709）

两处是同型函数（多参模式 `clip.seedancePrompt` 为空时的兜底），当前节拍行都是：

```typescript
return `P${index + 1}: ${[action, dialogue ? `dialogue/reaction ${dialogue}` : ""].filter(Boolean).join("; ")}`;
```

- [ ] **Step 1: 服务端替换**

`episodeCanvasSync.ts` 的 `buildLocalClipVideoPrompt` 内 beats 映射行替换为（S 标签 + 台词前置 + 无垃圾标签）：

```typescript
    return `S${index + 1}: ${[dialogue ? `dialogue ${dialogue}` : "", action].filter(Boolean).join("; ")}`;
```

注意：**只改 `buildLocalClipVideoPrompt`**。`buildEpisodeClipVideoPrompt`（章节导演板路径）里的同型行不动（规格範围：章节导演板既有行为冻结）。

- [ ] **Step 2: 前端镜像替换**

`canvasUtils.tsx:1709` 同样替换（注意该文件用单引号，保持风格）：

```typescript
    return `S${index + 1}: ${[dialogue ? `dialogue ${dialogue}` : '', action].filter(Boolean).join('; ')}`;
```

同样**不要动** `buildLocalClipVideoPromptFromStoryboard`（:1661，章节导演板路径）。

- [ ] **Step 3: 验证（替代提交步骤）**

Run: `npm run server:check && npm run build && grep -rn "dialogue/reaction" server/src/lib/episodeCanvasSync.ts src/app/features/canvas/canvasUtils.tsx`
Expected: 类型检查与构建通过；grep 仅剩章节导演板路径的命中（`buildEpisodeClipVideoPrompt` / `buildLocalClipVideoPromptFromStoryboard` 内），多参路径无残留。**不要 git commit。**

---

### Task 5: 全量验证

- [ ] **Step 1: 跑全部测试**

```bash
npx tsx --test server/src/lib/clipDialogueAllocator.test.ts   # 10/10
npx tsx --test server/src/routes/workflows.test.ts            # 18/18（12 既有 + 6 新增）
npx tsx --test server/src/lib/canvasAssetImageSync.test.ts    # 19/19（不回归）
npx tsx --test server/src/lib/storyboardPrompt.test.ts        # 不回归
npm run server:check
npm run build
```

- [ ] **Step 2: 样本冒烟**

用 Task 2 的 `sampleShots` 在 node REPL（`npx tsx -e`）里调用 `internals.composeSeedancePrompt`，人工核对输出满足规格验收标准 1-4（无垃圾尾巴、无 P 指令、说话人完整、无复读）。

---

### Task 6: 部署 + 存量重算（由主会话执行，非子代理）

- [ ] **Step 1: 重建镜像并替换容器**

```bash
cd /projects/loohii
docker tag loohii-app:latest loohii-app:rollback-$(date +%Y%m%d-%H%M)
docker build -f Dockerfile.loohii -t loohii-app:latest .
docker inspect loohii-app --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -vE '^(PATH|NODE_VERSION|YARN_VERSION|NODE_ENV|PORT)=' > /tmp/loohii-runtime.env
docker stop loohii-app && docker rm loohii-app
docker run -d --name loohii-app --network loohii_default --network-alias app -p 3001:3001 --env-file /tmp/loohii-runtime.env --restart unless-stopped loohii-app:latest
rm -f /tmp/loohii-runtime.env
# 健康检查
docker exec loohii-app sh -c "wget -qO- http://localhost:3001/api/health"
```

- [ ] **Step 2: 批量重算存量 Clip**

前置：Task 2/3 已把 `regenerateWorkflowClipSeedancePrompt`、`getWorkflowState`、`writeWorkflowEpisode` 加入 `workflowsTestInternals` 导出（若 Task 2 未加，在此步补加并重建镜像）。容器内执行事务脚本（模式同既有画布补救脚本）：

```typescript
// /tmp/recompute-seedance.ts → docker cp 进容器 /app 后 npx tsx 执行
import { prisma } from "./server/src/lib/prisma";
import { workflowsTestInternals as internals } from "./server/src/routes/workflows";

const projectId = "cmq8dw07r0003l00tewomnzwd";
const isRecord = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

await prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, metadata: true } });
  if (!project || !isRecord(project.metadata)) throw new Error("project not found");
  let metadata: Record<string, any> = project.metadata;
  const episodeIds = Object.keys(metadata.episodes ?? {});
  let updated = 0;
  for (const episodeId of episodeIds) {
    const workflow = internals.getWorkflowState(metadata, episodeId);
    if (!Array.isArray(workflow.clips) || workflow.clips.length === 0) continue;
    const nextClips = workflow.clips.map((clip: any) => {
      const shotIdSet = new Set(clip.shotIds ?? []);
      const targetShots = (workflow.breakdownScenes ?? []).filter((shot: any) => shotIdSet.has(shot.id));
      if (targetShots.length === 0) return clip;
      const generated = internals.regenerateWorkflowClipSeedancePrompt(project, workflow, clip, targetShots);
      updated += 1;
      return { ...clip, ...generated };
    });
    metadata = internals.writeWorkflowEpisode(metadata, episodeId, { ...workflow, clips: nextClips, updatedAt: new Date().toISOString() }, false);
  }
  await tx.project.update({ where: { id: projectId }, data: { metadata } });
  console.log(`recomputed seedancePrompt for ${updated} clips across ${episodeIds.length} episodes`);
});
await prisma.$disconnect();
```

- [ ] **Step 3: 验收**

```bash
docker exec loohii-postgres psql -U loohii -d loohii -t -A -c "
SELECT c->>'seedancePrompt' FROM \"Project\" p,
jsonb_array_elements(p.metadata->'workflowCenter'->'clips') c
WHERE p.id='cmq8dw07r0003l00tewomnzwd' AND c->>'id'='clip-001';"
```

对照规格验收标准：无「dialogue; reaction」残留、无「storyboard image/animate P1」、台词带说话人且与源台词逐字一致、长句不跨节拍、无相邻复读。然后通知用户强刷浏览器 + 画布重同步 + 旧翻译需重新翻译。

---

## Self-Review 记录

- 规格覆盖：D1→Task 2（3c/3d/3e）；D2→Task 2（3f）；D3→Task 1 + Task 2（3c 接线）；D4→Task 2（3d）；D5→Task 3；兜底构建器→Task 4；部署重算→Task 6。决策 1-5 全部落实。
- 占位符扫描：无 TBD/TODO；所有代码步骤含完整代码。
- 类型一致性：`ClipVideoStoryboardBeat` 新字段（camera/action）在 Task 2 的 3a 定义、3c/3d 使用一致；`allocateClipDialogueToBeats` 签名与 Task 1 一致；testInternals 导出名与测试引用一致（`buildShotOrderVideoBeats`/`composeSeedancePrompt`/`formatStoryboardVideoBeats`/`clampShotDuration`）。
- 已知留意点：composeSeedancePrompt 测试传参需与实际 input 类型字段齐全（实现时以 `server:check` 对齐，必要时在测试对象上加 `as any`——既有测试文件已有此先例）。
