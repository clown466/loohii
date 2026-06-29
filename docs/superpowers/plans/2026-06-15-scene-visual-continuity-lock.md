# Scene Visual Continuity Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Scene Visual Bible and continuity lock so workflow inference can move between areas while keeping the same canonical scene visually consistent across assets, storyboards, canvas prompts, and video prompts.

**Architecture:** Add a small pure TypeScript continuity module that builds canonical scene visual identities, aliases sub-areas to those identities, and formats compact lock text for image and video prompts. Wire it into the existing workflow route after model JSON normalization, then mirror the lock in canvas/video prompt generation without changing the user-facing workflow stages.

**Tech Stack:** TypeScript, Express, Prisma-backed project metadata, node:test with `npx tsx --test`, existing workflow metadata JSON.

---

## Scope

This plan addresses visual identity drift inside one continuous narrative scene. Spatial movement remains allowed. The system must prevent the same canonical scene from changing time of day, color palette, building type, material language, lighting family, or fixed landmark set without explicit source evidence.

This plan does not add a new UI page, does not redesign the canvas, and does not add a separate async job pipeline. It keeps the current workflow stages and adds stronger structured inference data.

## File Map

- Create `server/src/lib/sceneVisualContinuity.ts`: pure data types and helpers for canonical scene visual bibles, aliases, anchor locks, prompt lock formatting, and conflict scoring.
- Create `server/src/lib/sceneVisualContinuity.test.ts`: focused unit tests for canonical grouping, aliasing, lock text, and visual conflict detection.
- Modify `server/src/routes/workflows.ts`: import the continuity helpers, add visual bible fields to normalized locations and storyboard shots, add prompt rules, run continuity normalization after JSON model output, and export helpers for route tests.
- Modify `server/src/routes/workflows.test.ts`: add workflow-level regression tests proving the superstore sanctuary, toilet paper aisle, and pallet altar stay under one visual authority; fungus wall stays under frozen meat section.
- Modify `server/src/lib/episodeCanvasSync.ts`: include scene visual lock text in local canvas video prompt fallbacks and synced video node data.
- Modify `server/src/lib/canvasStoryboardReferences.test.ts` if existing assertions depend on exact prompt strings and need the new lock line.

## Data Contract

Use these fields in workflow metadata. Keep them additive so existing projects continue to load.

```ts
type SceneVisualBible = {
  canonicalSceneId: string;
  canonicalName: string;
  visualIdentity: {
    timeOfDay: string;
    lighting: string;
    colorPalette: string;
    buildingType: string;
    materialLanguage: string;
    fixedLandmarks: string[];
    atmosphere: string;
  };
  childZones: Array<{
    id: string;
    name: string;
    role: "zone" | "anchor" | "detail";
    visualLock: string;
  }>;
  aliases: string[];
  continuityLock: string;
};

type WorkflowSceneWithVisualLock = {
  canonicalSceneId?: string;
  sceneVisualLock?: string;
  sceneZone?: string;
  sceneAnchors?: string[];
};
```

## Task 1: Add Pure Scene Visual Continuity Module

**Files:**
- Create: `server/src/lib/sceneVisualContinuity.ts`
- Create: `server/src/lib/sceneVisualContinuity.test.ts`

- [ ] **Step 1: Write failing tests for canonical visual grouping**

Create `server/src/lib/sceneVisualContinuity.test.ts` with:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSceneVisualBible,
  detectSceneVisualConflict,
  formatSceneVisualLock,
  resolveSceneVisualLockForSetting,
} from "./sceneVisualContinuity";

test("buildSceneVisualBible keeps sanctuary zones under one visual authority", () => {
  const bibles = buildSceneVisualBible([
    {
      id: "loc-1",
      name: "Sanctuary Superstore Center",
      description: "Former superstore center converted into a cult meditation circle with green fabric strips and incense haze.",
      timeOfDay: "Interior dim",
    },
    {
      id: "loc-2",
      name: "Bulk Toilet Paper Aisle Meditation Circle",
      description: "Aisle repurposed as a trial space with hundreds of green-dyed strips hanging from the ceiling.",
      timeOfDay: "Interior dim",
    },
    {
      id: "loc-3",
      name: "Pallet Altar",
      description: "Makeshift altar built from wooden shipping pallets where Flora judges prisoners from above.",
      timeOfDay: "Interior dim",
    },
  ]);

  assert.equal(bibles.length, 1);
  assert.equal(bibles[0].canonicalSceneId, "scene-1-sanctuary-superstore-center");
  assert.equal(bibles[0].canonicalName, "Sanctuary Superstore Center");
  assert.deepEqual(
    bibles[0].childZones.map((zone) => zone.name),
    ["Bulk Toilet Paper Aisle Meditation Circle", "Pallet Altar"],
  );
  assert.match(bibles[0].continuityLock, /same canonical scene/i);
  assert.match(bibles[0].continuityLock, /green fabric/i);
  assert.match(bibles[0].continuityLock, /superstore/i);
});

test("resolveSceneVisualLockForSetting maps sub-area setting to canonical lock", () => {
  const bibles = buildSceneVisualBible([
    {
      id: "loc-1",
      name: "Sanctuary Superstore Center",
      description: "Former superstore center converted into a cult meditation circle with green fabric strips and incense haze.",
      timeOfDay: "Interior dim",
    },
    {
      id: "loc-2",
      name: "Pallet Altar",
      description: "Makeshift altar built from wooden shipping pallets where Flora judges prisoners from above.",
      timeOfDay: "Interior dim",
    },
  ]);

  const lock = resolveSceneVisualLockForSetting("Pallet altar aisle", bibles);

  assert.equal(lock?.canonicalSceneId, "scene-1-sanctuary-superstore-center");
  assert.equal(lock?.sceneZone, "Pallet Altar");
  assert.match(lock?.sceneVisualLock ?? "", /Sanctuary Superstore Center/);
  assert.match(lock?.sceneVisualLock ?? "", /must not become a different warehouse/i);
});

