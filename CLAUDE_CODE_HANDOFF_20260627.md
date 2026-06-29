# Claude Code Handoff - Loohii Comic-Series Workflow

Date: 2026-06-27
Repo: `/projects/loohii`
Primary user project: `美式漫剧`
Known project id from earlier work: `cmq8dw07r0003l00tewomnzwd`

This is the latest working handoff for Claude Code. It is intentionally detailed because the project is now less a generic image/video app and more a continuity-sensitive comic-series production system. Treat this file as the current memory layer for product behavior, creative rules, known defects, and the user's expectations.

## 0. Current Situation

The user's latest complaint before this handoff was:

> 刚刚画布中的视频提示词没有发生变化。

This means a previous attempted change, likely around Episode 23 Clip 08 storyboard/video prompt continuity, did not actually persist into the active canvas data. Do not assume the UI changed unless you verify the saved workflow and the saved canvas node payload for the current episode.

Immediate priority for the next coding session:

1. Verify which episode is active in `Project.metadata`.
2. Load the active episode workflow and canvas scene from backend storage, not only the browser UI.
3. Locate Episode 23 Clip 08 in both `workflowCenter.clips` and the corresponding canvas video/storyboard nodes.
4. Fix any writeback path that updates workflow state but not canvas nodes, or updates old episode/cached nodes instead of the current episode.
5. Confirm the saved canvas video prompt actually changes after the API call or manual edit.

Do not claim a prompt, storyboard, image, or canvas node was updated until you have checked the persisted data path.

## 1. Critical Behavioral Rules From The User

- Do not modify account passwords, credentials, auth records, or user login data unless the user explicitly asks. A previous password reset caused serious user frustration.
- Do not mention or work on unrelated domains. The current business is Loohii and the API/image route work should focus on the user's current stack. The user specifically rejected work around an unrelated temporary domain.
- When executing substantial project work, the user strongly prefers calling subagents for parallel inspection/review. This is not a code rule, but it is a collaboration expectation.
- The user wants implementation, not long proposals, unless they explicitly ask to discuss first.
- The user is very sensitive to UI actions that appear successful but do not change persisted data. Always verify writeback.
- The user often works in the browser while the agent works in the repo. Expect live state changes.
- Never delete nodes, images, or generated assets just to make the canvas faster unless the user explicitly asks. The user often wants to keep nodes and understand the cause.

## 2. Repo And Commands

Tech stack:

- Frontend: React 18, Vite 6, Tailwind CSS 4, shadcn/ui, `@xyflow/react`, Zustand.
- Backend: Express 5, TypeScript, Prisma ORM, PostgreSQL.
- Queue/realtime: BullMQ, Redis, Socket.io.
- Storage: Cloudflare R2-compatible upload flow and local Docker upload volume.
- Auth: JWT + bcryptjs.
- AI models: provider/model configs stored in DB.

Useful commands:

```bash
cd /projects/loohii
npm run dev
npm run server:dev
npm run build
npm run server:check
npx tsc --noEmit
npx tsx server/src/routes/workflows.test.ts
npx tsx server/src/lib/clipDialogueAllocator.test.ts
npx tsx server/src/lib/workflowPromptDedupe.test.ts
npx tsx server/src/lib/workflowPositioningBoards.test.ts
npx tsx server/src/lib/canvasStoryboardReferences.test.ts
npx tsx server/src/lib/canvasVideoReferences.test.ts
```

If `rg` is unavailable in the shell, use `grep -RIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next`.

## 3. Existing Docs To Read

Read these before deep changes:

- `CLAUDE.md`: repo conventions and ReactFlow warnings.
- `CLAUDE_CODE_HANDOFF_20260619.md`: older but still useful project handoff.
- `CODEX_HANDOFF_20260613.md`: earlier Docker/Dreamina/runtime history.
- `docs/gpt-image-2-generation.md`: Aizahuo `gpt-image-2` image generation usage.
- `docs/backend-architecture.md`: backend schema overview.

This 2026-06-27 handoff supersedes earlier creative/workflow rules where they conflict.

## 4. Key Code Map

Frontend:

- `src/app/pages/ProjectCanvasPage.tsx`
  Main project canvas page. ReactFlow and workflow center mount here.
- `src/app/features/canvas/canvasUtils.tsx`
  Shared canvas constants, strategy detection, node helpers, prompt utility helpers.
- `src/app/features/canvas/canvasHelpers.ts`
  Canvas helper logic.
- `src/app/features/canvas/components/WorkflowCenterOverlay.tsx`
  Workflow center modal/overlay.
- `src/app/features/canvas/components/StageWorkPanel.tsx`
  Stage controls and workflow actions.
- `src/app/features/canvas/components/ClipVideoPromptList.tsx`
  Clip video prompt display/editing.
