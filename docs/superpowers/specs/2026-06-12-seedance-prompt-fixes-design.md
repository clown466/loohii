# Seedance 多参提示词缺陷修复 — 设计文档（2026-06-12）

## 背景与缺陷清单

用户在生产环境（项目「美式漫剧」）发现 Seedance 多参模式生成的视频提示词存在以下缺陷，根因均已定位：

| # | 缺陷 | 根因位置 |
|---|------|---------|
| D1 | 每个节拍行尾残留「；对话；反应」垃圾尾巴 | `buildShotOrderVideoBeats` 把 `dialogue/reaction 台词` 拼进节拍正文（workflows.ts:5708）；`formatStoryboardVideoBeats` 抽走台词内容但留下标签（:5727）；`cleanStoryboardPanelText` 把 `/` 替换成 `;`（:5697） |
| D2 | 多参模式混入章节导演板指令：「使用关联的分镜图作为主要视觉参考」「先动画P1再P2…」 | `composeSeedancePrompt` 分镜图行无条件输出（:5464）；P 面板指令只判断节拍存在与否、不判断节拍是 P 还是 S（:5467） |
| D3 | 台词被缩减（S1 比原文少）、不标说话人、同一长句被切到 S2/S3/S4 三个节拍 | 节拍台词直接取各镜头（shot）的 dialogue 碎片；上游按镜头切碎长句；模板只识别 `角色名:` 前缀、不补全 |
| D4 | 相邻节拍动作文本完全重复（S2/S3/S4 三行一样） | 上游镜头数据重复，模板层无去重 |
| D5 | 镜头节奏偏慢，单 Clip 镜头数偏少（3-5 个） | 镜头时长钳制 2-4 秒（`clampShotDuration`，:4757）+ 4 处 LLM 指令文案「Prefer 2-4 seconds」 |

注：用户看到的中文提示词由「翻译提示词」功能（workflows.ts:1234）对英文模板产物逐字翻译而来，模板缺陷被原样保留；模板修复后翻译产物自然干净，翻译功能本身不动。

## 用户确认的决策

1. 台词形态：**台词随节拍 + 强制说话人前缀 + 长句不跨节拍切分**（归入句子开始的节拍）。
2. 完整性保证：**代码兜底逐字完整**——以分镜原始台词为唯一真相，生成后逐字校验，漏词自动补回所属节拍。
3. 存量数据：**部署后批量重算**当前项目所有 Clip 的 seedancePrompt（事务内、可回滚）。
4. 镜头节奏：**1-3 秒一个镜头**，尽量保证镜头更多。
5. 方案路线：本地模板层修复（方案 A）；上游 LLM 分镜拆解的根治留到「推理链路整体审计」子项目。

## 范围

**改**：`server/src/routes/workflows.ts`（提示词组装层）、新建 `server/src/lib/clipDialogueAllocator.ts`（+测试）、`server/src/lib/episodeCanvasSync.ts` 与 `src/app/features/canvas/canvasUtils.tsx` 中同型本地构建器（`clip.seedancePrompt` 为空时的兜底路径，带同样的 D1/D2 缺陷）。

**不改**：章节导演板（P 面板）模式的既有指令行为（仅 D5 的镜头节奏跨模式生效，见风险）；LLM 推理指令（除 D5 的 4 处时长文案）；翻译功能；Clip 分组逻辑（除时长钳制）。

**不碰**：`canvasHelpers.ts`（无引用的重构副本）。

## 设计

### 1. 台词分配器（新文件 `server/src/lib/clipDialogueAllocator.ts`，纯函数）

输入：该 Clip 的镜头数组（含 `dialogue`、`characters` 字段）与节拍数。输出：每节拍的台词行数组 + 完整性报告。

- **说话人补全**：已有 `角色名:`/`角色名：` 前缀的保留；无前缀且该镜头 `characters` 只有一个角色时补该角色名；多角色且无前缀时保持原文不猜。
- **碎句合并**：镜头台词不以句末标点（。！？.!?…"”）结尾时，视为被切碎的半句，与后续镜头同说话人（或同样无说话人）的片段拼接为完整句，整句归入**起始镜头**对应的节拍。
- **逐字校验**：分配完成后，每条源台词必须逐字出现且仅出现一次（按规范化比对，忽略空白差异）；缺失的补回其镜头对应节拍末尾。分配器不抛异常：空台词输出空数组。