test("fungus wall stays visually locked to frozen meat section", () => {
  const bibles = buildSceneVisualBible([
    {
      id: "loc-1",
      name: "Frozen Meat Section",
      description: "Powerless freezer aisle with sickly sweet rot stench and white pulsing fungus on the walls.",
      timeOfDay: "Interior dark",
    },
    {
      id: "loc-2",
      name: "Fungus-Covered Drywall",
      description: "Dim wall coated in lace-like white fungus that squirms and whispers through cracks.",
      timeOfDay: "Interior dark",
    },
  ]);

  const lock = resolveSceneVisualLockForSetting("Fungus-covered drywall whisper", bibles);

  assert.equal(lock?.canonicalSceneId, "scene-1-frozen-meat-section");
  assert.equal(lock?.sceneZone, "Fungus-Covered Drywall");
  assert.match(lock?.sceneVisualLock ?? "", /Frozen Meat Section/);
  assert.match(lock?.sceneVisualLock ?? "", /freezer|cold|frozen/i);
});

test("detectSceneVisualConflict flags day green superstore versus red night warehouse", () => {
  const conflict = detectSceneVisualConflict(
    {
      canonicalSceneId: "scene-1-sanctuary-superstore-center",
      canonicalName: "Sanctuary Superstore Center",
      visualIdentity: {
        timeOfDay: "Interior dim",
        lighting: "cool dim superstore lighting with green fabric filtered light",
        colorPalette: "muted green, gray concrete, candle warm points",
        buildingType: "abandoned big-box superstore",
        materialLanguage: "supermarket shelves, shopping carts, concrete floor, green fabric strips",
        fixedLandmarks: ["green fabric strips", "supermarket shelves", "shopping carts", "meditation circle"],
        atmosphere: "eerie absurd cult sanctuary",
      },
      childZones: [],
      aliases: ["pallet altar"],
      continuityLock: "same canonical scene",
    },
    "red black night warehouse corner, industrial bricks, no supermarket shelves, no green fabric",
  );

  assert.equal(conflict.pass, false);
  assert.ok(conflict.reasons.some((reason) => /building type/i.test(reason)));
  assert.ok(conflict.reasons.some((reason) => /color/i.test(reason)));
  assert.ok(conflict.reasons.some((reason) => /landmark/i.test(reason)));
});

