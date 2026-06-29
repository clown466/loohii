# Claude Code 交接文档 - Loohii 漫剧工作流

日期：2026-06-19  
仓库：`/projects/loohii`  
线上主站：`https://www.loohii.com` / `https://loohii.com`  
当前重点项目：`美式漫剧`，项目 ID `cmq8dw07r0003l00tewomnzwd`

这份文档给 Claude Code 接手当前 Loohii 项目使用。它不是普通 README，而是当前开发现场的完整交接：架构、数据结构、工作流、最近改动、当前项目状态、脚本、部署、风险和下一步都写在这里。

## 0. 先读这个

接手后优先读：

1. 本文件。
2. `CLAUDE.md`：仓库编码约定和 ReactFlow 约束。
3. `CODEX_HANDOFF_20260613.md`：旧交接，主要覆盖 Dreamina 浏览器容器、白屏、runtime bridge、Docker 持久化上传等历史。
4. `docs/gpt-image-2-generation.md`：Aizahuo `gpt-image-2` 生图调用方式。
5. `docs/dreamina-local-runner.md`：当服务器 Dreamina 浏览器不可用时，本地 Chrome runner 的接入方式。

关键铁律：

- 不要改用户认证、密码、账号数据，除非用户明确要求。此前曾发生过未授权重置密码的错误，必须避免。
- 不要在文档、日志或回复里泄露 API key、JWT secret、模型密钥、真实密码。可以写环境变量名和占位符。
- 不要回滚工作区已有改动。当前仓库有大量未提交和未跟踪文件，很多是进行中的功能修复。
- 不要再使用或提及用户之前临时展示用的某个域名。当前业务主站是 `loohii.com` / `www.loohii.com`。
- ReactFlow 画布必须保持 uncontrolled 模式，不要把 `<ReactFlow>` 改成受控 `nodes={...}` / `edges={...}`。
- 用户偏好是“直接做，不要反复问”。除非会改账号、删数据、消耗外部生成额度或存在不可逆风险，否则优先自己推进。

## 1. 当前运行环境

工作目录：

```bash
cd /projects/loohii
```

主要技术栈：

- Frontend：React 18、Vite 6、Tailwind CSS 4、shadcn/ui、`@xyflow/react`、Zustand。
- Backend：Express 5、TypeScript、Prisma ORM、PostgreSQL。
- Realtime / Queue：Socket.io、BullMQ、Redis。
- Storage：本机 Docker volume `loohii_uploads`，并保留 R2/S3 相关代码。
- Auth：JWT + bcryptjs。
- AI：模型配置来自数据库 `ProviderConfig` / `AiModel`，由设置页维护，密钥加密存储。

当前容器状态，2026-06-19 查询：

```text
loohii-app         loohii-app:latest         Up About an hour      3001
dreamina-browser   dreamina-browser:latest   Up 5 days             7900, 9223
codeg-codeg-1      codeg-codeg               Up 6 days             3080
loohii-postgres    postgres:16-alpine        Up 6 days healthy     internal 5432
loohii-redis       redis:7-alpine            Up 6 days healthy     internal 6379
```

线上健康检查：

```bash
curl -fsS -H 'Host: loohii.com' http://23.80.83.16:3001/api/health
```

最近返回：

```json
{"ok":true,"service":"loohii-api","databaseConfigured":true}
```

Docker compose：

- `docker-compose.production.yml`
- `Dockerfile.loohii`
- `Dockerfile.dreamina-browser`

重要 volumes：

- `loohii_uploads -> /var/lib/loohii/uploads`：项目上传、生成图、生成视频持久化。不要删。
- `dreamina_chrome_data8 -> /home/dreamina/.config/chromium`：Dreamina 登录态。不要删，除非用户明确要求重新登录。
- `loohii_postgres_data`：数据库。不要删。
- `loohii_redis_data`：Redis。通常不需要手动碰。

数据库连接：

- 应从 `.env.production` 或容器环境读 `DATABASE_URL`。
- 文档里不要写真实密码。需要本地只读检查时可在 shell 中临时设置 `DATABASE_URL='postgresql://loohii:<password>@<host>:5432/loohii?schema=public'`。

常用命令：

```bash
npm run server:check
npm run build
npx tsx server/src/routes/workflows.test.ts
npx tsx server/src/lib/canvasStoryboardReferences.test.ts
npx tsx server/src/lib/canvasSucceededVideoNodes.test.ts
npx tsx server/src/ai/dreaminaWebBridge.test.ts
```

Docker 重建：

```bash
docker compose -f docker-compose.production.yml build app
docker compose -f docker-compose.production.yml up -d app
```

如果同时改了 Dreamina browser 镜像：

```bash
docker compose -f docker-compose.production.yml build dreamina-browser
docker compose -f docker-compose.production.yml up -d dreamina-browser
```

## 2. 仓库结构

核心目录：

```text
src/app/
  pages/
    ProjectCanvasPage.tsx                 # 主画布页，工作流中心和 ReactFlow 都在这里挂接
  features/canvas/
    canvasUtils.tsx                       # 画布类型、常量、模型过滤、提示词工具
    canvasHelpers.ts                      # 画布辅助工具
    components/
      WorkflowCenterOverlay.tsx           # 流程中心浮层
      StageWorkPanel.tsx                  # 阶段工作面板
      StoryboardSceneList.tsx             # 分镜/故事板相关列表
      ClipVideoPromptList.tsx             # clip 视频提示词列表
      ProjectGlobalSettingsModal.tsx      # 全局设定弹窗
      CharacterPropPickerPanel.tsx        # 角色道具绑定
    nodes/
      GenerationNode.tsx                  # 生图节点、定位板节点
      VideoNode.tsx                       # 视频生成节点
      ImageInputNode.tsx                  # 图片参考节点
      TranslationNode.tsx                 # 翻译节点
      AgentNode.tsx                       # 智能体节点
      PromptOptimizerNode.tsx             # 润色/降敏节点
      PromptInspectorNode.tsx             # 检查节点
      SectionNode.tsx                     # 分区节点
      shared.tsx                          # PromptTextarea 弹窗编辑等共享 UI
  lib/api/
    workflowApi.ts                        # 工作流 API 客户端
    canvasApi.ts                          # 画布/生成/翻译/检查 API 客户端
    modelApi.ts                           # 模型配置 API 客户端
  stores/
    useCanvasStore.ts                     # 画布节点/边 Zustand store

server/src/
  routes/
    workflows.ts                          # 核心工作流、资产、分镜、视频提示词、画布生成、翻译
    canvas.ts                             # 画布加载/保存/分集同步
    agent.ts                              # 项目智能体消息和动作执行
    models.ts                            # 模型配置
    generations.ts                        # 生成记录
    uploads.ts                            # 上传公开访问
    auth.ts                              # 认证，不要随便改
  ai/
    imageModel.ts                         # 生图模型适配，含 Aizahuo gpt-image-2 / Responses
    textModel.ts                          # 文本模型适配，Chat Completions 兼容
    dreaminaWebBridge.ts                  # Dreamina Web runtime bridge
  lib/
    episodeCanvasSync.ts                  # 分集工作流 -> 画布同步
    canvasStoryboardReferences.ts         # 故事板引用恢复/清理，多参模式会移除故事板节点
    canvasSucceededVideoNodes.ts          # 已成功视频节点恢复，防止旧失败状态覆盖成功结果
    clipDialogueAllocator.ts              # 台词分配/防截断逻辑
    sceneVisualContinuity.ts              # 场景视觉锁和主场景/子场景连续性
    projectGenerationStrategy.ts          # Seedance 多参等全局生成策略识别
    hermesAgent.ts                        # 外部智能体 payload 和权限
```

