# 资产图回填画布参考节点 — 实现计划（2026-06-12）

## 背景与根因

资产面板（workflowCenter.assets）中给资产上传/生成/选择图片后，画布 `metadata.canvasScenes` 中已存在的
`imageInput` 参考节点（「角色参考: Chloe」「场景参考: …」「道具参考: …」）不会更新——它们是
「同步本集到画布」那一刻的快照。资产后设图时，节点保持空 `imageUrl` + 「该资产还没有参考图」错误文案。

对比：角色音频参考已有「服务端更新 → 前端重载画布」机制（`uploadCharacterReferenceAudio` +
`refreshCanvasAfterAudioReferenceChange`，见 `ProjectCanvasPage.tsx:1626`），图片缺少同样的机制。

二级问题：资产按剧集快照存储（`metadata.episodes[id].workflowCenter.assets`），当前集设图不会
传播到其他集的同名资产（实测 episode-009 快照全部无图）。

已验证：`buildEpisodeCanvasSyncScene`（server/src/lib/episodeCanvasSync.ts）本身取图逻辑正确
（`referenceImageUrl || generatedImageUrl` → publicImageUrl），用生产 metadata 离线重跑可正确填图。
所以修复方向是「资产图写入时回填」，不动重建逻辑。

## 约束（所有任务必须遵守）

- **禁止 git commit**：工作区有另一项进行中重构的未提交改动，本次修复只改工作区。
- 不要触碰 `src/app/features/canvas/canvasHelpers.ts`（无引用的重构副本）。
- 命名导出、文件 <1000 行、UI 文案中文、import 用 `@/` 别名（前端）。
- 测试框架：node:test + assert/strict，运行 `npx tsx --test <file>`。
- ReactFlow 画布保持非受控，前端刷新画布走已有的 `loadCanvasScene` 路径（同音频参考的做法）。

## Task 1：服务端回填 helper（纯函数 + 单测）

新建 `server/src/lib/canvasAssetImageSync.ts`，导出两个纯函数（不可变更入参）：

### applyWorkflowAssetImageToCanvasScenes(metadata, change, now)

- `change: { assetKind: 'characters'|'scenes'|'props'; assetName: string; imageUrl: string; imageAssetId: string }`
- `now: string`（ISO 时间，由调用方传入）
- 返回 `{ metadata: Record<string, unknown>; changedNodeCount: number }`
- 遍历 `metadata.canvasScenes`（对象 map，每项含 nodes/edges/updatedAt）下所有节点：
  - 匹配条件：`node.type === 'imageInput'` 且 `node.data.assetKind === change.assetKind`
    且 `normalizeCompareText(node.data.assetName) === normalizeCompareText(change.assetName)`。
  - **手动覆盖保护**：若 `node.data.imageUrl` 非空且 ≠ `node.data.clipSyncUrl`，说明用户手动换过图，跳过。
  - 补丁字段（参照 episodeCanvasSync.ts:484-502 的节点创建逻辑保持一致）：
    `imageUrl` 与 `clipSyncUrl` = change.imageUrl；`assetId` 与 `clipSyncAssetId` = change.imageAssetId；
    `uploadStatus` = imageUrl ? 'linked' : 'missing'；
    `uploadError` = imageUrl ? '' : '该资产还没有参考图，请上传或生成后再生成视频。'；
    `imageLoadError` = false。
  - 节点数据无变化时不改写（幂等）。某场景有节点变更时，该场景 `updatedAt` = now。
- URL 须经 publicImageUrl 规范化（episodeCanvasSync.ts:1459 有私有实现；导出复用或在新文件内
  实现等价函数，保持行为一致——https 直通、localhost 公网路径改写、其余返回空串）。

### fillMissingAssetImageAcrossEpisodes(metadata, change)

