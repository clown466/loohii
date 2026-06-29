# Dialogue-Safe Clip Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Loohii storyboard-to-Seedance workflow so dialogue is never cut mid-line, clip boundaries respect scene/event changes, repeated S-beat rules are hoisted out of shot lines, and positioning boards become a first-class reference in the Seedance multi-reference video flow.

**Architecture:** Add small workflow utility modules for dialogue turns, clip packing, prompt deduplication, and positioning-board metadata, then wire them into the existing `workflows.ts` and `episodeCanvasSync.ts` paths with focused compatibility changes. Keep the large existing files stable by exporting helpers from new `server/src/lib/*` modules and adding only minimal adapter calls in the route/sync code.

**Tech Stack:** TypeScript, Express, Prisma metadata JSON, Node `node:test`, ReactFlow canvas metadata, existing Loohii workflow/canvas APIs.

---

## File Structure

Create these focused modules:

- `server/src/lib/workflowDialogueTurns.ts`  
  Extracts and normalizes atomic dialogue turns, detects broken dialogue fragments, estimates speech time, and maps shot dialogue back to complete turns.

- `server/src/lib/workflowClipPacker.ts`  
  Groups normalized storyboard shots into clips using dialogue-turn atomicity, duration budgets, scene/event boundaries, and visual-over-dialogue coverage.

- `server/src/lib/workflowPromptDedupe.ts`  
  Removes repeated S-beat boilerplate by hoisting repeated rules/blocking to the prompt header and preserving only shot-specific content in each S beat.

- `server/src/lib/workflowPositioningBoards.ts`  
  Builds positioning-board prompt metadata from one clip/event and marks positioning-board references as spatial authority for video sync.

Modify existing files:

- `server/src/routes/workflows.ts`  
  Replace unsafe dialogue word-chunk splitting, call the new clip packer, add dialogue preflight warnings, and run final video prompt dedupe before saving.

- `server/src/routes/workflows.test.ts`  
  Add integration-style tests around `deriveWorkflowClipsFromShots`, `rebalanceStoryboardPacing`, `composeSeedancePrompt`, and final prompt output.

- `server/src/lib/clipDialogueAllocator.test.ts`  
  Keep existing allocator tests and add one regression to show it merges clip12-style fragments.

- `server/src/lib/episodeCanvasSync.ts`  
  Add positioning-board image references into Seedance multi-reference video sections and expose them in node metadata.

- `server/src/lib/canvasStoryboardReferences.ts` if needed  
  Do not add storyboard nodes for Seedance multi-ref. Only adjust if positioning-board refs are filtered incorrectly.

- `scripts/add-clip-positioning-board-flows.ts`  
  Reuse `workflowPositioningBoards.ts` prompt builder and write metadata compatible with video sync.

Tests to create:

- `server/src/lib/workflowDialogueTurns.test.ts`
- `server/src/lib/workflowClipPacker.test.ts`
- `server/src/lib/workflowPromptDedupe.test.ts`
- `server/src/lib/workflowPositioningBoards.test.ts`

Important execution note:

- Do not commit automatically in this dirty worktree unless the user explicitly asks. The step text includes commit checkpoints because the plan format requires them, but in this repository replace commit steps with “show `git diff --stat` and wait for approval” unless user has already approved commits.

---

### Task 1: Atomic Dialogue Turn Utilities

**Files:**
- Create: `server/src/lib/workflowDialogueTurns.ts`
- Create: `server/src/lib/workflowDialogueTurns.test.ts`
- Modify: none in production callers yet

- [ ] **Step 1: Write failing tests for source dialogue extraction and fragment detection**

Create `server/src/lib/workflowDialogueTurns.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  detectBrokenDialogueFragments,
  estimateDialogueSeconds,
  extractSourceDialogueTurns,
  mergeShotDialogueWithSourceTurns,
} from "./workflowDialogueTurns";

test("extractSourceDialogueTurns keeps each quoted line atomic with speaker when narrated nearby", () => {
  const source = [
    'Flora smiled into the cafeteria microphone.',
    '"My dear children, thank you for your hard work today. Under the Earth Mother\'s watchful eye, your sweat shall become nutrients for the altar."',
    '"Tonight, we will hold our first Pre-Harvest Ritual."',
  ].join("\n");

  const turns = extractSourceDialogueTurns(source, ["Flora"]);

  assert.equal(turns.length, 2);
  assert.equal(turns[0].speaker, "Flora");
  assert.equal(
    turns[0].text,
    "My dear children, thank you for your hard work today. Under the Earth Mother's watchful eye, your sweat shall become nutrients for the altar.",
  );
  assert.equal(turns[0].atomic, true);
  assert.equal(turns[1].text, "Tonight, we will hold our first Pre-Harvest Ritual.");
});

test("detectBrokenDialogueFragments catches clip12-style incomplete English fragments", () => {
  const fragments = detectBrokenDialogueFragments([
    "Flora: My dear children, thank you for your hard",
    "Flora: work today. Under the Earth Mother's watchful",
    "Flora: eye, your sweat shall become nutrients for the altar.",
    "Flora: Let us rejoice for our brothers and sisters who",
  ]);

  assert.deepEqual(fragments.map((item) => item.dialogue), [
    "Flora: My dear children, thank you for your hard",
    "Flora: work today. Under the Earth Mother's watchful",
    "Flora: Let us rejoice for our brothers and sisters who",
  ]);
  assert.ok(fragments.every((item) => item.reason === "missing-terminal-punctuation-or-likely-mid-clause"));
});

test("mergeShotDialogueWithSourceTurns replaces fragmented shot dialogue with complete source turn once", () => {
  const sourceTurns = [
    {
      id: "dlg-001",
      speaker: "Flora",
      text: "My dear children, thank you for your hard work today. Under the Earth Mother's watchful eye, your sweat shall become nutrients for the altar.",
      sourceIndex: 0,
      wordCount: 22,
      estimatedSpeechSeconds: 6.9,
      atomic: true,
    },
  ];

  const merged = mergeShotDialogueWithSourceTurns([
    { id: "shot-076", dialogue: "Flora: My dear children, thank you for your hard", characters: ["Flora"] },
    { id: "shot-078", dialogue: "Flora: work today. Under the Earth Mother's watchful", characters: ["Flora"] },
    { id: "shot-079", dialogue: "Flora: eye, your sweat shall become nutrients for the altar.", characters: ["Flora"] },
  ], sourceTurns);

  assert.equal(
    merged[0].dialogue,
    "Flora: My dear children, thank you for your hard work today. Under the Earth Mother's watchful eye, your sweat shall become nutrients for the altar.",
  );
  assert.equal(merged[0].dialogueTurnId, "dlg-001");
  assert.equal(merged[1].dialogue, "");
  assert.equal(merged[1].coveredByDialogueTurnId, "dlg-001");
  assert.equal(merged[2].dialogue, "");
  assert.equal(merged[2].coveredByDialogueTurnId, "dlg-001");
});

test("estimateDialogueSeconds uses fast animation pace without allowing zero-time long lines", () => {
  assert.equal(estimateDialogueSeconds("Flora: Tonight, we will hold our first Pre-Harvest Ritual."), 3);
  assert.equal(
    estimateDialogueSeconds("Flora: My dear children, thank you for your hard work today. Under the Earth Mother's watchful eye, your sweat shall become nutrients for the altar."),
    7,
  );
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npx tsx server/src/lib/workflowDialogueTurns.test.ts
```

Expected: FAIL because `workflowDialogueTurns.ts` does not exist.

- [ ] **Step 3: Implement dialogue turn utility module**

Create `server/src/lib/workflowDialogueTurns.ts`:

```ts
export type WorkflowDialogueTurn = {
  id: string;
  speaker: string;
  text: string;
  sourceIndex: number;
  wordCount: number;
  estimatedSpeechSeconds: number;
  atomic: true;
};

export type WorkflowShotDialogueInput = {
  id: string;
  dialogue: string;
  characters: string[];
};

export type WorkflowShotDialogueOutput = WorkflowShotDialogueInput & {
  dialogueTurnId?: string;
  coveredByDialogueTurnId?: string;
};

export type BrokenDialogueFragment = {
  dialogue: string;
  index: number;
  reason: "missing-terminal-punctuation-or-likely-mid-clause";
};

const SPEECH_WORDS_PER_SECOND = 3.2;
const SPEAKER_PREFIX_PATTERN =
  /^\s*([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}|[一-龥·]{1,12})\s*[:：]\s*([\s\S]+)$/;
const TERMINAL_PUNCTUATION_PATTERN = /[.!?。！？…]["'”’」』)]*$/;
const QUOTED_DIALOGUE_PATTERN = /["“”‘’'「『]([^"“”‘’'」』]{2,500})["“”‘’'」』]/g;
const LABELLED_DIALOGUE_PATTERN =
  /(?:^|\n|\s)([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}|[一-龥·]{1,12})\s*[:：]\s*([^。！？.!?\n]{2,500}[。！？.!?]?)/g;
const MID_CLAUSE_ENDING_PATTERN =
  /\b(?:a|an|the|and|or|but|for|to|of|in|on|at|with|from|under|over|who|which|that|hard|watchful|dear|our|your|their|his|her|its|shall|will|would|could|should)\s*$/i;

export function extractSourceDialogueTurns(sourceText: string, knownSpeakers: string[] = []): WorkflowDialogueTurn[] {
  const source = String(sourceText || "");
  const speaker = knownSpeakers.find(Boolean) || "";
  const quoted = Array.from(source.matchAll(QUOTED_DIALOGUE_PATTERN))
    .map((match) => ({ speaker, text: cleanDialogueText(match[1] ?? ""), sourceIndex: match.index ?? 0 }))
    .filter((item) => item.text);
  const labelled = Array.from(source.matchAll(LABELLED_DIALOGUE_PATTERN))
    .map((match) => ({
      speaker: cleanDialogueText(match[1] ?? ""),
      text: cleanDialogueText(match[2] ?? ""),
      sourceIndex: match.index ?? 0,
    }))
    .filter((item) => item.speaker && item.text);
  const merged = uniqueTurns([...quoted, ...labelled].sort((a, b) => a.sourceIndex - b.sourceIndex));
  return merged.map((turn, index) => buildDialogueTurn(turn.speaker, turn.text, turn.sourceIndex, index));
}

export function estimateDialogueSeconds(dialogue: string): number {
  const text = stripSpeakerPrefix(dialogue);
  const words = countDialogueWords(text);
  if (words <= 0) return 0;
  return Math.max(1, Math.ceil(words / SPEECH_WORDS_PER_SECOND));
}

export function detectBrokenDialogueFragments(dialogues: string[]): BrokenDialogueFragment[] {
  return dialogues
    .map((dialogue, index) => ({ dialogue: cleanDialogueText(dialogue), index }))
    .filter((item) => item.dialogue && isLikelyBrokenDialogue(item.dialogue))
    .map((item) => ({
      dialogue: item.dialogue,
      index: item.index,
      reason: "missing-terminal-punctuation-or-likely-mid-clause" as const,
    }));
}

export function mergeShotDialogueWithSourceTurns(
  shots: WorkflowShotDialogueInput[],
  sourceTurns: WorkflowDialogueTurn[],
): WorkflowShotDialogueOutput[] {
  const output: WorkflowShotDialogueOutput[] = shots.map((shot) => ({ ...shot, dialogue: cleanDialogueText(shot.dialogue) }));
  const consumedShotIds = new Set<string>();

  for (const turn of sourceTurns) {
    const match = findShotFragmentSequenceForTurn(output, turn, consumedShotIds);
    if (!match.length) continue;
    const firstIndex = match[0];
    output[firstIndex] = {
      ...output[firstIndex],
      dialogue: formatDialogue(turn.speaker, turn.text),
      dialogueTurnId: turn.id,
    };
    consumedShotIds.add(output[firstIndex].id);
    for (const coveredIndex of match.slice(1)) {
      output[coveredIndex] = {
        ...output[coveredIndex],
        dialogue: "",
        coveredByDialogueTurnId: turn.id,
      };
      consumedShotIds.add(output[coveredIndex].id);
    }
  }

  return output;
}

function buildDialogueTurn(speaker: string, text: string, sourceIndex: number, index: number): WorkflowDialogueTurn {
  const clean = cleanDialogueText(text);
  return {
    id: `dlg-${String(index + 1).padStart(3, "0")}`,
    speaker: cleanDialogueText(speaker),
    text: clean,
    sourceIndex,
    wordCount: countDialogueWords(clean),
    estimatedSpeechSeconds: estimateDialogueSeconds(clean),
    atomic: true,
  };
}

function findShotFragmentSequenceForTurn(
  shots: WorkflowShotDialogueOutput[],
  turn: WorkflowDialogueTurn,
  consumedShotIds: Set<string>,
): number[] {
  const target = normalizeDialogueKey(turn.text);
  if (!target) return [];
  for (let start = 0; start < shots.length; start += 1) {
    if (consumedShotIds.has(shots[start].id)) continue;
    let combined = "";
    const indexes: number[] = [];
    for (let index = start; index < shots.length; index += 1) {
      const shot = shots[index];
      if (consumedShotIds.has(shot.id)) break;
      const raw = stripSpeakerPrefix(shot.dialogue);
      if (!raw) {
        if (indexes.length) indexes.push(index);
        continue;
      }
      combined = [combined, raw].filter(Boolean).join(" ");
      indexes.push(index);
      const key = normalizeDialogueKey(combined);
      if (target === key || target.includes(key) || key.includes(target)) {
        if (target === key || key.length >= Math.floor(target.length * 0.86)) return indexes;
      }
      if (!target.startsWith(key.slice(0, Math.min(key.length, target.length)))) break;
    }
  }
  return [];
}

function isLikelyBrokenDialogue(dialogue: string): boolean {
  const text = stripSpeakerPrefix(dialogue);
  if (!text) return false;
  if (TERMINAL_PUNCTUATION_PATTERN.test(text)) return false;
  if (MID_CLAUSE_ENDING_PATTERN.test(text)) return true;
  return countDialogueWords(text) >= 4;
}

function formatDialogue(speaker: string, text: string): string {
  return speaker ? `${speaker}: ${text}` : text;
}

function stripSpeakerPrefix(dialogue: string): string {
  const match = cleanDialogueText(dialogue).match(SPEAKER_PREFIX_PATTERN);
  return match ? cleanDialogueText(match[2] ?? "") : cleanDialogueText(dialogue);
}

function cleanDialogueText(value: string): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?，。！？；：])/g, "$1")
    .trim()
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "")
    .trim();
}

function countDialogueWords(text: string): number {
  const english = stripSpeakerPrefix(text).match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g) ?? [];
  if (english.length) return english.length;
  const cjk = stripSpeakerPrefix(text).match(/[\u4e00-\u9fa5]/g) ?? [];
  return Math.ceil(cjk.length / 2);
}

function normalizeDialogueKey(value: string): string {
  return stripSpeakerPrefix(value)
    .toLowerCase()
    .replace(/["'“”‘’「」『』]/g, "")
    .replace(/[\s.,!?;:，。！？；：/\\-]+/g, " ")
    .trim();
}

function uniqueTurns<T extends { speaker: string; text: string; sourceIndex: number }>(turns: T[]): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const turn of turns) {
    const key = `${turn.speaker.toLowerCase()}|${normalizeDialogueKey(turn.text)}`;
    if (!normalizeDialogueKey(turn.text) || seen.has(key)) continue;
    seen.add(key);
    output.push(turn);
  }
  return output;
}
```

- [ ] **Step 4: Run utility tests and verify they pass**

Run:

```bash
npx tsx server/src/lib/workflowDialogueTurns.test.ts
```

Expected: PASS.

- [ ] **Step 5: Review diff instead of committing unless approved**

Run:

```bash
git diff --stat server/src/lib/workflowDialogueTurns.ts server/src/lib/workflowDialogueTurns.test.ts
```

Expected: two new files. Do not commit unless the user explicitly approves commits.

---

### Task 2: Stop Rebalancing From Splitting Dialogue Mid-Turn

**Files:**
- Modify: `server/src/routes/workflows.ts`
- Modify: `server/src/routes/workflows.test.ts`

- [ ] **Step 1: Add failing regression test for clip12-style rebalancing**

Append this test to `server/src/routes/workflows.test.ts`:

```ts
test("rebalanceStoryboardPacing does not split a complete long dialogue into word chunks", () => {
  const storyboard = [{
    id: "shot-001",
    title: "Flora PA announcement",
    description: "Flora addresses the cafeteria.",
    action: "Flora speaks over the PA while the trio reacts.",
    dialogue: "Flora: My dear children, thank you for your hard work today. Under the Earth Mother's watchful eye, your sweat shall become nutrients for the altar.",
    durationSeconds: 3,
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
    characters: ["Flora", "Chloe", "Bob", "Leo"],
    setting: "Sanctuary Cafeteria",
    references: "Flora voice over PA.",
    visualPrompt: "Cafeteria listens to Flora PA announcement.",
  }] as any[];

  const paced = internals.rebalanceStoryboardPacing(storyboard);
  const dialogueShots = paced.filter((shot: any) => String(shot.dialogue || "").trim());

  assert.equal(dialogueShots.length, 1);
  assert.equal(
    dialogueShots[0].dialogue,
    "Flora: My dear children, thank you for your hard work today. Under the Earth Mother's watchful eye, your sweat shall become nutrients for the altar.",
  );
  assert.ok(paced.length >= 2, "long dialogue should gain silent visual coverage shots instead of text chunks");
  assert.ok(paced.slice(1).every((shot: any) => !String(shot.dialogue || "").trim()));
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx tsx server/src/routes/workflows.test.ts --test-name-pattern "rebalanceStoryboardPacing does not split"
```

Expected: FAIL because current `rebalanceStoryboardPacing` calls `splitDialogueIntoWordChunks`.

- [ ] **Step 3: Replace dialogue word chunking with silent visual coverage**

In `server/src/routes/workflows.ts`, replace the `else` branch in `rebalanceStoryboardPacing` that calls `splitDialogueIntoWordChunks(...)` with this implementation:

```ts
    } else {
      const fullDialogue = cleanVideoDialogue(shot.dialogue || "");
      const speechDuration = Math.max(1, Math.ceil(words / TARGET_DIALOGUE_WORDS_PER_SECOND));
      const primaryDuration = clampShotDuration(Math.min(3, speechDuration));
      rebalanced.push(
        refreshShotProfessionalFields(
          {
            ...shot,
            dialogue: fullDialogue,
            subtitle: fullDialogue,
            durationSeconds: primaryDuration,
          },
          rebalanced.length,
        ),
      );

      const silentCoverageCount = Math.min(
        4,
        Math.max(1, Math.ceil(speechDuration / 2) - 1),
      );
      for (let coverageIndex = 0; coverageIndex < silentCoverageCount; coverageIndex += 1) {
        if (rebalanced.length >= MAX_REBALANCED_STORYBOARD_SHOTS) break;
        rebalanced.push(
          refreshShotProfessionalFields(
            {
              ...shot,
              title: `${shot.title} dialogue coverage ${coverageIndex + 1}`,
              description: `${shot.description || shot.action || shot.title} Silent visual coverage while the same dialogue continues.`,
              action: followupShotAction({
                ...shot,
                dialogue: fullDialogue,
              }),
              dialogue: "",
              subtitle: "",
              durationSeconds: 1,
              visualPrompt: followupShotVisualPrompt(shot),
              references: [
                shot.references,
                "Same dialogue turn continues over this silent reaction/cutaway shot.",
              ].filter(Boolean).join(" "),
            },
            rebalanced.length,
          ),
        );
      }
    }
```

Do not delete `splitDialogueIntoWordChunks` yet if other tests or internals still reference it. It can remain unused until a later cleanup.

- [ ] **Step 4: Run focused test and existing workflow tests**

Run:

```bash
npx tsx server/src/routes/workflows.test.ts --test-name-pattern "rebalanceStoryboardPacing does not split"
npx tsx server/src/routes/workflows.test.ts
```

Expected: both PASS.

- [ ] **Step 5: Review diff**

Run:

```bash
git diff --stat server/src/routes/workflows.ts server/src/routes/workflows.test.ts
```

Expected: `rebalanceStoryboardPacing` no longer creates chunked dialogue shots.

---

### Task 3: Dialogue-Safe Clip Packer

**Files:**
- Create: `server/src/lib/workflowClipPacker.ts`
- Create: `server/src/lib/workflowClipPacker.test.ts`
- Modify: `server/src/routes/workflows.ts`
- Modify: `server/src/routes/workflows.test.ts`

- [ ] **Step 1: Write failing tests for clip packing before dialogue overflow and scene/event boundaries**

Create `server/src/lib/workflowClipPacker.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { packWorkflowClipGroups, type PackableWorkflowShot } from "./workflowClipPacker";

function shot(input: Partial<PackableWorkflowShot> & { id: string }): PackableWorkflowShot {
  return {
    id: input.id,
    setting: input.setting ?? "Sanctuary Cafeteria",
    action: input.action ?? "Characters react.",
    description: input.description ?? input.action ?? "Characters react.",
    dialogue: input.dialogue ?? "",
    dialogueTurnId: input.dialogueTurnId,
    coveredByDialogueTurnId: input.coveredByDialogueTurnId,
    sceneEventKey: input.sceneEventKey ?? "sanctuary-cafeteria|ritual-announcement",
    durationSeconds: input.durationSeconds ?? 2,
    characters: input.characters ?? ["Chloe"],
  };
}

test("packer starts a new clip before a complete dialogue turn that would exceed max duration", () => {
  const groups = packWorkflowClipGroups([
    shot({ id: "setup-1", durationSeconds: 3, action: "The trio sits tensely." }),
    shot({ id: "setup-2", durationSeconds: 3, action: "Cultists freeze." }),
    shot({ id: "setup-3", durationSeconds: 3, action: "The PA light switches on." }),
    shot({
      id: "flora-line",
      dialogueTurnId: "dlg-flora-long",
      dialogue: "Flora: My dear children, thank you for your hard work today. Under the Earth Mother's watchful eye, your sweat shall become nutrients for the altar.",
      durationSeconds: 7,
      characters: ["Flora", "Chloe", "Bob", "Leo"],
    }),
  ], { maxClipSeconds: 15, targetClipSeconds: 13 });

  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].map((item) => item.id), ["setup-1", "setup-2", "setup-3"]);
  assert.deepEqual(groups[1].map((item) => item.id), ["flora-line"]);
});

test("packer keeps visual coverage shots with their dialogue turn even when they have no dialogue text", () => {
  const groups = packWorkflowClipGroups([
    shot({
      id: "flora-line",
      dialogueTurnId: "dlg-flora-long",
      dialogue: "Flora: My dear children, thank you for your hard work today.",
      durationSeconds: 4,
      characters: ["Flora"],
    }),
    shot({
      id: "chloe-reaction",
      dialogue: "",
      coveredByDialogueTurnId: "dlg-flora-long",
      durationSeconds: 1,
      characters: ["Chloe"],
    }),
    shot({
      id: "bob-reaction",
      dialogue: "",
      coveredByDialogueTurnId: "dlg-flora-long",
      durationSeconds: 1,
      characters: ["Bob"],
    }),
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map((item) => item.id), ["flora-line", "chloe-reaction", "bob-reaction"]);
});

test("packer splits when canonical scene or event changes even if duration is available", () => {
  const groups = packWorkflowClipGroups([
    shot({ id: "cafeteria-1", setting: "Sanctuary Cafeteria", sceneEventKey: "cafeteria|ritual" }),
    shot({ id: "cafeteria-2", setting: "Sanctuary Cafeteria", sceneEventKey: "cafeteria|ritual" }),
    shot({ id: "freezer-1", setting: "Frozen Meat Section", sceneEventKey: "freezer|wall-whisper" }),
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].map((item) => item.id), ["cafeteria-1", "cafeteria-2"]);
  assert.deepEqual(groups[1].map((item) => item.id), ["freezer-1"]);
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npx tsx server/src/lib/workflowClipPacker.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement `workflowClipPacker.ts`**

Create `server/src/lib/workflowClipPacker.ts`:

```ts
export type PackableWorkflowShot = {
  id: string;
  setting: string;
  action: string;
  description: string;
  dialogue: string;
  dialogueTurnId?: string;
  coveredByDialogueTurnId?: string;
  sceneEventKey?: string;
  durationSeconds: number;
  characters: string[];
};

export type WorkflowClipPackingOptions = {
  maxClipSeconds?: number;
  targetClipSeconds?: number;
  maxShotsPerClip?: number;
};

export function packWorkflowClipGroups<T extends PackableWorkflowShot>(
  shots: T[],
  options: WorkflowClipPackingOptions = {},
): T[][] {
  const maxClipSeconds = options.maxClipSeconds ?? 15;
  const targetClipSeconds = options.targetClipSeconds ?? 13;
  const maxShotsPerClip = options.maxShotsPerClip ?? 12;
  const groups: T[][] = [];
  let current: T[] = [];
  let currentDuration = 0;

  const flush = () => {
    if (current.length) groups.push(current);
    current = [];
    currentDuration = 0;
  };

  for (const shot of shots) {
    const shotDuration = normalizedDuration(shot);
    const nextDuration = currentDuration + shotDuration;
    const shouldSplit =
      current.length > 0 &&
      !continuesCurrentDialogueTurn(current, shot) &&
      (
        current.length >= maxShotsPerClip ||
        sceneEventChanged(current[0], shot) ||
        nextDuration > maxClipSeconds ||
        startsDialogueThatShouldMoveToNextClip(currentDuration, shotDuration, shot, targetClipSeconds, maxClipSeconds)
      );

    if (shouldSplit) flush();
    current.push(shot);
    currentDuration += shotDuration;
  }
  flush();
  return groups;
}

export function workflowSceneEventKey(shot: {
  canonicalSceneId?: string;
  sceneZone?: string;
  setting?: string;
  title?: string;
  description?: string;
  action?: string;
}): string {
  const scene = normalizeKey(shot.canonicalSceneId || shot.setting || "");
  const zone = normalizeKey(shot.sceneZone || "");
  const event = inferEventKey(`${shot.title || ""} ${shot.description || ""} ${shot.action || ""}`);
  return [scene, zone, event].filter(Boolean).join("|");
}

function startsDialogueThatShouldMoveToNextClip(
  currentDuration: number,
  shotDuration: number,
  shot: PackableWorkflowShot,
  targetClipSeconds: number,
  maxClipSeconds: number,
): boolean {
  if (!shot.dialogueTurnId || !shot.dialogue.trim()) return false;
  if (currentDuration < targetClipSeconds) return false;
  return currentDuration + shotDuration > maxClipSeconds;
}

function continuesCurrentDialogueTurn<T extends PackableWorkflowShot>(current: T[], shot: T): boolean {
  const activeTurnId = current
    .map((item) => item.dialogueTurnId || item.coveredByDialogueTurnId || "")
    .filter(Boolean)
    .at(-1);
  const nextTurnId = shot.dialogueTurnId || shot.coveredByDialogueTurnId || "";
  return Boolean(activeTurnId && nextTurnId && activeTurnId === nextTurnId);
}

function sceneEventChanged(previous: PackableWorkflowShot, next: PackableWorkflowShot): boolean {
  const previousKey = normalizeKey(previous.sceneEventKey || previous.setting);
  const nextKey = normalizeKey(next.sceneEventKey || next.setting);
  if (!previousKey || !nextKey) return false;
  return previousKey !== nextKey;
}