关键文档：

```text
CODEX_HANDOFF_20260613.md
docs/gpt-image-2-generation.md
docs/dreamina-local-runner.md
CLAUDE.md
```

## 3. 数据模型和持久化结构

Prisma 主要表：

- `User`：用户，包含 `passwordHash`。不要修改用户密码或账号。
- `Project`：项目。最重要字段是 `settings` 和 `metadata` JSON。
- `Generation`：生成记录。图片、视频、定位板、画布生成都会落这里。
- `Asset`：生成/上传资产，包含图片、视频、音频。`deletedAt` 软删。
- `Character` / `Scene`：旧结构仍在，但当前漫剧流程主要使用 `Project.metadata.workflowCenter` 和分集数据。
- `ProviderConfig` / `AiModel`：模型供应商和模型配置，密钥加密。
- `AgentMessage`：智能体对话。

当前工作流的真实状态主要在 `Project.metadata`，不是单独表。

当前项目 `metadata` 顶层键：

```text
activeCanvasSceneId
activeEpisodeId
canvasScenes
currentEpisodeId
episodes
selectedEpisodeId
updatedAt
workflowCenter
```

注意一个坑：

- 当前 `activeEpisodeId` 是 `episode-010`。
- 但 `activeCanvasSceneId/currentEpisodeId/selectedEpisodeId` 仍可能残留 `episode-001`。
- 后续读分集状态时，优先用 `metadata.activeEpisodeId`、`metadata.episodes[episodeId].workflowCenter`、`metadata.canvasScenes[episodeId]`。
- 不要只看 `metadata.workflowCenter` 或 `activeCanvasSceneId`，否则容易误判当前仍是第 9 集。

分集结构：

```text
Project.metadata.episodes[episodeId].workflowCenter
  sourceText
  sourceName
  selectedEpisode
  activeStage
  stageStatuses
  breakdownScenes
  clips
  assets
  sceneVisualBibles
  lastRun
  updatedAt

Project.metadata.canvasScenes[episodeId]
  nodes
  edges
  updatedAt
```

画布节点是 ReactFlow 节点。常见类型：

- `section`：分区容器。
- `imageInput`：图片/资产/场景/角色/道具/定位板参考。
- `generation`：图片生成节点，也用于定位板。
- `video`：视频生成节点。
- `translation`：翻译节点。
- `agent`：智能体节点。
- `audio`：音频参考节点。

画布保存接口：

- `GET /api/canvas/scenes/:projectId/:sceneId`
- `PUT /api/canvas/scenes/:projectId/:sceneId`

分集同步接口：

- `POST /api/canvas/projects/:projectId/sync-episode`

工作流接口：

- `GET /api/workflows/projects/:projectId/workflow?episodeId=...`
- `PUT /api/workflows/projects/:projectId/workflow?episodeId=...`
- `POST /api/workflows/projects/:projectId/workflow/run`
- `POST /api/workflows/projects/:projectId/workflow/clips/:clipId/seedance-prompt`
- `POST /api/workflows/projects/:projectId/workflow/canvas/generate-image`
- `POST /api/workflows/projects/:projectId/workflow/canvas/generate-video`
- `POST /api/workflows/projects/:projectId/workflow/canvas/translate-prompt`
- `POST /api/workflows/projects/:projectId/workflow/canvas/optimize-prompt`
- `POST /api/workflows/projects/:projectId/workflow/canvas/inspect-prompt`

## 4. 当前项目状态

项目：

```text
id: cmq8dw07r0003l00tewomnzwd
name: 美式漫剧
status: ACTIVE
aspectRatio: 9:16
ownerId: cmq8cvumo0000l00tqtcjsi0i
updatedAt: 2026-06-19 11:42 UTC
```

数据库资产/生成概览，2026-06-19 查询：

```text
Generation 总数: 156
Generation SUCCEEDED: 131
Generation FAILED: 25
Asset IMAGE: 108
Asset VIDEO: 3
Asset AUDIO: 3
```

分集：

```text
episode-001 / 第 9 集
  clips: 15
  shots: 97
  assets: 7 characters, 7 scenes, 15 props
  canvas: 277 nodes, 194 edges
  node types: section 30, generation 15, imageInput 202, video 15, translation 15
  stageStatuses: source/assets/storyboard/video done

episode-010 / 第 10 集
  clips: 13
  shots: 87
  assets: 10 characters, 7 scenes, 18 props
  canvas: 257 nodes, 167 edges
  node types: translation 13, section 26, generation 14, imageInput 165, video 13, audio 26
  stageStatuses: source/assets/storyboard/video done
```

当前活跃集：

```text
activeEpisodeId: episode-010
selectedEpisode: 第 10 集
```

第 10 集画布状态，最近扫描：

- 13 个视频节点，全部 `waiting`。
- 13 个批量翻译节点：
  - clip001-clip010：`waiting`，无翻译结果。
  - clip011-clip013：`completed`，已有翻译结果。
- 13 个定位板生成节点：全部 `completed`。
- 绿色污渍/仍然湿/旧污渍等 stale 文案扫描结果为 0。

第 10 集有一个重要历史问题：

