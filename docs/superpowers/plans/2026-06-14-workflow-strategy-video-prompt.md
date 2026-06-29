# Workflow Strategy Video Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the manga-drama workflow strategy-aware, remove duplicated full-pipeline controls, hide storyboard UI for Seedance multi-reference mode, and improve storyboard/video prompt inference with asset/state continuity constraints.

**Architecture:** Keep the current React + Express workflow structure. Add small strategy helpers in `canvasUtils.tsx`, route UI visibility through those helpers, and strengthen the existing workflow prompt builders in `server/src/routes/workflows.ts` instead of introducing a backend job state machine.

**Tech Stack:** React, TypeScript, Express, node:test, Vite, Prisma-backed project settings.

---

## File Map

- Modify `src/app/features/canvas/canvasUtils.tsx`: production strategy list, helpers for `chapter-board`/`first-frame`, default English rule hints, local video prompt fallback wording.
- Modify `src/app/pages/ProjectSetupPage.tsx`: hide/remove the obsolete `普通` strategy option and mark `首帧衔接` unavailable.
- Modify `src/app/features/canvas/components/WorkflowCenterOverlay.tsx`: remove duplicated top `全流程推理` and `更多操作` controls.
- Modify `src/app/features/canvas/components/StageWorkPanel.tsx`: make stage actions strategy-aware and rename the main buttons to the approved three-step flow.
- Modify `src/app/features/canvas/components/ClipStoryboardList.tsx`: hide storyboard prompt/image UI for Seedance multi-ref mode.
- Modify `src/app/features/canvas/components/ClipVideoPromptList.tsx`: add clear unavailable states for missing assets, missing breakdown, and first-frame mode.
- Modify `src/app/pages/ProjectCanvasPage.tsx`: pass generation strategy to stage/list components; adjust video sync copy; add one-time current-project global settings translation helper if matching Chinese fields exist.
- Modify `server/src/routes/workflows.ts`: strengthen breakdown/refinement prompts, add state ledger/asset constraint text, and export test helper functions if needed.
- Modify `server/src/routes/workflows.test.ts`: add readable fixtures for door-gap zombie order, asset physical constraints, and state continuation.
- Optionally modify `server/src/lib/episodeCanvasSync.ts`: mirror local video prompt wording if its fallback differs from `canvasUtils.tsx`.

## Task 1: Strategy Helpers And Defaults

**Files:**
- Modify: `src/app/features/canvas/canvasUtils.tsx`

- [ ] **Step 1: Add production strategy helpers**

Add helpers near `SEEDANCE_MULTI_REF_STRATEGY`:

```ts
export const CHAPTER_BOARD_STRATEGY = 'chapter-board';
export const FIRST_FRAME_STRATEGY = 'first-frame';

export const PROJECT_GLOBAL_GENERATION_STRATEGIES = [
  { id: 'seedance-multi-ref', title: 'Seedance 多参' },
  { id: 'chapter-board', title: '章节导演板' },
  { id: 'first-frame', title: '首帧衔接', disabled: true },
] as const;

export function isChapterBoardStrategy(value: unknown): boolean {
  const normalized = String(value || '').trim();
  return normalized === CHAPTER_BOARD_STRATEGY || normalized === '章节导演板';
}

export function isFirstFrameStrategy(value: unknown): boolean {
  const normalized = String(value || '').trim();
  return normalized === FIRST_FRAME_STRATEGY || normalized === '首帧衔接';
}

export function projectStrategySupportsStoryboard(value: unknown): boolean {
  return isChapterBoardStrategy(value);
}
```

Keep `isSeedanceMultiReferenceStrategy` unchanged except it now uses `SEEDANCE_MULTI_REF_STRATEGY`.

- [ ] **Step 2: Make fallback strategy explicit**

Change `projectGenerationStrategy()` and `createProjectGlobalSettingsDraft()` fallback from raw `'chapter-board'` to `CHAPTER_BOARD_STRATEGY`.

