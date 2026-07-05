import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  ImagePlay,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { Image as ImageIcon } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { cn } from '../../../utils/cn';
import { StoryboardSceneList } from './StoryboardSceneList';
import { apiClient } from '../../../lib/apiClient';
import {
  type BreakdownScene,
  type Clip,
  type ClipPanelCountChoice,
  type ClipStoryboardImageReference,
  type ClipStoryboardInferenceResult,
  type ClipStoryboardPlan,
  type EpisodeCanvasSyncRequest,
  type FinalizeClipStoryboardPrompt,
  type PersistedClipPromptBatch,
  type WorkflowAssets,
  CLIP_STORYBOARD_PANEL_CHOICES,
  buildClipDirectorBoardPrompt,
  clearPersistedClipPromptBatch,
  collectClipAssetReferences,
  compactList,
  enforceClipStoryboardContinuityPrompt,
  formatClipDialogue,
  formatClipDuration,
  getClipEstimatedDuration,
  getClipPreflightStatus,
  getClipRiskItems,
  getClipScenes,
  inferContinuityCharactersForClip,
  isClipPreflightRisky,
  previewCanvasImage,
  readPersistedClipPromptBatch,
  shouldResumePersistedClipPromptBatch,
  storyboardReferenceMatchesClip,
  suggestClipStoryboardPanelCount,
  writePersistedClipPromptBatch,
} from '../canvasUtils';
import { PromptTextarea } from '../nodes/shared';