- clip02 的临时状态，例如 `green stain` / `still wet`，曾被错误传播到后续 clip、翻译节点和定位板。
- 现在已清理，并在推理规则和翻译节点 stale 检测中加了防护。

## 5. 产品工作流总览

这是一个 AI 漫剧/动画生产系统，目标流程是：

1. 导入小说/剧本。
2. 选择全局设定、风格、生成策略。
3. 提取资产：角色、场景、道具。
4. 可生成或上传资产图；资产图成为视觉权威。
5. 拆解分镜脚本：clip、shot、角色出现、状态、台词、场景。
6. 生成每个 clip 的视频提示词，Seedance 多参模式下直接使用资产参考图 + 视频提示词。
7. 可批量把英文提示词翻译成中文。
8. 可为每个 clip 生成角色位置定位板，即单帧静态 keyframe，用来锁定场景空间和角色站位。
9. 视频节点连接场景、角色、道具、音频、定位板等参考后生成视频。

用户当前明确的工作流要求：

- Seedance 多参模式不应该显示故事板节点。
- 导演板模式才需要故事板。
- 普通模式价值不大，可以弱化或去掉。
- 首帧衔接模式暂不开发。
- 分镜和视频提示词必须遵守原文时序，不能把后文对白提前。
- 每个 clip 的角色位置、朝向、持物、穿戴和可见状态要根据上下文推理，不能写死模板。
- 状态必须延续，但临时污染/污渍/湿衣服不能无限传播。
- 视频模型每个 clip 没有上一段记忆，所以必要状态要在本 clip 明确写出来。
- 资产图是视觉权威。资产图里戴头盔，就不能写摸头发，除非原文/设定明确脱头盔。
- 资产提取、分镜、视频提示词应该是明确阶段，不要混在一个不可解释的“全流程”里。
- 定位板是单帧静态图，不是视频提示词复制版。
- 场景资产提示词应该是无角色空镜，不应塞入 Project authority、Script rules 这类给文本模型看的规则。

## 6. 全局设定和生成策略

生成策略识别在：

```text
server/src/lib/projectGenerationStrategy.ts
```

关键函数：

- `projectGenerationStrategyFromMetadata(metadata)`
- `isSeedanceMultiReferenceStrategy(value)`
- `metadataWithProjectSettings(metadata, settings)`

Seedance 多参识别值：

- `seedance-multi-ref`
- `Seedance 多参`

`projectGenerationStrategyFromPrompt` 还会从 `globalPrompt` 第一行里解析：

```text
Default generation strategy:
```

注意：

- 当前项目使用 Seedance 多参。
- 多参模式下画布保存和加载会调用 `removeCanvasStoryboardNodesForMultiReference`，不应保留故事板节点。
- 如果用户报告“Seedance 多参画布里出现故事板”，优先检查：
  - `metadata.setupSettings.generationStrategy`
  - `Project.settings.setupSettings.generationStrategy`
  - `globalPrompt` 里是否还残留旧策略
  - `server/src/routes/canvas.ts` GET/PUT 是否走到 `removeCanvasStoryboardNodesForMultiReference`
  - `server/src/lib/episodeCanvasSync.ts` 是否根据 generationStrategy 创建了错误节点

## 7. 工作流中心阶段

前端主入口：

```text
src/app/pages/ProjectCanvasPage.tsx
src/app/features/canvas/components/WorkflowCenterOverlay.tsx
src/app/features/canvas/components/StageWorkPanel.tsx
```

后端主入口：

```text
server/src/routes/workflows.ts
```

阶段：

- `source`：小说/剧本导入。
- `assets`：角色、场景、道具提取和资产图。
- `storyboard`：分镜拆解，当前也包含 clip/shot 数据。
- `video`：视频提示词和视频节点。
- `voice`：音频/配音，当前只做了一部分音频参考。
- `edit` / `preview`：后续编辑和预览。

用户对按钮混乱很敏感。之前的问题：

- 小说/剧本导入里的 AI 智能拆解、分镜脚本里的全流程推理、重新拆解、重跑分镜脚本等概念重叠。
- 用户要求去掉或弱化顶部几个让人混淆的按钮。
- 后续如继续改 UI，优先按阶段明确：资产 -> 分镜 -> 视频提示词 -> 翻译/定位板 -> 生成视频。

## 8. 资产流程

资产分类：

- `characters`
- `scenes`
- `props`

资产保存在：

```text
workflow.assets.characters
workflow.assets.scenes
workflow.assets.props
```

资产图片可能来自：

- 用户上传参考图。
- 画布或流程中心生成图。
- 从历史生成图里选择当前图。

相关 API：

- `POST /api/workflows/projects/:projectId/workflow/assets/reference-image`
- `GET /api/workflows/projects/:projectId/workflow/assets/images`
- `POST /api/workflows/projects/:projectId/workflow/assets/select-image`
- `POST /api/workflows/projects/:projectId/workflow/assets/clear-image`
- `DELETE /api/workflows/projects/:projectId/workflow/assets/images/:assetId`
- `DELETE /api/workflows/projects/:projectId/workflow/assets`
- `POST /api/workflows/projects/:projectId/workflow/assets/generate-image`

前端资产相关：

- `ProjectCanvasPage.tsx`
  - `handleGenerateAssetImage`
  - `handleAssetReferenceFile`
  - `handleSelectAssetHistoryImage`
  - `handleUpdateWorkflowAssetPrompt`
  - `handleClearAssetCurrentImage`
  - `handleRemoveWorkflowAsset`
- `CharacterPropPickerPanel.tsx`

近期重要修正：

- 资产提示词编辑已经改为双击弹出大弹窗，使用 `PromptTextarea`。
- 场景资产应该是无角色空镜。不要把 Project authority、Script rules、Character identity rules 这种文本模型推理规则塞进最终提交给生图模型的场景提示词。
- `Style details` 曾出现不跟随全局设定的问题。通常有上层风格描述后，`Style details` 可以弱化或去掉，避免风格重复或不一致。
- 角色图、场景图、道具图的“最终提交给图片模型的提示词”应可在前端完整编辑，不要只显示短摘要。

资产图作为视觉权威的规则：

- 推理视频提示词时必须读取资产图分析结果和当前图。
- 不能与资产图冲突。例如角色戴头盔，不应出现摸头发。
- 除非原文明确发生状态变化，否则不要写脱头盔、扔掉枪、换衣服等。
- 一旦状态变化发生，要在后续 clip/shot 中延续，直到原文或动作让它恢复。

