import React from 'react';
import {
  Boxes,
  CheckCircle2,
  Clapperboard,
  Download,
  FileText,
  Film,
  Image as ImageIcon,
  ListChecks,
  Mic,
  Package,
  RotateCcw,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { CanvasNodeKind } from '../../../stores/useCanvasStore';
import {
  type Clip,
  type StageWorkPanelProps,
  type WorkflowStageKey,
  assetArray,
  assetGroups,
  modelOptionLabel,
  workflowAssetImageReadiness,
} from '../canvasUtils';
import { StoryboardSceneList } from './StoryboardSceneList';
import { ClipStoryboardList } from './ClipStoryboardList';
import { ClipVideoPromptList } from './ClipVideoPromptList';
import { AssetMiniList } from './AssetMiniList';

export function StageWorkPanel({
  generationStrategy,
  storyboardEnabled = true,
  firstFrameUnavailable = false,
  activeStage,
  sourceReady,
  activeEpisodeId,
  scenes,
  clips,
  assets,
  selectedEpisode,
  workflowModels,
  workflowAiModelId,
  setWorkflowAiModelId,
  finalizeClipStoryboardPrompt,
  workflowModelsLoading,
  workflowModelError,
  workflowProgressText,
  runBreakdown,
  rerunStoryboard,
  inferBoardsAndVideoToCanvas,
  onSyncEpisodeBoardsToCanvas,
  onFullPipelineInfer,
  fullPipelineRunning,
  setActiveStage,
  onAddWorkflowNode,
  onAddSceneNode,
  onAddClipStoryboardNode,
  onAddClipStoryboardImageReferenceNode,
  onAddClipVideoNode,
  onAddClipPositioningBoardNode,
  onAddClipPositioningBoardNodes,
  onUpdateClipStoryboard,
  onDeleteScene,
  onEditScene,
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
  workflowBusy,
  storyboardImageRefs,
}: StageWorkPanelProps) {
  const assetImageReadiness = workflowAssetImageReadiness(assets);
  const hasAssets = assetImageReadiness.total > 0;
  const missingAssetPreview = assetImageReadiness.missing.slice(0, 6).map((item) => item.name).join('、');
  const generationUnavailableNotice = firstFrameUnavailable ? (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] leading-5 text-amber-100">
      首帧衔接模式暂未开发。请切换到 Seedance 多参或章节导演板后继续生成。
    </div>
  ) : null;

  if (activeStage === 'assets') {
    return (
      <div className="space-y-4">
        {generationUnavailableNotice}
        <section className="rounded-lg border border-zinc-800 bg-[#141416] p-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[14px] font-semibold text-zinc-100">
                <Boxes className="h-4 w-4 text-emerald-300" />
                场景角色道具
              </div>
              <p className="mt-1 text-[12px] text-zinc-500">先从当前集文本提取角色、场景、道具。资产图可按需要生成或上传，不再作为分镜硬门槛。</p>
            </div>
            <Button
              size="sm"
              className="h-8 bg-emerald-500 text-black hover:bg-emerald-400"
              disabled={!sourceReady || workflowBusy || firstFrameUnavailable}
              onClick={runBreakdown}
            >
              <Wand2 className="h-3.5 w-3.5" />
              {workflowBusy ? '提取中...' : '提取资产'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 border border-border bg-zinc-900 text-zinc-100 hover:bg-layer-4"
              disabled={workflowBusy}
              onClick={() => void onLoadAssetHistoryImages('all')}
            >
              <ImageIcon className="h-3.5 w-3.5" />
              一键加载历史图
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 border border-border bg-zinc-900 text-zinc-100 hover:bg-layer-4"
              disabled={workflowBusy || assetArray(assets, 'characters').length === 0}
              onClick={onBatchUploadCharacterAudioReferences}
              title="一次选择 1-5 音频：1 Bob，2 Chloe，3 Leo，4 Tiffany，5 Eugene"
            >
              <Mic className="h-3.5 w-3.5" />
              批量上传角色音频
            </Button>
          </div>
          {workflowBusy && workflowProgressText ? (
            <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-100">
              {workflowProgressText}
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-3">
            {assetGroups.map((item) => {
              const Icon = item.icon;
              const items = assetArray(assets, item.key);
              return (
                <div
                  key={item.title}
                  className="rounded-lg border border-zinc-800 bg-[#0d0d0f] p-4 text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-200">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="text-[13px] font-semibold text-zinc-100">{item.title}</div>
                      <div className="mt-1 text-[12px] leading-5 text-zinc-500">{item.desc}</div>
                    </div>
                    <Badge className="border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/10">
                      {items.length}
                    </Badge>
                  </div>
                  <AssetMiniList
                    assetKind={item.key}
                    items={items}
                    emptyText="还没有提取结果。运行 AI 智能拆解后会在这里显示。"
                    onUploadReference={(asset) => onUploadAssetReference(item.key, asset)}
                    onUploadAudioReference={item.key === 'characters' ? onUploadAudioReference : undefined}
                    onClearAudioReference={item.key === 'characters' ? onClearAudioReference : undefined}
                    onOpenCharacterPropPicker={item.key === 'characters' ? onOpenCharacterPropPicker : undefined}
                    onGenerateImage={(asset) => onGenerateAssetImage(item.key, asset)}
                    onOpenHistory={(asset, variantFilter) => onOpenAssetHistory(item.key, asset, variantFilter)}
                    onPreviewImage={onPreviewAssetImage}
                    onAddToCanvas={onAddAssetToCanvas}
                    onClearCurrentImage={(asset) => void onClearAssetCurrentImage(item.key, asset)}
                    onRemoveAsset={onRemoveAsset}
                    onUpdateAssetPrompt={onUpdateAssetPrompt}
                    buildAssetFinalPrompt={buildAssetFinalPrompt}
                    isUploadBusy={(asset) => isAssetUploadBusy(item.key, asset)}
                    isGenerationBusy={(asset) => isAssetGenerationBusy(item.key, asset)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-3 mr-2 h-7 text-[11px] text-sky-300 hover:bg-sky-500/10 hover:text-sky-100"
                    disabled={workflowBusy || items.length === 0}
                    onClick={() => void onLoadAssetHistoryImages(item.key)}
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    加载历史图
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-3 h-7 text-[11px] text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-100"
                    onClick={() => onAddWorkflowNode('asset', item.title, `${item.desc} · 已提取 ${items.length} 个`)}
                  >
                    放入画布
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  if (activeStage === 'storyboard') {
    return (
      <div className="space-y-4">
        {generationUnavailableNotice}
        <section className="rounded-lg border border-zinc-800 bg-[#141416]">
          <div className="flex flex-col gap-3 border-b border-zinc-800 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[14px] font-semibold text-zinc-100">
                <ListChecks className="h-4 w-4 text-amber-300" />
                {clips.length > 0 ? 'Clip-First 分镜脚本' : '分镜脚本'}
              </div>
              <p className="mt-1 text-[12px] text-zinc-500">
                {clips.length > 0 ? '按 Clip 控制剧情目标、时长、风险和包含分镜。' : '把当前集拆成镜头、对白、动作、时长和导演板输入。'}
              </p>
              <p className={assetImageReadiness.ready ? "mt-1 text-[11px] text-emerald-300" : "mt-1 text-[11px] text-amber-300"}>
                资产图状态：{assetImageReadiness.summary}{hasAssets ? (assetImageReadiness.ready ? '，可以拆分镜。' : missingAssetPreview ? `。可继续拆分镜；缺图资产会仅按文字设定参与推理：${missingAssetPreview}${assetImageReadiness.missing.length > 6 ? ' 等' : ''}` : '。可继续拆分镜。') : '。请先提取资产。'}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[240px]">
                <label className="mb-1 block text-[11px] text-zinc-500">分镜脚本文本模型</label>
                <select
                  value={workflowAiModelId}
                  onChange={(event) => setWorkflowAiModelId(event.target.value)}
                  disabled={workflowModelsLoading || workflowBusy || workflowModels.length === 0}
                  className="h-8 w-full rounded-md border border-border bg-zinc-950 px-2 text-[12px] text-zinc-100 outline-none focus:border-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">{workflowModelsLoading ? '加载模型中...' : '使用后端默认文本模型'}</option>
                  {workflowModels.map((model) => (
                    <option key={model.id} value={model.id}>{modelOptionLabel(model)}</option>
                  ))}
                </select>
                {workflowModelError ? <div className="mt-1 text-[10px] text-red-300">{workflowModelError}</div> : null}
              </div>
              <Button variant="secondary" size="sm" className="h-8 border border-border bg-zinc-900 text-zinc-100 hover:bg-layer-4" onClick={() => setActiveStage('source')}>
                返回原文
              </Button>
              <Button size="sm" className="h-8 bg-amber-500 text-black hover:bg-amber-400" disabled={!sourceReady || workflowBusy || firstFrameUnavailable || !hasAssets} onClick={rerunStoryboard}>
                <Wand2 className="h-3.5 w-3.5" />
                {workflowBusy ? '拆解中...' : '重新拆解分镜'}
              </Button>
            </div>
          </div>
          {workflowBusy && workflowProgressText ? (
            <div className="border-b border-zinc-800 bg-amber-500/10 px-4 py-2 text-[12px] leading-5 text-amber-100">
              {workflowProgressText}
            </div>
          ) : null}
          {clips.length > 0 ? (
            <ClipStoryboardList
              clips={clips}
              scenes={scenes}
              assets={assets}
              activeEpisodeId={activeEpisodeId}
              storyboardImageRefs={storyboardImageRefs}
              workflowAiModelId={workflowAiModelId}
              finalizeClipStoryboardPrompt={finalizeClipStoryboardPrompt}
              onAddSceneNode={onAddSceneNode}
              onAddClipStoryboardNode={onAddClipStoryboardNode}
              onAddClipStoryboardImageReferenceNode={onAddClipStoryboardImageReferenceNode}
              onUpdateClipStoryboard={onUpdateClipStoryboard}
              onSyncEpisodeBoardsToCanvas={onSyncEpisodeBoardsToCanvas}
              onEditScene={onEditScene}
              onDeleteScene={onDeleteScene}
              onAcceptClip={onAcceptClip}
              onOptimizeClip={onOptimizeClip}
              optimizingClipId={optimizingClipId}
              workflowBusy={workflowBusy}
              generationStrategy={generationStrategy}
              storyboardEnabled={storyboardEnabled}
            />
          ) : (
            <StoryboardSceneList
              scenes={scenes}
              onAddSceneNode={onAddSceneNode}
              onEditScene={onEditScene}
              onDeleteScene={onDeleteScene}
              emptyTitle="还没有分镜脚本"
              emptyDescription="先导入小说/剧本，提取资产并生成/上传资产图，再拆解分镜。"
            />
          )}
        </section>
      </div>
    );
  }

  if (activeStage === 'video') {
    return (
      <div className="space-y-4">
        {generationUnavailableNotice}
        <section className="rounded-lg border border-zinc-800 bg-[#141416]">
          <div className="flex flex-col gap-3 border-b border-zinc-800 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[14px] font-semibold text-zinc-100">
                <Film className="h-4 w-4 text-sky-300" />
                分镜视频提示词
              </div>
              <p className="mt-1 text-[12px] text-zinc-500">
                {storyboardEnabled
                  ? '按 Clip 生成 Seedance 视频提示词；放入画布时接入故事板坑位、角色、场景和音频参考。'
                  : '按 Clip 生成 Seedance 多参视频提示词；放入画布时直接接入角色、场景、道具资产和音频参考，不使用故事板图。'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" className="h-8 border border-border bg-zinc-900 text-zinc-100 hover:bg-layer-4" onClick={() => setActiveStage('storyboard')}>
                返回分镜
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-8 bg-sky-500 text-black hover:bg-sky-400"
                disabled={clips.length === 0 || workflowBusy || inferBoardsAndVideoRunning || fullPipelineRunning || firstFrameUnavailable}
                onClick={() => void onFullPipelineInfer?.()}
              >
                <Clapperboard className="h-3.5 w-3.5" />
                {fullPipelineRunning || inferBoardsAndVideoRunning ? '生成中...' : '生成视频提示词并同步画布'}
              </Button>
            </div>
          </div>
          <ClipVideoPromptList
            clips={clips}
            scenes={scenes}
            assets={assets}
            activeEpisodeId={activeEpisodeId}
            workflowModels={workflowModels}
            workflowAiModelId={workflowAiModelId}
            setWorkflowAiModelId={setWorkflowAiModelId}
            workflowModelsLoading={workflowModelsLoading}
            workflowModelError={workflowModelError}
            onAddClipVideoNode={onAddClipVideoNode}
            onAddClipPositioningBoardNode={onAddClipPositioningBoardNode}
            onAddClipPositioningBoardNodes={onAddClipPositioningBoardNodes}
            onGenerateClipSeedancePrompt={onGenerateClipSeedancePrompt}
            onSyncEpisodeBoardsToCanvas={onSyncEpisodeBoardsToCanvas}
            generatingSeedanceClipId={generatingSeedanceClipId}
            workflowBusy={workflowBusy}
            generationStrategy={generationStrategy}
            storyboardEnabled={storyboardEnabled}
            firstFrameUnavailable={firstFrameUnavailable}
          />
        </section>
      </div>
    );
  }

  const stageCards: Record<Exclude<WorkflowStageKey, 'source' | 'assets' | 'storyboard' | 'video'>, Array<{ title: string; desc: string; icon: React.ElementType; nodeType: CanvasNodeKind }>> = {
    voice: [
      { title: '台词整理', desc: '从分镜脚本提取对白、旁白和字幕', icon: FileText, nodeType: 'workflow' },
      { title: '配音任务', desc: '按角色音色生成配音音频', icon: Sparkles, nodeType: 'workflow' },
      { title: '口型与字幕', desc: '把音频、字幕和视频片段对齐', icon: Film, nodeType: 'workflow' },
    ],
    preview: [
      { title: '镜头缺失检查', desc: '检查视频、音频、字幕和参考图是否缺失', icon: CheckCircle2, nodeType: 'workflow' },
      { title: '快速拼接', desc: '临时拼接片段用于预览节奏', icon: Film, nodeType: 'workflow' },
      { title: '问题回修', desc: '定位需要重绘、重配音或重生成的视频', icon: RotateCcw, nodeType: 'workflow' },
    ],
    edit: [
      { title: '剪辑时间线', desc: '把视频、音频、字幕推入剪辑区', icon: Film, nodeType: 'workflow' },
      { title: '导出检查', desc: '检查画幅、音量、字幕和片尾', icon: Download, nodeType: 'workflow' },
      { title: '发布资产包', desc: '整理导出记录和复用素材', icon: Package, nodeType: 'asset' },
    ],
  };

  const titleMap: Record<Exclude<WorkflowStageKey, 'source' | 'assets' | 'storyboard' | 'video'>, string> = {
    voice: '配音对口型',
    preview: '视频预览',
    edit: '后期剪辑',
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-zinc-800 bg-[#141416] p-4">
        <div className="mb-4">
          <div className="text-[14px] font-semibold text-zinc-100">{titleMap[activeStage]}</div>
          <p className="mt-1 text-[12px] text-zinc-500">这里是当前阶段的操作区。真实生产 API 接入后，任务进度和结果会在这里显示。</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {stageCards[activeStage].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.title}
                type="button"
                onClick={() => onAddWorkflowNode(item.nodeType, item.title, item.desc)}
                className="rounded-lg border border-zinc-800 bg-[#0d0d0f] p-4 text-left transition-colors hover:border-amber-500/50"
              >
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-amber-500/10 text-amber-200">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="text-[13px] font-semibold text-zinc-100">{item.title}</div>
                <div className="mt-1 text-[12px] leading-5 text-zinc-500">{item.desc}</div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
