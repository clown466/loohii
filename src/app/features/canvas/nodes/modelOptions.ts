import { useEffect, useState } from 'react';
import { apiClient, type ModelConfig } from '../../../lib/apiClient';
import { isWorkflowImageModel, isWorkflowTextModel, isWorkflowVideoModel } from './shared';

type ModelOptionsState = {
  textModels: ModelConfig[];
  imageModels: ModelConfig[];
  videoModels: ModelConfig[];
  loading: boolean;
  failed: boolean;
};

let cachedTextModels: ModelConfig[] | null = null;
let cachedImageModels: ModelConfig[] | null = null;
let cachedVideoModels: ModelConfig[] | null = null;
let pendingTextModels: Promise<ModelConfig[]> | null = null;
let pendingModelConfigs: Promise<{ textModels: ModelConfig[]; imageModels: ModelConfig[]; videoModels: ModelConfig[] }> | null = null;

function loadModelOptions(): Promise<{ textModels: ModelConfig[]; imageModels: ModelConfig[]; videoModels: ModelConfig[] }> {
  if (cachedTextModels && cachedImageModels && cachedVideoModels) {
    return Promise.resolve({ textModels: cachedTextModels, imageModels: cachedImageModels, videoModels: cachedVideoModels });
  }
  if (!pendingModelConfigs) {
    pendingModelConfigs = apiClient.listModelConfigs()
      .then((result) => {
        cachedTextModels = result.models.filter(isWorkflowTextModel);
        cachedImageModels = result.models.filter(isWorkflowImageModel);
        cachedVideoModels = result.models.filter(isWorkflowVideoModel);
        return { textModels: cachedTextModels, imageModels: cachedImageModels, videoModels: cachedVideoModels };
      })
      .finally(() => {
        pendingModelConfigs = null;
      });
  }
  return pendingModelConfigs;
}

function loadTextModels(): Promise<ModelConfig[]> {
  if (cachedTextModels) return Promise.resolve(cachedTextModels);
  if (!pendingTextModels) {
    pendingTextModels = loadModelOptions()
      .then((result) => result.textModels)
      .finally(() => {
        pendingTextModels = null;
      });
  }
  return pendingTextModels;
}

export function useTextModelOptions(): ModelOptionsState {
  const [state, setState] = useState<ModelOptionsState>({
    textModels: cachedTextModels ?? [],
    imageModels: cachedImageModels ?? [],
    videoModels: cachedVideoModels ?? [],
    loading: cachedTextModels === null,
    failed: false,
  });

  useEffect(() => {
    let cancelled = false;
    loadTextModels()
      .then((textModels) => {
        if (cancelled) return;
        setState({ textModels, imageModels: cachedImageModels ?? [], videoModels: cachedVideoModels ?? [], loading: false, failed: false });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ textModels: cachedTextModels ?? [], imageModels: cachedImageModels ?? [], videoModels: cachedVideoModels ?? [], loading: false, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export function useImageModelOptions(): { imageModels: ModelConfig[]; loading: boolean; failed: boolean } {
  const [state, setState] = useState({
    imageModels: cachedImageModels ?? [],
    loading: cachedImageModels === null,
    failed: false,
  });

  useEffect(() => {
    let cancelled = false;
    loadModelOptions()
      .then((result) => {
        if (!cancelled) setState({ imageModels: result.imageModels, loading: false, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ imageModels: cachedImageModels ?? [], loading: false, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export function useVideoModelOptions(): { videoModels: ModelConfig[]; loading: boolean; failed: boolean } {
  const [state, setState] = useState({
    videoModels: cachedVideoModels ?? [],
    loading: cachedVideoModels === null,
    failed: false,
  });

  useEffect(() => {
    let cancelled = false;
    loadModelOptions()
      .then((result) => {
        if (!cancelled) setState({ videoModels: result.videoModels, loading: false, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ videoModels: cachedVideoModels ?? [], loading: false, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export function availableTextModelId(modelId: unknown, textModels: ModelConfig[], loading: boolean): string | undefined {
  const value = typeof modelId === 'string' ? modelId.trim() : '';
  if (!value) return undefined;
  if (loading) return value;
  return textModels.some((model) => model.id === value) ? value : undefined;
}

export function textModelSelectPlaceholder(textModels: ModelConfig[], loading: boolean, emptyLabel = '默认文本模型') {
  if (loading) return '加载文本模型...';
  return textModels.length ? emptyLabel : '未配置文本模型';
}

export function shouldShowUnavailableTextModel(modelId: unknown, textModels: ModelConfig[], loading: boolean): boolean {
  const value = typeof modelId === 'string' ? modelId.trim() : '';
  return Boolean(value && !loading && !textModels.some((model) => model.id === value));
}
