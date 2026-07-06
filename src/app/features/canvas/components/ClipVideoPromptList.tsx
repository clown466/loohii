import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { Copy, Film, Image as ImageIcon, Wand2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { type ModelConfig } from '../../../lib/apiClient';
import {
  type BreakdownScene,
  type Clip,
  type ClipVideoPromptInferenceResult,
  type EpisodeCanvasSyncRequest,
  type PersistedClipPromptBatch,
  type WorkflowAssets,
  clearPersistedClipPromptBatch,
  collectClipAssetReferences,
  compactList,
  formatClipDuration,
  getClipScenes,
  modelOptionLabel,
  readPersistedClipPromptBatch,
  shouldResumePersistedClipPromptBatch,
  writePersistedClipPromptBatch,
} from '../canvasUtils';

export function ClipVideoPromptList({
  clips,
  scenes,
  assets,
  generationStrategy,
  storyboardEnabled = true,
  firstFrameUnavailable = false,
  activeEpisodeId,
  workflowModels,
  workflowAiModelId,
  setWorkflowAiModelId,
  workflowModelsLoading,
  workflowModelError,
  onAddClipVideoNode,
  onAddClipVideoNodes,
  onAddClipPositioningBoardNode,
  onAddClipPositioningBoardNodes,
  onGenerateClipSeedancePrompt,
  onSyncEpisodeBoardsToCanvas,
  generatingSeedanceClipId,
  workflowBusy,
}: {
  clips: Clip[];
  scenes: BreakdownScene[];
  assets: WorkflowAssets;
  generationStrategy?: string;
  storyboardEnabled?: boolean;
  firstFrameUnavailable?: boolean;
  activeEpisodeId: string;
  workflowModels: ModelConfig[];
  workflowAiModelId: string;
  setWorkflowAiModelId: (value: string) => void;
  workflowModelsLoading: boolean;
  workflowModelError: string | null;
  onAddClipVideoNode: (clip: Clip, prompt: string) => void;
  onAddClipVideoNodes: (clips: Clip[]) => void | Promise<void>;
  onAddClipPositioningBoardNode: (clip: Clip) => void | Promise<unknown>;
  onAddClipPositioningBoardNodes: (clips: Clip[]) => void | Promise<void>;
  onGenerateClipSeedancePrompt: (clipId: string, options?: { skipCanvasSync?: boolean }) => ClipVideoPromptInferenceResult | Promise<ClipVideoPromptInferenceResult>;
  onSyncEpisodeBoardsToCanvas: (override?: EpisodeCanvasSyncRequest) => void | Promise<void>;
  generatingSeedanceClipId: string | null;
  workflowBusy: boolean;
}) {
  const { id: projectId } = useParams();
  const [selectedVideoPromptClipIds, setSelectedVideoPromptClipIds] = useState<string[]>([]);
  const [batchVideoPromptRunning, setBatchVideoPromptRunning] = useState(false);
  const videoPromptResumeAttemptedRef = useRef(false);

  useEffect(() => {
    const clipIds = new Set(clips.map((clip) => clip.id));
    setSelectedVideoPromptClipIds((current) => current.filter((clipId) => clipIds.has(clipId)));
  }, [clips]);

  const selectedVideoPromptClipSet = useMemo(() => new Set(selectedVideoPromptClipIds), [selectedVideoPromptClipIds]);
  const allVideoPromptsSelected = clips.length > 0 && selectedVideoPromptClipIds.length === clips.length;
  const videoPromptBatchBusy = batchVideoPromptRunning || Boolean(generatingSeedanceClipId) || workflowBusy;
  const assetCount = (assets.characters?.length ?? 0) + (assets.scenes?.length ?? 0) + (assets.props?.length ?? 0);
  const missingAssets = assetCount === 0;
  const missingBreakdown = scenes.length === 0 || clips.every((clip) => getClipScenes(clip, scenes).length === 0);
  const generationBlocked = firstFrameUnavailable || missingAssets || missingBreakdown;
  const generationBlockMessage = firstFrameUnavailable
    ? '首帧衔接模式暂未开发。请切换到 Seedance 多参或章节导演板后继续生成。'
    : missingAssets
      ? '当前集还没有资产条目。请先提取角色、场景和道具资产后再生成视频提示词。'
      : missingBreakdown
        ? '当前集还没有可用分镜脚本。请先重新拆解分镜。'
        : '';

  const toggleVideoPromptSelection = (clipId: string) => {
    setSelectedVideoPromptClipIds((current) => (
      current.includes(clipId)
        ? current.filter((id) => id !== clipId)
        : [...current, clipId]
    ));
  };

  const runSelectedVideoPromptInference = async () => {
    const selected = clips.filter((clip) => selectedVideoPromptClipSet.has(clip.id));
    if (selected.length === 0 || videoPromptBatchBusy) return;
    const now = new Date().toISOString();
    const initialBatch: PersistedClipPromptBatch = {
      version: 1,
      kind: 'video-prompt',
      projectId: projectId || 'local',
      episodeId: activeEpisodeId,
      clipIds: selected.map((clip) => clip.id),
      completedClipIds: [],
      failedClipIds: [],
      aiModelId: workflowAiModelId || '',
      createdAt: now,
      updatedAt: now,
    };
    writePersistedClipPromptBatch(initialBatch);
    await runVideoPromptInferenceBatch(initialBatch);
  };

  const addSelectedPositioningBoardsToCanvas = async () => {
    const selected = clips.filter((clip) => selectedVideoPromptClipSet.has(clip.id));
    if (selected.length === 0 || videoPromptBatchBusy || generationBlocked) return;
    await onAddClipPositioningBoardNodes(selected);
  };

  const selectedClipsWithPrompt = useMemo(
    () => clips.filter((clip) => selectedVideoPromptClipSet.has(clip.id) && (clip.seedancePrompt || '').trim()),
    [clips, selectedVideoPromptClipSet],
  );

  const addSelectedVideoNodesToCanvas = async () => {
    if (selectedClipsWithPrompt.length === 0 || videoPromptBatchBusy) return;
    await onAddClipVideoNodes(selectedClipsWithPrompt);
  };

  const runVideoPromptInferenceBatch = async (batch: PersistedClipPromptBatch) => {
    const completed = new Set(batch.completedClipIds);
    const failed = new Set(batch.failedClipIds ?? []);
    const selected = batch.clipIds
      .map((clipId) => clips.find((clip) => clip.id === clipId))
      .filter((clip): clip is Clip => Boolean(clip))
      .filter((clip) => !completed.has(clip.id) && !failed.has(clip.id));
    if (selected.length === 0 || videoPromptBatchBusy) {
      if (selected.length === 0) clearPersistedClipPromptBatch('video-prompt', batch.projectId, batch.episodeId || activeEpisodeId);
      return;
    }
    setSelectedVideoPromptClipIds(batch.clipIds.filter((clipId) => clips.some((clip) => clip.id === clipId)));
    setBatchVideoPromptRunning(true);
    let latestClips = clips;
    let latestScenes = scenes;
    let latestAssets = assets;
    let latestEpisode: string | undefined;
    try {
      for (const clip of selected) {
        writePersistedClipPromptBatch({
          ...batch,
          completedClipIds: Array.from(completed),
          failedClipIds: Array.from(failed),
          currentClipId: clip.id,
        });
        try {
          const result = await onGenerateClipSeedancePrompt(clip.id, { skipCanvasSync: true });
          if (!result.ok) throw new Error('视频提示词生成失败');
          if (result.clips) latestClips = result.clips;
          if (result.scenes) latestScenes = result.scenes;
          if (result.assets) latestAssets = result.assets;
          if (result.episode) latestEpisode = result.episode;
          completed.add(clip.id);
        } catch {
          failed.add(clip.id);
        }
        writePersistedClipPromptBatch({
          ...batch,
          completedClipIds: Array.from(completed),
          failedClipIds: Array.from(failed),
          currentClipId: undefined,
        });
      }
    } finally {
      setBatchVideoPromptRunning(false);
      clearPersistedClipPromptBatch('video-prompt', projectId, activeEpisodeId);
      if (completed.size > 0) {
        void onSyncEpisodeBoardsToCanvas({
          clips: latestClips,
          scenes: latestScenes,
          assets: latestAssets,
          episode: latestEpisode,
          refreshRecords: true,
        });
      }
    }
  };

  useEffect(() => {
    videoPromptResumeAttemptedRef.current = false;
  }, [projectId, activeEpisodeId]);

  useEffect(() => {
    if (videoPromptResumeAttemptedRef.current || clips.length === 0 || batchVideoPromptRunning || generatingSeedanceClipId || workflowBusy) return;
    const persisted = readPersistedClipPromptBatch('video-prompt', projectId, activeEpisodeId);
    if (!persisted) {
      videoPromptResumeAttemptedRef.current = true;
      return;
    }
    videoPromptResumeAttemptedRef.current = true;
    if (!shouldResumePersistedClipPromptBatch(persisted, workflowAiModelId, clips.map((clip) => clip.id))) {
      clearPersistedClipPromptBatch('video-prompt', projectId, activeEpisodeId);
      return;
    }
    setSelectedVideoPromptClipIds(persisted.clipIds.filter((clipId) => clips.some((clip) => clip.id === clipId)));
    void runVideoPromptInferenceBatch(persisted);
  }, [activeEpisodeId, batchVideoPromptRunning, clips, generatingSeedanceClipId, projectId, workflowAiModelId, workflowBusy]);

  if (clips.length === 0) {
    return (
      <div className="flex min-h-[220px] flex-col items-center justify-center p-6 text-center">
        <Film className="mb-3 h-6 w-6 text-zinc-700" />
        <div className="text-[13px] font-medium text-zinc-300">还没有 Clip 视频任务</div>
        <div className="mt-1 text-[12px] text-zinc-600">先完成分镜拆解，再在这里生成 Seedance 视频提示词。</div>
      </div>
    );
  }

  return (
    <div className="divide-y divide-zinc-800">
      <div className="flex flex-col gap-3 px-4 py-3 text-[11px] text-zinc-500 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="font-medium text-zinc-300">视频提示词文本模型</div>
          <div className="mt-1">
            {storyboardEnabled
              ? '章节导演板模式会结合故事板坑位、资产图和分镜脚本推理视频提示词。'
              : `Seedance 多参模式会直接结合资产图、分镜脚本和状态连续性推理视频提示词。${generationStrategy ? ` 当前策略：${generationStrategy}` : ''}`}
          </div>
          {generationBlockMessage ? (
            <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] leading-5 text-amber-100">
              {generationBlockMessage}
            </div>
          ) : null}
        </div>
        <div className="flex w-full flex-col gap-2 xl:w-auto xl:items-end">
          <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
            <button
              type="button"
              className="h-8 rounded-md border border-zinc-800 px-2 text-[11px] text-zinc-400 transition-colors hover:border-border hover:text-zinc-100"
              onClick={() => setSelectedVideoPromptClipIds(allVideoPromptsSelected ? [] : clips.map((clip) => clip.id))}
            >
              {allVideoPromptsSelected ? '清空选择' : '全选 Clip'}
            </button>
            <Button
              type="button"
              size="sm"
              className="h-8 bg-sky-500 text-[11px] text-black hover:bg-sky-400"
              disabled={selectedVideoPromptClipIds.length === 0 || videoPromptBatchBusy || generationBlocked}
              onClick={() => void runSelectedVideoPromptInference()}
            >
              <Wand2 className="h-3.5 w-3.5" />
              {batchVideoPromptRunning ? `批量推理中 ${selectedVideoPromptClipIds.length}` : `批量重新推理 ${selectedVideoPromptClipIds.length || ''}`}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8 border border-border bg-zinc-900 text-[11px] text-zinc-100 hover:bg-layer-4"
              disabled={selectedVideoPromptClipIds.length === 0 || videoPromptBatchBusy || generationBlocked}
              onClick={() => void addSelectedPositioningBoardsToCanvas()}
            >
              <ImageIcon className="h-3.5 w-3.5" />
              批量放入故事板/定位板 {selectedVideoPromptClipIds.length || ''}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-8 border border-border bg-zinc-900 text-[11px] text-zinc-100 hover:bg-layer-4"
              disabled={selectedClipsWithPrompt.length === 0 || videoPromptBatchBusy}
              onClick={() => void addSelectedVideoNodesToCanvas()}
              title={selectedVideoPromptClipIds.length > 0 && selectedClipsWithPrompt.length === 0 ? '所选 Clip 还没有视频提示词，请先推理' : undefined}
            >
              <Film className="h-3.5 w-3.5" />
              批量放入视频任务 {selectedClipsWithPrompt.length || ''}
            </Button>
          </div>
          <div className="w-full sm:w-[320px]">
            <select
              value={workflowAiModelId}
              onChange={(event) => setWorkflowAiModelId(event.target.value)}
              disabled={workflowModelsLoading || videoPromptBatchBusy || workflowModels.length === 0}
              className="h-8 w-full rounded-md border border-border bg-zinc-950 px-2 text-[12px] text-zinc-100 outline-none focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">{workflowModelsLoading ? '加载模型中...' : '使用后端默认文本模型'}</option>
              {workflowModels.map((model) => (
                <option key={model.id} value={model.id}>{modelOptionLabel(model)}</option>
              ))}
            </select>
            {workflowModelError ? <div className="mt-1 text-[10px] text-red-300">{workflowModelError}</div> : null}
          </div>
        </div>
      </div>
      {clips.map((clip, index) => {
        const clipScenes = getClipScenes(clip, scenes);
        const prompt = clip.seedancePrompt || '';
        const references = collectClipAssetReferences(clip, clipScenes, assets);
        const generating = generatingSeedanceClipId === clip.id;
        return (
          <div key={clip.id} className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_220px]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedVideoPromptClipSet.has(clip.id)}
                  onChange={() => toggleVideoPromptSelection(clip.id)}
                  className="h-3.5 w-3.5 accent-sky-500"
                />
                <span className="font-mono text-[11px] text-zinc-500">C{String(index + 1).padStart(2, '0')}</span>
                <span className="text-[13px] font-semibold text-zinc-100">{clip.title}</span>
                <Badge className="border border-border bg-zinc-900 text-[10px] text-zinc-400 hover:bg-zinc-900">
                  {formatClipDuration(clip)}
                </Badge>
                <Badge className="border border-sky-500/20 bg-sky-500/10 text-[10px] text-sky-200 hover:bg-sky-500/10">
                  {references.length} 参考图
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                <span className="rounded border border-zinc-800 bg-[#0d0d0f] px-2 py-1">场景：{clip.setting || '未指定'}</span>
                <span className="rounded border border-zinc-800 bg-[#0d0d0f] px-2 py-1">角色：{compactList(clip.characters, '未指定', 8)}</span>
                <span className="rounded border border-zinc-800 bg-[#0d0d0f] px-2 py-1">分镜：{clipScenes.length}/{clip.shotIds?.length ?? 0}</span>
              </div>
              <div className="mt-3 max-h-[260px] overflow-y-auto rounded-md border border-zinc-800 bg-background px-3 py-2 font-mono text-[12px] leading-5 text-zinc-300 whitespace-pre-wrap">
                {prompt || '未生成。点击右侧“生成视频提示词”。'}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                size="sm"
                className="h-8 bg-amber-500 text-black hover:bg-amber-400"
                disabled={videoPromptBatchBusy || generationBlocked}
                onClick={() => void onGenerateClipSeedancePrompt(clip.id)}
              >
                <Wand2 className="h-3.5 w-3.5" />
                {generating ? '推理中...' : prompt ? '润色提示词' : '推理视频提示词'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 border border-border bg-zinc-900 text-zinc-100 hover:bg-layer-4"
                disabled={generationBlocked}
                onClick={() => onAddClipPositioningBoardNode(clip)}
              >
                <ImageIcon className="h-3.5 w-3.5" />
                放入故事板/定位板流程
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 border border-border bg-zinc-900 text-zinc-100 hover:bg-layer-4"
                disabled={!prompt}
                onClick={() => onAddClipVideoNode(clip, prompt)}
              >
                <Film className="h-3.5 w-3.5" />
                放入画布视频任务
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 border border-border bg-zinc-900 text-zinc-100 hover:bg-layer-4"
                disabled={!prompt}
                onClick={() => void navigator.clipboard?.writeText(prompt).catch(() => undefined)}
              >
                <Copy className="h-3.5 w-3.5" />
                复制
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
