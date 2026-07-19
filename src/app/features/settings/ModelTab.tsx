import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, ChevronDown, MonitorPlay, Sparkles, Image as ImageIcon, KeyRound, Loader2, Pencil, X, Eye, EyeOff, Check, Cpu } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { cn } from "../../components/ui/utils";
import { apiClient, type ModelConfig, type ModelProviderConfig } from "../../lib/apiClient";
import { findRemovedModelConfigIds, type PersistedModelEntry } from "./modelFormPersistence";

type ModelModalMode = "provider" | "model" | null;

type ProviderFormState = {
  displayName: string;
  providerType: string;
  baseUrl: string;
};

type ModelFormEntry = {
  id: string;
  configId?: string;
  model: string;
  displayName: string;
  expanded: boolean;
};

type ModelModalityId = "text" | "image" | "video" | "audio";

type ModelFormState = {
  providerConfigId: string;
  modelEntriesByModality: Record<ModelModalityId, ModelFormEntry[]>;
  modelDraftByModality: Record<ModelModalityId, string>;
  apiKey: string;
  savedApiKey: string;
  modalities: ModelModalityId[];
  costCredits: string;
};

type ModelConfigGroup = {
  id: string;
  providerConfigId?: string;
  provider: string;
  apiKey?: string;
  apiKeyMasked?: string;
  hasApiKey?: boolean;
  costCredits: number;
  models: ModelConfig[];
};

const emptyProviderForm: ProviderFormState = {
  displayName: "",
  providerType: "openai-compatible",
  baseUrl: "",
};

const jimengProviderForm: ProviderFormState = {
  displayName: "Jimeng/Dreamina API",
  providerType: "jimeng-api",
  baseUrl: "http://127.0.0.1:5100",
};

const dreaminaWebProviderForm: ProviderFormState = {
  displayName: "Dreamina Web Browser",
  providerType: "dreamina-web",
  baseUrl: "",
};

const dreaminaWebImageModelEntries = () => [
  createModelFormEntry("dreamina-web-image-5-lite", "Dreamina Web Image 5.0 Lite", true),
  createModelFormEntry("dreamina-web-image-5", "Dreamina Web Image 5.0", true),
  createModelFormEntry("dreamina-web-seedream", "Dreamina Web Seedream", true),
];

const dreaminaWebVideoModelEntries = () => [
  createModelFormEntry("dreamina-web-seedance-2.0", "Dreamina Web Seedance 2.0", true),
];

const providerFormFor = (provider: ModelProviderConfig): ProviderFormState => ({
  displayName: provider.displayName,
  providerType: provider.providerType,
  baseUrl: provider.baseUrl ?? "",
});

const modelModalityOptions = [
  { id: "text", label: "文本", description: "对话、脚本、推理、结构化输出" },
  { id: "image", label: "图片", description: "文生图、图生图、参考图编辑" },
  { id: "video", label: "视频", description: "文生视频、图生视频、多参考视频" },
  { id: "audio", label: "音频", description: "配音、转写、音频生成" },
] as const;

const emptyModelEntriesByModality = (): Record<ModelModalityId, ModelFormEntry[]> => ({
  text: [],
  image: [],
  video: [],
  audio: [],
});

const emptyModelDraftByModality = (): Record<ModelModalityId, string> => ({
  text: "",
  image: "",
  video: "",
  audio: "",
});

const emptyModelForm: ModelFormState = {
  providerConfigId: "",
  modelEntriesByModality: emptyModelEntriesByModality(),
  modelDraftByModality: emptyModelDraftByModality(),
  apiKey: "",
  savedApiKey: "",
  modalities: ["text"],
  costCredits: "0",
};

const legacyModalityMap: Record<string, { modality: ModelModalityId; capability: string }> = {
  chat: { modality: "text", capability: "chat" },
  "text-to-image": { modality: "image", capability: "text-to-image" },
  "image-to-image": { modality: "image", capability: "image-to-image" },
  "text-to-video": { modality: "video", capability: "text-to-video" },
  "image-to-video": { modality: "video", capability: "image-to-video" },
};

function normalizeModelKind(modality: string, capabilities: string[] = []) {
  const normalized = modality.trim().toLowerCase();
  const legacy = legacyModalityMap[normalized];
  if (legacy) return legacy.modality;
  if (modelModalityOptions.some((option) => option.id === normalized)) return normalized;
  if (`${normalized} ${capabilities.join(" ")}`.includes("video")) return "video";
  if (`${normalized} ${capabilities.join(" ")}`.includes("audio")) return "audio";
  if (`${normalized} ${capabilities.join(" ")}`.includes("image")) return "image";
  return "text";
}

function normalizeModelKindStrict(modality: string): ModelModalityId {
  const normalized = modality.trim().toLowerCase();
  const legacy = legacyModalityMap[normalized];
  if (legacy) return legacy.modality;
  const matched = modelModalityOptions.find((option) => option.id === normalized);
  return matched?.id ?? "text";
}

function inferredCapabilitiesForModality(modality: string): string[] {
  if (modality === "image") return ["text-to-image", "image-to-image", "multi-reference-image", "image-edit"];
  if (modality === "video") return ["text-to-video", "image-to-video", "multi-reference-video", "first-last-frame-video", "audio-reference-video"];
  if (modality === "audio") return ["text-to-speech", "speech-to-text", "voice-clone", "music-generation"];
  return ["chat", "text-generation", "structured-output"];
}

function defaultParamsForModel(
  provider: Pick<ModelProviderConfig, "providerType" | "displayName" | "baseUrl">,
  modality: ModelModalityId,
  modelName: string,
): Record<string, unknown> {
  if (isJimengApiProviderConfig(provider) && modality === "video") return { functionMode: "omni_reference" };
  if (isDreaminaWebProviderConfig(provider) && modality === "image") {
    const normalized = modelName.toLowerCase();
    const dreaminaModelLabel = normalized.includes("image-5-lite") || normalized.includes("lite")
      ? "Image 5.0 Lite"
      : normalized.includes("image-5")
        ? "Image 5.0"
        : "Image 5.0 Lite";
    return { n: 4, dreaminaModelLabel };
  }
  if (isDreaminaWebProviderConfig(provider) && modality === "video") {
    return { provider: "dreamina-web", modelVersion: "seedance2.0fast" };
  }
  return {};
}