## 9. 分镜和视频提示词

核心文件：

```text
server/src/routes/workflows.ts
server/src/lib/clipDialogueAllocator.ts
server/src/lib/storyboardPrompt.ts
server/src/lib/sceneVisualContinuity.ts
```

视频提示词生成入口：

```text
POST /api/workflows/projects/:projectId/workflow/clips/:clipId/seedance-prompt
```

内部关键函数：

- `regenerateWorkflowClipSeedancePrompt`
- `refineWorkflowClipSeedancePrompt`
- `buildClipSeedancePromptRefinementPrompt`
- `composeSeedancePrompt`
- `composeLayoutMemory`
- `stripTemporaryStateFromClipMemory`

重要规则已经写进 `workflows.ts`：

```text
Temporary contamination, wet clothing, splashes, slime, stains, soot, wounds, or damage must be scoped...
Treat temporary contamination... as scoped state, not permanent identity...
Never spread a temporary state from one character to the whole cast or to later clips by default...
```

提示词质量要求：

- 分镜脚本本身很重要，分镜写不好，视频提示词和最终视频都会弱。
- clip 里的 shot 数不要机械固定。15 秒拆 5 个 3 秒 shot 是不合理的；要根据台词、动作、反应、节奏切分。
- shot 时长规则是 1-3 秒，但不是所有 shot 都必须 3 秒。
- 台词不能截断到下一个 clip。`clipDialogueAllocator.ts` 的目标就是减少截断、合并碎句、保持说话人。
- 台词应加双引号，便于阅读和视频模型判断。
- 不要把非台词写成 `Exact dialogue`。例如 `Composition: "Chloe stands..."` 不是台词。
- 不要每个 shot 都重复同样的全局限定。全局规则放在提示词开头，shot 内写具体动作、镜头、构图、情绪和台词。
- 不要每个 shot 都列全体角色，只写当前可见角色和与本 shot 相关的状态。
- 每个 clip 要明确：
  - 当前场景和视觉锁。
  - 角色站位、朝向、可见状态、持物、穿戴。
  - 当前情绪、表情、动作和台词语气。
  - 镜头景别、视角、运镜、构图。
  - 起始状态和结束状态。
  - 与前后 clip 的状态连续性。

用户给出的典型问题：

- 原文先是门缝僵尸探头，Chloe 开枪打掉，Flora 再怒斥。不能让 Flora 的台词和开枪同时发生。
- clip01 应该至少拆成：
  - S1：僵尸从门缝探出头，准备袭击毫无防备的 Flora。
  - S2：Chloe 开枪打掉。
  - 后续 Flora 才开始训斥。
- clip04/clip05 角色是否被绑住必须一致。如果 clip05 说 Leo 被绑，clip04 或更早必须交代绑定状态，后续也要延续。
- clip06 曾出现大量重复、台词消失、状态重复、无有效动作。后续修改 compose/refine prompt 时要避免这种退化。

## 10. 场景连续性和视觉锁

核心文件：

```text
server/src/lib/sceneVisualContinuity.ts
```

解决的问题：

- 同一个故事空间不能在不同 clip 间变成完全不同场景。
- 用户不担心空间从仓库外到仓库内这种合理变化，真正问题是“刚才白天绿色仓库建筑，下一 clip 变成红色黑夜仓库角落”。

关键概念：

- `SceneVisualBible`：主场景视觉圣经。
- `canonicalSceneId` / `canonicalName`：主场景。
- `childZones`：主场景内的子区域、锚点或细节。
- `continuityLock`：固定时间、灯光、色彩、建筑类型、材质、地标。
- `resolveSceneVisualLockForSetting`：根据 setting 找场景视觉锁。
- `detectSceneVisualConflict`：检测候选提示词是否漂移。

已内置的一些 canonical scene 类型：

- `Sanctuary Superstore Center`
- `Frozen Meat Section`
- `Underground Loading Dock`
- `Labor Purification Zone Approach`

注意：

- 场景资产图不应该包含角色。
- 视频提示词和定位板要引用场景视觉锁，但不要把大量无关规则塞进场景生图提示词。
- 如果同一个主场景被拆成多个场景资产，应尽量作为同一 canonical scene 的 child zone，而不是完全不同主场景。

## 11. Seedance 多参画布同步

核心文件：

```text
server/src/lib/episodeCanvasSync.ts
server/src/routes/canvas.ts
server/src/lib/canvasStoryboardReferences.ts
```

前端入口：

```text
ProjectCanvasPage.tsx
  handleSyncEpisodeBoardsToCanvas
  handleInferBoardsAndVideoToCanvas
  handleGenerateClipSeedancePrompt
```

后端接口：

```text
POST /api/canvas/projects/:projectId/sync-episode
```

脚本：

```bash
DATABASE_URL='postgresql://loohii:<password>@<host>:5432/loohii?schema=public' \
npx tsx scripts/restore-episode-canvas-sync.ts cmq8dw07r0003l00tewomnzwd episode-010
```

Seedance 多参模式下：

- 不应生成故事板节点。
- 视频节点应连接相关场景、角色、道具、音频、定位板等参考。
- `storyboardCount` 应为 0。
- `canvas.ts` GET/PUT 会调用 `removeCanvasStoryboardNodesForMultiReference`，防止故事板残留。

用户近期问题：

- 新建第 10 集后画布还显示第 9 集内容。
- 刷新页面后第 9 集数据会延迟一会儿才消失。
- 目前前端在 `loadEpisodeWorkspace` 开始时会先 `setNodes([]); setEdges([]);`，再异步加载对应集，减少旧画布闪现。
- 如果仍复现，优先检查：
  - `activeEpisodeId` 是否正确。
  - `activeCanvasSceneId/currentEpisodeId/selectedEpisodeId` 旧字段是否被错误使用。
  - `loadCanvasScene(projectId, activeCanvasSceneId)` 是否拿错 sceneId。
  - Zustand store 是否还保留旧节点。

## 12. 批量翻译节点

核心文件：

```text
src/app/pages/ProjectCanvasPage.tsx
src/app/features/canvas/nodes/TranslationNode.tsx
server/src/routes/workflows.ts
```

批量翻译按钮在主画布工具栏：

- 没有选中节点时，默认翻译当前集所有视频提示词节点。
- 有选中节点时，只翻译选中的可翻译节点。

模型选择规则：