- `src/app/features/canvas/components/ClipStoryboardList.tsx`
  Clip storyboard/positioning-board display.
- `src/app/features/canvas/components/StoryboardSceneList.tsx`
  Storyboard scene list and editing.
- `src/app/features/canvas/components/ProjectGlobalSettingsModal.tsx`
  Project-level style/tone/rules settings.
- `src/app/features/canvas/nodes/VideoNode.tsx`
  Video prompt/generation node.
- `src/app/features/canvas/nodes/GenerationNode.tsx`
  Image generation node, also used for storyboard/positioning-board image flows.
- `src/app/features/canvas/nodes/ImageInputNode.tsx`
  Image reference node.
- `src/app/features/canvas/nodes/TranslationNode.tsx`
  Translation node.
- `src/app/features/canvas/nodes/AgentNode.tsx`
  Agent node; must show send button and display response inside the node.
- `src/app/features/canvas/nodes/shared.tsx`
  Shared prompt editor UI. Important for double-click enlarged modal editing and character count.
- `src/app/stores/useCanvasStore.ts`
  Zustand canvas store.
- `src/app/lib/api/workflowApi.ts`
  Workflow client API: episodes, assets, clips, prompts, storyboards.
- `src/app/lib/api/canvasApi.ts`
  Canvas scene load/save and canvas generation/translation/optimization APIs.

Backend:

- `server/src/routes/workflows.ts`
  Core route for workflow stages, asset extraction, storyboard/clip generation, Seedance prompts, canvas generation, translation, prompt optimization.
- `server/src/routes/canvas.ts`
  Canvas scene load/save and episode canvas sync.
- `server/src/routes/agent.ts`
  Agent messages/actions.
- `server/src/routes/models.ts`
  Model configuration.
- `server/src/ai/textModel.ts`
  Text model adapter.
- `server/src/ai/imageModel.ts`
  Image model adapter, including Aizahuo/OpenAI-compatible image generation.
- `server/src/ai/openAiImageAdapter.ts`
  OpenAI-compatible image adapter.
- `server/src/lib/episodeCanvasSync.ts`
  Workflow to canvas sync. Critical for "front-end canvas did not change" bugs.
- `server/src/lib/workflowPositioningBoards.ts`
  Positioning-board/storyboard node layout and prompt generation.
- `server/src/lib/storyboardPrompt.ts`
  Storyboard prompt creation.
- `server/src/lib/clipDialogueAllocator.ts`
  Dialogue allocation; must prevent mid-line truncation.
- `server/src/lib/workflowPromptDedupe.ts`
  Prompt repetition cleanup.
- `server/src/lib/sceneVisualContinuity.ts`
  Scene continuity locks.
- `server/src/lib/canvasStoryboardReferences.ts`
  Storyboard references for video generation.
- `server/src/lib/canvasVideoReferences.ts`
  Video reference collection.
- `server/src/lib/canvasAssetImageSync.ts`
  Asset image synchronization into canvas.
- `server/src/lib/hermesAgent.ts`
  Agent tool/action layer.

Scripts:

- `scripts/` contains many one-off and reusable repair/audit scripts. Before writing a new bulk repair script, inspect this directory.
- Important examples:
  - `scripts/audit-dialogue-continuity.ts`
  - `scripts/audit-episode18plus-reference-state.ts`
  - `scripts/compact-project-video-prompts.ts`
  - `scripts/regenerate-clip-video-prompt.ts`
  - `scripts/regenerate-episode-video-prompts.ts`
  - `scripts/repair-missing-source-dialogues.ts`
  - `scripts/repair-episode15-25-video-dialogue-quality.ts`
  - `scripts/repair-episode16-ending-and-prompts.ts`
  - `scripts/repair-episode16-clip008-continuity.ts`
  - `scripts/repair-episode17-22-23-server-room-scenes.ts`
  - `scripts/repair-episode18plus-scene-asset-contamination.ts`
  - `scripts/repair-episode21-tangelo-monitor-reveal.ts`
  - `scripts/repair-episode21-clip002-bob-flamethrower.ts`
  - `scripts/repair-episode22-dialogue-prompts.ts`
  - `scripts/repair-episode23-warm-recovery-continuity.ts`
  - `scripts/repair-positioning-board-layout.ts`
  - `scripts/repair-storyboard-mode-prompts.ts`
  - `scripts/upgrade-positioning-board-dual-mode.ts`
  - `scripts/verify-episode22-dialogue-prompts.ts`
  - `scripts/verify-positioning-board-layout.ts`
- Warning: one-off scripts may update workflow clip data but not the matching canvas node data, or may assume a stale active episode. Verify both workflow and canvas persistence after running any script.

Prisma:

- `prisma/schema.prisma`
  The generic entities are still present, but the comic-series workflow mainly lives in `Project.metadata` JSON.