function labelForModality(value: string) {
  return modelModalityOptions.find((option) => option.id === value)?.label ?? value;
}

function displayModelGroupApiKey(group: ModelConfigGroup) {
  if (group.apiKeyMasked) return maskApiKeyForDisplay(group.apiKeyMasked);
  return group.hasApiKey ? "********" : "未设置";
}

function maskApiKeyForDisplay(value: string) {
  return value.replace(/•/g, "*");
}

type ModelApiKeyOwner = Pick<ModelConfig, "hasApiKey" | "apiKeyMasked"> | Pick<ModelConfigGroup, "hasApiKey" | "apiKeyMasked"> | null;

function apiKeyOwnerInitialMask(owner?: ModelApiKeyOwner) {
  if (!owner?.hasApiKey) return "";
  if (owner.apiKeyMasked) return maskApiKeyForDisplay(owner.apiKeyMasked);
  return "********";
}

function modelFormInitialApiKey(model?: ModelConfig | null) {
  return apiKeyOwnerInitialMask(model ?? null);
}

function modelFormSavedApiKey(model?: ModelConfig | null) {
  return model?.apiKey ?? "";
}

function groupFormInitialApiKey(group?: ModelConfigGroup | null) {
  return apiKeyOwnerInitialMask(group ?? null);
}

function groupFormSavedApiKey(group?: ModelConfigGroup | null) {
  return group?.apiKey ?? "";
}

function currentModelApiKeyOwner(model: ModelConfig | null, group: ModelConfigGroup | null): ModelApiKeyOwner {
  return group ?? model;
}

function isMaskedModelApiKeyInput(value: string, owner: ModelApiKeyOwner) {
  if (!owner?.hasApiKey) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  const expectedMask = apiKeyOwnerInitialMask(owner);
  const rawMask = owner.apiKeyMasked ? maskApiKeyForDisplay(owner.apiKeyMasked) : "";
  return trimmed === expectedMask || trimmed === rawMask || /^[A-Za-z0-9_-]{0,8}[*•]{4,}[A-Za-z0-9_-]{0,8}$/.test(trimmed);
}

function shouldSubmitModelApiKeyInput(value: string, owner: ModelApiKeyOwner, savedApiKey: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (savedApiKey && trimmed === savedApiKey) return false;
  return !isMaskedModelApiKeyInput(trimmed, owner);
}

function sanitizeModelApiKeyInput(value: string) {
  return value.trim().replace(/^Bearer\s+/i, "");
}

function visibleModelApiKeyValue(form: ModelFormState, owner: ModelApiKeyOwner, showApiKey: boolean) {
  if (showApiKey && form.savedApiKey && isMaskedModelApiKeyInput(form.apiKey, owner)) {
    return form.savedApiKey;
  }
  return form.apiKey;
}

function parseModelNameInput(value: string): string[] {
  return value
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function createModelFormEntry(model: string, displayName = model, expanded = true, configId?: string): ModelFormEntry {
  return {
    id: configId ?? `${model.toLowerCase()}-${Math.random().toString(36).slice(2)}`,
    configId,
    model,
    displayName,
    expanded,
  };
}

function uniqueModelEntries(entries: ModelFormEntry[]) {
  const seen = new Set<string>();
  const result: ModelFormEntry[] = [];
  for (const entry of entries) {
    const model = entry.model.trim();
    if (!model) continue;
    const key = model.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...entry, model, displayName: entry.displayName.trim() });
  }
  return result;
}

function entriesForModality(form: ModelFormState, modality: ModelModalityId): ModelFormEntry[] {
  return uniqueModelEntries([
    ...form.modelEntriesByModality[modality],
    ...parseModelNameInput(form.modelDraftByModality[modality]).map((name) => createModelFormEntry(name, name, false)),
  ]);
}

function allModelEntriesByModality(form: ModelFormState): Array<{ modality: ModelModalityId; entries: ModelFormEntry[] }> {
  return form.modalities.map((modality) => ({ modality, entries: entriesForModality(form, modality) }));
}

function persistedEntriesForModelGroup(group: ModelConfigGroup | null): PersistedModelEntry[] {
  return (group?.models ?? []).map((model) => ({
    configId: model.id,
    model: model.model,
    modality: normalizeModelKindStrict(model.modality),
  }));
}

function persistedEntriesForModelForm(form: ModelFormState): PersistedModelEntry[] {
  return allModelEntriesByModality(form).flatMap(({ modality, entries }) =>
    entries.map((entry) => ({
      configId: entry.configId,
      model: entry.model,
      modality,
    })),
  );
}

function modelFormEntryKey(modality: ModelModalityId, entryId: string) {
  return `${modality}:${entryId}`;
}

function modelGroupKey(model: ModelConfig) {
  return [
    model.providerConfigId ?? model.provider,
    model.apiKeyMasked ?? (model.hasApiKey ? "has-key" : "no-key"),
  ].join("::");
}

function isJimengApiProviderConfig(provider?: Pick<ModelProviderConfig, "providerType" | "displayName" | "baseUrl"> | null): boolean {
  if (!provider) return false;
  const searchable = `${provider.providerType} ${provider.displayName} ${provider.baseUrl ?? ""}`.toLowerCase();
  return searchable.includes("jimeng-api") || searchable.includes("dreamina-api") || searchable.includes("jimeng");
}

function isJimengApiProviderValue(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes("jimeng-api") || normalized.includes("dreamina-api") || normalized.includes("jimeng");
}

function isDreaminaWebProviderConfig(provider?: Pick<ModelProviderConfig, "providerType" | "displayName" | "baseUrl"> | null): boolean {
  if (!provider) return false;
  const searchable = `${provider.providerType} ${provider.displayName} ${provider.baseUrl ?? ""}`.toLowerCase();
  return searchable.includes("dreamina-web") || searchable.includes("dreamina browser");
}

function isDreaminaWebProviderValue(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes("dreamina-web") || normalized.includes("dreamina browser");
}