function normalizedDuration(shot: PackableWorkflowShot): number {
  const value = Number(shot.durationSeconds);
  return Number.isFinite(value) ? Math.max(1, Math.min(15, Math.round(value))) : 2;
}

function inferEventKey(text: string): string {
  const normalized = normalizeKey(text);
  if (/trial|judge|审判/.test(normalized)) return "trial";
  if (/ritual|harvest|announce|announcement|pa|仪式|广播|宣布/.test(normalized)) return "ritual-announcement";
  if (/freezer|fungus|wall|whisper|冷冻|真菌|墙/.test(normalized)) return "freezer-discovery";
  if (/escape|run|chase|逃|追/.test(normalized)) return "escape";
  return compactKey(normalized, 60);
}

function normalizeKey(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .trim();
}

function compactKey(value: string, limit: number): string {
  return value.slice(0, limit).replace(/-+$/g, "");
}
```

- [ ] **Step 4: Run clip packer tests**

Run:

```bash
npx tsx server/src/lib/workflowClipPacker.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire packer into `deriveWorkflowClipsFromShots`**

In `server/src/routes/workflows.ts`, add imports near the top:

```ts
import { packWorkflowClipGroups, workflowSceneEventKey } from "../lib/workflowClipPacker";
```

Replace the grouping loop in `deriveWorkflowClipsFromShots` with:

```ts
  const groups = packWorkflowClipGroups(
    shots.map((shot) => ({
      ...shot,
      sceneEventKey: workflowSceneEventKey(shot),
      durationSeconds: clampShotDuration(shot.durationSeconds),
    })),
    {
      maxClipSeconds: MAX_CLIP_DURATION_SECONDS,
      targetClipSeconds: MIN_CLIP_TARGET_SECONDS,
      maxShotsPerClip: MAX_CLIP_STORYBOARD_PANEL_COUNT,
    },
  );
```

Keep the final line:

```ts
  return groups.map((group, index) => buildWorkflowClip(group, index, context));
```

Delete only the old local grouping variables and loop. Do not modify `buildWorkflowClip` in this step.

- [ ] **Step 6: Add workflows regression for scene/event split**

Append to `server/src/routes/workflows.test.ts`:

```ts
test("deriveWorkflowClipsFromShots splits scene-event changes before positioning-board conflicts", () => {
  const shots = [
    {
      id: "cafeteria-1",
      title: "Flora ritual announcement",
      description: "Flora speaks in the cafeteria.",
      action: "Chloe and Bob listen from the cafeteria corner.",
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
      characters: ["Chloe", "Bob", "Flora"],
      setting: "Sanctuary Cafeteria",
      references: "",
      canonicalSceneId: "scene-1-sanctuary-superstore-center",
      sceneZone: "Sanctuary Cafeteria",
      visualPrompt: "",
    },
    {
      id: "freezer-1",
      title: "Frozen wall whisper",
      description: "The scene shifts to the freezer wall.",
      action: "Leo notices fungus spreading across the freezer wall.",
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
      characters: ["Leo"],
      setting: "Frozen Meat Section",
      references: "",
      canonicalSceneId: "scene-1-frozen-meat-section",
      sceneZone: "Frozen Meat Section",
      visualPrompt: "",
    },
  ] as any[];

  const clips = internals.deriveWorkflowClipsFromShots(shots);

  assert.equal(clips.length, 2);
  assert.deepEqual(clips[0].shotIds, ["cafeteria-1"]);
  assert.deepEqual(clips[1].shotIds, ["freezer-1"]);
});
```

- [ ] **Step 7: Run workflow tests**

Run:

```bash
npx tsx server/src/routes/workflows.test.ts --test-name-pattern "deriveWorkflowClipsFromShots splits scene-event"
npx tsx server/src/routes/workflows.test.ts
```

Expected: PASS.

- [ ] **Step 8: Review diff**

Run:

```bash
git diff --stat server/src/lib/workflowClipPacker.ts server/src/lib/workflowClipPacker.test.ts server/src/routes/workflows.ts server/src/routes/workflows.test.ts
```

Expected: new packer module and small route integration.

---

### Task 4: Source Dialogue Turn Integration in Normalization

**Files:**
- Modify: `server/src/routes/workflows.ts`
- Modify: `server/src/routes/workflows.test.ts`
- Modify: `server/src/lib/clipDialogueAllocator.test.ts`

- [ ] **Step 1: Add failing test that clip12 fragments are repaired before clips are derived**

Append to `server/src/routes/workflows.test.ts`:

```ts
test("normalizeBreakdown repairs source dialogue fragments before clip derivation", () => {
  const sourceText = [
    '"My dear children, thank you for your hard work today. Under the Earth Mother\'s watchful eye, your sweat shall become nutrients for the altar."',
    '"Tonight, we will hold our first Pre-Harvest Ritual."',
  ].join("\n");
  const raw = {
    summary: "Flora announces ritual.",
    characters: [{ name: "Flora" }, { name: "Chloe" }, { name: "Bob" }, { name: "Leo" }],
    locations: [{ name: "Sanctuary Cafeteria" }],
    props: [],
    storyboard: [
      {
        title: "Flora announcement setup",
        description: "Flora's voice fills the cafeteria.",
        action: "Cultists sit rigid while the trio listens.",
        dialogue: "Flora: My dear children, thank you for your hard",
        durationSeconds: 3,
        characters: ["Flora", "Chloe", "Bob", "Leo"],
        setting: "Sanctuary Cafeteria",
      },
      {
        title: "Flora announcement continues",
        description: "The cafeteria listens.",
        action: "Chloe reacts while the PA continues.",
        dialogue: "Flora: work today. Under the Earth Mother's watchful",
        durationSeconds: 2,
        characters: ["Flora", "Chloe"],
        setting: "Sanctuary Cafeteria",
      },
      {
        title: "Flora announcement finishes",
        description: "The line lands.",
        action: "Bob stares at the PA speaker.",
        dialogue: "Flora: eye, your sweat shall become nutrients for the altar.",
        durationSeconds: 2,
        characters: ["Flora", "Bob"],
        setting: "Sanctuary Cafeteria",
      },
    ],
  };

  const normalized = internals.normalizeBreakdown(raw, {
    sourceText,
    project: { name: "test", settings: {}, metadata: {}, aspectRatio: "9:16" },
  } as any);

  const dialogueShots = normalized.storyboard.filter((shot: any) => String(shot.dialogue || "").trim());
  assert.equal(dialogueShots.length, 1);
  assert.equal(
    dialogueShots[0].dialogue,
    "Flora: My dear children, thank you for your hard work today. Under the Earth Mother's watchful eye, your sweat shall become nutrients for the altar.",
  );
  assert.ok(normalized.storyboard.slice(1).every((shot: any) => !String(shot.dialogue || "").trim()));
});
```

- [ ] **Step 2: Run focused test and verify failure**

Run:

```bash
npx tsx server/src/routes/workflows.test.ts --test-name-pattern "normalizeBreakdown repairs source dialogue fragments"
```

Expected: FAIL because `normalizeBreakdown` does not call `workflowDialogueTurns` yet.

- [ ] **Step 3: Import and call dialogue repair after storyboard normalization**

In `server/src/routes/workflows.ts`, add import:

```ts
import {
  detectBrokenDialogueFragments,
  extractSourceDialogueTurns,
  mergeShotDialogueWithSourceTurns,
} from "../lib/workflowDialogueTurns";
```

Find `normalizeBreakdown(...)`. After `storyboardDraft` is normalized and before `rebalanceStoryboardPacing(...)` or `deriveWorkflowClipsFromShots(...)`, insert:

```ts
  const knownSpeakerNames = [
    ...characters.map((character) => character.name),
    ...storyboardDraft.flatMap((shot) => shot.characters),
  ].filter(Boolean);
  const sourceTurns = extractSourceDialogueTurns(stringFrom(context?.sourceText, ""), knownSpeakerNames);
  const dialogueRepairedStoryboard = sourceTurns.length
    ? mergeShotDialogueWithSourceTurns(
        storyboardDraft.map((shot) => ({
          id: shot.id,
          dialogue: shot.dialogue,
          characters: shot.characters,
        })),
        sourceTurns,
      )
    : storyboardDraft.map((shot) => ({ id: shot.id, dialogue: shot.dialogue, characters: shot.characters }));
  const storyboardWithDialogueLocks = storyboardDraft.map((shot, index) => ({
    ...shot,
    dialogue: dialogueRepairedStoryboard[index]?.dialogue ?? shot.dialogue,
    subtitle: dialogueRepairedStoryboard[index]?.dialogue ?? shot.subtitle,
    dialogueTurnId: dialogueRepairedStoryboard[index]?.dialogueTurnId,
    coveredByDialogueTurnId: dialogueRepairedStoryboard[index]?.coveredByDialogueTurnId,
  }));
```

Then pass `storyboardWithDialogueLocks` into `normalizeFragmentedStoryboardDialogue` / `rebalanceStoryboardPacing` instead of the original `storyboardDraft`.

If `context?.sourceText` is not currently available in `normalizeBreakdown`, update the normalization context type to include optional `sourceText?: string`, and pass it from the callers that already have `input.sourceText` or `workflow.sourceText`.

