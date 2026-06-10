# CODEX Handoff

Last updated: 2026-05-21

This document summarizes the current Loohii / 鹿绘AI project state for Claude Code or another coding agent continuing the work.

## Runtime

- Repo: `/tmp/Manjuui`
- Live site: `https://loohii.com`
- Static frontend dir: `/var/www/loohii`
- Backend service: `loohii-backend.service`
- Health check: `https://loohii.com/api/health`

Useful commands:

```sh
npm run server:check
npm run build
find /var/www/loohii -mindepth 1 -maxdepth 1 -exec rm -rf {} + && cp -a dist/. /var/www/loohii/
systemctl restart loohii-backend.service
curl -fsS https://loohii.com/api/health
```

Development rule from the user: after a verified successful change, create a focused local git commit. Do not push unless the user explicitly asks.

## Recent Commits

- `575f4f81 fix: keep character sheets prop-free`
- `3ee58e4e fix: enlarge asset panel preview`
- `d9a65dc7 feat: add workflow asset image history`
- `d8b33009 fix: strengthen asset-first character continuity`
- `570a0492 fix: enrich character reference sheet prompts`
- `f528850a fix: refine workflow asset image controls`
- `7ec000c9 feat: generate workflow asset images`
- `96470ce8 feat: upload references for all workflow assets`

## Key Files

- `server/src/routes/workflows.ts`
  Main workflow-center backend. Handles source workflow runs, asset extraction, storyboard generation, workflow asset upload, image generation, asset image history, and asset selection.

- `server/src/ai/imageModel.ts`
  OpenAI-compatible image generation adapter. Uses `/images/generations`; passes model default params, `size`, `resolution`, and reference `image_urls` through the request body.

- `src/app/pages/ProjectCanvasPage.tsx`
  Main project canvas UI. Contains workflow center, asset side panel, asset upload/generation controls, asset history UI, and image preview modal.

- `src/app/lib/apiClient.ts`
  Frontend API methods and response normalization.

- `prisma/schema.prisma`
  Postgres schema. Workflow state currently lives mostly in `Project.metadata.workflowCenter`; generated/uploaded media lives in `Asset`.

- `docs/clip-first-v1-plan.md`
  Existing plan for clip-first video production.

- `docs/backend-architecture.md`
  Backend schema and API overview.

- `docs/frontend-api-integration.md`
  Frontend API integration notes.

## Current Workflow Model

The intended production path is:

1. User imports one episode/chapter source text.
2. Backend runs asset extraction first.
3. Extracted assets are persisted into `Project.metadata.workflowCenter.assets`.
4. Storyboard generation runs after assets are available.
5. Storyboard prompts must obey locked asset facts and uploaded/generated asset references.
6. Asset images can be uploaded, generated from scratch, generated using the current reference image, and selected from history.

The relevant backend path is:

- `POST /api/workflows/projects/:projectId/workflow`
- `generateWorkflowBreakdown`
- `buildAssetExtractionPrompt`
- `persistWorkflowAssetsProgress`
- `generateStoryboardJson`
- `buildStoryboardOnlyPrompt`
- `persistWorkflowRun`

Important: `persistWorkflowAssetsProgress` writes assets before storyboard generation so the UI can retain asset state even if storyboard generation later fails.

## Asset Logic

### Asset Extraction

Character facts now include:

- `fruitIdentity`
- `personality`
- `height`
- `primaryLook`
- `expressionNotes`
- `habitualActions`
- `variantNotes`
- `signatureProps`
- `colorPalette`
- `lockedVisualIdentity`
- `referencePolicy`

These fields are normalized in `normalizeBreakdown` and `normalizeWorkflowAssets`, stored in workflow metadata, and included in `summarizeAssetsForPrompt` before storyboard generation.

### Uploading Reference Images

Frontend path:

- `ProjectCanvasPage.tsx`
- `handleUploadAssetReference`
- `handleAssetReferenceFile`

Backend paths:

- Characters: `POST /api/projects/:projectId/characters/reference-image`
- Scenes/props: `POST /api/workflows/projects/:projectId/workflow/assets/reference-image`