### 2. 模板修复（`composeSeedancePrompt` 及节拍函数，workflows.ts）

- **D1 根治**：`buildShotOrderVideoBeats` 节拍正文只含镜头参数与动作，台词只放 `beat.dialogue` 字段（来自分配器）；清洗函数防御性剥除残留的 `dialogue/reaction` 标签字样（覆盖 P 面板文本路径）。
- **D2 模式区分**：节拍按 label 前缀识别类型。P 节拍 → 保留现有「Use the connected storyboard image…」与「animate P1 first…」指令；S 节拍 → 分镜图行替换为「Turn the shot beats into natural continuous motion.」，顺序指令改为「Do not skip, merge, or reorder the shot beats; play S1 first, then S2, continuing in order.」。
- **D4 去重**：相邻节拍的动作核心文本（去镜头参数后）规范化相等时，后续节拍仅保留镜头参数差异，不复述动作。
- 两个 `composeSeedancePrompt` 调用点（workflows.ts:5011、:5118）改为传入分配器产物。

### 3. 镜头节奏 1-3 秒（D5）

- `clampShotDuration`：`max(2, min(4, round))` → `max(1, min(3, round))`，无效值默认 2 秒（workflows.ts:4757）。
- 4 处 LLM 指令文案「2-4 second(s)」→「1-3 second(s)」（workflows.ts:3303、3306、3394、3606）。
- 长台词按词数切分镜头的预算按「3 秒 × 目标语速」收紧。
- 预期效果：13-15 秒 Clip 通常 5-7 个镜头（对话密集约 4-6 个），节拍上限 12 不变。

### 4. 本地兜底构建器同步修复

`episodeCanvasSync.ts` 的 `buildLocalClipVideoPrompt`（含 :875 的 P beats 指令行）与前端 `canvasUtils.tsx` 同型函数，应用与 D1/D2 相同的修复（S 节拍措辞、无分镜图行、无垃圾尾巴）。前后端产物保持一致。

### 5. 数据流（不变）

shots → 分配器 → 节拍 → `composeSeedancePrompt` → 长度压缩（`finalizeWorkflowVideoPrompt`）→ 存 `clip.seedancePrompt` → 画布同步 → 用户可选翻译。

### 6. 测试与验证

- 新 lib 单测（node:test）：说话人补全、多角色不猜、碎句合并归起始节拍、逐字校验与补回、空台词、入参不可变。
- `workflows.test.ts` 追加（经 `workflowsTestInternals` 导出）：节拍行无 `dialogue/reaction` 残留、S/P 指令区分、相邻节拍去重、`clampShotDuration` 新边界。
- 回归：既有 12 个测试全绿；`npm run server:check`、`npm run build` 通过。

### 7. 部署与存量重算

1. 重建镜像、替换容器（保留回滚 tag，同既有做法）。
2. 容器内事务脚本（行锁 + 可回滚）重算项目 `cmq8dw07r0003l00tewomnzwd` 全部剧集所有 Clip 的 `seedancePrompt`；重算后提示画布重同步。
3. 注意：重算覆盖旧提示词；画布视频节点上手动翻译过的中文版需重新翻译。存量 Clip 的镜头数不变（D5 只影响未来的分镜推理）。

## 风险与已知影响

- **D5 跨模式影响**：镜头变短变多对章节导演板同样生效（导演板每页面板数增加）。用户已知情并接受。
- 提示词节拍块变长（镜头更多）→ 长度压缩（`DREAMINA_WEB_VIDEO_PROMPT_TARGET_CHARS`）触发概率上升；D4 去重与 D1 瘦身对冲此压力。实现时需验证 7 节拍 Clip 的压缩路径不会把台词压掉（台词优先级最高）。
- 碎句合并的标点启发式对非常规标点（省略号收尾的故意悬停）可能误合并；逐字校验保证内容不丢，最坏情况是归属节拍偏移一格。

## 验收标准

以「美式漫剧」Clip 01 重算后的提示词为样本：
1. 无任何「；对话；反应」/「dialogue; reaction」残留；
2. 无「分镜图为主要参考」「先动画P1」字样；含「S1 first, then S2」类顺序指令；
3. 每条台词带说话人前缀，与剧集分镜源台词逐字一致，长句不跨节拍；
4. 相邻节拍无重复动作文本；
5. 新分镜推理产出的镜头时长全部在 1-3 秒。