## 5. Data Model And Persistence

The real workflow state is stored in `Project.metadata`, especially:

```text
metadata.activeEpisodeId
metadata.currentEpisodeId
metadata.selectedEpisodeId
metadata.activeCanvasSceneId
metadata.episodes[episodeId].workflowCenter
metadata.canvasScenes[episodeId]
metadata.workflowCenter
```

Important:

- Prefer `metadata.episodes[episodeId].workflowCenter` for episode-specific workflow state.
- Prefer `metadata.canvasScenes[episodeId]` for episode-specific ReactFlow nodes and edges.
- Do not assume `metadata.workflowCenter` is the active episode.
- Do not assume `activeCanvasSceneId`, `currentEpisodeId`, and `selectedEpisodeId` are always consistent. There have been stale episode bugs.
- Every write path must carry `episodeId`.
- Every frontend refresh after a write must invalidate or bypass stale cache for that exact `projectId:episodeId`.

Canvas nodes are persisted as ReactFlow-compatible objects:

```text
metadata.canvasScenes[episodeId].nodes[]
metadata.canvasScenes[episodeId].edges[]
```

Common node concepts:

- Clip/video node: stores video prompt, clip id, references, generated video state.
- Storyboard/positioning-board generation node: stores image prompt and generated storyboard/positioning image.
- Image input node: connected reference image.
- Asset nodes: character/scene/prop reference images.
- Translation node: translated prompt output.
- Agent node: agent chat/action result.
- Section node: visual grouping. Layout bugs often involve these.

When updating a clip prompt, verify both:

1. `workflowCenter.clips[n].seedancePrompt` or related clip field.
2. Matching canvas node `data.seedancePrompt`, `data.videoPrompt`, `data.finalPrompt`, or whatever field that node renders.

If only one changes, the UI can appear stale or inconsistent.

## 6. ReactFlow Rules

From `CLAUDE.md`:

- Keep ReactFlow uncontrolled with `defaultNodes` and `defaultEdges`.
- Do not convert it to controlled `nodes={...}` / `edges={...}`.
- Do not add dynamic `key` based on node count, edge count, revision, or episode id in a way that causes remount loops.
- Sync external updates through `useReactFlow().setNodes/setEdges` with stable signature comparison.

Known user-facing ReactFlow issues:

- Switching episodes can briefly show the previous episode's canvas.
- New episode should show its own canvas, not the previous episode.
- Large storyboards/positioning boards can make the canvas sluggish.
- Batch-generated translation/storyboard nodes previously overlapped or appeared in old cached positions.
- Storyboard sections must be placed left of video boards and not overlap them.

## 7. Global Creative Rules

Project style:

- Project title: `美式漫剧`
- Visual style: American/European cartoon, now often described as saturated 3D American animated dark comedy.
- Tone: black humor, fast-paced American comic-series timing, exaggerated reactions and actions.
- Keep character designs consistent.
- Important actions should cut to close-up reactions when useful.

World rule:

- All main characters, side characters, zombies/infected, survivors, faction members, and social roles are anthropomorphic fruit, vegetable, or plant life.
- Avoid default human identity terms such as "human", "person", "humanoid" unless the source text explicitly requires them for plot language.
- Generic labels should be fruit/vegetable/plant citizens, survivor produce, plant residents, infected bodies, etc.
- Body/action details should use fruit/plant traits: peel, pulp, juice, seeds, leaves, roots, vines, stems, fibers.
- Jobs and social roles can remain realistic/comedic: delivery driver, neighbor, ex, property manager, cult member, livestream host.
- Humor should use fruit/plant physicality where it helps.

Prompt layering rule:

- Project authority, script rules, identity rules, and style rules belong in text-model reasoning prompts.
- Do not dump those meta rules into final image-generation prompts.
- A final image prompt should describe the visible image.
- A final video prompt should describe visible scene, continuity, characters, action, camera, exact dialogue, and prohibitions.

## 8. Asset Rules

### Scene Assets

Scene assets must be empty establishing images unless the user explicitly asks otherwise:

- No characters.
- No dialogue.
- No project authority/rules.
- No role/identity paragraphs.
- No script instructions.
- No UI text.

Scene assets should represent canonical places. The user strongly objected to creating many unrelated scene images for the same place. The correct model:

- One place = one canonical scene asset where possible.
- Different zones or states must be explicitly justified by the script.
- If a new image is meant to be another angle of the same room/building, it should reference the canonical scene image or preserve the same architecture/materials/palette.
- Do not let approximate names cause unrelated scenes to reuse the wrong asset.

Important examples:

- Thanksgiving Harvest Ritual Stage should not be replaced by Gutted Produce Section if the visual architecture is different.
- Episode 14 dusk highway asset must not be reused for Episode 18 wasteland highway, ruined overpass, or other later road scenes unless the script says it is the same place and same time/color state.
- Episode 17 Omega System Room is the same broad location family as later Omega rooms, but Episode 17 should not show frost if frost only appears later in the story.

### Character Assets

Character assets must preserve identity and costume. The user wants historical character images to become named multi-form references:

- base form
- holding shotgun
- holding frying pan
- wearing gas mask
- no gas mask
- restrained/bound
- injured/current episode state

When a prop is already part of a character's historical/current form, prefer selecting that character-form image instead of generating a separate prop. Example:

- Bob's gas mask should not be a separate prop if Bob already has a correct historical image with the mask. A separate gas-mask prop can conflict with the mask in Bob's character image.

### Prop Assets

Only extract/generate a prop as a standalone asset when it is distinctive, recurring, plot-critical, or needs identity continuity.

Avoid separate prop assets for:

- generic doors
- non-unique furniture
- non-plot background equipment
- incidental environmental objects

Reason: if a prop is already embedded in a scene image, a separate prop image can conflict with the scene version. The user called this out for a broken door and other nonstandard objects.

If a prop is needed in storyboards/video prompts, connect the actual prop asset or describe it plainly. Do not let storyboard free text redesign a referenced prop. The user noticed this with phones and other props.

## 9. Asset Extraction And Memory

The current system has weak long-term memory. This caused examples like:

- Episode 13 created `Cast Iron Frying Pan` even though Episode 12 already had `Cast Iron Pan`.

Desired behavior:

- Cross-episode asset memory should normalize aliases and near-duplicates.
- Use canonical asset names plus aliases.
- Before creating a new asset, compare against existing project-wide assets and character-form images.
- Store why an asset is reused or why a new one is justified.
- Do not create a new scene asset just because the wording is slightly different if it is actually the same place.

Recommended future data shape:

```text
AssetMemoryEntry
  canonicalName
  kind: character | character-form | scene | prop
  aliases[]
  episodeFirstSeen
  currentImageId
  historicalImages[]
  visualIdentityNotes
  continuityUseCases[]
```

This can initially live inside `Project.metadata.workflowCenter.assetMemory` or a project-level metadata key before becoming a DB table.

## 10. Story Breakdown Rules

The user repeatedly found breakdown quality regressions. The correct rules:

- A clip should usually cover one event in one canonical scene.
- Do not combine two different events/locations into the same clip just to fit duration.
- Do not make 1s/2s/3s clips unless the source truly requires a very short visual beat.
- Seedance video duration is 4-15s. Do not hardcode 13s.
- 13s is not the user's requirement. It appeared as a regression in Episodes 17-19 and must not be treated as policy.
- Keep dialogue complete. Never cut a line in the middle.
- If a line would exceed the clip's duration, end the clip before the line and place the full line in the next clip.
- Do not drop original dialogue.
- Do not invent replacement dialogue unless asked.
- For Chinese source text, preserve character-name mapping and still wrap dialogue with quotation marks.
- A clip with no dialogue should be shorter and visually specific; do not inflate it with filler.

Dialogue allocation rule:

- Dialogue must be assigned to a speaker.
- Format should be like `Chloe: “...”`.
- The user dislikes unlabeled `Exact dialogue` because it hides who is speaking.
- If an internal field is named `Exact dialogue`, the rendered prompt still needs speaker labels.

## 11. Video Prompt Rules

Every final Seedance prompt must:

- Stay under 4000 characters.
- Preserve original dialogue exactly unless the user asks to modify it.
- Wrap dialogue in English curly or straight quotes. User specifically asked for quotes around dialogue.
- Identify the speaker for every dialogue line.
- Include initial character state and positions before shot beats.
- Use connected character/scene/prop/storyboard references for identity.
- Include only useful continuity locks, not repeated boilerplate.
- Avoid repeating the same global rules inside every S beat.
- Avoid listing all characters in every S beat. Only visible/necessary characters belong in each beat.
- Avoid empty S beats.
- Avoid repeated S beats where the same line/action appears many times.
- Avoid `end; end; end` style corruption.
- Avoid inserting a large Continuity paragraph between shot beats.
- Preserve shot order.
- Avoid subtitles, speech bubbles, UI, panel borders, panel numbers, watermarks, and random text.

Preferred compact structure:

```text
Generate one continuous [4-15]s cinematic video, 9:16.
Style: saturated 3D American animated dark comedy, fast comic pacing, exaggerated readable reactions.
Scene: [canonical scene]. Lock: [one short sentence about time, palette, architecture/materials].
Characters: [visible clip characters]. Use connected references; do not redesign.
Initial state/positions: [specific state and blocking].
Continuity: [start state -> end target, one compact line].

Shot beats:
S1: [shot size; angle; movement; lens]. [visible action]. [Speaker: “dialogue” if any].
S2: ...

No subtitles, speech bubbles, UI, panel borders, watermarks, random text, gore, or identity drift.
```