Uploads try presigned object storage first. If public object storage is unavailable and the file is small enough, the frontend falls back to data URL.

For character uploads, the backend also creates/updates a real `Character` record and syncs it into `workflowCenter.assets.characters`.

### Generating Asset Images

Frontend:

- Asset panel supports model selection, aspect ratio, and resolution.
- Buttons on each asset:
  - `全新生成`: no reference image
  - `参考生成`: sends current asset image as `image_urls`
  - `上传参考图`
  - `历史`

Backend endpoint:

- `POST /api/workflows/projects/:projectId/workflow/assets/generate-image`

Relevant input:

- `assetKind`
- `assetName`
- `prompt`
- `aiModelId`
- `size`
- `parameters.resolution`
- `useCurrentReference`
- `referenceImageUrls`
- `referenceAssetIds`

If `useCurrentReference` is true, backend collects current `referenceImageUrl` / `generatedImageUrl` and passes public HTTP URLs to image model as `image_urls`. If no usable public URL exists, it returns a clear error.

### Asset Image History

New endpoints:

- `GET /api/workflows/projects/:projectId/workflow/assets/images?assetKind=...&assetName=...`
- `POST /api/workflows/projects/:projectId/workflow/assets/select-image`

History matches `Asset.metadata.workflowAssetKind + assetName`, and for characters also matches `Asset.metadata.characterName`.

Selecting a history image updates the current workflow asset:

- `referenceImageUrl`
- `referenceImageAssetId`
- `generatedImageUrl`
- `generatedImageAssetId`
- `visualAuthority`

Known limitation: older images without correct metadata may not appear in history. If needed, add a migration or broader title/prompt-based fallback.

## Character Asset Sheet Rules

Current character image prompt rule is in `buildWorkflowAssetImagePrompt`.

Character sheets should:

- Use one wide clean reference sheet.
- Make the upper main section occupy most of the image.
- Upper-left: natural, neutral, unobstructed face close-up / head bust.
- Upper-right: front/side/back or three-quarter turnaround views.
- Include inferred height marker beside turnaround views.
- Use natural neutral expressions in the main reference views.
- Keep pure neutral blank background.
- Keep all views the same identity, outfit, material, colors, proportions, and silhouette.
- Use lower strip only for expressions, body gestures, posture habits, and important state variants.
- If a character commonly wears mask/helmet/armor/long-term gear, upper section uses that dominant state; lower strip can include no-mask / gear-off reference.

Character sheets should not:

- Include pillows, handheld weapons, bags, furniture, food, loose tools, or other standalone story props.
- Put loose objects in the hands.
- Cover the face in the main close-up.
- Use standalone props in expression/gesture panels.

Allowed: wearable identity gear attached to the body, such as mask, helmet, armor, uniform, glasses, or backpack.

Standalone props should be extracted and generated as `props` assets separately.

## Storyboard / Clip Logic

The backend is now clip-first-ish but still stores detailed shots:

- `breakdownScenes`: detailed storyboard shots.
- `clips`: derived production units for video generation.

Rules in `docs/clip-first-v1-plan.md`:

- Clip target: 10-13 seconds.
- Clip hard max: 15 seconds.
- English fast comedy dialogue density target: 2.8-3.4 words/s.
- Warning above 3.6 words/s.
- Backend can rebalance and group shots into clips.

Storyboard prompts are instructed to:

- Use extracted assets as continuity references.
- Treat uploaded/generated asset references and locked asset facts as stronger than source prose.
- Convert impossible prose under the locked identity into valid visuals, e.g. hair movement on a hairless fruit character becomes leaf/stem/body/costume/prop movement.
- Use `primaryLook` and `variantNotes` for mask/gear on/off decisions.

## Image Model Notes

The image adapter currently posts to `/images/generations`.

For GPT-image-2 style providers:

- `size` can be ratio-like, e.g. `16:9`, `1:1`, `9:16`, `4:3`.
- `resolution` can be `1k`, `2k`, `4k`.
- `image_urls` is passed through for reference-image generation.

Provider compatibility is not uniform. Some OpenAI-compatible providers may reject some sizes/resolutions. Keep error messages visible and avoid silently falling back.