function buildModelGroups(models: ModelConfig[]): ModelConfigGroup[] {
  const groups = new Map<string, ModelConfigGroup>();
  for (const model of models) {
    const id = modelGroupKey(model);
    const current = groups.get(id);
    if (current) {
      current.models.push(model);
      if (!current.apiKey && model.apiKey) current.apiKey = model.apiKey;
      if (!current.apiKeyMasked && model.apiKeyMasked) current.apiKeyMasked = model.apiKeyMasked;
      current.hasApiKey ||= Boolean(model.hasApiKey);
      current.costCredits = Math.max(current.costCredits, model.costCredits ?? 0);
      continue;
    }
    groups.set(id, {
      id,
      providerConfigId: model.providerConfigId,
      provider: model.provider,
      apiKey: model.apiKey,
      apiKeyMasked: model.apiKeyMasked,
      hasApiKey: model.hasApiKey,
      costCredits: model.costCredits ?? 0,
      models: [model],
    });
  }
  return Array.from(groups.values()).sort((left, right) => {
    const leftProvider = left.providerConfigId ?? left.provider;
    const rightProvider = right.providerConfigId ?? right.provider;
    return leftProvider.localeCompare(rightProvider) || left.id.localeCompare(right.id);
  });
}

function representativeModelForGroup(group: ModelConfigGroup) {
  const dreaminaWebModel = group.models.find((model) => isDreaminaWebProviderConfig(model.providerConfig) || isDreaminaWebProviderValue(model.provider));
  if (dreaminaWebModel) return dreaminaWebModel;
  const jimengModel = group.models.find((model) => isJimengApiProviderConfig(model.providerConfig) || isJimengApiProviderValue(model.provider) || model.model.includes("jimeng-video"));
  if (jimengModel) return jimengModel;
  const videoModel = group.models.find((model) => normalizeModelKindStrict(model.modality) === "video");
  if (videoModel) return videoModel;
  return group.models.find((model) => normalizeModelKindStrict(model.modality) === "text") ?? group.models[0];
}

function latestModelCredential(models: ModelConfig[]) {
  return models.find((model) => model.apiKey)?.apiKey ?? "";
}

function groupModalities(group: ModelConfigGroup) {
  return modelModalityOptions
    .map((option) => ({ ...option, count: group.models.filter((model) => normalizeModelKindStrict(model.modality) === option.id).length }))
    .filter((option) => option.count > 0);
}

function iconForModel(model: ModelConfig) {
  const kind = normalizeModelKind(model.modality, model.capabilities);
  if (kind === "video") return <MonitorPlay className="h-5 w-5 text-[#f59e0b]" />;
  if (kind === "image") return <ImageIcon className="h-5 w-5 text-[#a78bfa]" />;
  if (kind === "audio") return <Sparkles className="h-5 w-5 text-[#7ED887]" />;
  return <Cpu className="h-5 w-5 text-[#60a5fa]" />;
}