export function ClipStoryboardList({
  clips,
  scenes,
  assets,
  generationStrategy,
  storyboardEnabled = true,
  activeEpisodeId,
  storyboardImageRefs,
  workflowAiModelId,
  finalizeClipStoryboardPrompt,
  onAddSceneNode,
  onAddClipStoryboardNode,
  onAddClipStoryboardImageReferenceNode,
  onUpdateClipStoryboard,
  onSyncEpisodeBoardsToCanvas,
  onEditScene,
  onDeleteScene,
  onAcceptClip,
  onOptimizeClip,
  optimizingClipId,
  workflowBusy,
}: {
  clips: Clip[];
  scenes: BreakdownScene[];
  assets: WorkflowAssets;
  generationStrategy?: string;
  storyboardEnabled?: boolean;
  activeEpisodeId: string;
  storyboardImageRefs: ClipStoryboardImageReference[];
  workflowAiModelId: string;
  finalizeClipStoryboardPrompt: FinalizeClipStoryboardPrompt;
  onAddSceneNode: (scene: BreakdownScene, index: number) => void;
  onAddClipStoryboardNode: (clip: Clip, prompt: string) => void | Promise<void>;
  onAddClipStoryboardImageReferenceNode: (clip: Clip, reference: ClipStoryboardImageReference) => void;
  onUpdateClipStoryboard: (clipId: string, patch: { prompt?: string; panelCount?: number; notes?: string }) => void;
  onSyncEpisodeBoardsToCanvas: (override?: EpisodeCanvasSyncRequest) => void | Promise<void>;
  onEditScene: (sceneId: string) => void;
  onDeleteScene: (sceneId: string) => void;
  onAcceptClip: (clipId: string) => void;
  onOptimizeClip: (clipId: string) => void;
  optimizingClipId: string | null;
  workflowBusy: boolean;
}) {
  const { id: projectId } = useParams();
  const [selectedClipId, setSelectedClipId] = useState<string | null>(clips[0]?.id ?? null);
  const [clipPanelChoices, setClipPanelChoices] = useState<Record<string, ClipPanelCountChoice>>({});
  const [clipStoryboardDrafts, setClipStoryboardDrafts] = useState<Record<string, string>>({});
  const [clipStoryboardPlans, setClipStoryboardPlans] = useState<Record<string, ClipStoryboardPlan>>({});
  const [clipStoryboardLoadingId, setClipStoryboardLoadingId] = useState<string | null>(null);
  const [batchStoryboardRunning, setBatchStoryboardRunning] = useState(false);
  const [selectedStoryboardClipIds, setSelectedStoryboardClipIds] = useState<string[]>([]);
  const [clipStoryboardErrors, setClipStoryboardErrors] = useState<Record<string, string>>({});
  const storyboardResumeAttemptedRef = useRef(false);

  useEffect(() => {
    if (clips.length === 0) {
      setSelectedClipId(null);
      return;
    }
    setSelectedClipId((current) => (current && clips.some((clip) => clip.id === current) ? current : null));
  }, [clips]);

  useEffect(() => {
    const clipIds = new Set(clips.map((clip) => clip.id));
    setClipPanelChoices((current) => Object.fromEntries(Object.entries(current).filter(([clipId]) => clipIds.has(clipId))));
    setClipStoryboardDrafts((current) => {
      const next: Record<string, string> = {};
      for (const clip of clips) {
        const prompt = String(clip.storyboardPrompt || '');
        next[clip.id] = prompt || current[clip.id] || '';
      }
      return next;
    });
    setClipStoryboardPlans((current) => Object.fromEntries(Object.entries(current).filter(([clipId]) => clipIds.has(clipId))));
    setClipStoryboardErrors((current) => Object.fromEntries(Object.entries(current).filter(([clipId]) => clipIds.has(clipId))));
    setSelectedStoryboardClipIds((current) => current.filter((clipId) => clipIds.has(clipId)));
  }, [clips]);

  const generateClipStoryboardPrompt = async (
    clip: Clip,
    clipScenes: BreakdownScene[],
    panelChoice: ClipPanelCountChoice,
    options: { keepLoading?: boolean; skipCanvasSync?: boolean } = {},
  ): Promise<ClipStoryboardInferenceResult> => {
    if (!options.keepLoading) setClipStoryboardLoadingId(clip.id);
    setClipStoryboardErrors((current) => ({ ...current, [clip.id]: '' }));
    try {
      if (!projectId || projectId === 'local') {
        const prompt = buildClipDirectorBoardPrompt(clip, clipScenes, panelChoice, scenes, assets);
        const finalPrompt = finalizeClipStoryboardPrompt(clip, prompt).prompt;
        setClipStoryboardDrafts((current) => ({ ...current, [clip.id]: finalPrompt }));
        onUpdateClipStoryboard(clip.id, {
          prompt: finalPrompt,
          panelCount: panelChoice === 'ai' ? suggestClipStoryboardPanelCount(clip, clipScenes) : panelChoice,
          notes: projectId === 'local' ? '本地项目使用离线提示词模板。' : '',
        });
        setClipStoryboardPlans((current) => ({
          ...current,
          [clip.id]: {
            panelCount: panelChoice === 'ai' ? suggestClipStoryboardPanelCount(clip, clipScenes) : panelChoice,
            notes: projectId === 'local' ? '本地项目使用离线提示词模板。' : '',
          },
        }));
        const nextClip = {
          ...clip,
          storyboardPrompt: finalPrompt,
          storyboardPanelCount: panelChoice === 'ai' ? suggestClipStoryboardPanelCount(clip, clipScenes) : panelChoice,
          storyboardNotes: projectId === 'local' ? '本地项目使用离线提示词模板。' : '',
          seedancePrompt: '',
        };
        if (!options.skipCanvasSync) {
          void onSyncEpisodeBoardsToCanvas({
            clips: clips.map((item) => (item.id === clip.id ? nextClip : item)),
            scenes,
            assets,
          });
        }
        return { ok: true, clip: nextClip };
      }

      const result = await apiClient.planProjectWorkflowClipStoryboard(projectId, clip.id, {
        episodeId: activeEpisodeId,
        aiModelId: workflowAiModelId || undefined,
        panelMode: panelChoice === 'ai' ? 'ai' : 'manual',
        panelCount: panelChoice === 'ai' ? undefined : panelChoice,
      });
      const serverClip = result.clip && result.clip.id === clip.id ? result.clip : undefined;
      const workflowClips = result.workflow?.clips ?? clips;
      const workflowAssets = result.workflow?.assets ?? assets;
      const finalPrompt = finalizeClipStoryboardPrompt(
        { ...clip, ...serverClip, storyboardPrompt: result.prompt, seedancePrompt: '' },
        result.prompt,
        workflowClips,
        workflowAssets,
      ).prompt;
      setClipStoryboardDrafts((current) => ({ ...current, [clip.id]: finalPrompt }));
      onUpdateClipStoryboard(clip.id, {
        prompt: finalPrompt,
        panelCount: result.panelCount,
        notes: result.notes || '',
      });
      setClipStoryboardPlans((current) => ({
        ...current,
        [clip.id]: {
          panelCount: result.panelCount,
          notes: result.notes,
        },
      }));
      const nextClip = {
        ...clip,
        ...serverClip,
        storyboardPrompt: finalPrompt,
        storyboardPanelCount: result.panelCount,
        storyboardNotes: result.notes || '',
        seedancePrompt: '',
      };
      const nextWorkflowClips = workflowClips.map((item) => (item.id === clip.id ? nextClip : item));
      await persistStoryboardPromptToBackend(nextWorkflowClips, workflowAssets, (result.workflow?.breakdownScenes as BreakdownScene[] | undefined) ?? scenes);
      if (!options.skipCanvasSync) {
        void onSyncEpisodeBoardsToCanvas({
          clips: nextWorkflowClips,
          scenes: (result.workflow?.breakdownScenes as BreakdownScene[] | undefined) ?? scenes,
          assets: workflowAssets,
        });
      }
      return { ok: true, clip: nextClip };
    } catch (error) {
      setClipStoryboardErrors((current) => ({
        ...current,
        [clip.id]: error instanceof Error ? error.message : 'Clip 故事板推理失败',
      }));
      return { ok: false };
    } finally {
      if (!options.keepLoading) setClipStoryboardLoadingId(null);
    }
  };

  const selectedStoryboardClipSet = useMemo(() => new Set(selectedStoryboardClipIds), [selectedStoryboardClipIds]);
  const allStoryboardSelected = clips.length > 0 && selectedStoryboardClipIds.length === clips.length;
  const storyboardBatchBusy = batchStoryboardRunning || Boolean(clipStoryboardLoadingId);

  const persistStoryboardPromptToBackend = async (nextClips: Clip[], nextAssets: WorkflowAssets = assets, nextScenes: BreakdownScene[] = scenes) => {
    if (!projectId || projectId === 'local') return;
    try {
      await apiClient.saveProjectWorkflow(projectId, {
        episodeId: activeEpisodeId,
        breakdownScenes: nextScenes,
        clips: nextClips,
        assets: nextAssets,
      }, { episodeId: activeEpisodeId });
    } catch {
      // The local draft still updates immediately; autosave can retry later.
    }
  };

  const toggleStoryboardClipSelection = (clipId: string) => {
    setSelectedStoryboardClipIds((current) => (
      current.includes(clipId)
        ? current.filter((id) => id !== clipId)
        : [...current, clipId]
    ));
  };

  const runSelectedStoryboardInference = async () => {
    const selected = clips.filter((clip) => selectedStoryboardClipSet.has(clip.id));
    if (selected.length === 0 || storyboardBatchBusy) return;
    const now = new Date().toISOString();
    const initialBatch: PersistedClipPromptBatch = {
      version: 1,
      kind: 'storyboard',
      projectId: projectId || 'local',
      episodeId: activeEpisodeId,
      clipIds: selected.map((clip) => clip.id),
      completedClipIds: [],
      failedClipIds: [],
      panelChoices: Object.fromEntries(selected.map((clip) => [clip.id, clipPanelChoices[clip.id] ?? 'ai'])),
      aiModelId: workflowAiModelId || '',
      createdAt: now,
      updatedAt: now,
    };
    writePersistedClipPromptBatch(initialBatch);
    await runStoryboardInferenceBatch(initialBatch);
  };

  const runStoryboardInferenceBatch = async (batch: PersistedClipPromptBatch) => {
    const completed = new Set(batch.completedClipIds);
    const failed = new Set(batch.failedClipIds ?? []);
    const selected = batch.clipIds
      .map((clipId) => clips.find((clip) => clip.id === clipId))
      .filter((clip): clip is Clip => Boolean(clip))
      .filter((clip) => !completed.has(clip.id) && !failed.has(clip.id));
    if (selected.length === 0 || storyboardBatchBusy) {
      if (selected.length === 0) clearPersistedClipPromptBatch('storyboard', projectId, activeEpisodeId);
      return;
    }
    setSelectedStoryboardClipIds(batch.clipIds.filter((clipId) => clips.some((clip) => clip.id === clipId)));
    setBatchStoryboardRunning(true);
    let latestClips = clips;
    try {
      for (const clip of selected) {
        const clipScenes = getClipScenes(clip, scenes);
        const panelChoice = batch.panelChoices?.[clip.id] ?? clipPanelChoices[clip.id] ?? 'ai';
        setClipStoryboardLoadingId(clip.id);
        writePersistedClipPromptBatch({
          ...batch,
          completedClipIds: Array.from(completed),
          failedClipIds: Array.from(failed),
          currentClipId: clip.id,
        });
        const result = await generateClipStoryboardPrompt(clip, clipScenes, panelChoice, { keepLoading: true, skipCanvasSync: true });
        if (result.ok) {
          completed.add(clip.id);
          if (result.clip) {
            latestClips = latestClips.map((item) => (item.id === result.clip?.id ? result.clip : item));
          }
        } else {
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
      setClipStoryboardLoadingId(null);
      setBatchStoryboardRunning(false);
      clearPersistedClipPromptBatch('storyboard', projectId, activeEpisodeId);
      if (completed.size > 0) void onSyncEpisodeBoardsToCanvas({ clips: latestClips, scenes, assets });
    }
  };

  useEffect(() => {
    storyboardResumeAttemptedRef.current = false;
  }, [projectId, activeEpisodeId]);

  useEffect(() => {
    if (storyboardResumeAttemptedRef.current || clips.length === 0 || batchStoryboardRunning || clipStoryboardLoadingId) return;
    const persisted = readPersistedClipPromptBatch('storyboard', projectId, activeEpisodeId);
    if (!persisted) {
      storyboardResumeAttemptedRef.current = true;
      return;
    }
    storyboardResumeAttemptedRef.current = true;
    if (!shouldResumePersistedClipPromptBatch(persisted, workflowAiModelId, clips.map((clip) => clip.id))) {
      clearPersistedClipPromptBatch('storyboard', projectId, activeEpisodeId);
      return;
    }
    setClipPanelChoices((current) => ({ ...current, ...(persisted.panelChoices ?? {}) }));
    setSelectedStoryboardClipIds(persisted.clipIds.filter((clipId) => clips.some((clip) => clip.id === clipId)));
    void runStoryboardInferenceBatch(persisted);
  }, [activeEpisodeId, batchStoryboardRunning, clipStoryboardLoadingId, clips, projectId, workflowAiModelId]);

  return (
    <div className="divide-y divide-zinc-800">
      <div className="flex flex-col gap-3 px-4 py-3 text-[11px] text-zinc-500 xl:flex-row xl:items-center xl:justify-between">
        <div className="grid flex-1 gap-2 sm:grid-cols-4">
          <span>Clips {clips.length}</span>
          <span>分镜 {scenes.length}</span>
          <span>预计 {clips.reduce((sum, clip) => sum + Number(clip.estimatedDuration ?? 0), 0)}s</span>
          {storyboardEnabled ? <span>已选 {selectedStoryboardClipIds.length}</span> : <span>{generationStrategy || '当前策略'} 不使用故事板图</span>}
        </div>
        {storyboardEnabled ? <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="h-7 rounded-md border border-zinc-800 px-2 text-[11px] text-zinc-400 transition-colors hover:border-border hover:text-zinc-100"
            onClick={() => setSelectedStoryboardClipIds(allStoryboardSelected ? [] : clips.map((clip) => clip.id))}
          >
            {allStoryboardSelected ? '清空选择' : '全选 Clip'}
          </button>
          <button
            type="button"
            className="h-7 rounded-md border border-zinc-800 px-2 text-[11px] text-zinc-400 transition-colors hover:border-border hover:text-zinc-100"
            onClick={() => setSelectedClipId((current) => (current ? null : clips[0]?.id ?? null))}
          >
            {selectedClipId ? '收起详情' : '展开第一个'}
          </button>
          <Button
            type="button"
            size="sm"
            className="h-7 bg-amber-500 text-[11px] text-black hover:bg-amber-400"
            disabled={selectedStoryboardClipIds.length === 0 || storyboardBatchBusy}
            onClick={() => void runSelectedStoryboardInference()}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {batchStoryboardRunning ? `批量推理中 ${selectedStoryboardClipIds.length}` : `批量重新推理 ${selectedStoryboardClipIds.length || ''}`}
          </Button>
        </div> : null}
      </div>

      {clips.map((clip, index) => {
        const active = selectedClipId === clip.id;
        const clipScenes = getClipScenes(clip, scenes);
        const continuityCharacters = inferContinuityCharactersForClip(clip, clipScenes, scenes, assets);
        const clipStoryboardPromptSource = clip.storyboardPrompt || clipStoryboardDrafts[clip.id] || '';
        const storyboardAssetReferences = collectClipAssetReferences(clip, clipScenes, assets, 100, clipStoryboardPromptSource, { includeProps: false, allScenes: scenes });
        const risks = getClipRiskItems(clip);
        const preflightRisky = isClipPreflightRisky(clip);
        const shotCount = clip.shotIds?.length ?? 0;
        const missingShotCount = Math.max(0, shotCount - clipScenes.length);
        const optimizing = optimizingClipId === clip.id;
        const panelChoice = clipPanelChoices[clip.id] ?? 'ai';
        const suggestedPanelCount = suggestClipStoryboardPanelCount(clip, clipScenes);
        const clipStoryboardDraft = enforceClipStoryboardContinuityPrompt(clipStoryboardPromptSource, clip, clipScenes, scenes, assets);
        const clipStoryboardPlan = clipStoryboardPlans[clip.id] ?? {
          panelCount: clip.storyboardPanelCount,
          notes: clip.storyboardNotes,
        };
        const clipStoryboardError = clipStoryboardErrors[clip.id] ?? '';
        const clipStoryboardLoading = clipStoryboardLoadingId === clip.id;
        const clipStoryboardImages = storyboardImageRefs.filter((ref) => storyboardReferenceMatchesClip(ref, clip));
        const shortClipWarning =
          getClipEstimatedDuration(clip, clipScenes) < 6
            ? '该 Clip 时长短于 6 秒，自动模式仍会至少生成 5 格；如果要按 15 秒节奏推进，建议先合并相邻 Clip。'
            : '';

        return (
          <div key={clip.id} className={cn("bg-[#141416]", active && "bg-card")}>
            {storyboardEnabled ? <div className="flex items-center gap-2 border-b border-zinc-900/70 px-4 py-2 text-[11px] text-zinc-500">
              <input
                type="checkbox"
                checked={selectedStoryboardClipSet.has(clip.id)}
                onChange={() => toggleStoryboardClipSelection(clip.id)}
                className="h-3.5 w-3.5 accent-amber-500"
              />
              <span>选择此 Clip 故事板提示词</span>
              {clipStoryboardLoading && (
                <span className="ml-auto text-amber-200">推理中...</span>
              )}
            </div> : null}
            <button
              type="button"
              onClick={() => setSelectedClipId((current) => (current === clip.id ? null : clip.id))}
              className="grid w-full gap-3 p-4 text-left transition-colors hover:bg-card xl:grid-cols-[112px_minmax(0,1.5fr)_150px_150px_minmax(0,1fr)_170px]"
            >
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.16em] text-zinc-600">Clip 编号</div>
                <div className="mt-1 truncate font-mono text-[13px] font-semibold text-zinc-100">
                  C{String(index + 1).padStart(2, '0')}
                </div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-zinc-600">{clip.id}</div>
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13px] font-semibold text-zinc-100">{clip.title}</span>
                  {clip.panelCount !== undefined && (
                    <Badge className="border border-border bg-zinc-900 text-[10px] text-zinc-400 hover:bg-zinc-900">
                      {clip.panelCount} panels
                    </Badge>
                  )}
                </div>
                <div className="mt-1 line-clamp-2 text-[12px] leading-5 text-zinc-400">
                  {clip.plotGoal || '未写入剧情目标'}
                </div>
              </div>

              <div className="min-w-0">
                <div className="text-[11px] text-zinc-600">预计时长</div>
                <div className="mt-1 text-[12px] leading-5 text-zinc-300">{formatClipDuration(clip)}</div>
              </div>

              <div className="min-w-0">
                <div className="text-[11px] text-zinc-600">台词词数/密度</div>
                <div className="mt-1 text-[12px] leading-5 text-zinc-300">{formatClipDialogue(clip)}</div>
              </div>

              <div className="min-w-0">
                <div className="text-[11px] text-zinc-600">场景 / 角色</div>
                <div className="mt-1 truncate text-[12px] text-zinc-300">
                  {[clip.setting, clip.sceneType].filter(Boolean).join(' · ') || '未指定'}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-zinc-500">{compactList(continuityCharacters.length ? continuityCharacters : clip.characters)}</div>
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap gap-1.5">
                  <Badge className="border border-primary/20 bg-primary/10 text-[10px] text-primary hover:bg-primary/10">
                    {clip.storyboardControlLevel || '控制未定'}
                  </Badge>
                  <Badge className="border border-amber-500/20 bg-amber-500/10 text-[10px] text-amber-200 hover:bg-amber-500/10">
                    {clip.storyboardType || '类型未定'}
                  </Badge>
                  <Badge className="border border-emerald-500/20 bg-emerald-500/10 text-[10px] text-emerald-200 hover:bg-emerald-500/10">
                    {storyboardAssetReferences.length} 角色/场景参考
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge
                    className={cn(
                      "border text-[10px]",
                      preflightRisky
                        ? "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/10"
                        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/10"
                    )}
                  >
                    {getClipPreflightStatus(clip)}
                  </Badge>
                  <span className="truncate text-[11px] text-zinc-500">
                    {risks.length ? `${risks[0]}${risks.length > 1 ? ` +${risks.length - 1}` : ''}` : '无风险提示'}
                  </span>
                </div>
              </div>
            </button>

            {active && (
              <div className="border-t border-zinc-800 bg-[#111113] p-4">
                <div className="mb-4 flex flex-col gap-3 rounded-md border border-zinc-800 bg-[#0d0d0f] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-semibold text-zinc-100">Clip 预检</span>
                      <Badge
                        className={cn(
                          "border text-[10px]",
                          preflightRisky
                            ? "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/10"
                            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/10"
                        )}
                      >
                        {getClipPreflightStatus(clip)}
                      </Badge>
                    </div>
                    <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-500">
                      {risks.length ? risks.join('；') : '当前没有风险提示。'}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 border border-border bg-zinc-900 text-zinc-100 hover:bg-layer-4"
                      onClick={() => onAcceptClip(clip.id)}
                      disabled={workflowBusy || optimizing}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      接受当前
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className={cn(
                        "h-8 text-black",
                        preflightRisky
                          ? "bg-red-400 hover:bg-red-300"
                          : "bg-amber-500 hover:bg-amber-400"
                      )}
                      onClick={() => onOptimizeClip(clip.id)}
                      disabled={workflowBusy || optimizing}
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      {optimizing ? '优化中...' : 'AI优化此 Clip'}
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="rounded-md border border-zinc-800 bg-[#0d0d0f] p-3">
                    <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-zinc-300">
                      <ArrowRight className="h-3.5 w-3.5 text-emerald-300" />
                      开始状态
                    </div>
                    <div className="text-[12px] leading-5 text-zinc-500">{clip.startState || '未指定'}</div>
                  </div>
                  <div className="rounded-md border border-zinc-800 bg-[#0d0d0f] p-3">
                    <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-zinc-300">
                      <CheckCircle2 className="h-3.5 w-3.5 text-amber-300" />
                      结束状态
                    </div>
                    <div className="text-[12px] leading-5 text-zinc-500">{clip.endState || '未指定'}</div>
                  </div>
                  <div className="rounded-md border border-zinc-800 bg-[#0d0d0f] p-3">
                    <div className="mb-2 text-[12px] font-medium text-zinc-300">Layout Memory</div>
                    <div className="whitespace-pre-wrap text-[12px] leading-5 text-zinc-500">{clip.layoutMemory || '未生成'}</div>
                  </div>
                  <div className="rounded-md border border-zinc-800 bg-[#0d0d0f] p-3">
                    <div className="mb-2 text-[12px] font-medium text-zinc-300">Seedance Prompt</div>
                    <div className="max-h-[220px] overflow-y-auto rounded border border-zinc-900 bg-background px-3 py-2 whitespace-pre-wrap text-[12px] leading-5 text-zinc-500">
                      {clip.seedancePrompt || '未生成'}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                  <span className="rounded border border-zinc-800 bg-[#0d0d0f] px-2 py-1">
                    shotIds：{shotCount ? (clip.shotIds ?? []).join(', ') : '无'}
                  </span>
                  {clip.emotionArc && (
                    <span className="rounded border border-zinc-800 bg-[#0d0d0f] px-2 py-1">情绪弧：{clip.emotionArc}</span>
                  )}
                  {clip.directorFreedom && (
                    <span className="rounded border border-zinc-800 bg-[#0d0d0f] px-2 py-1">导演自由度：{clip.directorFreedom}</span>
                  )}
                </div>

                {storyboardEnabled ? <div className="mt-4 rounded-lg border border-zinc-800 bg-[#141416]">
                  <div className="flex flex-col gap-2 border-b border-zinc-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-[13px] font-semibold text-zinc-100">已生成故事板图片</div>
                      <div className="mt-1 text-[11px] leading-4 text-zinc-500">
                        这里收纳当前 Clip 已生成的故事板图，可直接作为参考图放回画布。
                      </div>
                    </div>
                    <Badge className="w-fit border border-amber-500/25 bg-amber-500/10 text-[10px] text-amber-200 hover:bg-amber-500/10">
                      {clipStoryboardImages.length} 张
                    </Badge>
                  </div>
                  {clipStoryboardImages.length ? (
                    <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                      {clipStoryboardImages.map((reference) => (
                        <div key={`${reference.url}:${reference.nodeId || reference.assetId || ''}`} className="overflow-hidden rounded-md border border-zinc-800 bg-[#0d0d0f]">
                          <button
                            type="button"
                            className="block w-full bg-black"
                            onClick={(event) => previewCanvasImage(event, {
                              url: reference.url,
                              title: reference.title || `${clip.title || 'Clip'} 故事板`,
                              subtitle: '已生成故事板',
                            })}
                          >
                            <img
                              src={reference.url}
                              alt={reference.title || `${clip.title || 'Clip'} 故事板`}
                              className="aspect-video w-full object-cover"
                              loading="lazy"
                              decoding="async"
                            />
                          </button>
                          <div className="space-y-2 p-2">
                            <div className="line-clamp-1 text-[11px] text-zinc-300">{reference.title || `${clip.title || 'Clip'} 故事板`}</div>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="h-7 w-full border border-border bg-zinc-900 text-[11px] text-zinc-100 hover:bg-layer-4"
                              onClick={() => onAddClipStoryboardImageReferenceNode(clip, reference)}
                            >
                              <ImageIcon className="h-3.5 w-3.5" />
                              放入画布
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 text-[12px] leading-5 text-zinc-500">
                      暂无已生成故事板图。先点击下方“放入画布生图”，在画布节点生成完成后会自动出现在这里。
                    </div>
                  )}
                </div> : null}

                {storyboardEnabled ? <div className="mt-4 rounded-lg border border-zinc-800 bg-[#141416]">
                  <div className="flex flex-col gap-3 border-b border-zinc-800 px-4 py-3 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-zinc-100">Clip 故事板提示词</div>
                      <div className="mt-1 text-[11px] leading-4 text-zinc-500">
                        按整个 Clip 调用文本模型先推理格数和故事板提示词；生成图片请放入画布生图节点。
                      </div>
                      {shortClipWarning && (
                        <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[11px] leading-4 text-amber-200">
                          {shortClipWarning}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 bg-amber-500 text-black hover:bg-amber-400"
                        disabled={clipStoryboardLoading}
                        onClick={() => void generateClipStoryboardPrompt(clip, clipScenes, panelChoice)}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {clipStoryboardLoading ? '推理中...' : 'AI推理提示词'}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-8 border border-border bg-zinc-900 text-zinc-100 hover:bg-layer-4"
                        disabled={!clipStoryboardDraft}
                        onClick={() => void onAddClipStoryboardNode(clip, clipStoryboardDraft)}
                      >
                        <ImagePlay className="h-3.5 w-3.5" />
                        放入画布生图
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-8 border border-border bg-zinc-900 text-zinc-100 hover:bg-layer-4"
                        disabled={!clipStoryboardDraft}
                        onClick={() => void navigator.clipboard?.writeText(clipStoryboardDraft).catch(() => undefined)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        复制
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-zinc-500">宫格</span>
                      <button
                        type="button"
                        onClick={() => setClipPanelChoices((current) => ({ ...current, [clip.id]: 'ai' }))}
                        className={cn(
                          "h-8 rounded-md border px-3 text-[12px] transition-colors",
                          panelChoice === 'ai'
                            ? "border-amber-500 bg-amber-500/10 text-amber-200"
                            : "border-zinc-800 bg-[#0d0d0f] text-zinc-400 hover:border-border"
                        )}
                      >
                        AI推理
                      </button>
                      {CLIP_STORYBOARD_PANEL_CHOICES.map((count) => (
                        <button
                          key={count}
                          type="button"
                          onClick={() => setClipPanelChoices((current) => ({ ...current, [clip.id]: count }))}
                          className={cn(
                            "h-8 rounded-md border px-3 text-[12px] transition-colors",
                            panelChoice === count
                              ? "border-amber-500 bg-amber-500/10 text-amber-200"
                              : "border-zinc-800 bg-[#0d0d0f] text-zinc-400 hover:border-border"
                          )}
                        >
                          {count}格
                        </button>
                      ))}
                      <span className="text-[11px] text-zinc-500">
                        {clipStoryboardPlan?.panelCount
                          ? `AI结果：${clipStoryboardPlan.panelCount}格`
                          : `系统估算：${suggestedPanelCount}格`}
                      </span>
                    </div>
                    {clipStoryboardPlan?.notes && (
                      <div className="rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 py-2 text-[11px] leading-4 text-zinc-500">
                        {clipStoryboardPlan.notes}
                      </div>
                    )}
                    {clipStoryboardError && (
                      <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] leading-4 text-red-200">
                        {clipStoryboardError}
                      </div>
                    )}
                    <PromptTextarea
                      className="min-h-[220px] w-full resize-y rounded-md border border-zinc-800 bg-[#0d0d0f] px-3 py-2 font-mono text-[12px] leading-5 text-zinc-100 outline-none focus:border-amber-500"
                      value={clipStoryboardDraft}
                      onChange={(nextPrompt) => {
                        setClipStoryboardDrafts((current) => ({
                          ...current,
                          [clip.id]: nextPrompt,
                        }));
                        onUpdateClipStoryboard(clip.id, {
                          prompt: nextPrompt,
                          panelCount: clipStoryboardPlan?.panelCount,
                          notes: clipStoryboardPlan?.notes || '',
                        });
                      }}
                      modalTitle={`${clip.title || clip.id || 'Clip'} · 故事板提示词`}
                      modalSubtitle="完整故事板提示词"
                      placeholder="点击生成提示词。这里会基于整个 Clip 的多个分镜生成故事板提示词，可继续手动修改。"
                    />
                  </div>
                </div> : (
                  <div className="mt-4 rounded-lg border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-[12px] leading-5 text-sky-100">
                    当前为 Seedance 多参流程。视频提示词会直接读取资产图、分镜脚本和状态连续性，不生成 Clip 故事板图。
                  </div>
                )}

                <div className="mt-4 rounded-lg border border-zinc-800 bg-[#141416]">
                  <div className="flex flex-col gap-2 border-b border-zinc-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-[13px] font-semibold text-zinc-100">Clip 内镜头列表</div>
                    <div className="flex flex-wrap gap-2 text-[11px] text-zinc-500">
                      <span>{clipScenes.length}/{shotCount} 已匹配</span>
                      {missingShotCount > 0 && <span className="text-amber-300">缺 {missingShotCount}</span>}
                    </div>
                  </div>
                  {clipScenes.length > 0 ? (
                    <StoryboardSceneList
                      scenes={clipScenes}
                      onAddSceneNode={onAddSceneNode}
                      onEditScene={onEditScene}
                      onDeleteScene={onDeleteScene}
                      emptyTitle="该 Clip 暂无分镜"
                      emptyDescription="shotIds 还没有匹配到当前分镜列表。"
                    />
                  ) : (
                    <div className="p-4 text-[12px] text-zinc-500">
                      {shotCount ? 'shotIds 还没有匹配到当前分镜列表。' : '该 Clip 暂无 shotIds。'}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