- [ ] **Step 4: Add preflight warning for unrepaired broken fragments**

In `normalizeBreakdown`, after final paced storyboard is available, collect:

```ts
  const brokenDialogueFragments = detectBrokenDialogueFragments(storyboard.map((shot) => shot.dialogue));
```

When building clips, include a warning in `clip.preflight.warnings` for clips whose `shotIds` contain any broken fragment index:

```ts
`检测到疑似半句对白：${fragment.dialogue}`
```

Do not block saving yet; this is a warning. Blocking comes after UI support.

- [ ] **Step 5: Run focused and full workflow tests**

Run:

```bash
npx tsx server/src/routes/workflows.test.ts --test-name-pattern "normalizeBreakdown repairs source dialogue fragments"
npx tsx server/src/routes/workflows.test.ts
npx tsx server/src/lib/workflowDialogueTurns.test.ts
```

Expected: PASS.

- [ ] **Step 6: Add allocator regression for fragments ending without punctuation**

Append to `server/src/lib/clipDialogueAllocator.test.ts`:

```ts
test("clip12-style Flora fragments merge into the starting beat when all fragments are present", () => {
  const result = allocateClipDialogueToBeats([
    { dialogue: "Flora: My dear children, thank you for your hard", characters: ["Flora", "Chloe"] },
    { dialogue: "Flora: work today. Under the Earth Mother's watchful", characters: ["Flora", "Chloe"] },
    { dialogue: "Flora: eye, your sweat shall become nutrients for the altar.", characters: ["Flora", "Bob"] },
  ]);

  assert.deepEqual(result.beats, [
    ["Flora: My dear children, thank you for your hard work today. Under the Earth Mother's watchful eye, your sweat shall become nutrients for the altar."],
    [],
    [],
  ]);
});
```

- [ ] **Step 7: Run allocator tests**

Run:

```bash
npx tsx server/src/lib/clipDialogueAllocator.test.ts
```

Expected: PASS.

---

### Task 5: Prompt S-Beat Boilerplate Hoisting

**Files:**
- Create: `server/src/lib/workflowPromptDedupe.ts`
- Create: `server/src/lib/workflowPromptDedupe.test.ts`
- Modify: `server/src/routes/workflows.ts`
- Modify: `server/src/routes/workflows.test.ts`

- [ ] **Step 1: Write failing tests for duplicate S-beat rule hoisting**

Create `server/src/lib/workflowPromptDedupe.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { hoistRepeatedShotRules } from "./workflowPromptDedupe";

test("hoistRepeatedShotRules moves repeated same-scene rules out of S beats", () => {
  const prompt = [
    "Clip video prompt for Clip 12.",
    "Global shot rules: maintain one continuous scene geography.",
    "S1: Shot: close-up; blocking: Cafeteria listens to Flora PA announcement, trio tense in corner, cultists rigid. Same setting and character blocking, natural reaction or angle change.; Exact dialogue: Flora: \"Line one.\"",
    "S2: Shot: close-up; blocking: Cafeteria listens to Flora PA announcement, trio tense in corner, cultists rigid. Same setting and character blocking, natural reaction or angle change.; reaction/cutaway detail, same scene geography, same character positions; Chloe reacts.",
    "S3: Shot: close-up; blocking: Cafeteria listens to Flora PA announcement, trio tense in corner, cultists rigid. Same setting and character blocking, natural reaction or angle change.; Bob reacts.",
    "No subtitles, speech bubbles, UI, panel borders, watermarks, random text, gore, or identity drift.",
  ].join("\n");

  const result = hoistRepeatedShotRules(prompt);

  assert.match(result, /Clip blocking: Cafeteria listens to Flora PA announcement, trio tense in corner, cultists rigid\./);
  assert.equal((result.match(/Same setting and character blocking/g) ?? []).length, 0);
  assert.equal((result.match(/same scene geography/g) ?? []).length, 0);
  assert.match(result, /^S1: Shot: close-up; Exact dialogue: Flora: "Line one\."/m);
  assert.match(result, /^S2: Shot: close-up; Chloe reacts\./m);
  assert.match(result, /^S3: Shot: close-up; Bob reacts\./m);
});

test("hoistRepeatedShotRules never trims a line into half words", () => {
  const prompt = [
    "Header",
    "S1: Shot: close-up; Performance: Flora shows ceremonial delivery; Cultists sit rigidly.",
    "S2: Shot: close-up; Performance: Flora shows ceremonial delivery; Cultists sit rigidly.",
  ].join("\n");

  const result = hoistRepeatedShotRules(prompt);

  assert.doesNotMatch(result, /\bCultists s\b|\bdel\.\b|\bsit r\b/);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx tsx server/src/lib/workflowPromptDedupe.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement prompt dedupe module**

Create `server/src/lib/workflowPromptDedupe.ts`:

```ts
const REPEATED_RULE_PATTERNS = [
  /\bSame setting and character blocking, natural reaction or angle change\.?/gi,
  /\breaction\/cutaway detail, same scene geography, same character positions\.?/gi,
  /\bframe only the visible subject\(s\) for this shot\.?/gi,
  /\bkeep screen direction readable\.?/gi,
  /\bseparate foreground, midground, and background for continuity\.?/gi,
];

export function hoistRepeatedShotRules(prompt: string): string {
  const lines = normalizeLines(prompt);
  const beatLines = lines.filter(isBeatLine);
  if (beatLines.length < 2) return lines.join("\n");

  const repeatedBlocking = mostCommonBlocking(beatLines);
  const cleaned = lines.map((line) => {
    if (!isBeatLine(line)) return line;
    return cleanBeatLine(line, repeatedBlocking);
  });

  if (!repeatedBlocking) return cleaned.join("\n");
  const insertIndex = Math.max(1, cleaned.findIndex(isBeatLine));
  const blockingLine = `Clip blocking: ${repeatedBlocking}.`;
  if (cleaned.some((line) => line.trim() === blockingLine)) return cleaned.join("\n");
  return [
    ...cleaned.slice(0, insertIndex),
    blockingLine,
    ...cleaned.slice(insertIndex),
  ].join("\n");
}