Do not include:

- duplicated continuity lock
- long "Project authority" blocks
- global script rules
- repeated `frame only visible subject(s)` in every S
- repeated "Hold the same scene geography..." in every S
- repeated "Show the listener's reaction..." in every S
- character alias spam like `Pineapple Showrunner = Pineapple Showrunner, Pineapple`

## 12. Storyboard And Positioning Board Rules

The user wants a dual mode:

- Positioning board: one still frame that establishes character placement and scene layout for a clip.
- Storyboard: a grid, usually 3x3, matching video prompt shot beats S1, S2, S3...

Positioning board:

- It is a still positioning image, not a video prompt pasted into image generation.
- It should define approximate character positions, scene geography, and important props.
- It should be concise and image-oriented.

Storyboard:

- It is a comic/previsualization sheet.
- One 16:9 storyboard sheet.
- Multiple panels in clean grid.
- Each panel corresponds to one S shot.
- Panel label in upper-left: exactly S1, S2, S3...
- No other text/captions/subtitles/speech bubbles/UI/watermarks/random labels.
- It must use connected character/scene/prop references.
- If a scene state changes within a clip, the storyboard must show the intermediate step, not jump instantly.

Storyboard layout in canvas:

- Storyboard/positioning-board section should be left of video boards.
- It must not overlap video boards.
- Nodes inside section need enough spacing.
- Batch generated storyboard nodes must align with their matching clip/video node, not stack into one pile.

## 13. Translation Nodes

Known issues:

- Batch translation once used stale cached count `21/111` while the active episode only had 14 clips.
- Translation nodes overlapped.
- Translation nodes sometimes did not align with their source video prompt nodes.

Rules:

- Batch translation should operate only on current episode clips/nodes.
- The translation model option should be `deepseek-4-flash`.
- Run active clip count, not stale project/global count.
- Translation nodes should appear beside their own video prompt node, with vertical spacing.
- Do not mutate source prompt during translation unless the user explicitly asks.

## 14. Agent Nodes

The user expects agent nodes to behave like self-contained chat/action nodes:

- Node must have a model selector.
- Node must have a send button.
- Clicking/running should provide visible feedback.
- The result should appear inside the agent node.
- If the user asks the agent node to revise a video prompt, the response should first appear in the agent node, not silently overwrite the original video prompt.
- If an action does write back, it must be explicit and target the correct canvas node.

Known problem:

- User connected `clip01` to an agent node and clicked run; `clip01` disappeared. Investigate node replacement/removal logic before changing agent execution.

## 15. Prompt Editing UI

Global UI requirement:

- All prompt editors in the canvas should support double-click to open a centered, wide modal editor.
- Do not add a small expand button in the top-right of the editor; the user said it blocks/affects the scrollbar.
- The modal should be centered in the whole viewport, not merely enlarged in place.
- It should be wide enough and use larger font.
- Prompt editor should show character count below the editor.
- Asset prompts must expose the complete final prompt, not only a tiny fragment that has no impact on generation.

This likely involves `src/app/features/canvas/nodes/shared.tsx` and all prompt text areas using shared editor components.

## 16. Image Generation Rules

The relevant external image method for the user's other projects is Aizahuo `gpt-image-2`; do not write about unrelated provider flows unless needed for this repo.

See `docs/gpt-image-2-generation.md`.

Important behavior:

- Final image prompt should be visual, not meta-instruction heavy.
- Scene image prompt should be empty scene.
- Character image prompt should focus on identity, outfit/form, expression sheet/character board if requested.
- Prop image prompt should show the object cleanly, often isolated or simple background.
- Storyboard prompt should produce storyboard panels, not a single cinematic frame.

Cloudflare/API note:

- The user configured a direct image API subdomain previously.
- Be careful not to change text-model base URL to image-direct URL. Image and text model providers may need separate base URLs.

## 17. Video Generation Rules

The main video mode is Seedance multi-reference.

Multi-reference video should use:

- character references
- canonical scene references
- relevant prop references
- storyboard/positioning board reference when present

Do not accidentally introduce a generic storyboard flow when the project is in Seedance multi-reference mode. The user objected to seeing inappropriate storyboard concepts earlier, then later asked for explicit storyboard/positioning-board dual mode. The distinction is:

- Storyboard/positioning-board images are references.
- The final video model prompt is still Seedance multi-reference.

Video prompt must obey the 4000 character cap. If too long:

1. Remove duplicate locks.
2. Remove repeated global shot rules.
3. Remove alias spam.
4. Remove empty beats.
5. Merge silent duplicate reaction beats only if it does not skip story or dialogue.
6. Keep dialogue and core action.