- 用户要求使用 `deepseek-4-flash`。
- 代码中 `isDeepSeek4FlashTextModel` 会兼容搜索：
  - `deepseek-4-flash`
  - `deepseek4flash`
  - `deepseek-v4-flash`
  - `deepseek-v4-fast`
  - `deepseek-4-fast`
- 但 UI 和文案应以 `deepseek-4-flash` 为准。

批量翻译实现：

- `batchTranslationNodeIdForSource(sourceId)` 生成稳定翻译节点 ID。
- `batchTranslationNodePositionForSource(source, nodes)` 根据源视频节点 X 轴对齐，让翻译节点位于对应视频节点附近。
- 并发执行所有翻译任务：`Promise.all(translationJobs.map(...))`。
- 每个翻译节点保存：
  - `sourcePrompt`
  - `sourceNodeId`
  - `sourceNodeLabel`
  - `translatedPrompt`
  - `status`
  - `modelId`
  - `batchTranslation: true`
  - `translationStartedAt`

近期修复：

- 翻译节点曾叠在一起，已调整布局脚本和前端定位逻辑，目标是每个翻译节点对准自己连接的视频提示词 X 轴。
- 翻译进度曾显示 `21/111`，原因是把旧缓存/非当前集节点计入范围。当前逻辑应只处理当前集视频节点或选中节点。
- `TranslationNode.tsx` 会检查上游提示词变化：
  - 如果上游 `incomingPrompt` 与存储的 `sourcePrompt` 不一致，并且是批量翻译或来源匹配，则自动清空旧译文、状态改 `waiting`。
  - 这防止视频提示词更新后仍显示旧翻译。

重置 stale 翻译脚本：

```bash
DATABASE_URL='postgresql://loohii:<password>@<host>:5432/loohii?schema=public' \
npx tsx scripts/reset-stale-episode-translations.ts cmq8dw07r0003l00tewomnzwd episode-010
```

布局修复脚本：

```bash
DATABASE_URL='postgresql://loohii:<password>@<host>:5432/loohii?schema=public' \
npx tsx scripts/fix-batch-translation-layout.ts
```

## 13. 定位板工作流

用户定义：

定位板是一个单帧静态 keyframe 图片，用来锁定某个 clip 中场景和角色的大概位置、朝向、构图、持物和状态。它不是视频提示词，也不应该直接复制视频提示词。

脚本：

```bash
DATABASE_URL='postgresql://loohii:<password>@<host>:5432/loohii?schema=public' \
npx tsx scripts/add-clip-positioning-board-flows.ts cmq8dw07r0003l00tewomnzwd episode-010
```

核心脚本文件：

```text
scripts/add-clip-positioning-board-flows.ts
```

关键函数：

- `buildPositioningPrompt`
- `selectAnchorShot`
- `compactBoardCues`
- `stripBoardNoise`

定位板提示词要求：

- `Create ONE static keyframe positioning-board image...`
- 显示足够环境和地面深度。
- 保持连接的角色、场景、道具参考不漂移。
- 只展示当前 clip 可见/应出现的角色和关键道具。
- 不生成字幕、对白气泡、视频镜头运动、连续动作。
- 不复制完整视频提示词。

近期修复：

- 定位板曾照搬视频提示词，已改为静态 keyframe prompt。
- 定位板生成节点是 lightweight generation 节点，降低画布卡顿。
- 定位板提示词可以在节点内编辑，双击 `PromptTextarea` 会弹出居中宽屏编辑弹窗。
- `GenerationNode.tsx` 中 `positioningBoardFlow === true` 会走轻量 UI。
- `ImageInputNode.tsx` 中 `positioningBoardFlow === true` 或 `lightweightReference === true` 会降低参考图展示成本。

清理定位板 stale 历史：

```bash
DATABASE_URL='postgresql://loohii:<password>@<host>:5432/loohii?schema=public' \
npx tsx scripts/clear-stale-positioning-board-history.ts cmq8dw07r0003l00tewomnzwd episode-010
```

## 14. 画布性能

用户近期反馈“画布非常卡”。原因主要是：

- 第 10 集有大量 imageInput 节点，定位板、角色、场景、道具、音频参考叠加后达到 257 节点 / 167 边。
- 图片缩略图和生成节点内容较重。
- ReactFlow 如果渲染所有不可见节点，会明显卡顿。

已做优化：

- `ProjectCanvasPage.tsx`
  - `<ReactFlow onlyRenderVisibleElements />`
  - 保持 uncontrolled 模式。
  - 外部数据同步用 `useReactFlow().setNodes/setEdges`。
- `ImageInputNode.tsx`
  - 定位板引用使用轻量显示。
- `GenerationNode.tsx`
  - 定位板 generation 节点轻量化，隐藏重参考缩略图和大提示词块。

不要做的事：

- 不要把 ReactFlow 改成 controlled。
- 不要给 `<ReactFlow>` 加基于节点数量、版本号或 episode 的动态 `key`，这会诱发重挂载和状态问题。
- 不要在节点每次 render 时生成新大对象或遍历全图。

如果还卡，后续建议：

- 进一步虚拟化/折叠 section 子节点。
- 对 `imageInput` 图片使用懒加载和低分辨率缩略。
- 大批量脚本创建节点时避免把所有参考都接入所有视频节点。
- 视频节点只连接 clip 实际出现的角色、场景、道具，不要全项目资产全接。

## 15. 智能体节点

前端节点：

```text
src/app/features/canvas/nodes/AgentNode.tsx
```

后端：

```text
server/src/routes/agent.ts
server/src/lib/hermesAgent.ts
```

用户需求：

- 画布中可以新增智能体节点。
- 智能体节点可以连接到视频提示词、翻译、图片等节点。
- 用户能给智能体写要求，例如“修改提示词、降敏、不改对白”。
- 智能体应能访问所在项目小说原文、前置推理规则、提示词、分镜、资产和当前画布上下文。
- 结果先返回到智能体节点内，不要自动写回原视频提示词，除非用户明确点击写回或动作要求。

当前实现要点：

- `AgentNode.tsx` 已有模型下拉，读取文本模型列表。
- 智能体结果保存在节点的返回草稿区域。
- 节点内 `PromptTextarea` 支持放大弹窗编辑。
- `server/src/routes/agent.ts` 支持 message 和 actions 两条路：
  - `/api/agent/messages` 创建/继续对话，后台调用 Hermes。
  - `/api/agent/actions` 执行白名单动作。