## UI State

Important current UI behavior:

- Asset panel in canvas is wider now: `520px`.
- Asset thumbnails are `64px`.
- Clicking asset thumbnails opens a large preview modal.
- History thumbnails also open the same preview modal.
- Asset panel lives in `ProjectCanvasPage.tsx`, around the `activePanel === 'assets'` block.

Potential UI improvements:

- The asset panel is still dense. If the user continues using many assets, add filtering/search by asset type/name.
- The panel currently shows only `items.slice(0, 6)` in `AssetMiniList`; this should be revisited because real projects may have many characters/props.
- History UI is embedded in the same panel; it may deserve its own drawer or modal.

## ReactFlow Canvas Stability Notes

Verified production fix for the recurring `Maximum update depth exceeded` canvas crash:

- Keep `<ReactFlow>` uncontrolled with `defaultNodes` / `defaultEdges`; do not switch back to controlled `nodes={...}` / `edges={...}` for the large canvas.
- Do not add a dynamic `key` to `<ReactFlow>` based on scene revision, node count, edge count, or canvas revision. That caused remount/reset loops.
- Sync external canvas store changes into ReactFlow only through a guarded `useReactFlow().setNodes/setEdges` bridge.
- Before calling the bridge, compare a stable signature and skip if the graph did not materially change.
- Selection and in-progress dragging are transient ReactFlow UI state. Do not write every select/drag frame into `useCanvasStore`; persist only durable changes such as drag end, delete, resize, add, connect, and data edits.
- Store setters should keep no-op guards. `updateNodeData` must return the existing state when a patch does not change node data.
- Image `onError` handlers must not repeatedly write the same `imageLoadError` value.

If this crash returns, reproduce it with a headless browser on the real canvas route and check console text for `Maximum update depth exceeded`. The likely regression is one of: controlled ReactFlow props, dynamic ReactFlow remount keys, unguarded `setNodes/setEdges`, or a node render effect repeatedly writing identical data.

## Known Risks / Follow-ups

1. Asset history matching is metadata-dependent. Old assets may not show.
2. Role of `referenceImageUrl` and `generatedImageUrl` is overloaded. Current selected image is written to both for convenience. A cleaner model would add `currentImageUrl/currentImageAssetId`.
3. Workflow state in `Project.metadata.workflowCenter` is flexible but easy to regress. Consider adding typed helpers and unit tests around asset mutations.
4. Character uploads through `/characters/reference-image` and workflow uploads through `/workflow/assets/reference-image` have overlapping logic. Consider unifying reference analysis fields.
5. The frontend has a large `ProjectCanvasPage.tsx`; it should be split into asset panel, workflow center, storyboard editor, and canvas shell components.
6. Reference-image generation requires public image URLs. Data URLs work for upload analysis fallback but should not be expected to work with all image providers.
7. `AssetMiniList` still limits visible items to six per group.
8. No Playwright UI regression checks exist for asset panel preview/history.

## Suggested Next Tasks

1. Add asset search/filter and show all extracted assets safely.
2. Split `ProjectCanvasPage.tsx` into smaller components before more UI work.
3. Add `currentImageUrl/currentImageAssetId` fields in workflow asset metadata and migrate usage away from overloading reference/generated fields.
4. Add tests around:
   - `collectWorkflowAssetReferenceUrls`
   - `matchesWorkflowAssetImage`
   - `syncWorkflowSelectedAssetImage`
   - `buildWorkflowAssetImagePrompt`
5. Improve prop extraction so standalone props like pillows, weapons, bags, tools, and furniture are reliably generated as `props`, not folded into character sheets.
6. Add a specific UI affordance for "generate prop from character-associated object" when the model extracts signature props.

## Verification Baseline

Most recent verified commands:

```sh
npm run server:check
npm run build
git diff --check
curl -fsS https://loohii.com/api/health
```

Before committing future changes, rerun the relevant subset. For frontend-only changes, `npm run build` and `git diff --check` are the minimum. For backend changes, include `npm run server:check` and restart `loohii-backend.service`.