## 18. Scene Continuity And Canonical Place Rules

The biggest creative bug class is scene drift.

The user described the core problem:

- If one clip is a daytime green warehouse conversation and the next is a red night warehouse corner, the film feels broken even if the broad concept is "warehouse".

Correct system behavior:

- Text reasoning should choose a canonical scene identity.
- Each clip should reference that canonical scene image if still in the same place.
- Scene state changes should be explicit: time of day, lighting, frost, warmth, destruction, alarms, etc.
- Similar names are not enough to reuse a scene asset. Visual identity must match.
- Do not create many disconnected scene assets for one big room/building without references. A large building's angles should share style/materials/palette.

Recommended validation:

- For every clip, compare `clip.scene`, `sceneVisualContinuity`, connected scene asset names, and actual image URL.
- Flag if scene name says interior but lock says exterior.
- Flag if current scene uses an asset from a different episode/time/palette.
- Flag if the storyboard prompt has a different scene than the video prompt.

Known bad example:

- `Scene: Black Spire Greenhouse Lobby` but visual lock says `Black Spire Exterior Entrance. Maintain: Exterior night`. This is contradictory and must be fixed.

## 19. Known Episode Memory And Problems

### Episode 9 / Episode 10

- Duplicate Episode 9 existed previously.
- New Episode 10 initially showed Episode 9 canvas after switching. Episode isolation must remain fixed.
- When creating a new episode, the canvas should display that episode's own canvas, not stale previous episode content.

### Episode 10

- Clip asset connections were too broad: clips received characters who did not appear.
- Props were missing from clips where they did appear.
- Rule: connect only visible/needed clip assets.

### Episode 11

- `Thanksgiving Harvest Ritual Stage` is the correct/current ritual scene for early clips, not `Gutted Produce Section` if visuals differ.
- Potato manager should be embedded/growing in the wall, not tied to the wall.
- Some positioning boards lacked Chloe, Leo, cultists, etc.; visible characters must be present.

### Episode 12

- Clips 01-03 do not contain Leo/Bob, but they were connected due to incorrect inference.
- Scene conflict: `Living Vine Hospital Bed` should not be paired with a frozen meat area if the visuals conflict.

### Episode 13

- `Cast Iron Frying Pan` duplicated prior `Cast Iron Pan`.
- This demonstrates need for cross-episode asset alias memory.

### Episode 14

- User planned Chinese source text for readability.
- Character names may need mapping between Chinese and canonical English names.
- Dialogue must still use quotes.
- Clip 01-03 should continue from previous episode ending: characters are already out and riding/starting forward on motorcycle. No blast door.

### Episode 15

Known missing dialogue examples:

- Clip 07 missed Leo's long line:
  `However, I would like to establish a verbal liability waiver: If, during the course of the broadcast, my occupational reflexes cause me to bludgeon your zombies into a fine puree and consequently get your stream Terms-of-Service banned, I am not legally responsible.`
- Clips 04-06 missed Chloe's line:
  `My trauma level entirely depends on how many more seconds you exist in my line of sight. Back off, you overgrown yellow pear.`
- Clip 05 had S10 then a large continuity block then S12; S11 disappeared.
- Clip prompts exceeded 4000 characters.
- Character list was too redundant.

### Episode 16

The user revised the ending. The active storyboard and video prompts must use this revised source, not the old text:

```text
Chloe stared at the towering black monolith in the distance. She knew that the "ultimate villain" was sitting up there, pulling the strings of the entire world like some twisted puppet master.

"The whole human race is just its personal plaything now," Chloe muttered, clenching her fists. "We need to stop it before it completely breaks this world for fun."

Down the endless highway, the zombie horde grew thicker and thicker. And at the very peak of the Black Spire, a single red light pulsed eerily in the night sky—blinking just like the slitted pupil of a cat.
```

User later reported this still had not changed in the canvas. Verify workflow and canvas writeback.

### Episode 17

- Omega System Room should not already show frost if frost appears later in the story.
- It may be the same broad room as Episodes 22/23, but scene state is different.

### Episode 18

- A dusk highway asset from Episode 14 was reused for later wasteland highway/ruined overpass scenes, causing wrong storyboards.
- Need inspect real cause: likely scene asset reuse/lock logic, but do not assume.
- Storyboard prompts also lacked time/palette restrictions, causing one clip night and next dusk.

### Episode 19

- Many/all clips became 13s, which the user rejected as an accidental hard limit.
- 13s is not policy. Remove any hardcoding or generation bias causing all clips to become 13s.

### Episode 20

Known bad Clip 03 symptoms:

- Repeated S5-S16 with the same line `Downloading the raw test logs for the 'Flow State Project'.`
- Over 4000 characters.
- Contradictory scene lock: Black Spire interior/reception/greenhouse but lock points to exterior entrance.
- Dialogue labels and speaker clarity were unreliable.

The user also said Episode 20 Clip 01 has dialogue without clear speaker labels. Audit all Episode 20 video prompts.

### Episode 21

- Security monitor object is the same later big boss Tangelo, but at this point it should not reveal a clear cat.
- It should be a blurred/soft orange lump, not white, not an obvious orange cat.
- Storyboard prompt should use wording like `orange fur balls shape`.
- Do not write `orange cat`, `tangelo cat`, or `pale white belly` in storyboard prompts for this reveal.
- Episode 21 Clip 02 Bob should have a flamethrower, not a handgun.
- Episode 21 video prompts also had unlabeled dialogue.

### Episode 22

- Bob's flamethrower appears inconsistently.
- User requested: uniformly do not show the flamethrower in Episode 22.
- Check dialogue missing. Clip 07 reportedly has no dialogue, so it should not be bloated.
- Fix other dialogue omissions.

### Episode 23

- Storyboard sections were messy/overlapping, then moved, but must stay left of video boards and not be hidden behind them.
- Some Episode 23 storyboards were not real storyboard images.
- Clip 08 current issue: scene transition is too fast. The cat jumps onto the desk and the room instantly becomes warm/normal; missing scan step.
- Correct Clip 08 story:
  1. Keep cold/frozen Omega room state at entry.
  2. Show the cat/Tangelo-like blurred target or entity on/near desk as appropriate.
  3. Show scanning/identification step clearly.
  4. Only after scan/recognition should the room transition toward warmer/normal state.
  5. Subsequent clips should use the warmed/normal room state if the script says the scan changed the room.
- User said the video prompt did not change in the canvas after attempted update. This is the current P0 persistence bug.

### Episode 25 And Beyond

- User imported all 25 chapters and wanted:
  1. Generate assets.
  2. Generate storyboards/breakdowns.
  3. Generate video prompts.
  4. Put every episode's video boards and positioning/storyboard boards into their own canvas.
  5. Translate them.
- This large batch should wait until the above continuity/writeback issues are stable.

## 20. Known Prompt Failure Patterns

Search existing prompts/data for these patterns:

```text
end; end; end
Exact dialogue:
Hold the same scene geography
Show the listener's reaction
Downloading the raw test logs
unauthorized background extras
Scene visual authority: Black Spire Exterior Entrance
13s cinematic video
orange tangelo cat
pale white belly
white fluffy
```

Red flags:

- More than one repeated identical dialogue line in adjacent S beats.
- S beat count far beyond clip duration without reason.
- Dialogue line with no speaker.
- Character state says `reacts to previous moment` without specific action.
- Scene name and scene visual authority are different places.
- `Characters` includes people not visible in clip.
- Connected props include objects not visible or not needed.
- Prompt over 4000 characters.
- Storyboard prompt reveals a hidden identity too early.

## 21. Current Root-Cause Hypotheses To Verify

Do not assume these are true; verify in code/data.

### A. Prompt updates do not write to canvas nodes

Likely paths:

- `server/src/routes/workflows.ts` updates `workflowCenter.clips`.
- `server/src/lib/episodeCanvasSync.ts` may not update existing video nodes.
- Frontend might show node data from `useCanvasStore` without reloading current episode.
- API cache in `src/app/lib/api/workflowApi.ts` may return stale `projectId:episodeId`.
- One-off scripts in `scripts/` may patch clip prompts in metadata but leave `metadata.canvasScenes[episodeId].nodes` unchanged.

Verification:

1. Trigger prompt generation/update.
2. Inspect API response clip prompt.
3. Inspect saved `Project.metadata.episodes[episodeId].workflowCenter.clips`.
4. Inspect saved `Project.metadata.canvasScenes[episodeId].nodes`.
5. Refresh frontend and inspect node payload.

### B. Episode id mismatch

Symptoms:

- User edits Episode 23 but backend writes default/current/old episode.
- New episode shows previous episode canvas.
- Batch translation/storyboard count comes from old cache.

Fix direction:

- Ensure every API call carries `episodeId`.
- Ensure route handler uses query/body `episodeId` and not only project active state.
- Ensure `saveProjectWorkflow`, `syncEpisodeCanvas`, prompt generation, storyboard planning, image generation, translation, prompt optimization all preserve episode id.

### C. Scene asset reuse too permissive

Symptoms:

- Later episodes reuse a visually wrong highway/room scene.
- Different rooms lock to exterior entrance.

Fix direction:

- Use canonical scene identity plus visual fingerprint fields: place, zone, time, palette, architecture, state.
- Similar words alone should not auto-connect scene assets.
- If no correct existing scene, create new scene asset or ask/reason explicitly.