export function ModelsSettings() {
  const [providers, setProviders] = useState<ModelProviderConfig[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalMode, setModalMode] = useState<ModelModalMode>(null);
  const [editingProvider, setEditingProvider] = useState<ModelProviderConfig | null>(null);
  const [editingModel, setEditingModel] = useState<ModelConfig | null>(null);
  const [editingModelGroup, setEditingModelGroup] = useState<ModelConfigGroup | null>(null);
  const [providerForm, setProviderForm] = useState<ProviderFormState>(emptyProviderForm);
  const [modelForm, setModelForm] = useState<ModelFormState>(emptyModelForm);
  const [saving, setSaving] = useState(false);
  const [removingModelId, setRemovingModelId] = useState<string | null>(null);
  const [showModelApiKey, setShowModelApiKey] = useState(false);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [testingModelFormKey, setTestingModelFormKey] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [modelFormTestResults, setModelFormTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  const providerById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers]);
  const providerModelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const model of models) {
      if (!model.providerConfigId) continue;
      counts.set(model.providerConfigId, (counts.get(model.providerConfigId) ?? 0) + 1);
    }
    return counts;
  }, [models]);
  const modelGroups = useMemo(() => buildModelGroups(models), [models]);

  const loadConfigs = async () => {
    setLoading(true);
    setError("");
    try {
      const configs = await apiClient.listModelConfigs();
      setProviders(configs.providers);
      setModels(configs.models);
    } catch (err) {
      setProviders([]);
      setModels([]);
      setError(err instanceof Error ? err.message : "模型配置接口不可用，请检查后端服务。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfigs();
  }, []);

  const openProviderForm = (provider?: ModelProviderConfig) => {
    const selectedProvider = provider ?? providers[0] ?? null;
    setEditingProvider(selectedProvider);
    setProviderForm(selectedProvider ? providerFormFor(selectedProvider) : emptyProviderForm);
    setModalMode("provider");
  };

  const selectProviderForEdit = (providerId: string) => {
    if (providerId === "__new__") {
      setEditingProvider(null);
      setProviderForm(emptyProviderForm);
      return;
    }
    const provider = providerById.get(providerId);
    if (!provider) return;
    setEditingProvider(provider);
    setProviderForm(providerFormFor(provider));
  };

  const startNewProvider = () => {
    setEditingProvider(null);
    setProviderForm(emptyProviderForm);
  };

  const openJimengSeedanceSetup = () => {
    const provider = providers.find((item) => isDreaminaWebProviderConfig(item));
    if (!provider) {
      setEditingProvider(null);
      setProviderForm(dreaminaWebProviderForm);
      setModalMode("provider");
      return;
    }
    const entries = emptyModelEntriesByModality();
    entries.video = dreaminaWebVideoModelEntries();
    const existingDreaminaModels = models.filter((model) => model.providerConfigId === provider.id || isDreaminaWebProviderConfig(model.providerConfig));
    setEditingModel(null);
    setEditingModelGroup(null);
    setModelForm({
      ...emptyModelForm,
      providerConfigId: provider.id,
      modelEntriesByModality: entries,
      modelDraftByModality: emptyModelDraftByModality(),
      apiKey: "",
      savedApiKey: "",
      modalities: ["video"],
      costCredits: String(existingDreaminaModels[0]?.costCredits ?? "6"),
    });
    setShowModelApiKey(false);
    setModelFormTestResults({});
    setTestingModelFormKey(null);
    setModalMode("model");
  };

  const openDreaminaWebSetup = () => {
    const provider = providers.find((item) => isDreaminaWebProviderConfig(item));
    if (!provider) {
      setEditingProvider(null);
      setProviderForm(dreaminaWebProviderForm);
      setModalMode("provider");
      return;
    }
    const entries = emptyModelEntriesByModality();
    entries.image = dreaminaWebImageModelEntries();
    entries.video = dreaminaWebVideoModelEntries();
    const existingModels = models.filter((model) => model.providerConfigId === provider.id || isDreaminaWebProviderConfig(model.providerConfig));
    setEditingModel(null);
    setEditingModelGroup(null);
    setModelForm({
      ...emptyModelForm,
      providerConfigId: provider.id,
      modelEntriesByModality: entries,
      modelDraftByModality: emptyModelDraftByModality(),
      apiKey: "",
      savedApiKey: "",
      modalities: ["image", "video"],
      costCredits: String(existingModels[0]?.costCredits ?? "6"),
    });
    setShowModelApiKey(false);
    setModelFormTestResults({});
    setTestingModelFormKey(null);
    setModalMode("model");
  };

  const openModelForm = (modelOrGroup?: ModelConfig | ModelConfigGroup) => {
    const firstProvider = providers[0];
    const group = modelOrGroup && "models" in modelOrGroup ? modelOrGroup : null;
    const model = modelOrGroup && !("models" in modelOrGroup) ? modelOrGroup : null;
    const groupModels = group?.models ?? (model ? [model] : []);
    const normalizedModalities = groupModels.length
      ? Array.from(new Set(groupModels.map((item) => normalizeModelKindStrict(item.modality)))) as ModelModalityId[]
      : emptyModelForm.modalities;
    const modelEntriesByModality = emptyModelEntriesByModality();
    const modelDraftByModality = emptyModelDraftByModality();
    for (const item of groupModels) {
      const modality = normalizeModelKindStrict(item.modality);
      modelEntriesByModality[modality].push(createModelFormEntry(item.model, item.displayName, true, item.id));
    }
    setEditingModel(model ?? null);
    setEditingModelGroup(group);
    setModelForm(
      group || model
        ? {
            providerConfigId: group?.providerConfigId ?? model?.providerConfigId ?? "",
            modelEntriesByModality,
            modelDraftByModality,
            apiKey: group ? groupFormInitialApiKey(group) : modelFormInitialApiKey(model),
            savedApiKey: group ? groupFormSavedApiKey(group) : modelFormSavedApiKey(model),
            modalities: normalizedModalities,
            costCredits: String(group?.costCredits ?? model?.costCredits ?? 0),
          }
        : {
            ...emptyModelForm,
            modelEntriesByModality: emptyModelEntriesByModality(),
            modelDraftByModality: emptyModelDraftByModality(),
            providerConfigId: firstProvider?.id ?? "",
          }
    );
    setShowModelApiKey(false);
    setModelFormTestResults({});
    setTestingModelFormKey(null);
    setModalMode("model");
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingProvider(null);
    setEditingModel(null);
    setEditingModelGroup(null);
    setSaving(false);
    setTestingModelFormKey(null);
  };

  const commitModelDraft = (modality: ModelModalityId) => {
    setModelForm((current) => ({
      ...current,
      modelEntriesByModality: {
        ...current.modelEntriesByModality,
        [modality]: uniqueModelEntries([
          ...current.modelEntriesByModality[modality],
          ...parseModelNameInput(current.modelDraftByModality[modality]).map((name) => createModelFormEntry(name, name, true)),
        ]),
      },
      modelDraftByModality: {
        ...current.modelDraftByModality,
        [modality]: "",
      },
    }));
  };

  const removeModelEntry = async (modality: ModelModalityId, entryId: string) => {
    setRemovingModelId(entryId);
    setModelForm((current) => ({
      ...current,
      modelEntriesByModality: {
        ...current.modelEntriesByModality,
        [modality]: current.modelEntriesByModality[modality].filter((item) => item.id !== entryId),
      },
    }));
    setRemovingModelId(null);
  };

  const updateModelEntry = (modality: ModelModalityId, entryId: string, patch: Partial<Pick<ModelFormEntry, "model" | "displayName" | "expanded">>) => {
    setModelForm((current) => ({
      ...current,
      modelEntriesByModality: {
        ...current.modelEntriesByModality,
        [modality]: current.modelEntriesByModality[modality].map((entry) => (entry.id === entryId ? { ...entry, ...patch } : entry)),
      },
    }));
  };

  const toggleModelModality = (modality: ModelModalityId) => {
    setModelForm((current) => {
      const next = current.modalities.includes(modality)
        ? current.modalities.filter((item) => item !== modality)
        : [...current.modalities, modality];
      return {
        ...current,
        modalities: next.length ? next : [modality],
      };
    });
  };

  const saveProvider = async () => {
    if (!providerForm.displayName.trim() || !providerForm.providerType.trim()) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        displayName: providerForm.displayName.trim(),
        providerType: providerForm.providerType.trim(),
        baseUrl: providerForm.baseUrl.trim(),
      };
      if (editingProvider) {
        await apiClient.updateModelProvider(editingProvider.id, payload);
      } else {
        await apiClient.createModelProvider(payload);
      }
      closeModal();
      await loadConfigs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存供应商失败。");
      setSaving(false);
    }
  };

  const deleteProvider = async () => {
    if (!editingProvider) return;
    if (!confirm(`确定要删除供应商「${editingProvider.displayName}」吗？相关模型不会自动删除，但不能再选择这个供应商。`)) return;
    setSaving(true);
    setError("");
    try {
      await apiClient.disableModelProvider(editingProvider.id);
      const nextProviders = providers.filter((provider) => provider.id !== editingProvider.id);
      setProviders(nextProviders);
      const nextProvider = nextProviders[0] ?? null;
      setEditingProvider(nextProvider);
      setProviderForm(nextProvider ? providerFormFor(nextProvider) : emptyProviderForm);
      await loadConfigs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除供应商失败。");
    } finally {
      setSaving(false);
    }
  };

  const saveModel = async () => {
    const provider = providerById.get(modelForm.providerConfigId);
    const modalityEntries = allModelEntriesByModality(modelForm).filter(({ entries }) => entries.length > 0);
    if (modalityEntries.length === 0 || !provider || modelForm.modalities.length === 0) return;
    setSaving(true);
    setError("");
    try {
      const apiKeyInput = sanitizeModelApiKeyInput(modelForm.apiKey);
      const apiKeyOwner = currentModelApiKeyOwner(editingModel, editingModelGroup);
      const shouldSubmitApiKey = shouldSubmitModelApiKeyInput(apiKeyInput, apiKeyOwner, modelForm.savedApiKey);
      const payloadApiKey = shouldSubmitApiKey ? apiKeyInput : sanitizeModelApiKeyInput(modelForm.savedApiKey);
      const payloadBase = {
        providerConfigId: modelForm.providerConfigId,
        provider: provider.providerType,
        costCredits: Number(modelForm.costCredits) || 0,
        ...(payloadApiKey ? { apiKey: payloadApiKey } : {}),
        isActive: true,
      };
      const removedModelConfigIds = findRemovedModelConfigIds(
        persistedEntriesForModelGroup(editingModelGroup),
        persistedEntriesForModelForm(modelForm),
      );
      for (const modelId of removedModelConfigIds) {
        await apiClient.disableModelConfig(modelId);
      }
      for (const { modality, entries } of modalityEntries) {
        for (const entry of entries) {
          await apiClient.upsertModelConfig({
            ...payloadBase,
            defaultParams: defaultParamsForModel(provider, modality, entry.model),
            modality,
            capabilities: inferredCapabilitiesForModality(modality),
            model: entry.model,
            displayName: entry.displayName || entry.model,
          });
        }
      }
      closeModal();
      await loadConfigs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存模型失败。");
      setSaving(false);
    }
  };

  const testProvider = async (providerId: string) => {
    setTestingProviderId(providerId);
    try {
      const result = await apiClient.testModelProvider(providerId);
      setTestResults((current) => ({ ...current, [providerId]: { ok: result.ok, message: result.message } }));
    } catch (err) {
      setTestResults((current) => ({
        ...current,
        [providerId]: { ok: false, message: err instanceof Error ? err.message : "连接测试失败。" },
      }));
    } finally {
      setTestingProviderId(null);
    }
  };

  const testModel = async (modelId: string) => {
    setTestingModelId(modelId);
    try {
      const result = await apiClient.testModelConfig(modelId);
      setTestResults((current) => ({ ...current, [modelId]: { ok: result.ok, message: result.message } }));
    } catch (err) {
      setTestResults((current) => ({
        ...current,
        [modelId]: { ok: false, message: err instanceof Error ? err.message : "模型测试失败。" },
      }));
    } finally {
      setTestingModelId(null);
    }
  };

  const testModelFormEntry = async (modality: ModelModalityId, entry: ModelFormEntry) => {
    const provider = providerById.get(modelForm.providerConfigId);
    const modelName = entry.model.trim();
    const resultKey = modelFormEntryKey(modality, entry.id);
    if (!provider || !modelName) return;
    const apiKeyInput = sanitizeModelApiKeyInput(modelForm.apiKey);
    const apiKeyOwner = currentModelApiKeyOwner(editingModel, editingModelGroup);
    const shouldSubmitApiKey = shouldSubmitModelApiKeyInput(apiKeyInput, apiKeyOwner, modelForm.savedApiKey);
    const testApiKey = shouldSubmitApiKey ? apiKeyInput : sanitizeModelApiKeyInput(modelForm.savedApiKey);
    setTestingModelFormKey(resultKey);
    setModelFormTestResults((current) => ({
      ...current,
      [resultKey]: { ok: true, message: "正在测试..." },
    }));
    try {
      const result = await apiClient.testDraftModelConfig({
        ...(editingModel ? { existingModelId: editingModel.id } : {}),
        providerConfigId: provider.id,
        model: modelName,
        displayName: entry.displayName.trim() || modelName,
        modality,
        capabilities: inferredCapabilitiesForModality(modality),
        defaultParams: defaultParamsForModel(provider, modality, modelName),
        ...(testApiKey ? { apiKey: testApiKey } : {}),
      });
      setModelFormTestResults((current) => ({ ...current, [resultKey]: { ok: result.ok, message: result.message } }));
    } catch (err) {
      setModelFormTestResults((current) => ({
        ...current,
        [resultKey]: { ok: false, message: err instanceof Error ? err.message : "模型测试失败。" },
      }));
    } finally {
      setTestingModelFormKey(null);
    }
  };

  const disableModel = async (modelId: string) => {
    if (!confirm("确定要禁用这个模型吗？")) return;
    setError("");
    try {
      await apiClient.disableModelConfig(modelId);
      await loadConfigs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "禁用模型失败。");
    }
  };

  const selectedModelProvider = providerById.get(modelForm.providerConfigId);
  const modelFormUsesJimengSession = isJimengApiProviderConfig(selectedModelProvider);
  const modelFormUsesDreaminaWeb = isDreaminaWebProviderConfig(selectedModelProvider);
  const providerFormIsJimengApi = isJimengApiProviderValue(providerForm.providerType) || isJimengApiProviderValue(providerForm.displayName);
  const providerFormIsDreaminaWeb = isDreaminaWebProviderValue(providerForm.providerType) || isDreaminaWebProviderValue(providerForm.displayName);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:mb-8 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-[26px] font-extrabold text-[#E8E8EC]">模型配置</h1>
          <p className="text-muted-foreground mt-1 text-[16px]">管理真实供应商、模型 API Key 和可用模型</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button onClick={openDreaminaWebSetup} variant="outline" className="h-9 w-full gap-2 border-[#a78bfa]/40 text-[#ddd6fe] hover:bg-[#a78bfa]/10 sm:w-auto">
            <ImageIcon className="h-4 w-4" />
            配置 Dreamina Web
          </Button>
          <Button onClick={openJimengSeedanceSetup} variant="outline" className="h-9 w-full gap-2 border-[#f59e0b]/40 text-[#fde68a] hover:bg-[#f59e0b]/10 sm:w-auto">
            <MonitorPlay className="h-4 w-4" />
            配置 Seedance 2.0
          </Button>
          <Button onClick={() => openProviderForm()} variant="outline" className="h-9 w-full gap-2 border-border text-foreground hover:bg-accent sm:w-auto">
            <KeyRound className="h-4 w-4" />
            管理供应商
          </Button>
          <Button onClick={() => openModelForm()} disabled={providers.length === 0} className="h-9 w-full gap-2 disabled:opacity-50 sm:w-auto">
            <Plus className="h-4 w-4" />
            添加模型
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-[15px] text-[#fecaca]">
          <div className="mb-3 font-medium text-foreground">模型配置接口不可用</div>
          <div className="break-words">{error}</div>
          <Button onClick={loadConfigs} variant="outline" className="mt-4 h-8 border-destructive/40 text-[#fecaca] hover:bg-destructive/20">重试</Button>
        </div>
      )}

      {loading ? (
        <div className="lh-card flex min-h-[220px] items-center justify-center rounded-xl border border-border text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在加载模型配置...
        </div>
      ) : (
        <div className="space-y-6">
          {providers.length === 0 && models.length === 0 && !error && (
            <div className="rounded-xl border border-dashed border-border bg-[#141417] p-6 text-center">
              <Cpu className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <h3 className="text-[17px] font-medium text-foreground">还没有模型配置</h3>
              <p className="mt-1 text-[15px] text-muted-foreground">先添加供应商，再为每个模型配置对应 API Key。</p>
              <Button onClick={() => openProviderForm()} className="mt-4 h-9">管理供应商</Button>
            </div>
          )}

          {providers.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[18px] font-medium text-foreground">供应商</h2>
                <span className="text-[14px] text-muted-foreground">{providers.length} 个</span>
              </div>
              <div className="lh-card flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-[17px] font-medium text-foreground">已配置 {providers.length} 个供应商</div>
                  <div className="mt-1 text-[14px] text-muted-foreground">
                    在供应商管理里选择具体供应商，修改 Base URL、API Key、测试连接或删除。
                  </div>
                </div>
                <Button onClick={() => openProviderForm()} variant="outline" className="h-8 w-full gap-1 border-border text-[15px] text-foreground hover:bg-accent sm:w-auto">
                  <Pencil className="h-3.5 w-3.5" />
                  管理供应商
                </Button>
              </div>
            </section>
          )}

          {modelGroups.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[18px] font-medium text-foreground">模型配置</h2>
                <span className="text-[14px] text-muted-foreground">{modelGroups.length} 组 / {models.length} 个模型</span>
              </div>
              <div className="grid gap-3">
                {modelGroups.map((group) => {
                  const representative = representativeModelForGroup(group);
                  const provider = group.providerConfigId ? providerById.get(group.providerConfigId) : undefined;
                  const result = representative ? testResults[representative.id] : undefined;
                  const modalities = groupModalities(group);
                  return (
                    <div key={group.id} className="lh-card flex flex-col gap-4 rounded-xl border border-border p-4 transition-colors hover:border-primary/30 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                      <div className="flex min-w-0 items-center gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-layer-4">
                          {representative ? iconForModel(representative) : <Cpu className="h-5 w-5 text-[#60a5fa]" />}
                        </div>
                        <div className="min-w-0">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-[18px] font-medium text-foreground">{provider?.displayName ?? group.provider}</h3>
                            <Badge className="border border-[#7ED88733] bg-[#7ED88733] px-1.5 py-0 font-normal text-[#7ED887] hover:bg-[#7ED88733]">已启用</Badge>
                            <Badge variant="secondary" className="border-0 bg-layer-4 px-1.5 py-0 font-normal text-muted-foreground">{group.models.length} 个模型</Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[14px] text-muted-foreground sm:gap-3">
                            <span>{modalities.map((item) => `${item.label}${item.count > 1 ? ` x${item.count}` : ""}`).join(" / ")}</span>
                            <span className="h-1 w-1 rounded-full bg-accent" />
                            <span className="break-all font-mono">Key: <span className="text-muted-foreground">{displayModelGroupApiKey(group)}</span></span>
                            {group.costCredits > 0 && (
                              <>
                                <span className="h-1 w-1 rounded-full bg-accent" />
                                <span>{group.costCredits} 积分</span>
                              </>
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {group.models.map((model) => (
                              <Badge key={model.id} variant="secondary" className="border-0 bg-layer-4 px-2 py-0.5 font-mono text-[13px] text-muted-foreground">
                                {labelForModality(normalizeModelKindStrict(model.modality))}: {model.displayName || model.model}
                              </Badge>
                            ))}
                          </div>
                          {result && (
                            <div className={cn("mt-1 text-[14px]", result.ok ? "text-[#7ED887]" : "text-destructive")}>
                              {result.message}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex w-full gap-2 sm:w-auto sm:shrink-0">
                        {representative && (
                          <Button onClick={() => testModel(representative.id)} disabled={testingModelId === representative.id} variant="outline" className="h-8 flex-1 border-border text-[15px] text-foreground hover:bg-accent sm:flex-none">
                            {testingModelId === representative.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                            测试
                          </Button>
                        )}
                        <Button onClick={() => openModelForm(group)} variant="outline" className="h-8 flex-1 border-border text-[15px] text-foreground hover:bg-accent sm:flex-none">编辑</Button>
                        {representative && (
                          <Button onClick={() => disableModel(representative.id)} variant="ghost" size="icon" className="h-8 w-10 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}

      {modalMode && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm animate-in fade-in sm:items-center sm:p-4">
          <div className="lh-card flex max-h-[92vh] w-full max-w-4xl flex-col rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-border p-4 sm:p-5">
              <h2 className="text-[18px] font-medium text-foreground">
                {modalMode === "provider" ? (editingProvider ? "编辑供应商" : "添加供应商") : (editingModel || editingModelGroup ? "编辑模型" : "添加模型")}
              </h2>
              <button onClick={closeModal} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
              {modalMode === "provider" ? (
                <>
                  {providers.length > 0 && (
                    <div className="rounded-lg border border-border bg-[#141417] p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="min-w-0 flex-1">
                          <label className="mb-1.5 block text-[16px] font-medium text-foreground">选择供应商</label>
                          <select
                            value={editingProvider?.id ?? "__new__"}
                            onChange={(event) => selectProviderForEdit(event.target.value)}
                            className="h-10 w-full rounded-md border border-border bg-layer-4 px-3 text-[16px] text-foreground outline-none focus:border-primary"
                          >
                            {providers.map((provider) => (
                              <option key={provider.id} value={provider.id}>{provider.displayName}</option>
                            ))}
                            <option value="__new__">新建供应商</option>
                          </select>
                        </div>
                        <Button type="button" onClick={startNewProvider} variant="outline" className="h-10 border-border text-foreground hover:bg-accent">
                          <Plus className="mr-1 h-4 w-4" />
                          新建
                        </Button>
                      </div>
                    </div>
                  )}

                  {editingProvider && (
                    <div className="rounded-lg border border-border bg-[#141417] p-3 text-[14px] text-muted-foreground">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="border-0 bg-layer-4 text-muted-foreground">{providerModelCounts.get(editingProvider.id) ?? 0} 模型</Badge>
                      </div>
                      <div className="break-all">当前 Base URL: <span className="text-muted-foreground">{editingProvider.baseUrl || "未设置"}</span></div>
                      {testResults[editingProvider.id] && (
                        <div className={cn("mt-1", testResults[editingProvider.id].ok ? "text-[#7ED887]" : "text-destructive")}>
                          {testResults[editingProvider.id].message}
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="mb-1.5 block text-[16px] font-medium text-foreground">显示名称</label>
                    <Input value={providerForm.displayName} onChange={(e) => setProviderForm({ ...providerForm, displayName: e.target.value })} placeholder="OpenAI / Volcengine / 自定义供应商" className="h-10 border-border bg-layer-4 text-[16px]" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[16px] font-medium text-foreground">供应商类型</label>
                    <Input value={providerForm.providerType} onChange={(e) => setProviderForm({ ...providerForm, providerType: e.target.value })} placeholder="openai-compatible" className="h-10 border-border bg-layer-4 text-[16px]" />
                    {providerFormIsDreaminaWeb ? (
                      <p className="mt-1.5 text-[14px] leading-5 text-[#ddd6fe]">
                        Dreamina Web 使用服务器云浏览器登录态，不在这里配置 API Key 或 session。先保存供应商，再添加图片模型。
                      </p>
                    ) : providerFormIsJimengApi ? (
                      <p className="mt-1.5 text-[14px] leading-5 text-[#fde68a]">
                        Jimeng/Dreamina 视频接入请使用 providerType: jimeng-api。session 不填在供应商里，填到视频模型的 API Key。
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[16px] font-medium text-foreground">Base URL</label>
                    <Input value={providerForm.baseUrl} onChange={(e) => setProviderForm({ ...providerForm, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" className="h-10 border-border bg-layer-4 text-[16px]" />
                    {providerFormIsDreaminaWeb ? (
                      <p className="mt-1.5 text-[14px] leading-5 text-muted-foreground">
                        Base URL 留空。服务器会连接本机 Dreamina 云浏览器：/dreamina-browser/。
                      </p>
                    ) : providerFormIsJimengApi ? (
                      <p className="mt-1.5 text-[14px] leading-5 text-muted-foreground">
                        默认本机服务地址是 http://127.0.0.1:5100。需要先部署 iptag/jimeng-api 容器。
                      </p>
                    ) : null}
                  </div>
	                </>
              ) : (
                <>
                  <div>
                    <label className="mb-1.5 block text-[16px] font-medium text-foreground">供应商</label>
                    <select value={modelForm.providerConfigId} onChange={(e) => setModelForm({ ...modelForm, providerConfigId: e.target.value })} className="h-10 w-full rounded-md border border-border bg-layer-4 px-3 text-[16px] text-foreground outline-none focus:border-primary">
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>{provider.displayName}</option>
                      ))}
                    </select>
                  </div>
                  {!modelFormUsesDreaminaWeb && (
                  <div>
                    <label className="mb-1.5 block text-[16px] font-medium text-foreground">{modelFormUsesJimengSession ? "Session ID" : "API Key"}</label>
                    <div className="flex rounded-md border border-border bg-layer-4 focus-within:border-primary">
                      <Input
                        type={showModelApiKey || isMaskedModelApiKeyInput(modelForm.apiKey, currentModelApiKeyOwner(editingModel, editingModelGroup)) ? "text" : "password"}
                        value={visibleModelApiKeyValue(modelForm, currentModelApiKeyOwner(editingModel, editingModelGroup), showModelApiKey)}
                        onChange={(e) => setModelForm({ ...modelForm, apiKey: e.target.value })}
                        placeholder={modelFormUsesJimengSession ? "Dreamina/Jimeng sessionid，例如 us-xxx / hk-xxx / xxx" : editingModel?.hasApiKey ? "输入新 API Key 将替换当前 Key" : "输入这一批模型使用的 API Key"}
                        className="h-10 flex-1 border-0 bg-transparent font-mono text-[16px] shadow-none focus-visible:ring-0"
                      />
                      <button
                        type="button"
                        onClick={() => setShowModelApiKey((value) => !value)}
                        className="flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                        aria-label={showModelApiKey ? "隐藏 API Key" : "显示 API Key"}
                      >
                        {showModelApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="mt-1.5 text-[14px] leading-5 text-muted-foreground">
                      {modelFormUsesJimengSession
                        ? "这里填写浏览器 Cookie 里的 sessionid；国际站按 jimeng-api 规则加 us-/hk-/jp-/sg- 前缀。测试只检查 session，不会生成视频。"
                        : "这一批模型共用这里的 Key；需要另一组 Key 时，再新建同供应商下的模型即可。"}
                    </p>
                  </div>
                  )}
                  {modelFormUsesDreaminaWeb && (
                    <div className="rounded-lg border border-[#a78bfa]/25 bg-[#a78bfa]/10 p-3 text-[14px] leading-5 text-[#ddd6fe]">
                      Dreamina Web 模型不需要 API Key。测试会连接服务器云浏览器并检查是否已登录；未登录时请打开 /dreamina-browser/ 手动登录。
                    </div>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block text-[16px] font-medium text-foreground">模型大类</label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {modelModalityOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => toggleModelModality(option.id)}
                            className={cn(
                              "flex items-start gap-2 rounded-lg border p-3 text-left transition-colors",
                              modelForm.modalities.includes(option.id)
                                ? "border-primary/60 bg-primary/10"
                                : "border-border bg-layer-4 hover:border-[#3f3f46]",
                            )}
                          >
                            <span className={cn(
                              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                              modelForm.modalities.includes(option.id) ? "border-primary/80 bg-primary" : "border-[#3f3f46]",
                            )}>
                              {modelForm.modalities.includes(option.id) ? <Check className="h-3 w-3 text-primary-foreground" /> : null}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[15px] font-medium text-foreground">{option.label}</span>
                              <span className="mt-0.5 block text-[13px] leading-4 text-muted-foreground">{option.description}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                      <div className="mt-3 space-y-2">
                        {modelModalityOptions
                          .filter((option) => modelForm.modalities.includes(option.id))
                          .map((option) => {
                            const modality = option.id;
                            const entries = modelForm.modelEntriesByModality[modality];
                            return (
                              <div key={option.id} className="rounded-lg border border-border bg-[#141417] p-3">
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                  <div>
                                    <div className="text-[15px] font-medium text-foreground">{option.label}模型</div>
                                    <div className="mt-1 text-[13px] leading-5 text-muted-foreground">
                                      能力：{inferredCapabilitiesForModality(option.id).join(" / ")}
                                    </div>
                                  </div>
                                  <Badge variant="secondary" className="w-fit border-0 bg-layer-4 text-muted-foreground">{entries.length} 个</Badge>
                                </div>
                                <div className="mt-3 rounded-md border border-border bg-layer-4 p-2 focus-within:border-primary">
                                  <Input
                                    value={modelForm.modelDraftByModality[modality]}
                                    onChange={(e) => setModelForm((current) => ({
                                      ...current,
                                      modelDraftByModality: {
                                        ...current.modelDraftByModality,
                                        [modality]: e.target.value,
                                      },
                                    }))}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === "," || event.key === "，") {
                                        event.preventDefault();
                                        commitModelDraft(modality);
                                      }
                                    }}
                                    onBlur={() => commitModelDraft(modality)}
                                    placeholder={`${option.label}模型名称，回车添加多个`}
                                    className="h-8 border-0 bg-transparent px-1 text-[16px] shadow-none focus-visible:ring-0"
                                  />
                                </div>
                                <p className="mt-1.5 text-[14px] text-muted-foreground">只会保存为{option.label}模型，不会套用到其他大类。</p>
                                {entries.length > 0 && (
                                  <div className="mt-3 space-y-2">
                                    {entries.map((entry) => {
                                      const entryTestKey = modelFormEntryKey(modality, entry.id);
                                      const entryTestResult = modelFormTestResults[entryTestKey];
                                      const entryTesting = testingModelFormKey === entryTestKey;
                                      return (
                                      <div key={entry.id} className="rounded-lg border border-border bg-card">
                                        <button
                                          type="button"
                                          onClick={() => updateModelEntry(modality, entry.id, { expanded: !entry.expanded })}
                                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                                        >
                                          <div className="min-w-0">
                                            <div className="truncate font-mono text-[15px] text-foreground">{entry.model || "未命名模型"}</div>
                                            <div className="truncate text-[13px] text-muted-foreground">显示：{entry.displayName || entry.model || "默认同模型名称"}</div>
                                          </div>
                                          <div className="flex shrink-0 items-center gap-2">
                                            {(!editingModel || entries.length > 1 || modelForm.modalities.length > 1) && (
                                              removingModelId === entry.id ? (
                                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                              ) : (
                                              <span
                                                role="button"
                                                tabIndex={0}
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  void removeModelEntry(modality, entry.id);
                                                }}
                                                onKeyDown={(event) => {
                                                  if (event.key === "Enter" || event.key === " ") {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    void removeModelEntry(modality, entry.id);
                                                  }
                                                }}
                                                className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                              >
                                                <X className="h-4 w-4" />
                                              </span>
                                              )
                                            )}
                                            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", entry.expanded ? "rotate-180" : "")} />
                                          </div>
                                        </button>
                                        {entry.expanded && (
                                          <div className="border-t border-border p-3">
                                            <div className="grid gap-3 sm:grid-cols-2">
                                              <div>
                                              <label className="mb-1.5 block text-[14px] font-medium text-[#d4d4d8]">模型名称</label>
                                              <Input value={entry.model} onChange={(e) => updateModelEntry(modality, entry.id, { model: e.target.value })} className="h-9 border-border bg-layer-4 font-mono text-[15px]" />
                                              </div>
                                              <div>
                                              <label className="mb-1.5 block text-[14px] font-medium text-[#d4d4d8]">显示名称</label>
                                              <Input value={entry.displayName} onChange={(e) => updateModelEntry(modality, entry.id, { displayName: e.target.value })} placeholder="可留空，默认使用模型名称" className="h-9 border-border bg-layer-4 text-[15px]" />
                                              </div>
                                            </div>
                                            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                              <div className="min-h-5 text-[14px]">
                                                {entryTestResult && (
                                                  <span className={entryTestResult.ok ? "text-[#7ED887]" : "text-destructive"}>
                                                    {entryTestResult.message}
                                                  </span>
                                                )}
                                              </div>
                                              <Button
                                                type="button"
                                                onClick={() => testModelFormEntry(modality, entry)}
                                                disabled={saving || entryTesting || !modelForm.providerConfigId || !entry.model.trim()}
                                                variant="outline"
                                                className="h-8 w-full border-border text-[15px] text-foreground hover:bg-accent sm:w-auto"
                                              >
                                                {entryTesting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                                                测试{option.label}模型
                                              </Button>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[16px] font-medium text-foreground">单次积分</label>
                      <Input value={modelForm.costCredits} onChange={(e) => setModelForm({ ...modelForm, costCredits: e.target.value })} inputMode="numeric" className="h-10 border-border bg-layer-4 text-[16px]" />
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="flex shrink-0 flex-col justify-end gap-3 border-t border-border p-4 sm:flex-row sm:p-5">
              {modalMode === "provider" && editingProvider && (
                <>
                  <Button
                    type="button"
                    onClick={() => testProvider(editingProvider.id)}
                    disabled={saving || testingProviderId === editingProvider.id}
                    variant="outline"
                    className="border-border text-foreground hover:bg-accent"
                  >
                    {testingProviderId === editingProvider.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    测试
                  </Button>
                  <Button
                    type="button"
                    onClick={deleteProvider}
                    disabled={saving}
                    variant="outline"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-[#fecaca]"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    删除
                  </Button>
                </>
              )}
              <Button variant="outline" onClick={closeModal} className="border-border text-foreground hover:bg-accent">取消</Button>
              <Button
                onClick={modalMode === "provider" ? saveProvider : saveModel}
	                disabled={
	                  saving ||
	                  (modalMode === "provider" && (!providerForm.displayName.trim() || !providerForm.providerType.trim())) ||
	                  (modalMode === "model" && (
	                    providers.length === 0 ||
	                    modelForm.modalities.length === 0 ||
	                    allModelEntriesByModality(modelForm).every(({ entries }) => entries.length === 0)
	                  ))
	                }
                className="disabled:opacity-50"
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                保存
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
