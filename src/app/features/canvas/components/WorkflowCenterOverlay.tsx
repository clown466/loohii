import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  FileText,
  PanelLeft,
  Save,
  SlidersHorizontal,
  UploadCloud,
  Wand2,
  X,
} from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { cn } from '../../../utils/cn';
import {
  type Clip,
  type WorkflowCenterOverlayProps,
  type WorkflowStageKey,
  assetArray,
  modelOptionLabel,
  workflowAssetImageReadiness,
  workflowHasRunningStage,
  workflowStages,
  workflowSteps,
} from '../canvasUtils';
import { StageWorkPanel } from './StageWorkPanel';
import { StoryboardSceneEditor } from './StoryboardSceneEditor';

export function WorkflowCenterOverlay({
  generationStrategy,
  storyboardEnabled = true,
  firstFrameUnavailable = false,
  activeStage,
  setActiveStage,
  sourceText,
  setSourceText,
  sourceName,
  setSourceName,
  selectedEpisode,
  setSelectedEpisode,
  episodeList,
  activeEpisodeId,
  activeEpisodeSummary,
  episodeSwitching,
  episodeCreating,
  onSelectEpisode,
  onCreateNextEpisode,
  onSaveSource,
  scenes,
  clips,
  assets,
  stageStatuses,
  workflowLoading,
  workflowSaving,
  workflowRunning,
  workflowError,
  workflowProgressText,
  workflowModels,
  workflowAiModelId,
  setWorkflowAiModelId,
  finalizeClipStoryboardPrompt,
  workflowModelsLoading,
  workflowModelError,
  runBreakdown,
  rerunStoryboard,
  inferBoardsAndVideoToCanvas,
  onSyncEpisodeBoardsToCanvas,
  onFullPipelineInfer,
  fullPipelineRunning,
  onClose,
  onUploadClick,
  onAddWorkflowNode,
  onAddSceneNode,
  onAddClipStoryboardNode,
  onAddClipStoryboardImageReferenceNode,
  onAddClipVideoNode,
  onAddClipVideoNodes,
  onAddClipPositioningBoardNode,
  onAddClipPositioningBoardNodes,
  onUpdateClipStoryboard,
  onUpdateScene,
  onDeleteScene,
  onAcceptClip,
  onOptimizeClip,
  onGenerateClipSeedancePrompt,
  onUploadAssetReference,
  onUploadAudioReference,
  onClearAudioReference,
  onBatchUploadCharacterAudioReferences,
  onOpenProjectGlobalSettings,
  onOpenCharacterPropPicker,
  onGenerateAssetImage,
  onOpenAssetHistory,
  onLoadAssetHistoryImages,
  onPreviewAssetImage,
  onAddAssetToCanvas,
  onClearAssetCurrentImage,
  onRemoveAsset,
  onUpdateAssetPrompt,
  buildAssetFinalPrompt,
  isAssetUploadBusy,
  isAssetGenerationBusy,
  optimizingClipId,
  generatingSeedanceClipId,
  inferBoardsAndVideoRunning,
  storyboardImageRefs,
}: WorkflowCenterOverlayProps) {
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const imported = sourceText.trim().length > 0;
  const hasBreakdown = scenes.length > 0;
  const hasStoryboard = hasBreakdown || clips.length > 0;
  const assetTotal = assetArray(assets, 'characters').length + assetArray(assets, 'scenes').length + assetArray(assets, 'props').length;
  const hasAssets = assetTotal > 0;
  const assetImageReadiness = workflowAssetImageReadiness(assets);
  const workflowBusy = workflowRunning || inferBoardsAndVideoRunning || fullPipelineRunning || workflowHasRunningStage(stageStatuses);
  const stageStatus = useMemo(() => {
    const status: Record<WorkflowStageKey, 'done' | 'current' | 'pending'> = {
      source: imported ? 'done' : 'current',
      assets: hasAssets ? 'done' : imported ? 'current' : 'pending',
      storyboard: hasStoryboard ? 'done' : hasAssets ? 'current' : 'pending',
      video: 'pending',
      voice: 'pending',
      preview: 'pending',
      edit: 'pending',
    };
    for (const stage of workflowStages) {
      const remote = stageStatuses[stage.key];
      if (remote === 'done') status[stage.key] = 'done';
      if (remote === 'running') status[stage.key] = 'current';
    }
    status[activeStage] = status[activeStage] === 'done' ? 'done' : 'current';
    return status;
  }, [activeStage, hasAssets, hasStoryboard, imported, stageStatuses]);

  const sourceStats = useMemo(() => {
    const text = sourceText.trim();
    const chars = text.length;
    const paragraphs = text ? text.split(/\n\s*\n/).filter((item) => item.trim()).length : 0;
    const estimatedScenes = Math.max(0, Math.min(24, Math.ceil(chars / 420)));
    return { chars, paragraphs, estimatedScenes };
  }, [sourceText]);
  const activeStageInfo = workflowStages.find((stage) => stage.key === activeStage) ?? workflowStages[0];
  const editingScene = editingSceneId ? scenes.find((scene) => scene.id === editingSceneId) : undefined;

  useEffect(() => {
    if (editingSceneId && !scenes.some((scene) => scene.id === editingSceneId)) {
      setEditingSceneId(null);
    }
  }, [editingSceneId, scenes]);

  return (
    <div className="absolute inset-3 left-16 z-30 flex min-h-0 overflow-hidden rounded-lg border border-zinc-800 bg-[#0d0d0f]/95 shadow-2xl backdrop-blur">
      <aside className="hidden w-[230px] shrink-0 border-r border-zinc-800 bg-[#111113] p-4 md:block">
        <div className="mb-5 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-500/10 text-amber-300">
            <PanelLeft className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[14px] font-semibold text-zinc-100">流程中心</div>
            <div className="text-[11px] text-zinc-500">多集生产工作台</div>
          </div>
        </div>

        <div className="space-y-2">
          {workflowStages.map((stage) => {
            const active = activeStage === stage.key;
            const status = stageStatus[stage.key];
            return (
              <button
                key={stage.key}
                type="button"
                onClick={() => setActiveStage(stage.key)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  active
                    ? "border-amber-500/70 bg-amber-500/10"
                    : "border-transparent bg-transparent hover:border-zinc-800 hover:bg-card"
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                    status === 'done'
                      ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                      : status === 'current'
                        ? "border-amber-500 bg-amber-500/15 text-amber-300"
                        : "border-border text-zinc-500"
                  )}
                >
                  {status === 'done' ? <CheckCircle2 className="h-3.5 w-3.5" /> : stage.num}
                </span>
                <span className="min-w-0">
                  <span className={cn("block text-[13px] font-medium", active ? "text-zinc-50" : "text-zinc-300")}>{stage.title}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-zinc-500">{stage.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 px-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">Production Flow</span>
              <Badge className="border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/10">
                {workflowLoading ? '加载中' : workflowBusy ? '拆解中' : workflowSaving ? '保存中' : sourceName ? '已保存' : '等待导入'}
              </Badge>
            </div>
            <div className="mt-1 truncate text-[15px] font-semibold text-zinc-100">{selectedEpisode} · {activeStageInfo.title}</div>
            {workflowBusy && workflowProgressText ? (
              <div className="mt-1 truncate text-[11px] text-amber-200">{workflowProgressText}</div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="hidden h-8 text-zinc-400 hover:text-zinc-100 sm:inline-flex"
              onClick={() => onAddWorkflowNode('episode', selectedEpisode, '章节原文、资产、分镜和导演板的生产容器')}
            >
              放入章节节点
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-500 hover:text-zinc-100" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-h-0 overflow-y-auto p-4">
            {editingScene ? (
              <StoryboardSceneEditor
                scene={editingScene}
                selectedEpisode={selectedEpisode}
                onBack={() => setEditingSceneId(null)}
                onSave={(scene) => {
                  onUpdateScene(scene);
                  setEditingSceneId(scene.id);
                }}
                onDelete={onDeleteScene}
                onAddSceneNode={onAddSceneNode}
              />
            ) : activeStage === 'source' ? (
              <>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <section className="rounded-lg border border-zinc-800 bg-[#141416]">
                <div className="flex flex-col gap-3 border-b border-zinc-800 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 text-[14px] font-semibold text-zinc-100">
                      <FileText className="h-4 w-4 text-amber-300" />
                      原文导入
                    </div>
                    <p className="mt-1 text-[12px] text-zinc-500">先放入小说、短剧剧本或章节文本，再提取资产；资产图可按需要补充，不再阻止拆分镜。</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" className="h-8 border border-border bg-zinc-900 text-zinc-100 hover:bg-layer-4" onClick={onUploadClick}>
                      <UploadCloud className="h-3.5 w-3.5" />
                      导入文本
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-8 border border-border bg-zinc-900 text-zinc-100 hover:bg-layer-4"
                      onClick={onSaveSource}
                      disabled={!imported || workflowBusy || workflowSaving}
                    >
                      <Save className="h-3.5 w-3.5" />
                      {workflowSaving ? '保存中...' : '保存原文'}
                    </Button>
                    <Button
                      size="sm"
                      className="h-8 bg-amber-500 text-black hover:bg-amber-400"
                      onClick={runBreakdown}
                      disabled={!imported || workflowBusy}
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      {workflowBusy ? '提取中...' : '提取资产'}
                    </Button>
                  </div>
                </div>
                {workflowError && (
                  <div className="mx-4 mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] leading-5 text-red-200">
                    {workflowError}
                  </div>
                )}

                <div className="grid gap-4 p-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                  <div className="space-y-3">
                    <div>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <label className="block text-[12px] font-medium text-zinc-400">当前集</label>
                        <button
                          type="button"
                          className="text-[11px] text-amber-300 hover:text-amber-100 disabled:cursor-not-allowed disabled:text-zinc-600"
                          disabled={episodeCreating || episodeSwitching || workflowBusy}
                          onClick={onCreateNextEpisode}
                        >
                          {episodeCreating ? '新增中...' : '新增下一集'}
                        </button>
                      </div>
                      <select
                        value={activeEpisodeId}
                        onChange={(event) => onSelectEpisode(event.target.value)}
                        disabled={episodeSwitching || workflowBusy}
                        className="h-9 w-full rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 text-[13px] text-zinc-100 outline-none focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {episodeList.episodes.map((episode) => (
                          <option key={episode.id} value={episode.id}>
                            {episode.title || episode.selectedEpisode}
                          </option>
                        ))}
                      </select>
                      <input
                        value={selectedEpisode}
                        onChange={(event) => setSelectedEpisode(event.target.value)}
                        className="mt-2 h-9 w-full rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 text-[13px] text-zinc-100 outline-none focus:border-amber-500"
                      />
                      <p className="mt-1 text-[11px] leading-4 text-zinc-500">
                        {episodeSwitching ? '正在切换剧集工作区...' : `画布：${activeEpisodeSummary?.canvasSceneId || activeEpisodeId}`}
                      </p>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">文件名</label>
                      <input
                        value={sourceName}
                        onChange={(event) => setSourceName(event.target.value)}
                        placeholder="可直接粘贴文本"
                        className="h-9 w-full rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 text-[13px] text-zinc-100 outline-none focus:border-amber-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[12px] font-medium text-zinc-400">分镜推理文本模型</label>
                      <select
                        value={workflowAiModelId}
                        onChange={(event) => setWorkflowAiModelId(event.target.value)}
                        disabled={workflowModelsLoading || workflowBusy || workflowModels.length === 0}
                        className="h-9 w-full rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 text-[13px] text-zinc-100 outline-none focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">{workflowModelsLoading ? '加载模型中...' : '使用后端默认文本模型'}</option>
                        {workflowModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {modelOptionLabel(model)}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-[11px] leading-4 text-zinc-500">
                        这里只用于资产文本提取和 Clip/分镜脚本推理；DeepSeek 不能识图也不影响这个文本流程。
                      </p>
                      {workflowModelError && (
                        <p className="mt-1 text-[11px] leading-4 text-red-300">{workflowModelError}</p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md border border-zinc-800 bg-[#0d0d0f] p-3">
                        <div className="text-[18px] font-semibold text-zinc-100">{sourceStats.chars}</div>
                        <div className="text-[11px] text-zinc-500">字符</div>
                      </div>
                      <div className="rounded-md border border-zinc-800 bg-[#0d0d0f] p-3">
                        <div className="text-[18px] font-semibold text-zinc-100">{sourceStats.estimatedScenes}</div>
                        <div className="text-[11px] text-zinc-500">预估段落</div>
                      </div>
                    </div>
                  </div>

                  <textarea
                    value={sourceText}
                    onChange={(event) => setSourceText(event.target.value)}
                    placeholder="粘贴小说或剧本文本。建议按章节、场景或自然段分隔，后续会先提取角色、场景、道具；资产图可按需要补充，然后拆分分镜脚本。"
                    className="min-h-[280px] resize-none rounded-md border border-zinc-800 bg-background p-3 font-mono text-[12px] leading-5 text-zinc-200 outline-none focus:border-amber-500"
                  />
                </div>
              </section>

              <section className="rounded-lg border border-zinc-800 bg-[#141416] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="text-[14px] font-semibold text-zinc-100">生产流程概览</div>
                  <Badge className="border border-border bg-zinc-900 text-zinc-400 hover:bg-zinc-900">自动执行</Badge>
                </div>
                <div className="space-y-2">
                  {workflowSteps.map((item, index) => (
                    <div
                      key={item.key}
                      className="flex w-full items-center justify-between rounded-md border border-zinc-800 bg-[#0d0d0f] p-3 text-left"
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-[13px] font-medium text-zinc-100">
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-zinc-900 text-[10px] text-zinc-500">{index + 1}</span>
                          {item.title}
                        </span>
                        <span className="mt-1 block text-[11px] leading-4 text-zinc-500">{item.desc}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className="mt-4 rounded-lg border border-zinc-800 bg-[#141416] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-[14px] font-semibold text-zinc-100">拆解结果</div>
                  <p className="mt-1 text-[12px] text-zinc-500">
                    {hasStoryboard
                      ? `已生成 ${clips.length ? `${clips.length} 个 Clip、` : ''}${scenes.length} 条分镜脚本，进入左侧第 03 阶段查看、编辑或删除。`
                      : hasAssets
                        ? `已提取 ${assetTotal} 个资产，资产图状态：${assetImageReadiness.summary}。现在可以进入左侧第 03 阶段拆分镜。`
                        : '先提取资产；提取后即可进入左侧第 03 阶段生成分镜脚本。'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 border border-border bg-zinc-900 text-zinc-100 hover:bg-layer-4"
                    onClick={() => setActiveStage('storyboard')}
                    disabled={!hasStoryboard && !hasAssets}
                  >
                    进入分镜脚本
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-primary hover:bg-primary/10 hover:text-primary"
                    onClick={() => scenes.forEach((scene, index) => onAddSceneNode(scene, index))}
                    disabled={!hasBreakdown}
                  >
                    全部放入画布
                  </Button>
                </div>
              </div>
            </section>
              </>
            ) : (
            <StageWorkPanel
              generationStrategy={generationStrategy}
              storyboardEnabled={storyboardEnabled}
              firstFrameUnavailable={firstFrameUnavailable}
              activeStage={activeStage}
                sourceReady={imported}
                activeEpisodeId={activeEpisodeId}
                scenes={scenes}
                clips={clips}
                assets={assets}
                selectedEpisode={selectedEpisode}
                workflowModels={workflowModels}
                workflowAiModelId={workflowAiModelId}
                setWorkflowAiModelId={setWorkflowAiModelId}
                workflowModelsLoading={workflowModelsLoading}
                workflowModelError={workflowModelError}
                workflowProgressText={workflowProgressText}
                runBreakdown={runBreakdown}
                rerunStoryboard={rerunStoryboard}
                inferBoardsAndVideoToCanvas={inferBoardsAndVideoToCanvas}
                onSyncEpisodeBoardsToCanvas={onSyncEpisodeBoardsToCanvas}
                onFullPipelineInfer={onFullPipelineInfer}
                fullPipelineRunning={fullPipelineRunning}
                setActiveStage={setActiveStage}
                onAddWorkflowNode={onAddWorkflowNode}
                onAddSceneNode={onAddSceneNode}
                onAddClipStoryboardNode={onAddClipStoryboardNode}
                onAddClipStoryboardImageReferenceNode={onAddClipStoryboardImageReferenceNode}
                onAddClipVideoNode={onAddClipVideoNode}
                onAddClipVideoNodes={onAddClipVideoNodes}
                onAddClipPositioningBoardNode={onAddClipPositioningBoardNode}
                onAddClipPositioningBoardNodes={onAddClipPositioningBoardNodes}
                onUpdateClipStoryboard={onUpdateClipStoryboard}
                onDeleteScene={onDeleteScene}
                onEditScene={setEditingSceneId}
                onAcceptClip={onAcceptClip}
                onOptimizeClip={onOptimizeClip}
                onGenerateClipSeedancePrompt={onGenerateClipSeedancePrompt}
                onUploadAssetReference={onUploadAssetReference}
                onUploadAudioReference={onUploadAudioReference}
                onClearAudioReference={onClearAudioReference}
                onBatchUploadCharacterAudioReferences={onBatchUploadCharacterAudioReferences}
                onOpenProjectGlobalSettings={onOpenProjectGlobalSettings}
                onOpenCharacterPropPicker={onOpenCharacterPropPicker}
                onGenerateAssetImage={onGenerateAssetImage}
                onOpenAssetHistory={onOpenAssetHistory}
                onLoadAssetHistoryImages={onLoadAssetHistoryImages}
                onPreviewAssetImage={onPreviewAssetImage}
                onAddAssetToCanvas={onAddAssetToCanvas}
                onClearAssetCurrentImage={onClearAssetCurrentImage}
                onRemoveAsset={onRemoveAsset}
                onUpdateAssetPrompt={onUpdateAssetPrompt}
                buildAssetFinalPrompt={buildAssetFinalPrompt}
                isAssetUploadBusy={isAssetUploadBusy}
                isAssetGenerationBusy={isAssetGenerationBusy}
                optimizingClipId={optimizingClipId}
                generatingSeedanceClipId={generatingSeedanceClipId}
                inferBoardsAndVideoRunning={inferBoardsAndVideoRunning}
                workflowBusy={workflowBusy}
                storyboardImageRefs={storyboardImageRefs}
              />
            )}
          </div>

          <aside className="hidden min-h-0 overflow-y-auto border-l border-zinc-800 bg-[#111113] p-4 lg:block">
            <div className="mb-4">
              <div className="text-[13px] font-semibold text-zinc-100">项目流转状态</div>
              <div className="mt-1 text-[12px] text-zinc-500">按集处理，避免多集上下文互相污染。</div>
            </div>
            <div className="space-y-2">
              {[
                ['当前集', selectedEpisode],
                ['工作区', activeEpisodeSummary?.canvasSceneId || activeEpisodeId],
                ['文本段落', `${sourceStats.paragraphs}`],
                ['Clips', `${clips.length}`],
                ['分镜脚本', `${scenes.length}`],
                ['资产状态', assetTotal > 0 ? `${assetTotal} 个` : workflowBusy ? '提取中' : '未提取'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 py-2">
                  <span className="text-[12px] text-zinc-500">{label}</span>
                  <span className="max-w-[160px] truncate text-[12px] font-medium text-zinc-100">{value}</span>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="text-[12px] font-medium text-amber-200">全局设定</div>
              <p className="mt-2 text-[12px] leading-5 text-amber-100/70">
                本项目的资产、分镜、故事板和视频提示词推理都会读取项目全局设定。
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-3 h-8 w-full bg-amber-500 text-black hover:bg-amber-400"
                onClick={onOpenProjectGlobalSettings}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                编辑全局设定
              </Button>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