function cleanBeatLine(line: string, repeatedBlocking: string): string {
  const labelMatch = line.match(/^(S\d{1,2}:)\s*([\s\S]*)$/i);
  if (!labelMatch) return line;
  const label = labelMatch[1];
  let body = labelMatch[2] ?? "";
  if (repeatedBlocking) {
    body = body.replace(new RegExp(escapeRegExp(`blocking: ${repeatedBlocking}.`), "gi"), "");
    body = body.replace(new RegExp(escapeRegExp(repeatedBlocking), "gi"), "");
  }
  for (const pattern of REPEATED_RULE_PATTERNS) body = body.replace(pattern, "");
  const parts = body
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^blocking\s*:\s*$/i.test(part))
    .filter((part) => !/^composition\s*:\s*$/i.test(part));
  return `${label} ${parts.join("; ")}`
    .replace(/\s+([.;,!?])/g, "$1")
    .replace(/;\s*;/g, ";")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function mostCommonBlocking(beatLines: string[]): string {
  const counts = new Map<string, number>();
  for (const line of beatLines) {
    const match = line.match(/\bblocking\s*:\s*([^;]+?)(?:\s+Same setting and character blocking|\s*$|;)/i);
    const blocking = cleanSentence(match?.[1] ?? "");
    if (!blocking || blocking.length < 24) continue;
    counts.set(blocking, (counts.get(blocking) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function cleanSentence(value: string): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[.;,，。；]+$/g, "")
    .trim();
}

function normalizeLines(prompt: string): string[] {
  return String(prompt || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isBeatLine(line: string): boolean {
  return /^S\d{1,2}:/i.test(line.trim());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

- [ ] **Step 4: Run dedupe tests**

Run:

```bash
npx tsx server/src/lib/workflowPromptDedupe.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire prompt dedupe into Seedance prompt finalization**

In `server/src/routes/workflows.ts`, add import:

```ts
import { hoistRepeatedShotRules } from "../lib/workflowPromptDedupe";
```

In `finalizeWorkflowVideoPrompt`, change:

```ts
  const normalized = normalizePromptTextWithoutCompression(value);
```

to:

```ts
  const normalized = hoistRepeatedShotRules(normalizePromptTextWithoutCompression(value));
```

Also ensure the fallback path uses dedupe:

```ts
const compactFallback = compactWorkflowVideoPrompt(hoistRepeatedShotRules(normalizePromptTextWithoutCompression(fallback)));
```

- [ ] **Step 6: Add workflow-level prompt regression**

Append to `server/src/routes/workflows.test.ts`:

```ts
test("final video prompt hoists repeated S beat boilerplate before compaction", () => {
  const prompt = [
    "Clip video prompt for Clip 12.",
    "S1: Shot: close-up; blocking: Cafeteria listens to Flora PA announcement, trio tense in corner, cultists rigid. Same setting and character blocking, natural reaction or angle change.; Exact dialogue: Flora: \"Line one.\"",
    "S2: Shot: close-up; blocking: Cafeteria listens to Flora PA announcement, trio tense in corner, cultists rigid. Same setting and character blocking, natural reaction or angle change.; Chloe reacts.",
    "S3: Shot: close-up; blocking: Cafeteria listens to Flora PA announcement, trio tense in corner, cultists rigid. Same setting and character blocking, natural reaction or angle change.; Bob reacts.",
  ].join("\n");

  const result = internals.finalizeWorkflowVideoPrompt(prompt);

  assert.match(result, /Clip blocking: Cafeteria listens to Flora PA announcement, trio tense in corner, cultists rigid\./);
  assert.equal((result.match(/Same setting and character blocking/g) ?? []).length, 0);
});
```

- [ ] **Step 7: Run tests**

Run:

```bash
npx tsx server/src/lib/workflowPromptDedupe.test.ts
npx tsx server/src/routes/workflows.test.ts --test-name-pattern "final video prompt hoists"
npx tsx server/src/routes/workflows.test.ts
```

Expected: PASS.

---

### Task 6: Positioning Board Prompt Module

**Files:**
- Create: `server/src/lib/workflowPositioningBoards.ts`
- Create: `server/src/lib/workflowPositioningBoards.test.ts`
- Modify: `scripts/add-clip-positioning-board-flows.ts`

- [ ] **Step 1: Write failing tests for static positioning-board prompt**

Create `server/src/lib/workflowPositioningBoards.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildClipPositioningBoardPrompt, positioningBoardReferenceMetadata } from "./workflowPositioningBoards";

test("buildClipPositioningBoardPrompt creates static keyframe, not video prompt", () => {
  const prompt = buildClipPositioningBoardPrompt({
    projectName: "美式漫剧",
    clip: {
      id: "clip-012",
      title: "Clip 12 · Flora announces ritual",
      setting: "Sanctuary Cafeteria",
      startState: "Starts with cultists rigid while the trio listens from the corner.",
      endState: "Ends with the same cafeteria layout, alarm rising.",
    },
    shots: [
      {
        id: "shot-001",
        action: "Cultists sit rigid while Chloe, Bob, and Leo listen from the corner.",
        dialogue: "Flora: Tonight, we will hold our first Pre-Harvest Ritual.",
        references: "Flora voice over PA; PA speaker on screen-right wall.",
        characters: ["Chloe", "Bob", "Leo", "Celery Cultist", "Flora"],
      },
    ],
    referenceLabels: ["Chloe", "Bob", "Leo", "Celery Cultist", "Flora", "Sanctuary Cafeteria"],
    visibleCharacterNames: ["Chloe", "Bob", "Leo", "Celery Cultist", "Flora"],
  });

  assert.match(prompt, /Create ONE static keyframe positioning-board image/);
  assert.match(prompt, /single 16:9 still frame/);
  assert.match(prompt, /Visible characters for this still frame only: Chloe, Bob, Leo, Celery Cultist, Flora/);
  assert.doesNotMatch(prompt, /Generate one continuous/i);
  assert.doesNotMatch(prompt, /S1:/);
  assert.doesNotMatch(prompt, /No subtitles, speech bubbles, UI, panel borders/);
});

test("positioningBoardReferenceMetadata marks image as spatial authority for Seedance", () => {
  const metadata = positioningBoardReferenceMetadata({
    clipId: "clip-012",
    episodeId: "episode-010",
    assetId: "asset-position-board",
    imageUrl: "https://example.com/board.png",
  });

  assert.equal(metadata.assetKind, "positioning-board");
  assert.equal(metadata.clipNodeKind, "positioning-board-reference");
  assert.equal(metadata.positioningBoardForClip, true);
  assert.equal(metadata.spatialAuthority, true);
  assert.equal(metadata.sourceEpisodeId, "episode-010");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npx tsx server/src/lib/workflowPositioningBoards.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement positioning board module**

Create `server/src/lib/workflowPositioningBoards.ts`:

```ts
type PromptClip = {
  id?: string;
  title?: string;
  setting?: string;
  startState?: string;
  endState?: string;
};

type PromptShot = {
  id?: string;
  action?: string;
  description?: string;
  visualPrompt?: string;
  dialogue?: string;
  references?: string;
  characters?: string[];
};

export function buildClipPositioningBoardPrompt(input: {
  projectName: string;
  clip: PromptClip;
  shots: PromptShot[];
  referenceLabels: string[];
  visibleCharacterNames: string[];
}): string {
  const anchor = selectPositioningAnchorShot(input.shots, input.visibleCharacterNames);
  const anchorAction = sentence(anchor?.action || anchor?.description || anchor?.visualPrompt || input.clip.title || "a readable representative moment");
  const anchorRefs = sentence(anchor?.references || "");
  const speaker = speakerFromDialogue(anchor?.dialogue || "");
  const cues = compactBoardCues(input.shots, input.visibleCharacterNames);
  return [
    `Create ONE static keyframe positioning-board image for ${input.clip.title || input.clip.id || "this clip"}.`,
    "Image type: a single 16:9 still frame used as a spatial layout reference, not a storyboard, not a video prompt, not a multi-shot sequence.",
    `Project: ${input.projectName}. Style: saturated 3D American animated dark-comedy, cinematic but readable previsualization.`,
    `Scene to lock: ${input.clip.setting || "current scene"}. Use the connected scene reference as the spatial authority.`,
    input.referenceLabels.length ? `Connected references to preserve exactly: ${input.referenceLabels.join(", ")}.` : "Use connected references to preserve identity and scene consistency.",
    `Visible characters for this still frame only: ${input.visibleCharacterNames.length ? input.visibleCharacterNames.join(", ") : "only characters visible in this clip event"}.`,
    `Representative frame to depict: ${anchorAction}.`,
    anchorRefs ? `Important spatial/prop cue: ${anchorRefs}.` : "",
    speaker ? `If ${speaker} is speaking in this chosen frame, show mouth shape, expression, and gesture only; do not draw dialogue text.` : "",
    input.clip.startState ? `Continuity entering this clip: ${sentence(input.clip.startState)}.` : "",
    input.clip.endState ? `Continuity target after this clip: ${sentence(input.clip.endState)}.` : "",
    cues.length ? `Additional layout cues for this one still frame:\n- ${cues.join("\n- ")}` : "",
    "Clearly show approximate screen-left/screen-right/center positions, facing directions, body posture, facial emotion, held items, worn items, restraints, and key props for visible subjects.",
    "Keep the background as one coherent space with readable floor depth and fixed landmarks; show enough environment to locate characters in the scene.",
    "Do not render every beat. Collapse the clip context into one representative frozen frame. No motion trails, no panels, no subtitles, no labels, no UI, no watermarks, no random text.",
    "Do not redesign characters, scene architecture, props, clothing, helmets, held items, or visible restraints. Keep visible states consistent with connected references and continuity notes.",
  ].filter(Boolean).join("\n");
}

export function positioningBoardReferenceMetadata(input: {
  clipId: string;
  episodeId: string;
  assetId?: string;
  imageUrl?: string;
}): Record<string, unknown> {
  return {
    assetKind: "positioning-board",
    clipNodeKind: "positioning-board-reference",
    positioningBoardForClip: true,
    spatialAuthority: true,
    clipId: input.clipId,
    sourceEpisodeId: input.episodeId,
    assetId: input.assetId || "",
    imageUrl: input.imageUrl || "",
  };
}

function selectPositioningAnchorShot(shots: PromptShot[], names: string[]): PromptShot | undefined {
  return shots
    .map((shot, index) => ({ shot, score: scoreShot(shot, names, index, shots.length) }))
    .sort((a, b) => b.score - a.score)[0]?.shot;
}

function scoreShot(shot: PromptShot, names: string[], index: number, total: number): number {
  const text = [shot.action, shot.description, shot.visualPrompt, shot.references, shot.dialogue].filter(Boolean).join(" ");
  let score = 0;
  for (const name of names) if (name && text.toLowerCase().includes(name.toLowerCase())) score += 20;
  if (/\b(left|right|center|foreground|midground|background|screen|facing|holds?|wears?|bound|restrained|corner|speaker|table)\b/i.test(text)) score += 30;
  if (shot.dialogue) score += 8;
  score += total > 1 ? (1 - Math.abs(index / Math.max(1, total - 1) - 0.45)) * 10 : 10;
  return score;
}

function compactBoardCues(shots: PromptShot[], names: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const shot of shots) {
    const cue = sentence([shot.action, shot.references].filter(Boolean).join(" "));
    if (!cue) continue;
    const hasName = names.some((name) => name && cue.toLowerCase().includes(name.toLowerCase()));
    const hasSpatial = /\b(left|right|center|foreground|midground|background|screen|facing|holds?|wears?|bound|restrained|corner|speaker|table)\b/i.test(cue);
    if (!hasName && !hasSpatial) continue;
    const compact = cue.length > 180 ? `${cue.slice(0, 177).trim()}...` : cue;
    const key = compact.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(compact);
    if (output.length >= 5) break;
  }
  return output;
}

function speakerFromDialogue(value: string): string {
  return String(value || "").match(/^([^:：]{1,40})[:：]/)?.[1]?.trim() ?? "";
}

function sentence(value: string): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\bShow the listener's reaction, speaker's expression, and body language as the line lands\.?/gi, "")
    .replace(/\bHold the same scene geography and shift to a natural reaction or angle change\.?/gi, "")
    .replace(/\bSame setting and character blocking, natural reaction or angle change\.?/gi, "")
    .replace(/[。.!?;,，；：:]+$/g, "")
    .trim();
}
```

- [ ] **Step 4: Run positioning tests**

Run:

```bash
npx tsx server/src/lib/workflowPositioningBoards.test.ts
```

Expected: PASS.

- [ ] **Step 5: Reuse module in positioning-board script**

In `scripts/add-clip-positioning-board-flows.ts`, import:

```ts
import { buildClipPositioningBoardPrompt, positioningBoardReferenceMetadata } from "../server/src/lib/workflowPositioningBoards";
```

Replace the local `buildPositioningPrompt(...)` function call with:

```ts
const prompt = buildClipPositioningBoardPrompt({
  projectName: project.name,
  clip,
  shots,
  referenceLabels,
  visibleCharacterNames,
});
```

When creating imageInput refs for positioning boards or output metadata, spread:

```ts
...positioningBoardReferenceMetadata({
  clipId,
  episodeId,
  assetId,
  imageUrl,
})
```

Keep any layout logic unchanged.

- [ ] **Step 6: Typecheck script/module**

Run:

```bash
npx tsx server/src/lib/workflowPositioningBoards.test.ts
npm run server:check
```

Expected: PASS.

---

### Task 7: Add Positioning Board References to Seedance Multi-Reference Video Sync

**Files:**
- Modify: `server/src/lib/episodeCanvasSync.ts`
- Modify: `server/src/lib/canvasStoryboardReferences.test.ts` or create a new focused test if sync tests already exist

- [ ] **Step 1: Add failing test for positioning-board connection in multi-ref sync**

If `server/src/lib/episodeCanvasSync.test.ts` does not exist, add this test to `server/src/lib/canvasStoryboardReferences.test.ts` only if it already imports sync helpers. If not, create `server/src/lib/episodeCanvasSync.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildEpisodeCanvasSyncScene } from "./episodeCanvasSync";

test("Seedance multi-reference video sync connects completed positioning board as spatial authority", () => {
  const metadata = {
    setupSettings: { generationStrategy: "seedance-multi-ref" },
    episodes: {
      "episode-010": {
        workflowCenter: {
          selectedEpisode: "第 10 集",
          clips: [{
            id: "clip-012",
            title: "Clip 12",
            setting: "Sanctuary Cafeteria",
            characters: ["Chloe", "Flora"],
            shotIds: ["shot-001"],
            seedancePrompt: "Generate one continuous 15s video.",
          }],
          breakdownScenes: [{
            id: "shot-001",
            title: "Flora ritual",
            setting: "Sanctuary Cafeteria",
            characters: ["Chloe", "Flora"],
          }],
          assets: {
            characters: [],
            scenes: [],
            props: [],
          },
          stageStatuses: {},
        },
      },
    },
    canvasScenes: {
      "episode-010": {
        nodes: [{
          id: "positioning-generation-episode-010-clip-012",
          type: "generation",
          data: {
            positioningBoardFlow: true,
            clipId: "clip-012",
            outputImage: "https://example.com/positioning-board.png",
            outputImageAssetId: "asset-positioning-board",
            status: "completed",
          },
        }],
        edges: [],
      },
    },
  };

  const sync = buildEpisodeCanvasSyncScene({
    metadata,
    episodeId: "episode-010",
    generationStrategy: "seedance-multi-ref",
    existingScene: metadata.canvasScenes["episode-010"],
    records: [],
  } as any);

  const boardRef = sync.nodes.find((node: any) =>
    node.type === "imageInput" &&
    node.data?.assetKind === "positioning-board" &&
    node.data?.clipId === "clip-012"
  ) as any;
  const videoNode = sync.nodes.find((node: any) => node.type === "video" && node.data?.clipId === "clip-012") as any;

  assert.ok(boardRef, "expected positioning board imageInput");
  assert.ok(videoNode, "expected video node");
  assert.equal(boardRef.data.spatialAuthority, true);
  assert.ok(sync.edges.some((edge: any) => edge.source === boardRef.id && edge.target === videoNode.id));
  assert.match(String(videoNode.data.prompt || ""), /positioning board/i);
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npx tsx server/src/lib/episodeCanvasSync.test.ts
```

Expected: FAIL because positioning boards are not collected by sync yet.

- [ ] **Step 3: Add positioning board collector in `episodeCanvasSync.ts`**

In `server/src/lib/episodeCanvasSync.ts`, add a helper:

```ts
function collectClipPositioningBoardReference(existingScene: unknown, clipId: string, episodeId: string): CanvasReference | null {
  const scene = isRecord(existingScene) ? existingScene : {};
  const nodes = Array.isArray(scene.nodes) ? scene.nodes.filter(isRecord) : [];
  const generation = nodes.find((node) => {
    const data = isRecord(node.data) ? node.data : {};
    return node.type === "generation" &&
      data.positioningBoardFlow === true &&
      stringValue(data.clipId) === clipId &&
      Boolean(stringValue(data.outputImage));
  });
  if (!generation) return null;
  const data = isRecord(generation.data) ? generation.data : {};
  return {
    kind: "positioning-board",
    name: "Clip positioning board",
    url: stringValue(data.outputImage),
    assetId: stringValue(data.outputImageAssetId),
    prompt: stringValue(data.finalPrompt || data.prompt || data.submittedPrompt),
    sourceClipId: clipId,
    sourceEpisodeId: episodeId,
  } as any;
}
```

If `CanvasReference` is a local type that does not allow `kind: "positioning-board"`, extend the type union. Do not treat positioning board as `storyboard`.

Inside the clip loop, after `videoReferences` are collected, add:

```ts
const positioningBoardRef = useMultiReferenceStrategy
  ? collectClipPositioningBoardReference(input.existingScene, clip.id, episodeId)
  : null;
const videoReferencesWithBoard = positioningBoardRef
  ? [positioningBoardRef, ...videoReferences]
  : videoReferences;
```

Use `videoReferencesWithBoard` for:

- `videoReferenceCount`
- reference node creation
- edge creation
- `persistedVideoReferenceUrls`
- section description/reference count

Keep non-multi-reference behavior unchanged.

- [ ] **Step 4: Mark board ref metadata and prompt authority**

When creating an `imageInput` for a reference whose kind is `positioning-board`, set data:

```ts
assetKind: "positioning-board",
clipNodeKind: "positioning-board-reference",
positioningBoardForClip: true,
spatialAuthority: true,
sourcePrompt: "Positioning board: use as spatial layout authority for this clip video.",
```

When `videoPrompt` is finalized for multi-reference and a board exists, prepend one header line before prompt finalization:

```text
Use the connected positioning board as the spatial layout authority for this clip: preserve character screen positions, facing directions, visible states, and scene geography from that single frame.
```

Do not add this line if no positioning board image exists.

- [ ] **Step 5: Run sync tests**

Run:

```bash
npx tsx server/src/lib/episodeCanvasSync.test.ts
npx tsx server/src/lib/canvasStoryboardReferences.test.ts
```

Expected: PASS. Existing storyboard tests must still pass and Seedance multi-ref must still have no storyboard nodes.

---

### Task 8: Final Prompt Validation for Broken Dialogue and Half-Word Truncation

**Files:**
- Modify: `server/src/routes/workflows.ts`
- Modify: `server/src/routes/workflows.test.ts`

- [ ] **Step 1: Add failing tests for final prompt validation**

Append to `server/src/routes/workflows.test.ts`:

```ts
test("final video prompt rejects obvious broken dialogue fragments before canvas save", () => {
  const prompt = [
    "Generate one continuous 15s video.",
    "S1: Exact dialogue: Flora: \"Let us rejoice for our brothers and sisters who\"; Flora smiles.",
  ].join("\n");

  const issues = internals.validateFinalVideoPromptForTest(prompt);

  assert.deepEqual(issues.map((issue: any) => issue.code), ["BROKEN_DIALOGUE_FRAGMENT"]);
});

test("final video prompt validation catches half-word truncation artifacts", () => {
  const prompt = [
    "Generate one continuous 15s video.",
    "S3: Performance: Flora shows tense expression; Cultists s.",
    "S4: Performance: delivery ceremonial; del.",
  ].join("\n");

  const issues = internals.validateFinalVideoPromptForTest(prompt);

  assert.ok(issues.some((issue: any) => issue.code === "HALF_WORD_TRUNCATION"));
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
npx tsx server/src/routes/workflows.test.ts --test-name-pattern "final video prompt"
```

Expected: FAIL because validator does not exist.

- [ ] **Step 3: Implement validator**

In `server/src/routes/workflows.ts`, add:

```ts
type FinalVideoPromptIssue = {
  code: "BROKEN_DIALOGUE_FRAGMENT" | "HALF_WORD_TRUNCATION";
  line: string;
  message: string;
};

function validateFinalVideoPrompt(prompt: string): FinalVideoPromptIssue[] {
  const issues: FinalVideoPromptIssue[] = [];
  const lines = normalizePromptTextWithoutCompression(prompt).split("\n");
  for (const line of lines) {
    const dialogue = extractDialogueFromVideoBeatLine(line);
    if (dialogue && detectBrokenDialogueFragments([dialogue]).length > 0) {
      issues.push({
        code: "BROKEN_DIALOGUE_FRAGMENT",
        line,
        message: "Final video prompt contains a likely truncated dialogue fragment.",
      });
    }
    if (/\b(?:Cultists s|sit r|del\.|del;|deliver[y]?\s*$)\b/i.test(line)) {
      issues.push({
        code: "HALF_WORD_TRUNCATION",
        line,
        message: "Final video prompt contains a half-word truncation artifact.",
      });
    }
  }
  return issues;
}
```

Export it in `workflowsTestInternals` as:

```ts
validateFinalVideoPromptForTest: validateFinalVideoPrompt,
```

- [ ] **Step 4: Use validator after prompt generation without hard-blocking existing projects**

In `regenerateWorkflowClipSeedancePrompt`, after `seedancePrompt` is built, compute:

```ts
const promptIssues = validateFinalVideoPrompt(seedancePrompt);
```

Add issues into `preflight.warnings`, but do not throw:

```ts
const preflight = buildClipPreflight(...);
const finalPreflight = promptIssues.length
  ? {
      ...preflight,
      pass: false,
      status: "需检查",
      warnings: [
        ...preflight.warnings,
        ...promptIssues.map((issue) => issue.message),
      ],
    }
  : preflight;
```

Return `finalPreflight` as `preflight`.

- [ ] **Step 5: Run tests**

Run:

```bash
npx tsx server/src/routes/workflows.test.ts --test-name-pattern "final video prompt"
npx tsx server/src/routes/workflows.test.ts
```

Expected: PASS.

---

### Task 9: Current Episode 10 Migration Script

**Files:**
- Create: `scripts/repair-episode-dialogue-and-prompts.ts`

- [ ] **Step 1: Create dry-run first script**

Create `scripts/repair-episode-dialogue-and-prompts.ts`:

```ts
import { prisma } from "../server/src/lib/prisma";
import { workflowMaintenanceInternals } from "../server/src/routes/workflows";
import {
  extractSourceDialogueTurns,
  mergeShotDialogueWithSourceTurns,
} from "../server/src/lib/workflowDialogueTurns";

const projectId = process.argv[2];
const episodeId = process.argv[3];
const apply = process.argv.includes("--apply");

if (!projectId || !episodeId) {
  console.error("Usage: npx tsx scripts/repair-episode-dialogue-and-prompts.ts <projectId> <episodeId> [--apply]");
  process.exit(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const project = await prisma.project.findUnique({ where: { id: projectId } });
if (!project) {
  console.error(`Project not found: ${projectId}`);
  process.exit(1);
}

const metadata = isRecord(project.metadata) ? project.metadata : {};
const workflow = workflowMaintenanceInternals.getWorkflowState(metadata, episodeId);
const sourceTurns = extractSourceDialogueTurns(workflow.sourceText, [
  ...((workflow.assets?.characters ?? []) as any[]).map((item) => String(item.name || "")),
  ...workflow.breakdownScenes.flatMap((shot: any) => Array.isArray(shot.characters) ? shot.characters.map(String) : []),
]);

const repaired = mergeShotDialogueWithSourceTurns(
  workflow.breakdownScenes.map((shot: any) => ({
    id: shot.id,
    dialogue: shot.dialogue || "",
    characters: Array.isArray(shot.characters) ? shot.characters.map(String) : [],
  })),
  sourceTurns,
);

const nextScenes = workflow.breakdownScenes.map((shot: any, index: number) => ({
  ...shot,
  dialogue: repaired[index]?.dialogue ?? shot.dialogue,
  subtitle: repaired[index]?.dialogue ?? shot.subtitle,
  dialogueTurnId: repaired[index]?.dialogueTurnId,
  coveredByDialogueTurnId: repaired[index]?.coveredByDialogueTurnId,
}));

let changedShots = 0;
for (let index = 0; index < workflow.breakdownScenes.length; index += 1) {
  if (String(workflow.breakdownScenes[index].dialogue || "") !== String(nextScenes[index].dialogue || "")) changedShots += 1;
}

const nextClips = workflowMaintenanceInternals
  .deriveWorkflowClipsFromShotsForMaintenance
  ? workflowMaintenanceInternals.deriveWorkflowClipsFromShotsForMaintenance(nextScenes as any)
  : workflow.clips;

const nextWorkflow = {
  ...workflow,
  breakdownScenes: nextScenes,
  clips: nextClips,
  updatedAt: new Date().toISOString(),
};

console.log(JSON.stringify({
  projectId,
  episodeId,
  apply,
  sourceTurnCount: sourceTurns.length,
  changedShots,
  previousClipCount: workflow.clips.length,
  nextClipCount: nextClips.length,
}, null, 2));

if (!apply) {
  console.log("Dry run only. Re-run with --apply to write metadata.");
  await prisma.$disconnect();
  process.exit(0);
}

const nextMetadata = workflowMaintenanceInternals.writeWorkflowEpisode(metadata, episodeId, nextWorkflow, true);
await prisma.project.update({
  where: { id: projectId },
  data: { metadata: nextMetadata },
});

await prisma.$disconnect();
```

- [ ] **Step 2: Export maintenance helper for clip derivation**

In `server/src/routes/workflows.ts`, add to `workflowMaintenanceInternals`:

```ts
deriveWorkflowClipsFromShotsForMaintenance: deriveWorkflowClipsFromShots,
```

- [ ] **Step 3: Run dry-run**

Run:

```bash
DATABASE_URL='postgresql://loohii:<password>@<host>:5432/loohii?schema=public' \
npx tsx scripts/repair-episode-dialogue-and-prompts.ts cmq8dw07r0003l00tewomnzwd episode-010
```

Expected: JSON summary with `apply: false`. Do not write metadata.

- [ ] **Step 4: Apply only after user approval**

Run only if the user approves:

```bash
DATABASE_URL='postgresql://loohii:<password>@<host>:5432/loohii?schema=public' \
npx tsx scripts/repair-episode-dialogue-and-prompts.ts cmq8dw07r0003l00tewomnzwd episode-010 --apply
```

Expected: project metadata updated.

---

### Task 10: Verification Checklist

**Files:**
- No new files unless tests fail and require small fixes.

- [ ] **Step 1: Run all focused new tests**

Run:

```bash
npx tsx server/src/lib/workflowDialogueTurns.test.ts
npx tsx server/src/lib/workflowClipPacker.test.ts
npx tsx server/src/lib/workflowPromptDedupe.test.ts
npx tsx server/src/lib/workflowPositioningBoards.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run existing workflow tests**

Run:

```bash
npx tsx server/src/lib/clipDialogueAllocator.test.ts
npx tsx server/src/routes/workflows.test.ts
npx tsx server/src/lib/canvasStoryboardReferences.test.ts
npx tsx server/src/lib/episodeCanvasSync.test.ts
```

Expected: all PASS. If `episodeCanvasSync.test.ts` was not created because tests were added elsewhere, run the actual file used in Task 7.

- [ ] **Step 3: Run typecheck and build**

Run:

```bash
npm run server:check
npm run build
```

Expected: both PASS.

- [ ] **Step 4: Inspect generated clip12 prompt after dry-run or apply**

Use a read-only node snippet:

```bash
node - <<'NODE'
const { execFileSync } = require('child_process');
const sql = `select metadata::text from "Project" where id='cmq8dw07r0003l00tewomnzwd';`;
const raw = execFileSync('docker', ['exec','loohii-postgres','psql','-U','loohii','-d','loohii','-Atc', sql], {encoding:'utf8', maxBuffer: 1024*1024*50});
const metadata = JSON.parse(raw);
const clip = metadata.episodes?.['episode-010']?.workflowCenter?.clips?.find((item) => item.id === 'clip-012');
console.log(clip?.seedancePrompt || '');
NODE
```

Expected after regeneration:

- No `Flora: "Let us rejoice for our brothers and sisters who"` without terminal punctuation unless the source truly ends there.
- No `Cultists s`, `Cultists sit r`, or `del.` artifacts.
- Repeated `Same setting and character blocking` appears zero times in S beats.
- If positioning board exists, prompt contains positioning board authority line.

- [ ] **Step 5: Do not commit without explicit user approval**

Run:

```bash
git diff --stat
```

Expected: changed files match this plan. Ask user before any commit.

---

## Self-Review

Spec coverage:

- Dialogue not truncated: Tasks 1, 2, 4, and 8 cover atomic dialogue, source repair, no chunking, and final validation.
- Time limit without compressing reactions/actions/story: Tasks 2 and 3 cover silent visual coverage and clip packing before overlong dialogue.
- Clip boundaries by same scene/event: Task 3 covers scene/event key splitting.
- Repeated S rules: Task 5 hoists repeated boilerplate.
- Positioning board in Seedance multi-ref workflow: Tasks 6 and 7 add static prompt module and video sync reference.
- Current episode migration: Task 9 provides dry-run first script.
- Verification: Task 10 covers focused tests, existing tests, typecheck/build, and clip12 inspection.

Placeholder scan:

- No `TBD`, `TODO`, or “implement later” placeholders remain.
- Steps include concrete file paths, code snippets, commands, and expected results.

Type consistency:

- `WorkflowDialogueTurn`, `PackableWorkflowShot`, and positioning metadata types are introduced before use.
- `deriveWorkflowClipsFromShotsForMaintenance` is explicitly exported before script usage.
- `validateFinalVideoPromptForTest` is explicitly exported for tests.