test("formatSceneVisualLock is compact enough for video prompts", () => {
  const text = formatSceneVisualLock({
    canonicalSceneId: "scene-1-sanctuary-superstore-center",
    canonicalName: "Sanctuary Superstore Center",
    visualIdentity: {
      timeOfDay: "Interior dim",
      lighting: "cool dim superstore lighting with green fabric filtered light",
      colorPalette: "muted green, gray concrete, candle warm points",
      buildingType: "abandoned big-box superstore",
      materialLanguage: "supermarket shelves, shopping carts, concrete floor, green fabric strips",
      fixedLandmarks: ["green fabric strips", "supermarket shelves", "shopping carts", "meditation circle"],
      atmosphere: "eerie absurd cult sanctuary",
    },
    childZones: [{ id: "zone-pallet-altar", name: "Pallet Altar", role: "anchor", visualLock: "wooden pallet altar inside the same superstore sanctuary" }],
    aliases: ["bulk toilet paper aisle", "pallet altar aisle"],
    continuityLock: "same canonical scene",
  }, "Pallet Altar");

  assert.ok(text.length < 700, `expected compact lock, got ${text.length}`);
  assert.match(text, /Scene visual authority: Sanctuary Superstore Center/);
  assert.match(text, /Current zone: Pallet Altar/);
  assert.match(text, /Do not change.*time.*palette.*building type/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /projects/loohii && npx tsx --test server/src/lib/sceneVisualContinuity.test.ts
```

Expected: FAIL with module-not-found for `./sceneVisualContinuity`.

- [ ] **Step 3: Create the continuity module**

Create `server/src/lib/sceneVisualContinuity.ts` with:

```ts
export type SceneVisualIdentity = {
  timeOfDay: string;
  lighting: string;
  colorPalette: string;
  buildingType: string;
  materialLanguage: string;
  fixedLandmarks: string[];
  atmosphere: string;
};

export type SceneVisualBible = {
  canonicalSceneId: string;
  canonicalName: string;
  visualIdentity: SceneVisualIdentity;
  childZones: Array<{
    id: string;
    name: string;
    role: "zone" | "anchor" | "detail";
    visualLock: string;
  }>;
  aliases: string[];
  continuityLock: string;
};

export type SceneVisualLockResolution = {
  canonicalSceneId: string;
  canonicalName: string;
  sceneZone: string;
  sceneAnchors: string[];
  sceneVisualLock: string;
};

export type SceneVisualConflict = {
  pass: boolean;
  score: number;
  reasons: string[];
};

export type SceneLike = {
  id?: string;
  name?: string;
  title?: string;
  description?: string;
  timeOfDay?: string;
};

const SANCTUARY_PATTERN = /(sanctuary|superstore|meditation|bulk toilet paper|toilet paper aisle|pallet altar|trial|green fabric|圣所|超市|冥想|纸巾|托盘|祭坛|审判)/i;
const FROZEN_PATTERN = /(frozen meat|freezer|fungus|drywall|wall whisper|冷冻|冷柜|菌丝|真菌|墙)/i;
const LOADING_DOCK_PATTERN = /(loading dock|blast door|roll-up door|装卸|卸货|防爆门|卷帘门)/i;
const LABOR_PATTERN = /(labor purification|purification zone|machinery|corridor|净化|劳作|机器|走廊)/i;

export function buildSceneVisualBible(scenes: SceneLike[]): SceneVisualBible[] {
  const canonical = new Map<string, SceneVisualBible>();
  for (const scene of scenes) {
    const name = cleanName(scene.name || scene.title || "Scene");
    const description = text(scene.description);
    const timeOfDay = text(scene.timeOfDay);
    const key = canonicalSceneKey(`${name} ${description}`);
    const bible = canonical.get(key);
    if (!bible) {
      canonical.set(key, createCanonicalBible(key, name, description, timeOfDay));
      continue;
    }
    if (!sameName(name, bible.canonicalName)) {
      bible.childZones.push({
        id: slugId(zoneRole(name, description), name, bible.childZones.length + 1),
        name,
        role: zoneRole(name, description),
        visualLock: childZoneLock(name, bible.canonicalName),
      });
      bible.aliases.push(name);
    }
  }
  return Array.from(canonical.values()).map((bible) => ({
    ...bible,
    aliases: uniqueStrings([bible.canonicalName, ...bible.aliases, ...bible.childZones.map((zone) => zone.name)]),
    continuityLock: buildContinuityLock(bible),
  }));
}

export function resolveSceneVisualLockForSetting(setting: string, bibles: SceneVisualBible[]): SceneVisualLockResolution | null {
  const settingText = normalize(setting);
  if (!settingText) return null;
  const matched = bibles.find((bible) => {
    const names = [bible.canonicalName, ...bible.aliases, ...bible.childZones.map((zone) => zone.name)].map(normalize);
    return names.some((name) => name && (settingText.includes(name) || name.includes(settingText)));
  }) ?? bibles.find((bible) => canonicalSceneKey(settingText) === canonicalSceneKey(`${bible.canonicalName} ${bible.aliases.join(" ")}`));
  if (!matched) return null;
  const zone = matched.childZones.find((item) => {
    const zoneName = normalize(item.name);
    return zoneName && (settingText.includes(zoneName) || zoneName.includes(settingText));
  });
  const currentZone = zone?.name || matched.canonicalName;
  return {
    canonicalSceneId: matched.canonicalSceneId,
    canonicalName: matched.canonicalName,
    sceneZone: currentZone,
    sceneAnchors: matched.childZones.filter((item) => item.role !== "zone").map((item) => item.name),
    sceneVisualLock: formatSceneVisualLock(matched, currentZone),
  };
}

export function formatSceneVisualLock(bible: SceneVisualBible, currentZone = ""): string {
  const identity = bible.visualIdentity;
  return [
    `Scene visual authority: ${bible.canonicalName}.`,
    currentZone && currentZone !== bible.canonicalName ? `Current zone: ${currentZone}, inside the same canonical scene.` : "",
    `Maintain: ${compactList([identity.timeOfDay, identity.lighting, identity.colorPalette, identity.buildingType, identity.materialLanguage], 5)}.`,
    identity.fixedLandmarks.length ? `Fixed landmarks: ${identity.fixedLandmarks.slice(0, 6).join(", ")}.` : "",
    "Do not change the time of day, color palette, building type, material language, or fixed landmarks unless the source text explicitly moves to a different canonical scene.",
    `Continuity lock: ${bible.continuityLock}`,
  ].filter(Boolean).join(" ");
}

export function detectSceneVisualConflict(bible: SceneVisualBible, candidatePrompt: string): SceneVisualConflict {
  const candidate = normalize(candidatePrompt);
  const reasons: string[] = [];
  const identity = bible.visualIdentity;
  if (candidate.includes("night") && !normalize(identity.timeOfDay).includes("night")) reasons.push("time of day drift");
  if (/(red|black|crimson)/.test(candidate) && /green/.test(normalize(identity.colorPalette)) && !/green/.test(candidate)) reasons.push("color palette drift");
  if (/warehouse|brick|factory/.test(candidate) && /superstore|supermarket|big-box/.test(normalize(identity.buildingType)) && !/superstore|supermarket|shelf|cart/.test(candidate)) reasons.push("building type drift");
  const missingLandmarks = identity.fixedLandmarks.filter((landmark) => !containsLoose(candidate, landmark));
  if (identity.fixedLandmarks.length > 0 && missingLandmarks.length >= Math.ceil(identity.fixedLandmarks.length / 2)) reasons.push("fixed landmark drift");
  const score = Math.max(0, 100 - reasons.length * 30);
  return { pass: reasons.length === 0, score, reasons };
}

function createCanonicalBible(key: string, name: string, description: string, timeOfDay: string): SceneVisualBible {
  const identity = inferVisualIdentity(name, description, timeOfDay);
  const bible: SceneVisualBible = {
    canonicalSceneId: `scene-1-${slugBase(name)}`,
    canonicalName: name,
    visualIdentity: identity,
    childZones: [],
    aliases: [name],
    continuityLock: "",
  };
  bible.continuityLock = buildContinuityLock(bible);
  return bible;
}

function inferVisualIdentity(name: string, description: string, timeOfDay: string): SceneVisualIdentity {
  const source = `${name} ${description}`;
  if (SANCTUARY_PATTERN.test(source)) {
    return {
      timeOfDay: timeOfDay || "Interior dim",
      lighting: "dim superstore lighting with green fabric filtered light and small warm practical points",
      colorPalette: "muted green, gray concrete, dull metal, warm candle accents",
      buildingType: "abandoned big-box superstore sanctuary",
      materialLanguage: "supermarket shelves, shopping carts, concrete floor, green fabric strips, pallets",
      fixedLandmarks: ["green fabric strips", "supermarket shelves", "shopping carts", "meditation circle", "pallet altar"],
      atmosphere: "eerie absurd cult sanctuary inside a mundane superstore",
    };
  }
  if (FROZEN_PATTERN.test(source)) {
    return {
      timeOfDay: timeOfDay || "Interior dark",
      lighting: "cold dark freezer aisle lighting with blue-gray spill",
      colorPalette: "cold blue-gray, white fungus, dark freezer metal",
      buildingType: "superstore frozen meat freezer section",
      materialLanguage: "freezer cases, cold tile, metal doors, white lace-like fungus",
      fixedLandmarks: ["freezer cases", "white fungus", "cold tile floor", "dark freezer wall"],
      atmosphere: "cold powerless freezer aisle with unsettling fungal growth",
    };
  }
  if (LOADING_DOCK_PATTERN.test(source)) {
    return {
      timeOfDay: timeOfDay || "Interior dim",
      lighting: "dim industrial loading dock lighting",
      colorPalette: "dark concrete, gray metal, yellow hazard marks",
      buildingType: "underground loading dock",
      materialLanguage: "concrete walls, stainless blast door, roll-up door, pipes, pallets",
      fixedLandmarks: ["stainless blast door", "roll-up door", "concrete dock floor", "pallet stacks"],
      atmosphere: "tense underground loading bay",
    };
  }
  if (LABOR_PATTERN.test(source)) {
    return {
      timeOfDay: timeOfDay || "Interior dark",
      lighting: "cold corridor light with warm machinery glow ahead",
      colorPalette: "green-gray corridor shadows, orange industrial glow",
      buildingType: "superstore back corridor leading to machinery zone",
      materialLanguage: "pipes, conveyor belts, metal gates, cracked concrete, retail backroom walls",
      fixedLandmarks: ["pipes", "conveyor belts", "industrial doorway", "machinery glow"],
      atmosphere: "ominous backroom approach to purification machinery",
    };
  }
  return {
    timeOfDay: timeOfDay || "Interior",
    lighting: "consistent lighting from the canonical scene reference",
    colorPalette: "consistent palette from the canonical scene reference",
    buildingType: "canonical scene architecture",
    materialLanguage: "fixed materials from the canonical scene reference",
    fixedLandmarks: [],
    atmosphere: description || "consistent scene atmosphere",
  };
}

function canonicalSceneKey(value: string): string {
  const normalized = normalize(value);
  if (SANCTUARY_PATTERN.test(normalized)) return "sanctuary-superstore";
  if (FROZEN_PATTERN.test(normalized)) return "frozen-meat";
  if (LOADING_DOCK_PATTERN.test(normalized)) return "underground-loading-dock";
  if (LABOR_PATTERN.test(normalized)) return "labor-purification";
  return slugBase(normalized);
}

function buildContinuityLock(bible: SceneVisualBible): string {
  const zones = bible.childZones.map((zone) => zone.name).join(", ");
  const zoneText = zones ? ` Zones/anchors (${zones}) remain inside the same canonical scene.` : "";
  return `Keep the same canonical scene identity for ${bible.canonicalName}: ${bible.visualIdentity.timeOfDay}, ${bible.visualIdentity.colorPalette}, ${bible.visualIdentity.buildingType}, ${bible.visualIdentity.materialLanguage}.${zoneText} It must not become a different warehouse, different night setting, different palette, or unrelated building.`;
}

function childZoneLock(name: string, canonicalName: string): string {
  return `${name} is a local zone or anchor inside ${canonicalName}; inherit the canonical scene time, palette, architecture, materials, and landmarks.`;
}

function zoneRole(name: string, description: string): "zone" | "anchor" | "detail" {
  const source = normalize(`${name} ${description}`);
  if (/altar|祭坛/.test(source)) return "anchor";
  if (/wall|drywall|fungus|墙|菌/.test(source)) return "detail";
  return "zone";
}

function sameName(left: string, right: string): boolean {
  return normalize(left) === normalize(right);
}

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function slugBase(value: string): string {
  return normalize(value).replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-").replace(/^-|-$/g, "").slice(0, 56) || "scene";
}

function slugId(prefix: string, value: string, index: number): string {
  return `${prefix}-${index}-${slugBase(value)}`;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const item = cleanName(value);
    const key = normalize(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function compactList(values: string[], limit: number): string {
  return values.map((value) => value.trim()).filter(Boolean).slice(0, limit).join("; ");
}

function containsLoose(haystack: string, needle: string): boolean {
  const words = normalize(needle).split(" ").filter((word) => word.length > 2);
  return words.some((word) => haystack.includes(word));
}
```

- [ ] **Step 4: Run module tests**

Run:

```bash
cd /projects/loohii && npx tsx --test server/src/lib/sceneVisualContinuity.test.ts
```

Expected: PASS, all 5 tests pass.

- [ ] **Step 5: Commit pure module**

Run:

```bash
cd /projects/loohii && git add server/src/lib/sceneVisualContinuity.ts server/src/lib/sceneVisualContinuity.test.ts && git commit -m "feat: add scene visual continuity helpers"
```

Expected: commit succeeds. If the worktree contains unrelated user changes, commit only these two files.

## Task 2: Store Scene Visual Bible In Normalized Workflow Metadata

**Files:**
- Modify: `server/src/routes/workflows.ts`
- Modify: `server/src/routes/workflows.test.ts`

- [ ] **Step 1: Write failing workflow normalization tests**

Append to `server/src/routes/workflows.test.ts`:

```ts
test("normalizeBreakdown stores scene visual bible and locks sub-area storyboard settings", () => {
  const normalized = internals.normalizeBreakdown({
    characters: [],
    locations: [
      {
        name: "Sanctuary Superstore Center",
        description: "Former superstore center converted into a cult meditation circle with green fabric strips and incense haze.",
        timeOfDay: "Interior dim",
      },
      {
        name: "Bulk Toilet Paper Aisle Meditation Circle",
        description: "Aisle repurposed as a trial space with hundreds of green-dyed strips hanging from the ceiling.",
        timeOfDay: "Interior dim",
      },
      {
        name: "Pallet Altar",
        description: "Makeshift altar built from wooden shipping pallets where Flora judges prisoners from above.",
        timeOfDay: "Interior dim",
      },
    ],
    props: [],
    storyboard: [
      {
        title: "Trial begins",
        description: "Flora judges from the pallet altar.",
        action: "Flora stands above Chloe at the pallet altar while green strips hang overhead.",
        dialogue: "Flora: You are accused!",
        durationSeconds: 2,
        characters: ["Flora", "Chloe"],
        setting: "Pallet altar aisle",
      },
    ],
  }, {
    sourceText: "The trial continues inside the same superstore sanctuary.",
    sourceName: "test",
    selectedEpisode: "Episode 1",
    stage: "full-breakdown",
  } as any);

  assert.ok(Array.isArray((normalized as any).sceneVisualBibles));
  assert.equal((normalized as any).sceneVisualBibles.length, 1);
  assert.equal((normalized as any).storyboard[0].canonicalSceneId, "scene-1-sanctuary-superstore-center");
  assert.match((normalized as any).storyboard[0].sceneVisualLock, /Scene visual authority: Sanctuary Superstore Center/);
  assert.match((normalized as any).storyboard[0].sceneVisualLock, /Do not change.*time.*palette.*building type/i);
});

test("normalizeBreakdown locks fungus wall detail to frozen meat section", () => {
  const normalized = internals.normalizeBreakdown({
    characters: [],
    locations: [
      {
        name: "Frozen Meat Section",
        description: "Powerless freezer aisle with sickly sweet rot stench and white pulsing fungus on the walls.",
        timeOfDay: "Interior dark",
      },
      {
        name: "Fungus-Covered Drywall",
        description: "Dim wall coated in lace-like white fungus that squirms and whispers through cracks.",
        timeOfDay: "Interior dark",
      },
    ],
    storyboard: [
      {
        title: "Wall whispers",
        description: "The fungus-covered wall whispers to Chloe.",
        action: "Chloe studies the white fungus spreading across the freezer wall.",
        dialogue: "",
        durationSeconds: 2,
        characters: ["Chloe"],
        setting: "Fungus-covered drywall",
      },
    ],
  }, {
    sourceText: "Inside the frozen meat section, the wall whispers.",
    sourceName: "test",
    selectedEpisode: "Episode 1",
    stage: "full-breakdown",
  } as any);

  assert.equal((normalized as any).storyboard[0].canonicalSceneId, "scene-1-frozen-meat-section");
  assert.match((normalized as any).storyboard[0].sceneVisualLock, /Frozen Meat Section/);
  assert.match((normalized as any).storyboard[0].sceneVisualLock, /freezer|cold|frozen/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /projects/loohii && npx tsx --test server/src/routes/workflows.test.ts
```

Expected: FAIL because `sceneVisualBibles`, `canonicalSceneId`, and `sceneVisualLock` are absent.

- [ ] **Step 3: Import continuity helpers and extend the normalized shot type**

In `server/src/routes/workflows.ts`, add near existing imports:

```ts
import {
  buildSceneVisualBible,
  formatSceneVisualLock,
  resolveSceneVisualLockForSetting,
  type SceneVisualBible,
} from "../lib/sceneVisualContinuity.js";
```

Extend `NormalizedStoryboardShot`:

```ts
  canonicalSceneId: string;
  sceneVisualLock: string;
  sceneZone: string;
  sceneAnchors: string[];
```

- [ ] **Step 4: Add visual bible generation inside `normalizeBreakdown()`**

In `normalizeBreakdown()`, after `locations` is built and before `storyboardDraft`, add:

```ts
  const sceneVisualBibles = buildSceneVisualBible(locations);
```

Inside the `storyboardDraft` mapper, after `const visualPrompt = ...`, add:

```ts
    const visualLock = resolveSceneVisualLockForSetting(setting || title || description, sceneVisualBibles);
```

Then add these fields to the returned shot object:

```ts
      canonicalSceneId: visualLock?.canonicalSceneId ?? "",
      sceneVisualLock: visualLock?.sceneVisualLock ?? "",
      sceneZone: visualLock?.sceneZone ?? "",
      sceneAnchors: visualLock?.sceneAnchors ?? [],
```

In the normalized return object from `normalizeBreakdown()`, include:

```ts
    sceneVisualBibles,
```

- [ ] **Step 5: Add visual lock fields to `enrichWorkflowScene()`**

In `enrichWorkflowScene()`, read and return additive fields:

```ts
  const canonicalSceneId = stringFrom(record.canonicalSceneId, "");
  const sceneVisualLock = cleanWorkflowPublicText(stringFrom(record.sceneVisualLock, ""));
  const sceneZone = stringFrom(record.sceneZone, "");
  const sceneAnchors = arrayFrom(record.sceneAnchors).map((name) => String(name)).slice(0, 12);
```

Add them to the returned object:

```ts
      canonicalSceneId,
      sceneVisualLock,
      sceneZone,
      sceneAnchors,
```

- [ ] **Step 6: Export helpers for tests**

At the bottom `workflowsTestInternals`, add:

```ts
  buildSceneVisualBible,
  formatSceneVisualLock,
  resolveSceneVisualLockForSetting,
```

- [ ] **Step 7: Run workflow tests**

Run:

```bash
cd /projects/loohii && npx tsx --test server/src/routes/workflows.test.ts
```

Expected: PASS. Existing tests remain green, and the two new visual lock tests pass.

- [ ] **Step 8: Commit workflow metadata normalization**

Run:

```bash
cd /projects/loohii && git add server/src/routes/workflows.ts server/src/routes/workflows.test.ts && git commit -m "feat: store scene visual continuity locks"
```

Expected: commit succeeds with only these files.

## Task 3: Make Text Model Prompts Infer Visual Identity Before Assets And Storyboards

**Files:**
- Modify: `server/src/routes/workflows.ts`
- Modify: `server/src/routes/workflows.test.ts`

- [ ] **Step 1: Write failing prompt-builder tests**

Append to `server/src/routes/workflows.test.ts`:

```ts
test("buildBreakdownPrompt asks for canonical scene visual bible before local scene assets", () => {
  const prompt = internals.buildBreakdownPrompt({
    name: "美式漫剧",
    description: "",
    settings: { globalPrompt: "Base style: 欧美卡通", setupSettings: {} },
  }, {
    sourceText: "They speak in the same superstore sanctuary, then move to the pallet altar.",
    sourceName: "test",
    selectedEpisode: "Episode 1",
    stage: "assets",
  } as any, {
    globalPrompt: "Base style: 欧美卡通",
    negativePrompt: "",
    setupSettings: {},
    setupSettingsSummary: "",
    characterIdentityRules: "",
    existingCharacters: [],
    requiresSpecificFruitIdentity: false,
  } as any);

  assert.match(prompt, /Scene Visual Bible/i);
  assert.match(prompt, /canonical scene/i);
  assert.match(prompt, /Do not split a local altar, wall, aisle, door, or corner into a new visual world/i);
  assert.match(prompt, /same time of day, color palette, building type, material language, lighting family, and fixed landmarks/i);
});

test("buildStoryboardOnlyPrompt requires storyboard settings to use visual bible ids", () => {
  const prompt = internals.buildStoryboardOnlyPrompt({
    name: "美式漫剧",
    description: "",
    settings: { globalPrompt: "Base style: 欧美卡通", setupSettings: {} },
  }, {
    sourceText: "Flora judges Chloe at the pallet altar inside the superstore.",
    sourceName: "test",
    selectedEpisode: "Episode 1",
    stage: "storyboard",
  } as any, {
    characters: [],
    scenes: [
      {
        name: "Sanctuary Superstore Center",
        description: "green fabric superstore sanctuary",
        timeOfDay: "Interior dim",
      },
      {
        name: "Pallet Altar",
        description: "wooden pallet altar inside the sanctuary",
        timeOfDay: "Interior dim",
      },
    ],
    props: [],
  }, {
    globalPrompt: "Base style: 欧美卡通",
    negativePrompt: "",
    setupSettings: {},
    setupSettingsSummary: "",
    characterIdentityRules: "",
    existingCharacters: [],
    requiresSpecificFruitIdentity: false,
  } as any);

  assert.match(prompt, /Use the supplied Scene Visual Bible/i);
  assert.match(prompt, /canonicalSceneId/i);
  assert.match(prompt, /sceneZone/i);
  assert.match(prompt, /sceneVisualLock/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /projects/loohii && npx tsx --test server/src/routes/workflows.test.ts
```

Expected: FAIL because current prompts do not include Scene Visual Bible instructions.

- [ ] **Step 3: Add a prompt section helper**

In `server/src/routes/workflows.ts`, add near prompt helper functions:

```ts
function sceneVisualBiblePromptRules(): string {
  return [
    "Scene Visual Bible rules:",
    "- First infer canonical scenes by visual identity, not by every local object or camera angle.",
    "- A canonical scene is one continuous visual world with the same time of day, color palette, building type, material language, lighting family, and fixed landmarks.",
    "- Local areas such as an altar, wall, aisle, door, checkout counter, freezer wall, or corner should become sceneZone or sceneAnchors inside a canonical scene unless the source explicitly moves to a new place.",
    "- Do not split a local altar, wall, aisle, door, or corner into a new visual world.",
    "- If a clip moves within the same location, preserve the canonical scene visual identity and only change the current zone, camera angle, or blocking.",
    "- Output or preserve canonicalSceneId, sceneZone, sceneAnchors, and sceneVisualLock when the JSON shape allows those fields.",
  ].join("\n");
}
```

- [ ] **Step 4: Insert rules in breakdown and storyboard prompts**

In `buildBreakdownPrompt()`, add `sceneVisualBiblePromptRules()` before the JSON shape instructions.

In `buildStoryboardOnlyPrompt()`, add:

```ts
sceneVisualBiblePromptRules(),
"Use the supplied Scene Visual Bible from existing assets when present. If a setting is a sub-area, set sceneZone to that sub-area and keep canonicalSceneId pointed at the parent canonical scene.",
```

- [ ] **Step 5: Make JSON shape accept scene visual fields**

In the JSON shape text returned by `workflowJsonShape()` and `storyboardJsonShape()`, add these fields to storyboard beat examples:

```json
"canonicalSceneId": "scene-1-sanctuary-superstore-center",
"sceneZone": "Pallet Altar",
"sceneAnchors": ["Pallet Altar", "green fabric strips"],
"sceneVisualLock": "Scene visual authority: Sanctuary Superstore Center..."
```

Do not require the model to output perfect locks; `normalizeBreakdown()` remains the final authority.

- [ ] **Step 6: Run prompt tests**

Run:

```bash
cd /projects/loohii && npx tsx --test server/src/routes/workflows.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit prompt inference rules**

Run:

```bash
cd /projects/loohii && git add server/src/routes/workflows.ts server/src/routes/workflows.test.ts && git commit -m "feat: guide workflow reasoning with scene visual bible"
```

Expected: commit succeeds.

## Task 4: Apply Scene Visual Lock To Scene Asset Image Generation

**Files:**
- Modify: `server/src/routes/workflows.ts`
- Modify: `server/src/routes/workflows.test.ts`

- [ ] **Step 1: Write failing asset prompt test**

Append to `server/src/routes/workflows.test.ts`:

```ts
test("scene asset image prompt inherits canonical visual lock for child anchors", () => {
  const prompt = internals.buildWorkflowAssetImagePromptForTest(
    {
      name: "美式漫剧",
      description: "",
      settings: {
        globalPrompt: "Base style: 欧美卡通",
        setupSettings: {},
      },
    },
    "scenes",
    "Pallet Altar",
    {
      name: "Pallet Altar",
      description: "Makeshift altar built from wooden shipping pallets where Flora judges prisoners from above.",
      timeOfDay: "Interior dim",
      canonicalSceneId: "scene-1-sanctuary-superstore-center",
      sceneZone: "Pallet Altar",
      sceneVisualLock: "Scene visual authority: Sanctuary Superstore Center. Current zone: Pallet Altar, inside the same canonical scene. Maintain: Interior dim; muted green; abandoned big-box superstore; supermarket shelves, shopping carts, concrete floor, green fabric strips.",
    },
  );

  assert.match(prompt, /Scene visual authority: Sanctuary Superstore Center/);
  assert.match(prompt, /Current zone: Pallet Altar/);
  assert.match(prompt, /Do not reinterpret this child zone as a separate warehouse/i);
  assert.match(prompt, /same time of day, color palette, building type, material language, lighting family, and fixed landmarks/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /projects/loohii && npx tsx --test server/src/routes/workflows.test.ts
```

Expected: FAIL because `buildWorkflowAssetImagePromptForTest` is not exported and asset prompts do not include child scene lock language.

- [ ] **Step 3: Add asset prompt lock text**

In `buildWorkflowAssetImagePrompt()`, after `assetFacts`, compute:

```ts
  const sceneVisualLock = assetKind === "scenes" ? cleanWorkflowPublicText(stringFrom(asset?.sceneVisualLock, "")) : "";
```

Add these lines to the final prompt array after `Asset name`:

```ts
    sceneVisualLock ? `Scene visual continuity lock: ${sceneVisualLock}` : "",
    sceneVisualLock ? "This scene asset is a canonical scene zone/anchor, not a separate new visual world. Do not reinterpret this child zone as a separate warehouse, a different time of day, a different color palette, or an unrelated building." : "",
    sceneVisualLock ? "Preserve the same time of day, color palette, building type, material language, lighting family, and fixed landmarks from the scene visual authority." : "",
```

In the `assetKind === "scenes"` `kindRule`, replace the current single sentence with:

```ts
        ? [
            "Create a clean scene/location production reference image. Prioritize readable layout, geography, lighting, and atmosphere.",
            "If a Scene visual continuity lock is provided, inherit it exactly. The image may show a local zone, anchor, or detail, but it must remain inside the same canonical visual world.",
            "For local zones and anchors, show enough of the parent canonical scene materials and landmarks to make the relationship clear.",
          ].join("\n")
```

- [ ] **Step 4: Export asset prompt builder for tests**

Add to `workflowsTestInternals`:

```ts
  buildWorkflowAssetImagePromptForTest: buildWorkflowAssetImagePrompt,
```

- [ ] **Step 5: Run workflow tests**

Run:

```bash
cd /projects/loohii && npx tsx --test server/src/routes/workflows.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit asset prompt lock**

Run:

```bash
cd /projects/loohii && git add server/src/routes/workflows.ts server/src/routes/workflows.test.ts && git commit -m "feat: lock scene asset image prompts to visual bibles"
```

Expected: commit succeeds.

## Task 5: Apply Scene Visual Lock To Seedance Video Prompts

**Files:**
- Modify: `server/src/routes/workflows.ts`
- Modify: `server/src/lib/episodeCanvasSync.ts`
- Modify: `server/src/routes/workflows.test.ts`

- [ ] **Step 1: Write failing Seedance prompt test**

Append to `server/src/routes/workflows.test.ts`:

```ts
test("regenerated Seedance prompt includes scene visual lock for sub-area clips", () => {
  const clip = {
    id: "clip-005",
    title: "Clip 05 · Trial begins",
    plotGoal: "Flora begins the trial at the pallet altar.",
    targetDuration: 13,
    maxDuration: 15,
    estimatedDuration: 8,
    sceneType: "dialogue",
    storyboardControlLevel: "hard",
    storyboardType: "multi_panel",
    panelCount: 6,
    startState: "Flora stands above Chloe.",
    endState: "Chloe looks up from below.",
    emotionArc: "",
    dialogueWordCount: 4,
    dialogueDensity: "low",
    characters: ["Flora", "Chloe"],
    setting: "Pallet altar aisle",
    shotIds: ["s1"],
    layoutMemory: "",
    directorFreedom: "",
    seedancePrompt: "",
    storyboardPrompt: "",
    storyboardPanelCount: 6,
    storyboardNotes: "",
    preflight: {},
  } as any;
  const shots = [
    {
      id: "s1",
      title: "Trial begins",
      description: "Flora judges Chloe from the pallet altar.",
      action: "Flora stands on the pallet altar while Chloe waits below inside the green-draped superstore sanctuary.",
      dialogue: "Flora: You are accused!",
      durationSeconds: 2,
      shotSize: "medium shot",
      cameraAngle: "low angle",
      cameraMove: "slow push-in",
      composition: "Flora high on altar, Chloe below",
      lens: "50mm",
      aperture: "",
      shutter: "",
      iso: "",
      sound: "",
      music: "",
      subtitle: "",
      characters: ["Flora", "Chloe"],
      setting: "Pallet altar aisle",
      references: "",
      visualPrompt: "",
      directorBoardPrompt: "",
      status: "ready",
      canonicalSceneId: "scene-1-sanctuary-superstore-center",
      sceneZone: "Pallet Altar",
      sceneAnchors: ["Pallet Altar"],
      sceneVisualLock: "Scene visual authority: Sanctuary Superstore Center. Current zone: Pallet Altar, inside the same canonical scene. Maintain: Interior dim; muted green, gray concrete, candle warm points; abandoned big-box superstore; supermarket shelves, shopping carts, concrete floor, green fabric strips.",
    },
  ] as any[];

  const result = internals.regenerateWorkflowClipSeedancePrompt(
    { name: "test", aspectRatio: "16:9", settings: {} },
    { assets: { characters: [], scenes: [], props: [] }, clips: [clip] } as any,
    clip,
    shots,
  ).seedancePrompt;

  assert.match(result, /Scene visual authority: Sanctuary Superstore Center/);
  assert.match(result, /Current zone: Pallet Altar/);
  assert.match(result, /Do not change.*time.*palette.*building type/i);
  assert.doesNotMatch(result, /red black night warehouse/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /projects/loohii && npx tsx --test server/src/routes/workflows.test.ts
```

Expected: FAIL because `composeSeedancePrompt()` does not include scene visual locks.

- [ ] **Step 3: Extend `composeSeedancePrompt()` input**

In `composeSeedancePrompt()` input type, add:

```ts
  sceneVisualLock?: string;
```

In `regenerateWorkflowClipSeedancePrompt()`, compute before calling `composeSeedancePrompt()`:

```ts
  const sceneVisualLock = mostCommonString(group.map((shot) => stringFrom((shot as any).sceneVisualLock, "")).filter(Boolean));
```

Pass it:

```ts
    sceneVisualLock,
```

In tests that call `composeSeedancePrompt()` directly, no changes are needed because the property is optional.

- [ ] **Step 4: Insert the lock into video prompt header**

In `composeSeedancePrompt()`, add after `Scene:`:

```ts
    input.sceneVisualLock ? `Scene visual continuity lock: ${cleanVideoLine(input.sceneVisualLock)}` : "",
```

Update `compactWorkflowVideoPromptLine()` so it preserves a compact version:

```ts
  if (/^Scene visual continuity lock:/i.test(trimmed)) return compactSentence(trimmed, 520);
```

- [ ] **Step 5: Mirror lock in local canvas video prompt fallback**

In `server/src/lib/episodeCanvasSync.ts`, in `buildLocalClipVideoPrompt()`, compute:

```ts
  const sceneVisualLock = clipScenes.map((scene) => stringValue((scene as Record<string, unknown>).sceneVisualLock)).find(Boolean) || "";
```

Add after `Setting:`:

```ts
    sceneVisualLock ? `Scene visual continuity lock: ${compactPromptText(sceneVisualLock)}` : "",
```

- [ ] **Step 6: Run workflow and canvas sync tests**

Run:

```bash
cd /projects/loohii && npx tsx --test server/src/routes/workflows.test.ts && npx tsx --test server/src/lib/canvasStoryboardReferences.test.ts
```

Expected: PASS. If `canvasStoryboardReferences.test.ts` fails only because an expected prompt string lacks the new lock line, update that assertion to include `Scene visual continuity lock`.

- [ ] **Step 7: Commit video prompt lock**

Run:

```bash
cd /projects/loohii && git add server/src/routes/workflows.ts server/src/lib/episodeCanvasSync.ts server/src/routes/workflows.test.ts server/src/lib/canvasStoryboardReferences.test.ts && git commit -m "feat: include scene visual locks in video prompts"
```

Expected: commit succeeds. If `canvasStoryboardReferences.test.ts` was not modified, omit it from `git add`.

## Task 6: Add Visual Conflict Preflight For Generated Scene Assets

**Files:**
- Modify: `server/src/routes/workflows.ts`
- Modify: `server/src/routes/workflows.test.ts`

- [ ] **Step 1: Write failing conflict preflight test**

Append to `server/src/routes/workflows.test.ts`:

```ts
test("scene visual conflict warning reports visual-world drift", () => {
  const warning = internals.sceneVisualConflictWarningForTest(
    {
      canonicalSceneId: "scene-1-sanctuary-superstore-center",
      canonicalName: "Sanctuary Superstore Center",
      visualIdentity: {
        timeOfDay: "Interior dim",
        lighting: "dim superstore lighting with green fabric filtered light",
        colorPalette: "muted green, gray concrete, candle warm points",
        buildingType: "abandoned big-box superstore",
        materialLanguage: "supermarket shelves, shopping carts, concrete floor, green fabric strips",
        fixedLandmarks: ["green fabric strips", "supermarket shelves", "shopping carts", "meditation circle"],
        atmosphere: "eerie absurd cult sanctuary",
      },
      childZones: [],
      aliases: ["Pallet Altar"],
      continuityLock: "same canonical scene",
    },
    "red black night warehouse corner with brick wall and no supermarket shelves",
  );

  assert.match(warning, /视觉连续性风险/);
  assert.match(warning, /building type drift|color palette drift|fixed landmark drift/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /projects/loohii && npx tsx --test server/src/routes/workflows.test.ts
```

Expected: FAIL because `sceneVisualConflictWarningForTest` is not exported.

- [ ] **Step 3: Add warning helper**

In `server/src/routes/workflows.ts`, import `detectSceneVisualConflict`:

```ts
  detectSceneVisualConflict,
```

Add helper near image prompt utilities:

```ts
function sceneVisualConflictWarning(bible: SceneVisualBible | undefined, candidatePrompt: string): string {
  if (!bible) return "";
  const conflict = detectSceneVisualConflict(bible, candidatePrompt);
  if (conflict.pass) return "";
  return `视觉连续性风险：当前提示词可能偏离 ${bible.canonicalName} 的场景视觉身份；${conflict.reasons.join("；")}。请保持同一时间、色调、建筑类型、材质语言和固定地标。`;
}
```

Add to `workflowsTestInternals`:

```ts
  sceneVisualConflictWarningForTest: sceneVisualConflictWarning,
```

- [ ] **Step 4: Store warning on generated scene asset metadata**

In the workflow asset image generation route, after `finalPrompt` is available and before `prisma.generation.create`, find the matching bible when `input.assetKind === "scenes"`:

```ts
    const currentWorkflow = getWorkflowState(project.metadata, requestEpisodeId);
    const currentSceneBibles = Array.isArray((currentWorkflow as any).sceneVisualBibles) ? (currentWorkflow as any).sceneVisualBibles as SceneVisualBible[] : [];
    const currentAsset = findWorkflowAssetItem(currentWorkflow.assets, input.assetKind, assetName);
    const currentBible = input.assetKind === "scenes"
      ? currentSceneBibles.find((bible) => bible.canonicalSceneId === stringFrom(currentAsset?.canonicalSceneId, ""))
      : undefined;
    const visualConflictWarning = sceneVisualConflictWarning(currentBible, finalPrompt);
```

When creating `Generation.input.metadata` or `Asset.metadata`, include:

```ts
visualConflictWarning,
```

When writing back to the workflow asset item, preserve:

```ts
visualConflictWarning,
```

This is a warning only. It must not block image generation, because the generated image may still satisfy the lock even if the text prompt looks risky.

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
cd /projects/loohii && npx tsx --test server/src/routes/workflows.test.ts && npm run server:check
```

Expected: tests pass and TypeScript check passes.

- [ ] **Step 6: Commit preflight warning**

Run:

```bash
cd /projects/loohii && git add server/src/routes/workflows.ts server/src/routes/workflows.test.ts && git commit -m "feat: warn on scene visual identity drift"
```

Expected: commit succeeds.

## Task 7: Final Regression And Current Project Verification

**Files:**
- No required file changes unless tests expose a defect.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
cd /projects/loohii && npx tsx --test server/src/lib/sceneVisualContinuity.test.ts && npx tsx --test server/src/routes/workflows.test.ts && npx tsx --test server/src/lib/canvasStoryboardReferences.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run server typecheck**

Run:

```bash
cd /projects/loohii && npm run server:check
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run production build**

Run:

```bash
cd /projects/loohii && npm run build
```

Expected: PASS. Vite build completes.

- [ ] **Step 4: Inspect current project metadata after a test rerun**

After using the UI to run `提取资产并拆解分镜` on project `cmq8dw07r0003l00tewomnzwd`, run:

```bash
docker exec loohii-postgres psql -U loohii -d loohii -P pager=off -t -A -c "select metadata->'workflowCenter'->'sceneVisualBibles' from \"Project\" where id='cmq8dw07r0003l00tewomnzwd';"
```

Expected: JSON contains canonical entries for `Sanctuary Superstore Center`, `Frozen Meat Section`, `Underground Loading Dock`, and `Labor Purification Zone Approach`.

- [ ] **Step 5: Verify clip visual lock fields**

Run:

```bash
docker exec loohii-postgres psql -U loohii -d loohii -P pager=off -t -A -c "select metadata->'workflowCenter'->'breakdownScenes'->0->>'sceneVisualLock' from \"Project\" where id='cmq8dw07r0003l00tewomnzwd';"
```

Expected: output is a non-empty `Scene visual authority:` string for any breakdown scene that maps to a canonical scene.

- [ ] **Step 6: Verify generated video prompt contains visual lock**

In the UI, regenerate video prompts for a clip in `Pallet altar aisle`. The prompt should contain:

```text
Scene visual continuity lock: Scene visual authority: Sanctuary Superstore Center.
Current zone: Pallet Altar
Do not change the time of day, color palette, building type, material language, or fixed landmarks
```

Expected: the prompt still contains all S beats and remains under the Dreamina Web 3900 character target after compaction.

- [ ] **Step 7: Final git status**

Run:

```bash
cd /projects/loohii && git status --short
```

Expected: only unrelated pre-existing user changes remain. The files touched by this plan are committed.

## Self-Review

- Spec coverage: This plan covers visual identity grouping, child zone anchoring, asset image prompt locking, video prompt locking, conflict warnings, and current project verification.
- Placeholder scan: The plan contains concrete file paths, code snippets, test cases, commands, expected failures, expected passes, and commit commands.
- Type consistency: `SceneVisualBible`, `SceneVisualLockResolution`, `canonicalSceneId`, `sceneVisualLock`, `sceneZone`, and `sceneAnchors` use the same names across tests, route normalization, asset prompts, and video prompts.