- `hermesAgent.ts` 的权限明确禁止：
  - 改应用代码。
  - 执行 shell。
  - 读服务端 secrets。
  - 改服务配置。
  - 删除用户账号。
  - 未经明确要求删除项目。

需要注意：

- 如果用户说“点运行没反应”，先检查 `AgentNode.tsx` UI 是否有发送/运行按钮、状态是否更新、API 是否返回。
- 如果“卡在这里没返回”，检查 `HERMES_AGENT_ENABLED`、`HERMES_AGENT_URL` / `HERMES_AGENT_COMMAND`、超时和 `AgentMessage.payload.status`。
- 不要默认把智能体输出写回右侧或原节点。用户明确希望结果保存在智能体节点里。

## 16. GPT image 2 / Aizahuo 生图

详细文档：

```text
docs/gpt-image-2-generation.md
```

核心代码：

```text
server/src/ai/imageModel.ts
```

Aizahuo `gpt-image-2` 的关键点：

- 不是普通 `/images/generations`。
- 要请求 `/v1/responses`。
- 外层 Responses 模型默认 `gpt-5.5`。
- 真正生图模型在 tool 内：

```json
{
  "type": "image_generation",
  "model": "gpt-image-2"
}
```

- 文本提示词放在：

```text
input[0].content[type=input_text].text
```

- 参考图放在：

```text
input[0].content[type=input_image].image_url
```

不要用：

```text
image_urls
reference_images
images
```

这些可能是其他供应商的写法，不适合 Aizahuo `responses + image_generation`。

代码路径：

- `shouldUseSub2ApiResponsesImageGeneration(model)`：当前只对 Aizahuo `gpt-image-2` 返回 true。
- `buildSub2ApiResponsesImageBody(body)`：构造 Responses body。
- `buildResponsesImageInput(body, referenceImageUrls)`：把 prompt 和参考图放进 input content。
- `buildResponsesImageTool(body)`：构造 image_generation tool。
- `resolveResponsesImageGenerationResult(...)`：轮询 Responses 结果。

尺寸建议：

- 角色/道具资产图：`1024x1024`。
- 横屏场景/定位板：`2048x1152` 或 `1024x576`。
- 竖屏：`1152x2048` 或 `576x1024`。
- 避免超大尺寸、极端比例和一次过多参考图。

## 17. Dreamina / Seedance 视频生成

用户当前决定：暂时不接入远程 Dreamina，自己本地生成也可能会用。但代码中仍保留 Dreamina Web 和本地 runner。

旧详细交接：

```text
CODEX_HANDOFF_20260613.md
docs/dreamina-local-runner.md
```

服务端桥：

```text
server/src/ai/dreaminaWebBridge.ts
```

Docker browser：

```text
Dockerfile.dreamina-browser
docker/dreamina-browser/start.sh
docker/dreamina-browser/cdp-host-rewrite-proxy.js
```

环境变量：

- `DREAMINA_BROWSER_CDP_URL=http://dreamina-browser:9223`
- `DREAMINA_LOCAL_RUNNER_URL=<user-local-runner-url>` 可切换到本地 runner。

本地 runner 逻辑：

- 用户本地启动带 CDP 的 Chrome，并登录 Dreamina。
- 在本地 repo 运行 `scripts/dreamina-local-runner.ts`。
- 服务器设置 `DREAMINA_LOCAL_RUNNER_URL` 后，生成、预检、查询都转发到本地 runner。

注意措辞：

- 用户强调指纹浏览器/本地 runner是为了正常使用，不要表述成“绕过风控”。
- 不要主动帮用户做规避平台规则的方案。

历史 Dreamina 修复：

- Dreamina 前端白屏时，runtime service 仍可用。
- CDP host rewrite 已固化进 `dreamina-browser:latest`。
- `loohii_uploads` 已挂载，避免 app 重建后上传资产 404。
- Dreamina 返回 mp4 时，服务端曾增加 WebM 转码逻辑以兼容无 H.264 的 Chromium 测试环境。

## 18. 重要脚本

所有会改数据库的脚本都要先确认项目 ID 和 episode ID。优先使用显式参数，不要依赖默认值。

只读/检查类：

```bash
node scripts/check-episode-canvas-links.mjs <projectId>
node scripts/check-video-prompts-follow-storyboards.mjs <projectId>
```

可带 `--fix` 的检查脚本：

```bash
node scripts/check-episode-canvas-links.mjs <projectId> --fix
```

分集画布重建：

```bash
DATABASE_URL='postgresql://loohii:<password>@<host>:5432/loohii?schema=public' \
npx tsx scripts/restore-episode-canvas-sync.ts cmq8dw07r0003l00tewomnzwd episode-010
```

添加/刷新定位板工作流：

```bash
DATABASE_URL='postgresql://loohii:<password>@<host>:5432/loohii?schema=public' \
npx tsx scripts/add-clip-positioning-board-flows.ts cmq8dw07r0003l00tewomnzwd episode-010
```

修复 clip 视频节点场景参考：

```bash
DATABASE_URL='postgresql://loohii:<password>@<host>:5432/loohii?schema=public' \
npx tsx scripts/fix-clip-video-scene-references.ts cmq8dw07r0003l00tewomnzwd episode-010
```

重新生成单个 clip 视频提示词并同步画布节点：

```bash
DATABASE_URL='postgresql://loohii:<password>@<host>:5432/loohii?schema=public' \
npx tsx scripts/regenerate-clip-video-prompt.ts cmq8dw07r0003l00tewomnzwd episode-010 clip-006
```

重置 stale 翻译：

```bash
DATABASE_URL='postgresql://loohii:<password>@<host>:5432/loohii?schema=public' \
npx tsx scripts/reset-stale-episode-translations.ts cmq8dw07r0003l00tewomnzwd episode-010
```

清理第 10 集绿色污渍历史：

```bash
DATABASE_URL='postgresql://loohii:<password>@<host>:5432/loohii?schema=public' \
npx tsx scripts/clear-episode10-expired-green-stain.ts cmq8dw07r0003l00tewomnzwd episode-010
```

清理定位板 stale 历史：

```bash
DATABASE_URL='postgresql://loohii:<password>@<host>:5432/loohii?schema=public' \
npx tsx scripts/clear-stale-positioning-board-history.ts cmq8dw07r0003l00tewomnzwd episode-010
```

修复批量翻译布局：