- `change: { assetKind; assetName; field: 'referenceImageUrl'|'generatedImageUrl'; imageUrl: string; imageAssetId: string }`
- 返回 `{ metadata; changedEpisodeIds: string[] }`
- 遍历 `metadata.episodes[*].workflowCenter.assets[assetKind]`，对名字匹配（normalizeCompareText）
  且 **referenceImageUrl 与 generatedImageUrl 都为空** 的资产：填入 `change.field` = imageUrl，
  以及对应的 `referenceImageAssetId`/`generatedImageAssetId` = imageAssetId。
- 只补缺，不覆盖已有图；不处理顶层 workflowCenter（调用方负责活动集）。

### 单测 `server/src/lib/canvasAssetImageSync.test.ts`

至少覆盖：空节点被回填（含 status/error 字段断言）；手动覆盖的节点被跳过；imageUrl='' 时节点重置为
missing + 错误文案；资产名大小写/空白差异仍匹配；跨集补缺生效；其他集已有图不被覆盖；入参对象未被修改。

## Task 2：接入服务端四个写入点（server/src/routes/workflows.ts）

四个函数都已有 `const nextMetadata = writeWorkflowEpisode(...)` 后紧跟 `tx.project.update` 的结构，
在两者之间插入回填（用 nextItem 实际写入的 URL/assetId，时间用 nextWorkflow.updatedAt）：

1. `syncWorkflowAssetReference`（~2499 行，上传参考图）：
   canvas 回填 imageUrl = nextItem.referenceImageUrl，imageAssetId = asset.id；
   跨集补缺 field='referenceImageUrl'。
2. `syncWorkflowGeneratedAssetImage`（~2579 行，生成图写回）：
   canvas 回填 imageUrl = 写回后资产的当前图（referenceImageUrl || generatedImageUrl，注意上传参考图
   优先级高于生成图，若资产已有 referenceImageUrl 则当前图不变，此时回填值仍应是该当前图，等价于不变）；
   跨集补缺 field='generatedImageUrl'。注意：路由 ~1523 行存在 `writeBackToAsset=false`（道具版）分支
   不调用本函数，无需处理。
3. `syncWorkflowSelectedAssetImage`（~2655 行，历史图设为当前图）：
   canvas 回填 imageUrl = 选择后资产的当前图；跨集补缺用其实际写入的字段。
4. `clearWorkflowAssetCurrentImage`（~2715 行，取消当前图）：
   canvas 回填 imageUrl=''（节点回到 missing 占位）；**不做**跨集传播。

实现前先读这四个函数确认各自 nextItem 的字段写法，回填值必须与写入 workflow 资产的最终状态一致。
`server/src/routes/workflows.ts` 已有未提交改动——只做最小插入，不要重排/重构既有代码。

## Task 3：前端在资产图变更后重载画布（src/app/pages/ProjectCanvasPage.tsx）

仿照 `refreshCanvasAfterAudioReferenceChange`（1626 行）：将其改名为通用的
`refreshCanvasAfterAssetReferenceChange`（更新原引用），并在以下 handler 成功路径中调用
（仅 `projectId && projectId !== 'local'`）：

- `handleSelectAssetHistoryImage`（~2067 行）
- `handleGenerateAssetImage`（~2217 行；`variant === 'with-props'`（不写回资产）时跳过）
- `handleClearAssetCurrentImage`（~2320 行附近）
- 资产参考图上传完成的回调（从 `openAssetReferencePicker` 跟踪到实际调用
  `/workflow/assets/reference-image` 的位置，在其成功后调用）

`ProjectCanvasPage.tsx` 也有未提交改动——同样最小插入。

## Task 4：验证

```bash
npx tsx --test server/src/lib/canvasAssetImageSync.test.ts   # 新增测试全绿
npx tsx --test server/src/routes/workflows.test.ts            # 既有测试不回归
npm run server:check                                           # 后端类型检查
npm run build                                                  # 前端构建
```

## 部署（用户操作）

修复在 `/projects/loohii` 工作区。生效需要同步到宿主机 `/srv/loohii` 后：
`docker compose -f docker-compose.production.yml up -d --build app`。
对已损坏的存量画布：部署后在工作流中心重新「同步本集到画布」，或对任一资产重设当前图触发回填。