### D. Dialogue allocator splits or drops source text

Symptoms:

- Missing Leo/Chloe lines in Episode 15.
- S7 clipped line in earlier episodes.
- Long lines truncated mid-sentence.
- Gemini breakdowns omitted lines.

Fix direction:

- In breakdown stage, validate every source dialogue line appears exactly once or is intentionally marked omitted.
- Long line overflow should move the full line to next clip.
- Do not compress reaction/action beats by deleting dialogue.

### E. Dedupe runs too late or not on all generated prompts

Symptoms:

- Repeated S beats and repeated rules still appear after "dedupe" fixes.

Fix direction:

- Apply prompt dedupe after model output and before persistence.
- Validate final persisted prompt, not only in-memory prompt.
- Add tests for repeated phrases and over-4000 output.

## 22. Suggested Verification Scripts

Use Prisma or a small one-off script to inspect the active project. Do not print secrets.

Pseudo-checks:

```ts
const project = await prisma.project.findUnique({ where: { id: PROJECT_ID } })
const meta = project.metadata as any
console.log(meta.activeEpisodeId, meta.currentEpisodeId, meta.selectedEpisodeId, meta.activeCanvasSceneId)
const ep = meta.episodes?.[episodeId]
console.log(ep?.workflowCenter?.clips?.map(c => [c.id, c.title, c.duration, c.seedancePrompt?.length]))
console.log(meta.canvasScenes?.[episodeId]?.nodes?.map(n => [n.id, n.type, n.data?.clipId, n.data?.title]))
```

Recommended audit outputs:

- per episode clip count
- prompt lengths
- prompts over 4000
- clips with `13s` hardcoded
- prompts with `Exact dialogue` but no `Name:`
- prompts with repeated S beats
- prompts with scene mismatch
- storyboards with `orange cat` or `white fluffy`
- Episode 22 prompts/storyboards mentioning flamethrower

## 23. Acceptance Criteria For Fixes

For any episode/clip prompt fix:

- User-visible canvas node changes after refresh.
- Workflow clip data changes.
- Correct episode only is changed.
- Prompt is under 4000 characters.
- Dialogue is complete and speaker-labeled.
- Scene lock matches scene name and asset.
- Visible character list matches the clip.
- Storyboard/positioning board references match video prompt.

For storyboard generation:

- The generated image is actually a storyboard sheet if in storyboard mode.
- Panels are labeled S1/S2/S3...
- No speech bubbles/subtitles/random text.
- No hidden identity revealed early.
- Image is connected to the correct clip/video node.
- Node placement does not overlap video boards.

For batch operations:

- Count matches current episode clips.
- No stale previous episode nodes.
- No duplicate old cached nodes.
- Progress UI reaches completion and errors are shown per item.

## 24. High-Priority Backlog

P0:

- Fix Episode 23 Clip 08 writeback: storyboard and video prompt must persist to active canvas.
- Audit and fix Episode 16 revised ending still using old prompt text.
- Audit Episode 20/21 unlabeled dialogue.
- Stop prompt generation from producing over-4000 prompts.
- Remove any 13s hard duration bias/hardcode, especially Episode 19.

P1:

- Fix scene canonical asset matching so wrong highway/room images are not reused.
- Add source-dialogue coverage validation at breakdown and video-prompt stages.
- Add final prompt dedupe/compaction gate before persistence.
- Improve storyboard/positioning-board node layout left of video boards.
- Add complete prompt character counter to all prompt editors.

P2:

- Implement project-wide asset memory with aliases and character forms.
- Add automated audit UI for missing dialogue, repeated prompt text, scene conflicts, and over-limit prompts.
- Improve batch translation/storyboard generation progress and concurrency.

## 25. How To Start The Next Session

Recommended first steps:

1. Run `git status --short` and do not revert unrelated user changes.
2. Read `CLAUDE.md` and this handoff.
3. Inspect current project metadata for active episode and Episode 23.
4. Reproduce the prompt writeback path for Episode 23 Clip 08.
5. Patch the smallest correct persistence path.
6. Add or update tests around that path if possible.
7. Verify with backend data and frontend refresh.

Useful searches:

```bash
grep -RIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next "seedance-prompt" src server
grep -RIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next "storyboardPrompt" src server
grep -RIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next "episodeId" src/app/lib server/src/routes server/src/lib
grep -RIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next "13s" src server
grep -RIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next "Exact dialogue" server/src
```

## 26. Final Reminder

This project is fundamentally about continuity. The user's main quality bar is not just that an API returns something. The output must preserve:

- original dialogue
- speaker identity
- character state
- prop ownership
- scene identity
- episode continuity
- prompt length limits
- visible canvas persistence

When in doubt, inspect actual saved project metadata and canvas nodes before answering.