```bash
DATABASE_URL='postgresql://loohii:<password>@<host>:5432/loohii?schema=public' \
npx tsx scripts/fix-batch-translation-layout.ts
```

本地化项目图片 URL：

```bash
node scripts/localize-project-image-urls.mjs <projectId> --fix
```

Dreamina local runner：

```bash
DREAMINA_LOCAL_CDP_URL=http://127.0.0.1:9222 \
DREAMINA_LOCAL_RUNNER_PORT=4317 \
npx tsx scripts/dreamina-local-runner.ts
```

## 19. 最近关键修复清单

### 19.1 绿色污渍 / 临时状态泄漏

问题：

- clip02 的 `green stain`、`still wet` 被当成长期状态传播到后续 clip、翻译和定位板。

修复：

- `server/src/routes/workflows.ts`
  - 加入临时污染/湿衣服/污渍/伤口等 scoped state 规则。
  - `composeLayoutMemory` 通过 `stripTemporaryStateFromClipMemory` 过滤跨 clip 记忆。
- `scripts/clear-episode10-expired-green-stain.ts`
  - 清理已写入 metadata 的旧污渍文案。
- `scripts/clear-stale-positioning-board-history.ts`
  - 清理定位板节点历史里残留的 stale 文案。
- `src/app/features/canvas/nodes/TranslationNode.tsx`
  - 上游 prompt 改变时自动清空旧翻译。

当前第 10 集画布扫描：

```text
greenMatchCount: 0
```

### 19.2 定位板静态 keyframe

问题：

- 早期定位板直接照搬视频提示词，导致生图失败或不符合定位板用途。

修复：

- `scripts/add-clip-positioning-board-flows.ts`
  - 改为生成 ONE static keyframe positioning-board prompt。
- `GenerationNode.tsx`
  - 定位板节点轻量化并支持双击弹窗编辑。
- `ImageInputNode.tsx`
  - 定位板参考轻量化。

### 19.3 批量翻译 stale 和布局

问题：

- 视频提示词更新后，旧中文翻译还显示。
- 批量翻译节点叠在一起。
- 批量翻译进度统计包含旧缓存节点。

修复：

- `TranslationNode.tsx` 自动检测上游 prompt 变化并重置译文。
- `ProjectCanvasPage.tsx` 批量翻译只处理当前集或选中节点。
- 翻译节点按源视频节点 X 轴位置布局。
- `scripts/fix-batch-translation-layout.ts` 可修历史画布。

### 19.4 画布性能

修复：

- ReactFlow 使用 `onlyRenderVisibleElements`。
- 定位板 generation/imageInput 节点轻量化。
- 保持 ReactFlow uncontrolled，避免 update depth 问题。

### 19.5 分集画布隔离

问题：

- 新建第 10 集后仍显示第 9 集画布。
- 刷新时旧画布会短暂延迟消失。

修复方向：

- `loadEpisodeWorkspace` 先清空节点/边再加载对应集。
- 画布 sceneId 应使用 active episode id。
- 当前仍需警惕 metadata 顶层旧字段导致读错。

### 19.6 Seedance 多参故事板清理

问题：

- Seedance 多参模式不应该出现故事板。

修复：

- `canvas.ts` GET/PUT 在多参策略下调用 `removeCanvasStoryboardNodesForMultiReference`。
- `episodeCanvasSync.ts` 同步时按 generationStrategy 构建不同节点结构。

### 19.7 智能体节点结果留在节点内

问题：

- 用户希望智能体运行结果先返回到智能体节点，而不是直接覆盖原视频提示词。

修复方向：

- `AgentNode.tsx` 保存返回草稿。
- 后端 agent action 有白名单写回动作，但默认不应自动写回。

## 20. 测试和验证

最近已经跑过且通过：

```bash
npm run server:check
npx tsx server/src/routes/workflows.test.ts
npx tsx server/src/lib/canvasStoryboardReferences.test.ts
npm run build
```

旧 Dreamina 相关曾跑过：

```bash
npx tsx server/src/lib/canvasSucceededVideoNodes.test.ts
npx tsx server/src/ai/dreaminaWebBridge.test.ts
```

每次改后建议：

1. 后端类型检查：

```bash
npm run server:check
```

2. 前端 build：

```bash
npm run build
```

3. 工作流测试：

```bash
npx tsx server/src/routes/workflows.test.ts
npx tsx server/src/lib/canvasStoryboardReferences.test.ts
```

4. 如果改画布同步：

```bash
npx tsx server/src/lib/canvasSucceededVideoNodes.test.ts
```

5. 如果改场景连续性：

```bash
npx tsx server/src/lib/sceneVisualContinuity.test.ts
```

6. 如果改台词分配：

```bash
npx tsx server/src/lib/clipDialogueAllocator.test.ts
```

7. Docker 重建后健康检查：

```bash
curl -fsS -H 'Host: loohii.com' http://23.80.83.16:3001/api/health
```

## 21. 当前已知风险和坑点

### 21.1 metadata 新旧结构混杂

当前同时存在：

- 顶层 `workflowCenter`
- 分集 `episodes[episodeId].workflowCenter`
- 顶层 `activeCanvasSceneId/currentEpisodeId/selectedEpisodeId`
- 分集 `activeEpisodeId`

不要只改一个地方。保存分集工作流应通过后端 `writeWorkflowEpisode` 路径或 API，避免写乱。

### 21.2 脚本里有些默认 episode 是旧值

例如部分脚本默认 `episode-001`。执行时必须显式传：

```text
cmq8dw07r0003l00tewomnzwd episode-010
```

### 21.3 大文件

`server/src/routes/workflows.ts` 和 `src/app/pages/ProjectCanvasPage.tsx` 很大。改动时尽量局部插入，不要重排全文件。能抽到 `server/src/lib/*` 或 `src/app/features/canvas/*` 时再抽。

### 21.4 画布自动保存会覆盖

旧页面如果还打开，可能把旧节点状态 PUT 回后端。`canvas.ts` 已有 `baseUpdatedAt` 冲突判断，但前端仍要注意。

### 21.5 生成会消耗额度

调用生图/视频真实生成会消耗外部模型额度。调试时优先 dry-run 或只检查提示词和节点结构。

### 21.6 提示词不要被“规则污染”

文本模型推理规则、Project authority、Script rules、Character identity rules 是给文本模型用的，不应原样提交给图片模型，尤其是场景资产图。

### 21.7 临时状态不要污染长期连续性