- [ ] **Step 3: Translate default prompt-relevant rule hints to English**

Update `PROJECT_SCRIPT_RULE_TEMPLATES` hints to English while keeping titles if the UI still expects Chinese:

```ts
{ id: 'continuity', title: '人物与气质一致性', hint: 'Keep character appearance, personality, carried items, wardrobe state, and performance state continuous across shots and clips.' }
{ id: 'world', title: '叙事与世界观', hint: 'Respect the story world, era, location, technology level, and physical rules established by the source text and assets.' }
{ id: 'camera', title: '镜头与节奏', hint: 'Use fast short-drama pacing with clear camera changes, visible actions, readable dialogue timing, and 1-3 second shots unless the story requires otherwise.' }
{ id: 'safety', title: '边界与禁用元素', hint: 'Avoid watermarks, random text, low quality output, identity drift, and visual details that conflict with locked assets.' }
```

- [ ] **Step 4: Run typecheck after helper edits**

Run: `npm run build`

Expected: Build may still fail because downstream props are not updated yet. If it fails only on missing imports/props to be handled in later tasks, continue.

## Task 2: Strategy-Aware UI Controls

**Files:**
- Modify: `src/app/features/canvas/components/WorkflowCenterOverlay.tsx`
- Modify: `src/app/features/canvas/components/StageWorkPanel.tsx`
- Modify: `src/app/features/canvas/components/ClipStoryboardList.tsx`
- Modify: `src/app/features/canvas/components/ClipVideoPromptList.tsx`
- Modify: `src/app/features/canvas/canvasUtils.tsx`
- Modify: `src/app/pages/ProjectCanvasPage.tsx`
- Modify: `src/app/pages/ProjectSetupPage.tsx`

- [ ] **Step 1: Extend component prop types**

In `canvasUtils.tsx`, add optional strategy props to the relevant prop types:

```ts
generationStrategy?: string;
storyboardEnabled?: boolean;
firstFrameUnavailable?: boolean;
```

Apply to `WorkflowCenterOverlayProps`, `StageWorkPanelProps`, `ClipStoryboardListProps`, and `ClipVideoPromptListProps` as needed.

- [ ] **Step 2: Pass strategy from canvas page**

In `ProjectCanvasPage.tsx`, compute:

```ts
const currentGenerationStrategy = projectGenerationStrategy(currentProject);
const storyboardEnabled = projectStrategySupportsStoryboard(currentGenerationStrategy);
const firstFrameUnavailable = isFirstFrameStrategy(currentGenerationStrategy);
```

Pass these into `WorkflowCenterOverlay`, `StageWorkPanel`, `ClipStoryboardList`, and `ClipVideoPromptList` through existing component nesting.

- [ ] **Step 3: Remove top duplicate controls**

In `WorkflowCenterOverlay.tsx`, delete:

- the top `全流程推理` button;
- the `更多操作` button and dropdown;
- the local `advancedMenuOpen` state if unused.

Keep the close button and `放入章节节点`.

- [ ] **Step 4: Rename and reduce main stage actions**

In `StageWorkPanel.tsx`:

- In `assets` stage, add one primary button labeled `提取资产并拆解分镜` that calls `runBreakdown`.
- In `storyboard` stage, keep one primary button labeled `重新拆解分镜` that calls `rerunStoryboard`.
- In `video` stage, replace `全流程推理` with `生成视频提示词并同步画布`, calling the current batch/full prompt path (`onFullPipelineInfer` or existing equivalent).
- Keep secondary navigation buttons like `返回原文` and `返回分镜`.

- [ ] **Step 5: Hide storyboard UI for Seedance multi-ref**

In `ClipStoryboardList.tsx`, if `storyboardEnabled === false`, hide:

- generated storyboard image list;
- Clip storyboard prompt panel;
- storyboard image generation/add-to-canvas actions.

Still show the Clip/script list and optimization controls.

- [ ] **Step 6: Add first-frame unavailable state**