绿色污渍问题就是例子。规则：

- 绑定、持枪、穿戴、伤势、脱帽这类可能需要延续。
- 污渍、湿衣、溅落、短暂动作要有范围，不能自动传播全 cast 和所有后续 clip。

### 21.8 道具连接

第 10 集用户指出：很多 clip 应出现的道具没有连接，所有 clip 没有接道具；同时部分不存在角色被接入了视频节点。后续继续修时要让引用连接基于每个 clip/shot 的实际出现角色和道具，而不是全量资产。

### 21.9 翻译节点不要叠加旧缓存

批量翻译应基于当前集视频节点重新计算，不要把之前集或删除过的节点算进去。

### 21.10 用户已有页面和本地 AI 可能同时操作

用户可能让本地 AI 或 Claude Code 并行改。接手前先看 `git status --short`，只处理自己任务相关文件。

## 22. 当前建议的下一步

如果 Claude Code 接手继续做功能，建议顺序：

1. 先解决第 10 集视频节点引用精确性：
   - 每个 clip 只连接实际出现角色。
   - 道具按实际出现接入。
   - 场景接入保持唯一主场景或合理子场景。
2. 检查第 10 集视频提示词：
   - 是否包含台词。
   - 是否有镜头运镜、景别、构图。
   - 是否只写可见角色状态。
   - 是否表达角色情绪和台词语气。
3. 对第 10 集 clip001-clip010 重新批量翻译，因为当前这些翻译节点是 waiting。
4. 检查定位板提示词是否都是静态 keyframe，不复制视频提示词。
5. 清理 metadata 顶层旧 active 字段使用风险：
   - 不一定要立刻迁移数据。
   - 但前端读取当前集时必须以 `activeEpisodeId` 和显式 `episodeId` 为准。
6. 如果继续优化流程中心：
   - 去掉容易混淆的重复按钮。
   - 把 Seedance 多参、导演板、首帧衔接显示为不同工作页面。
   - 普通模式可以降级或隐藏。

## 23. 快速排查手册

### 23.1 页面白屏

先查：

```bash
curl -fsS -H 'Host: loohii.com' http://23.80.83.16:3001/api/health
docker logs --tail=100 loohii-app
```

历史原因之一：

- Helmet 默认 CSP 的 `upgrade-insecure-requests` 曾导致 HTTP 端口访问时 JS/CSS 被升级到 HTTPS，从而白屏。
- 当前 `server/src/http.ts` 已设置 `upgradeInsecureRequests: null`，并放开图片/媒体/connect。

### 23.2 第 10 集显示第 9 集画布

检查：

- 当前前端 `activeEpisodeId`。
- 调用 `GET /api/canvas/scenes/:projectId/episode-010` 的返回。
- 是否错误使用了 `activeCanvasSceneId`。
- Zustand store 是否在异步加载前已清空。

### 23.3 Seedance 多参出现故事板

检查：

- `isSeedanceMultiReferenceStrategy(projectGenerationStrategyFromMetadata(metadata))`
- `removeCanvasStoryboardNodesForMultiReference`
- `/api/canvas/projects/:projectId/sync-episode` 返回 `storyboardCount`

### 23.4 翻译节点旧内容

检查：

- 翻译节点 `data.sourcePrompt` 是否等于上游视频节点当前 prompt。
- `TranslationNode.tsx` 自动 stale 检测是否触发。
- 可运行 `scripts/reset-stale-episode-translations.ts`。

### 23.5 绿色污渍又出现

检查：

```bash
docker exec loohii-postgres psql -U loohii -d loohii -Atc \
"select metadata::text from \"Project\" where id='cmq8dw07r0003l00tewomnzwd';" | \
grep -iE 'green stain|still wet|earlier green stain|green sludge still|still sticky|绿色污渍|仍然湿'
```

如果命中：

- 先判断是否在 clip02 合理上下文。
- 如果跨 clip 泄漏，运行清理脚本并检查 `stripTemporaryStateFromClipMemory`。

### 23.6 定位板图片失败

检查：

- 定位板 prompt 是否是静态 keyframe，不是视频提示词。
- 是否连接了场景参考和实际可见角色参考。
- 生图模型是否支持参考图。
- `Generation` 的 `errorMessage`。
- `Asset` 是否生成成功但节点没有写回。

### 23.7 视频生成失败

检查：

- 视频节点连接的参考图是否公网可访问。
- 参考图数量是否超过 provider 限制。
- prompt 是否过长或包含高风险词。
- `Generation.parameters.raw` 里的 provider 返回。
- 若 Dreamina Web，本地 runner 或 Docker browser 状态是否正常。

## 24. 当前工作区状态提示

2026-06-19 查询 `git status --short` 显示大量改动：

- 多个后端文件已修改：`workflows.ts`、`canvas.ts`、`agent.ts`、`dreaminaWebBridge.ts` 等。
- 多个前端文件已修改：`ProjectCanvasPage.tsx`、各种 canvas nodes、页面和样式。
- 多个 UI 组件文件被删除或重构。
- 多个新脚本、新 lib、新 docs 未跟踪。

不要执行：

```bash
git reset --hard
git checkout -- .
```

除非用户明确要求，否则不要尝试“清理”工作区。接手时只改当前任务需要的文件。

## 25. 提交建议

如果用户要求提交，建议先按主题拆分，而不是一个大提交：

1. 工作流和提示词推理修复。
2. 画布分集同步和 Seedance 多参修复。
3. 翻译节点和智能体节点。
4. 定位板工作流。
5. Dreamina / Docker / 上传持久化。
6. 文档。

提交前至少跑：

```bash
npm run server:check
npm run build
```

如果改了后端工作流，再跑：

```bash
npx tsx server/src/routes/workflows.test.ts
```

## 26. 给接手者的当前重点判断

当前系统不是“完全不可用”，而是已经具备完整工作流雏形，但正在把漫剧生产流程从“粗糙一键推理”重构成“资产 -> 分镜 -> 视频提示词 -> 翻译/定位板 -> 视频”的可控流程。

最容易出问题的地方不是单个 API，而是状态和上下文：

- 当前集 vs 旧集。
- 主场景 vs 子场景。
- 长期状态 vs 临时状态。
- 可见角色 vs 全量角色。
- 文本模型规则 vs 最终提交给图片/视频模型的 prompt。
- 用户编辑后的节点内容 vs 重新推理/同步覆盖。

后续每次改动都要围绕这些边界验证。