In `StageWorkPanel.tsx` and `ClipVideoPromptList.tsx`, if `firstFrameUnavailable` is true:

```tsx
<div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-100">
  首帧衔接模式暂未开发。请切换到 Seedance 多参或章节导演板后继续生成。
</div>
```

Disable generation buttons in that mode.

- [ ] **Step 7: Remove `普通` from setup options**

In `ProjectSetupPage.tsx`, remove `{ id: "standard", title: "普通", ... }` from visible options. Keep `first-frame` visible but disabled if the setup UI supports disabled options; otherwise render it with unavailable copy and prevent selection.

## Task 3: Prompt Rules For Event Order, Blocking, Assets, And State

**Files:**
- Modify: `server/src/routes/workflows.ts`

- [ ] **Step 1: Strengthen breakdown prompt rules**

In `buildBreakdownPrompt()` and `buildStoryboardOnlyPrompt()`, add rules:

```ts
"- Preserve source event order exactly. If the source says an action happens before dialogue, keep that action in an earlier beat and start the dialogue later.",
"- Do not make a character speak before the source says they speak. Dialogue can overlap action only when the source explicitly makes them simultaneous.",
"- Each shot must contain concrete visible content. Never output camera-only shots such as close-up, eye-level, static, 85mm without describing what is visible.",
"- For every shot with characters, include blocking in action/references/visualPrompt: screen side or relative position, facing direction, held items, worn items, and visible state.",
"- Shot durations should vary between 1 and 3 seconds. Do not assign every shot 3 seconds.",
"- For a 13-15 second Clip, prefer 7-10 shots when the beat contains several actions, reactions, or dialogue timing changes.",
```

- [ ] **Step 2: Add asset-state rules to refinement prompt**

In `buildClipSeedancePromptRefinementPrompt()`, add:

```ts
"Every beat must explicitly restate current character blocking and physical state because the video model has no memory from previous clips.",
"Respect locked asset images and asset fact cards as hard constraints. Do not write actions that conflict with worn gear, helmets, masks, held props, body type, or locked identity.",
"Only introduce a state change such as removing a helmet or dropping a weapon when the source text, current shots, or project settings explicitly allow it.",
"Carry state forward across beats and clips until the source or shots clearly changes it back.",
"For each beat, mention screen side or relative position, facing direction, held items, worn items, and visible contamination/damage when relevant.",
```

- [ ] **Step 3: Add structured state ledger helper**

Add a small pure helper near prompt utilities:

```ts
function buildClipStateLedgerText(workflow: ReturnType<typeof getWorkflowState>, clip: NormalizedWorkflowClip, shots: NormalizedStoryboardShot[]): string {
  const clipIndex = workflow.clips.findIndex((item) => item.id === clip.id);
  const previousClips = clipIndex > 0 ? workflow.clips.slice(Math.max(0, clipIndex - 2), clipIndex) : [];
  const previous = previousClips.map((item) => `${item.title}: start=${item.startState || "unknown"}; end=${item.endState || "unknown"}; continuity=${item.layoutMemory || ""}`).join("\n");
  const current = shots.map((shot, index) => `S${index + 1}: characters=${shot.characters.join(", ") || "unknown"}; action=${shot.action || shot.description || ""}; references=${shot.references || ""}; visual=${shot.visualPrompt || ""}`).join("\n");
  return [previous ? `Previous clip state memory:\n${previous}` : "", `Current ordered state evidence:\n${current}`].filter(Boolean).join("\n\n");
}
```

Include this text in `buildClipSeedancePromptRefinementPrompt()`.

- [ ] **Step 4: Add asset facts to refinement context**

In `buildClipSeedancePromptRefinementPrompt()`, include `summarizeAssetsForStoryboardPrompt(input.workflow.assets)` under a `Current asset constraints:` heading so the model sees wearable/held item facts at video prompt refinement time.

- [ ] **Step 5: Add local prompt fallback wording**

In `composeSeedancePrompt()`, add a compact instruction line after `Characters:`:

```ts
"For every listed beat, explicitly state current blocking, facing direction, held items, worn items, and visible state when relevant."
```

## Task 4: Current Project Global Settings Translation

**Files:**
- Modify: `src/app/features/canvas/canvasUtils.tsx`
- Modify: `src/app/pages/ProjectCanvasPage.tsx`

- [ ] **Step 1: Add English default generation prompt text**

Keep `PROJECT_DEFAULT_GLOBAL_PROMPT` and `PROJECT_DEFAULT_NEGATIVE_PROMPT` English. Ensure `buildProjectGlobalPromptFromDraft()` emits English labels and keeps the project title out of translation.

- [ ] **Step 2: Add a one-shot translator for known Chinese default fields**

Add a helper in `canvasUtils.tsx`:

```ts
export function translateProjectPromptSettingsDraftToEnglish(draft: ProjectGlobalSettingsDraft): ProjectGlobalSettingsDraft {
  const translatedRules = projectDefaultScriptRules();
  return {
    ...draft,
    customStylePrompt: draft.customStylePrompt || '',
    projectTone: draft.projectTone || '',
    directorNotes: draft.directorNotes || '',
    characterIdentityRules: draft.characterIdentityRules || '',
    scriptRules: {
      ...translatedRules,
      ...Object.fromEntries(Object.entries(draft.scriptRules).map(([key, value]) => [key, value || translatedRules[key] || ''])),
    },
  };
}
```

Use this as a conservative normalizer for empty/default Chinese rules. Do not translate `title`.

- [ ] **Step 3: Wire manual save path**

In `saveProjectGlobalSettings`, call the normalizer before building the saved payload so default prompt-relevant rules are English. Preserve user-entered non-empty values unless they match old defaults exactly.

## Task 5: Tests

**Files:**
- Modify: `server/src/routes/workflows.test.ts`
- Modify: `server/src/routes/workflows.ts`

- [ ] **Step 1: Export internals if needed**

Ensure `workflowsTestInternals` exports:

```ts
buildBreakdownPrompt,
buildStoryboardOnlyPrompt,
buildClipSeedancePromptRefinementPrompt,
composeSeedancePrompt,
```

- [ ] **Step 2: Add door-gap zombie order prompt test**

Add a test that builds the breakdown prompt with the source excerpt and asserts it contains:

- `Preserve source event order exactly`;
- `Do not make a character speak before`;
- the source excerpt;
- `screen side or relative position`;
- `Shot durations should vary between 1 and 3 seconds`.

- [ ] **Step 3: Add asset physical constraint prompt test**

Add a test for the refinement prompt with an asset containing a helmet fact. Assert the prompt contains:

- `locked asset images`;
- `helmets`;
- `Only introduce a state change`;
- `Carry state forward`.

- [ ] **Step 4: Add state continuation prompt test**

Add a test with previous clip `endState: "Chloe dropped the shotgun"` and current clip shots. Assert the prompt contains:

- `Previous clip state memory`;
- `Chloe dropped the shotgun`;
- `video model has no memory`.

- [ ] **Step 5: Add compose prompt blocking instruction test**

Add a test asserting `composeSeedancePrompt()` output includes:

```text
explicitly state current blocking, facing direction, held items, worn items
```

## Task 6: Verification And Cleanup

**Files:**
- All changed files

- [ ] **Step 1: Run server typecheck**

Run: `npm run server:check`

Expected: exits 0.

- [ ] **Step 2: Run targeted backend tests**

Run: `node --import tsx --test server/src/routes/workflows.test.ts`

Expected: exits 0.

- [ ] **Step 3: Run frontend build**

Run: `npm run build`

Expected: exits 0.

- [ ] **Step 4: Inspect git diff**

Run: `git diff --stat` and `git diff --check`

Expected: changed files match this plan; no whitespace errors.

- [ ] **Step 5: Final report**

Report changed behavior, verification results, and any test/build limitations.
