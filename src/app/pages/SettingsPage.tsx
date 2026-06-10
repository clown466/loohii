import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router";
import { User, Users, Palette, Cpu, CreditCard, Zap, Check, Trash2, Plus, UploadCloud, ChevronDown, MonitorPlay, Sparkles, Image as ImageIcon, KeyRound, Loader2, Pencil, X, Eye, EyeOff } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../components/ui/utils";
import { useAuthStore } from "../stores/useAuthStore";
import { apiClient, type ModelConfig, type ModelProviderConfig } from "../lib/apiClient";

function ProfileSettings() {
  const user = useAuthStore(state => state.user);
  const updateProfile = useAuthStore(state => state.updateProfile);
  const signOut = useAuthStore(state => state.signOut);
  const navigate = useNavigate();

  const [nickname, setNickname] = useState(user?.name || "");

  const handleSave = () => {
    updateProfile({ name: nickname });
  };

  const handleDeleteAccount = () => {
    if (confirm("确定要注销账号吗？此操作不可恢复。")) {
      signOut();
      navigate("/");
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-[22px] font-semibold text-[#fafafa] sm:text-[24px]">个人信息</h1>
      </div>

      <div className="space-y-6 rounded-xl border border-[#27272a] bg-[#18181b] p-4 sm:space-y-8 sm:p-6">
        <div>
          <label className="block text-[14px] font-medium text-[#fafafa] mb-4">头像</label>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
            <div className="h-20 w-20 rounded-full border border-[#27272a] overflow-hidden bg-[#09090b]">
              <img src={user?.avatar || "https://api.dicebear.com/7.x/avataaars/svg?seed=Felix"} alt="User avatar" className="h-full w-full object-cover" />
            </div>
            <Button variant="outline" className="h-9 w-full border-[#27272a] text-[#fafafa] hover:bg-[#27272a] sm:w-auto">更换头像</Button>
          </div>
        </div>

        <div className="w-full max-w-md space-y-4">
          <div>
            <label className="block text-[14px] font-medium text-[#fafafa] mb-1.5">昵称</label>
            <Input value={nickname} onChange={(e) => setNickname(e.target.value)} className="h-10 text-[14px] bg-[#1f1f23] border-[#27272a] focus-visible:ring-[#6366f1]" />
          </div>
          <div>
            <label className="block text-[14px] font-medium text-[#fafafa] mb-1.5">邮箱</label>
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
              <Input defaultValue={user?.email || ""} disabled className="h-10 text-[14px] bg-[#1f1f23]/50 border-[#27272a] opacity-70" />
              <span className="text-[#22c55e] text-[12px] whitespace-nowrap flex items-center gap-1"><Check className="h-3 w-3" />已验证</span>
            </div>
          </div>
        </div>

        <div className="w-full max-w-md pt-4 border-t border-[#1f1f23] space-y-4">
          <label className="block text-[14px] font-medium text-[#fafafa]">修改密码</label>
          <div>
            <Input type="password" placeholder="当前密码" className="h-10 text-[14px] bg-[#1f1f23] border-[#27272a] focus-visible:ring-[#6366f1]" />
          </div>
          <div>
            <Input type="password" placeholder="新密码" className="h-10 text-[14px] bg-[#1f1f23] border-[#27272a] focus-visible:ring-[#6366f1]" />
          </div>
          <div>
            <Input type="password" placeholder="确认密码" className="h-10 text-[14px] bg-[#1f1f23] border-[#27272a] focus-visible:ring-[#6366f1]" />
          </div>
        </div>

        <div className="pt-2">
          <Button onClick={handleSave} className="h-9 w-full rounded-md border-0 bg-gradient-to-r from-[#6366f1] to-[#818cf8] px-6 text-white hover:opacity-90 sm:w-auto">保存修改</Button>
        </div>
      </div>

      <div className="relative mt-6 overflow-hidden rounded-xl border border-[#ef4444]/20 bg-[#18181b] p-4 sm:mt-8 sm:p-6">
        <div className="absolute top-0 left-0 w-1 h-full bg-[#ef4444]" />
        <h3 className="text-[16px] font-medium text-[#ef4444] mb-2">危险操作</h3>
        <p className="text-[#a1a1aa] text-[14px] mb-4">注销账号后，您的所有数据将被永久删除，无法恢复。</p>
        <Button onClick={handleDeleteAccount} variant="outline" className="w-full border-[#ef4444] text-[#ef4444] hover:bg-[#ef4444]/10 hover:text-[#ef4444] sm:w-auto">注销账号</Button>
      </div>
    </div>
  );
}

function TeamSettings() {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:mb-8 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-[24px] font-semibold text-[#fafafa]">团队管理</h1>
          <p className="text-[#a1a1aa] mt-1 text-[14px]">当前团队: Loohii Studio</p>
        </div>
        <Button className="h-9 w-full gap-2 rounded-md border-0 bg-gradient-to-r from-[#6366f1] to-[#818cf8] text-white hover:opacity-90 sm:w-auto">
          <Plus className="h-4 w-4" />
          邀请成员
        </Button>
      </div>

      <div className="rounded-xl border border-[#27272a] bg-[#18181b] overflow-hidden">
        <div className="p-4 border-b border-[#1f1f23] bg-[#1f1f23]/50">
          <h3 className="text-[14px] font-medium text-[#fafafa]">成员 (3/5)</h3>
        </div>
        <div className="divide-y divide-[#1f1f23]">
          <div className="flex flex-col gap-3 p-4 transition-colors hover:bg-[#1f1f23]/50 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" alt="张三" className="w-8 h-8 rounded-full border border-[#27272a]" />
              <div>
                <div className="text-[14px] font-medium text-[#fafafa]">张三</div>
                <div className="text-[12px] text-[#71717a]">admin@xx.com</div>
              </div>
            </div>
            <Badge variant="secondary" className="bg-[#1f1f23] text-[#a1a1aa] border-0 text-[12px] font-normal">管理员</Badge>
          </div>
          
          <div className="flex flex-col gap-3 p-4 transition-colors hover:bg-[#1f1f23]/50 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Oliver" alt="李四" className="w-8 h-8 rounded-full border border-[#27272a]" />
              <div>
                <div className="text-[14px] font-medium text-[#fafafa]">李四</div>
                <div className="text-[12px] text-[#71717a]">li@xx.com</div>
              </div>
            </div>
            <div className="flex items-center gap-3 self-end sm:self-auto">
              <button className="flex items-center gap-1 text-[13px] text-[#fafafa] bg-[#1f1f23] px-2.5 py-1.5 rounded border border-[#27272a] hover:border-[#6366f1] transition-colors">
                编辑者 <ChevronDown className="h-3 w-3" />
              </button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-[#71717a] hover:text-[#ef4444] hover:bg-[#ef4444]/10 rounded-md">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 p-4 transition-colors hover:bg-[#1f1f23]/50 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Sam" alt="王五" className="w-8 h-8 rounded-full border border-[#27272a]" />
              <div>
                <div className="text-[14px] font-medium text-[#fafafa]">王五</div>
                <div className="text-[12px] text-[#71717a]">wang@xx.com</div>
              </div>
            </div>
            <div className="flex items-center gap-3 self-end sm:self-auto">
              <button className="flex items-center gap-1 text-[13px] text-[#fafafa] bg-[#1f1f23] px-2.5 py-1.5 rounded border border-[#27272a] hover:border-[#6366f1] transition-colors">
                查看者 <ChevronDown className="h-3 w-3" />
              </button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-[#71717a] hover:text-[#ef4444] hover:bg-[#ef4444]/10 rounded-md">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-b border-[#1f1f23] bg-[#1f1f23]/50 mt-4">
          <h3 className="text-[14px] font-medium text-[#fafafa]">待接受邀请</h3>
        </div>
        <div className="divide-y divide-[#1f1f23]">
          <div className="flex flex-col gap-3 p-4 transition-colors hover:bg-[#1f1f23]/50 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[14px] font-medium text-[#fafafa]">zhao@xx.com</div>
              <div className="text-[12px] text-[#71717a]">已发送 2天前</div>
            </div>
            <Button variant="outline" className="h-8 w-full border-[#27272a] text-[12px] text-[#a1a1aa] hover:bg-[#27272a] hover:text-[#fafafa] sm:w-auto">取消</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PresetsSettings() {
  const [activeTab, setActiveTab] = useState("系统预设");
  const [showEditModal, setShowEditModal] = useState(false);

  const presets = [
    { name: "赛博朋克", cover: "https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?w=400&q=80" },
    { name: "吉卜力风", cover: "https://images.unsplash.com/photo-1578305716160-5f25a77ccbe7?w=400&q=80" },
    { name: "美漫风格", cover: "https://images.unsplash.com/photo-1618331835717-801e976710b2?w=400&q=80" },
    { name: "水墨国风", cover: "https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=400&q=80" },
    { name: "写实电影", cover: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&q=80" },
  ];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 relative">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:mb-8 sm:flex-row sm:items-center">
        <h1 className="text-[24px] font-semibold text-[#fafafa]">预设管理</h1>
        <Button onClick={() => setShowEditModal(true)} className="h-9 w-full gap-2 rounded-md border-0 bg-gradient-to-r from-[#6366f1] to-[#818cf8] text-white hover:opacity-90 sm:w-auto">
          <Plus className="h-4 w-4" />
          新建预设
        </Button>
      </div>

      <div className="mb-6 flex w-full space-x-1 overflow-x-auto rounded-lg border border-[#1f1f23] bg-[#111113] p-1 sm:w-fit">
        {["系统预设", "我的预设"].map((tab) => (
          <button 
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`shrink-0 px-4 py-1.5 text-[14px] font-medium rounded-md transition-colors ${
              activeTab === tab 
                ? "bg-[#1f1f23] text-[#fafafa] shadow-sm" 
                : "text-[#71717a] hover:text-[#fafafa] hover:bg-[#18181b]"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 min-[380px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {presets.map((style, i) => (
          <div key={i} className="group rounded-xl border border-[#27272a] bg-[#18181b] overflow-hidden hover:border-[#6366f1]/50 transition-colors">
            <div className="aspect-square bg-[#09090b] relative overflow-hidden">
              <img src={style.cover} alt={style.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                <Button variant="secondary" size="icon" className="h-8 w-8 rounded-full bg-[#18181b] text-[#fafafa] hover:bg-[#6366f1] border-0" onClick={() => setShowEditModal(true)}>
                  <span className="text-[12px] font-medium">编辑</span>
                </Button>
                {activeTab === "我的预设" && (
                  <Button variant="secondary" size="icon" className="h-8 w-8 rounded-full bg-[#18181b] text-[#ef4444] hover:bg-[#ef4444] hover:text-white border-0">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="p-3 text-[13px] font-medium text-[#fafafa]">
              {style.name}
            </div>
          </div>
        ))}
      </div>

      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm animate-in fade-in sm:p-4">
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-2xl border border-[#27272a] bg-[#18181b] shadow-2xl">
            <div className="p-5 border-b border-[#1f1f23] flex items-center justify-between shrink-0">
              <h2 className="text-[16px] font-medium text-[#fafafa]">编辑预设</h2>
              <button onClick={() => setShowEditModal(false)} className="text-[#71717a] hover:text-[#fafafa]">
                <Trash2 className="h-5 w-5 hidden" />
                <span className="text-xl leading-none">&times;</span>
              </button>
            </div>
            
            <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
              <div>
                <label className="block text-[14px] font-medium text-[#fafafa] mb-1.5">预设名称</label>
                <Input placeholder="输入预设名称" className="h-10 bg-[#1f1f23] border-[#27272a]" />
              </div>
              
              <div>
                <label className="block text-[14px] font-medium text-[#fafafa] mb-1.5">分类</label>
                <button className="w-full flex items-center justify-between h-10 px-3 bg-[#1f1f23] border border-[#27272a] rounded-md text-[14px] text-[#fafafa]">
                  动漫 <ChevronDown className="h-4 w-4 text-[#71717a]" />
                </button>
              </div>

              <div>
                <label className="block text-[14px] font-medium text-[#fafafa] mb-1.5">预览图</label>
                <div className="border-2 border-dashed border-[#27272a] rounded-xl p-4 flex flex-col items-center justify-center bg-[#1f1f23] text-[#71717a] cursor-pointer hover:border-[#6366f1]/50 h-24">
                  <UploadCloud className="h-6 w-6 mb-1 text-[#a1a1aa]" />
                  <p className="text-[12px]">点击上传</p>
                </div>
              </div>

              <div>
                <label className="block text-[14px] font-medium text-[#fafafa] mb-1.5">提示词 (Prompt)</label>
                <Textarea placeholder="输入与此风格相关的提示词..." className="h-24 resize-none bg-[#1f1f23] border-[#27272a] font-mono text-[13px]" />
              </div>

              <div>
                <label className="block text-[14px] font-medium text-[#fafafa] mb-1.5">参考图 (最多5张)</label>
                <div className="flex gap-3">
                  <div className="h-16 w-16 rounded-md bg-[#09090b] border border-[#27272a] overflow-hidden">
                    <img src="https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?w=100&q=80" alt="ref" className="w-full h-full object-cover" />
                  </div>
                  <div className="border-2 border-dashed border-[#27272a] rounded-md flex flex-col items-center justify-center bg-[#1f1f23] text-[#71717a] cursor-pointer hover:border-[#6366f1]/50 h-16 w-16">
                    <Plus className="h-5 w-5" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-col justify-end gap-3 rounded-b-2xl border-t border-[#1f1f23] bg-[#18181b] p-4 sm:flex-row sm:p-5">
              <Button variant="outline" onClick={() => setShowEditModal(false)} className="border-[#27272a] text-[#fafafa] hover:bg-[#27272a]">取消</Button>
              <Button onClick={() => setShowEditModal(false)} className="bg-gradient-to-r from-[#6366f1] to-[#818cf8] hover:opacity-90 text-white border-0">保存预设</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type ModelModalMode = "provider" | "model" | null;

type ProviderFormState = {
  displayName: string;
  providerType: string;
  baseUrl: string;
};

type ModelFormEntry = {
  id: string;
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

function createModelFormEntry(model: string, displayName = model, expanded = true): ModelFormEntry {
  return {
    id: `${model.toLowerCase()}-${Math.random().toString(36).slice(2)}`,
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
  if (kind === "audio") return <Sparkles className="h-5 w-5 text-[#22c55e]" />;
  return <Cpu className="h-5 w-5 text-[#60a5fa]" />;
}

function ModelsSettings() {
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
      modelEntriesByModality[modality].push(createModelFormEntry(item.model, item.displayName, true));
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

  const removeModelEntry = (modality: ModelModalityId, entryId: string) => {
    setModelForm((current) => ({
      ...current,
      modelEntriesByModality: {
        ...current.modelEntriesByModality,
        [modality]: current.modelEntriesByModality[modality].filter((item) => item.id !== entryId),
      },
    }));
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
          <h1 className="text-[24px] font-semibold text-[#fafafa]">模型配置</h1>
          <p className="text-[#a1a1aa] mt-1 text-[14px]">管理真实供应商、模型 API Key 和可用模型</p>
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
          <Button onClick={() => openProviderForm()} variant="outline" className="h-9 w-full gap-2 border-[#27272a] text-[#fafafa] hover:bg-[#27272a] sm:w-auto">
            <KeyRound className="h-4 w-4" />
            管理供应商
          </Button>
          <Button onClick={() => openModelForm()} disabled={providers.length === 0} className="h-9 w-full gap-2 rounded-md border-0 bg-gradient-to-r from-[#6366f1] to-[#818cf8] text-white hover:opacity-90 disabled:opacity-50 sm:w-auto">
            <Plus className="h-4 w-4" />
            添加模型
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-[#ef4444]/30 bg-[#ef4444]/10 p-4 text-[13px] text-[#fecaca]">
          <div className="mb-3 font-medium text-[#fafafa]">模型配置接口不可用</div>
          <div className="break-words">{error}</div>
          <Button onClick={loadConfigs} variant="outline" className="mt-4 h-8 border-[#ef4444]/40 text-[#fecaca] hover:bg-[#ef4444]/20">重试</Button>
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-[#27272a] bg-[#18181b] text-[#a1a1aa]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在加载模型配置...
        </div>
      ) : (
        <div className="space-y-6">
          {providers.length === 0 && models.length === 0 && !error && (
            <div className="rounded-xl border border-dashed border-[#27272a] bg-[#18181b] p-6 text-center">
              <Cpu className="mx-auto mb-3 h-8 w-8 text-[#71717a]" />
              <h3 className="text-[15px] font-medium text-[#fafafa]">还没有模型配置</h3>
              <p className="mt-1 text-[13px] text-[#71717a]">先添加供应商，再为每个模型配置对应 API Key。</p>
              <Button onClick={() => openProviderForm()} className="mt-4 h-9 border-0 bg-[#6366f1] text-white hover:bg-[#818cf8]">管理供应商</Button>
            </div>
          )}

          {providers.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[16px] font-medium text-[#fafafa]">供应商</h2>
                <span className="text-[12px] text-[#71717a]">{providers.length} 个</span>
              </div>
              <div className="flex flex-col gap-3 rounded-xl border border-[#27272a] bg-[#18181b] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-[15px] font-medium text-[#fafafa]">已配置 {providers.length} 个供应商</div>
                  <div className="mt-1 text-[12px] text-[#71717a]">
                    在供应商管理里选择具体供应商，修改 Base URL、API Key、测试连接或删除。
                  </div>
                </div>
                <Button onClick={() => openProviderForm()} variant="outline" className="h-8 w-full gap-1 border-[#27272a] text-[13px] text-[#fafafa] hover:bg-[#27272a] sm:w-auto">
                  <Pencil className="h-3.5 w-3.5" />
                  管理供应商
                </Button>
              </div>
            </section>
          )}

          {modelGroups.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[16px] font-medium text-[#fafafa]">模型配置</h2>
                <span className="text-[12px] text-[#71717a]">{modelGroups.length} 组 / {models.length} 个模型</span>
              </div>
              <div className="grid gap-3">
                {modelGroups.map((group) => {
                  const representative = representativeModelForGroup(group);
                  const provider = group.providerConfigId ? providerById.get(group.providerConfigId) : undefined;
                  const result = representative ? testResults[representative.id] : undefined;
                  const modalities = groupModalities(group);
                  return (
                    <div key={group.id} className="flex flex-col gap-4 rounded-xl border border-[#27272a] bg-[#18181b] p-4 transition-colors hover:border-[#6366f1]/30 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                      <div className="flex min-w-0 items-center gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-[#27272a] bg-[#1f1f23]">
                          {representative ? iconForModel(representative) : <Cpu className="h-5 w-5 text-[#60a5fa]" />}
                        </div>
                        <div className="min-w-0">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-[16px] font-medium text-[#fafafa]">{provider?.displayName ?? group.provider}</h3>
                            <Badge className="border border-[#22c55e]/20 bg-[#22c55e]/10 px-1.5 py-0 font-normal text-[#22c55e] hover:bg-[#22c55e]/20">已启用</Badge>
                            <Badge variant="secondary" className="border-0 bg-[#1f1f23] px-1.5 py-0 font-normal text-[#a1a1aa]">{group.models.length} 个模型</Badge>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#71717a] sm:gap-3">
                            <span>{modalities.map((item) => `${item.label}${item.count > 1 ? ` x${item.count}` : ""}`).join(" / ")}</span>
                            <span className="h-1 w-1 rounded-full bg-[#27272a]" />
                            <span className="break-all font-mono">Key: <span className="text-[#a1a1aa]">{displayModelGroupApiKey(group)}</span></span>
                            {group.costCredits > 0 && (
                              <>
                                <span className="h-1 w-1 rounded-full bg-[#27272a]" />
                                <span>{group.costCredits} 积分</span>
                              </>
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {group.models.map((model) => (
                              <Badge key={model.id} variant="secondary" className="border-0 bg-[#1f1f23] px-2 py-0.5 font-mono text-[11px] text-[#a1a1aa]">
                                {labelForModality(normalizeModelKindStrict(model.modality))}: {model.displayName || model.model}
                              </Badge>
                            ))}
                          </div>
                          {result && (
                            <div className={cn("mt-1 text-[12px]", result.ok ? "text-[#22c55e]" : "text-[#f87171]")}>
                              {result.message}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex w-full gap-2 sm:w-auto sm:shrink-0">
                        {representative && (
                          <Button onClick={() => testModel(representative.id)} disabled={testingModelId === representative.id} variant="outline" className="h-8 flex-1 border-[#27272a] text-[13px] text-[#fafafa] hover:bg-[#27272a] sm:flex-none">
                            {testingModelId === representative.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                            测试
                          </Button>
                        )}
                        <Button onClick={() => openModelForm(group)} variant="outline" className="h-8 flex-1 border-[#27272a] text-[13px] text-[#fafafa] hover:bg-[#27272a] sm:flex-none">编辑</Button>
                        {representative && (
                          <Button onClick={() => disableModel(representative.id)} variant="ghost" size="icon" className="h-8 w-10 text-[#71717a] hover:bg-[#ef4444]/10 hover:text-[#ef4444]">
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
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-t-2xl border border-[#27272a] bg-[#18181b] shadow-2xl sm:rounded-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-[#1f1f23] p-4 sm:p-5">
              <h2 className="text-[16px] font-medium text-[#fafafa]">
                {modalMode === "provider" ? (editingProvider ? "编辑供应商" : "添加供应商") : (editingModel || editingModelGroup ? "编辑模型" : "添加模型")}
              </h2>
              <button onClick={closeModal} className="rounded-md p-1 text-[#71717a] hover:bg-[#27272a] hover:text-[#fafafa]">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
              {modalMode === "provider" ? (
                <>
                  {providers.length > 0 && (
                    <div className="rounded-lg border border-[#27272a] bg-[#111113] p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="min-w-0 flex-1">
                          <label className="mb-1.5 block text-[14px] font-medium text-[#fafafa]">选择供应商</label>
                          <select
                            value={editingProvider?.id ?? "__new__"}
                            onChange={(event) => selectProviderForEdit(event.target.value)}
                            className="h-10 w-full rounded-md border border-[#27272a] bg-[#1f1f23] px-3 text-[14px] text-[#fafafa] outline-none focus:border-[#6366f1]"
                          >
                            {providers.map((provider) => (
                              <option key={provider.id} value={provider.id}>{provider.displayName}</option>
                            ))}
                            <option value="__new__">新建供应商</option>
                          </select>
                        </div>
                        <Button type="button" onClick={startNewProvider} variant="outline" className="h-10 border-[#27272a] text-[#fafafa] hover:bg-[#27272a]">
                          <Plus className="mr-1 h-4 w-4" />
                          新建
                        </Button>
                      </div>
                    </div>
                  )}

                  {editingProvider && (
                    <div className="rounded-lg border border-[#27272a] bg-[#111113] p-3 text-[12px] text-[#71717a]">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="border-0 bg-[#1f1f23] text-[#a1a1aa]">{providerModelCounts.get(editingProvider.id) ?? 0} 模型</Badge>
                      </div>
                      <div className="break-all">当前 Base URL: <span className="text-[#a1a1aa]">{editingProvider.baseUrl || "未设置"}</span></div>
                      {testResults[editingProvider.id] && (
                        <div className={cn("mt-1", testResults[editingProvider.id].ok ? "text-[#22c55e]" : "text-[#f87171]")}>
                          {testResults[editingProvider.id].message}
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="mb-1.5 block text-[14px] font-medium text-[#fafafa]">显示名称</label>
                    <Input value={providerForm.displayName} onChange={(e) => setProviderForm({ ...providerForm, displayName: e.target.value })} placeholder="OpenAI / Volcengine / 自定义供应商" className="h-10 border-[#27272a] bg-[#1f1f23] text-[14px]" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[14px] font-medium text-[#fafafa]">供应商类型</label>
                    <Input value={providerForm.providerType} onChange={(e) => setProviderForm({ ...providerForm, providerType: e.target.value })} placeholder="openai-compatible" className="h-10 border-[#27272a] bg-[#1f1f23] text-[14px]" />
                    {providerFormIsDreaminaWeb ? (
                      <p className="mt-1.5 text-[12px] leading-5 text-[#ddd6fe]">
                        Dreamina Web 使用服务器云浏览器登录态，不在这里配置 API Key 或 session。先保存供应商，再添加图片模型。
                      </p>
                    ) : providerFormIsJimengApi ? (
                      <p className="mt-1.5 text-[12px] leading-5 text-[#fde68a]">
                        Jimeng/Dreamina 视频接入请使用 providerType: jimeng-api。session 不填在供应商里，填到视频模型的 API Key。
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[14px] font-medium text-[#fafafa]">Base URL</label>
                    <Input value={providerForm.baseUrl} onChange={(e) => setProviderForm({ ...providerForm, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" className="h-10 border-[#27272a] bg-[#1f1f23] text-[14px]" />
                    {providerFormIsDreaminaWeb ? (
                      <p className="mt-1.5 text-[12px] leading-5 text-[#71717a]">
                        Base URL 留空。服务器会连接本机 Dreamina 云浏览器：/dreamina-browser/。
                      </p>
                    ) : providerFormIsJimengApi ? (
                      <p className="mt-1.5 text-[12px] leading-5 text-[#71717a]">
                        默认本机服务地址是 http://127.0.0.1:5100。需要先部署 iptag/jimeng-api 容器。
                      </p>
                    ) : null}
                  </div>
	                </>
              ) : (
                <>
                  <div>
                    <label className="mb-1.5 block text-[14px] font-medium text-[#fafafa]">供应商</label>
                    <select value={modelForm.providerConfigId} onChange={(e) => setModelForm({ ...modelForm, providerConfigId: e.target.value })} className="h-10 w-full rounded-md border border-[#27272a] bg-[#1f1f23] px-3 text-[14px] text-[#fafafa] outline-none focus:border-[#6366f1]">
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>{provider.displayName}</option>
                      ))}
                    </select>
                  </div>
                  {!modelFormUsesDreaminaWeb && (
                  <div>
                    <label className="mb-1.5 block text-[14px] font-medium text-[#fafafa]">{modelFormUsesJimengSession ? "Session ID" : "API Key"}</label>
                    <div className="flex rounded-md border border-[#27272a] bg-[#1f1f23] focus-within:border-[#6366f1]">
                      <Input
                        type={showModelApiKey || isMaskedModelApiKeyInput(modelForm.apiKey, currentModelApiKeyOwner(editingModel, editingModelGroup)) ? "text" : "password"}
                        value={visibleModelApiKeyValue(modelForm, currentModelApiKeyOwner(editingModel, editingModelGroup), showModelApiKey)}
                        onChange={(e) => setModelForm({ ...modelForm, apiKey: e.target.value })}
                        placeholder={modelFormUsesJimengSession ? "Dreamina/Jimeng sessionid，例如 us-xxx / hk-xxx / xxx" : editingModel?.hasApiKey ? "输入新 API Key 将替换当前 Key" : "输入这一批模型使用的 API Key"}
                        className="h-10 flex-1 border-0 bg-transparent font-mono text-[14px] shadow-none focus-visible:ring-0"
                      />
                      <button
                        type="button"
                        onClick={() => setShowModelApiKey((value) => !value)}
                        className="flex h-10 w-10 shrink-0 items-center justify-center text-[#71717a] hover:text-[#fafafa]"
                        aria-label={showModelApiKey ? "隐藏 API Key" : "显示 API Key"}
                      >
                        {showModelApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="mt-1.5 text-[12px] leading-5 text-[#71717a]">
                      {modelFormUsesJimengSession
                        ? "这里填写浏览器 Cookie 里的 sessionid；国际站按 jimeng-api 规则加 us-/hk-/jp-/sg- 前缀。测试只检查 session，不会生成视频。"
                        : "这一批模型共用这里的 Key；需要另一组 Key 时，再新建同供应商下的模型即可。"}
                    </p>
                  </div>
                  )}
                  {modelFormUsesDreaminaWeb && (
                    <div className="rounded-lg border border-[#a78bfa]/25 bg-[#a78bfa]/10 p-3 text-[12px] leading-5 text-[#ddd6fe]">
                      Dreamina Web 模型不需要 API Key。测试会连接服务器云浏览器并检查是否已登录；未登录时请打开 /dreamina-browser/ 手动登录。
                    </div>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block text-[14px] font-medium text-[#fafafa]">模型大类</label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {modelModalityOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => toggleModelModality(option.id)}
                            className={cn(
                              "flex items-start gap-2 rounded-lg border p-3 text-left transition-colors",
                              modelForm.modalities.includes(option.id)
                                ? "border-[#6366f1]/60 bg-[#6366f1]/10"
                                : "border-[#27272a] bg-[#1f1f23] hover:border-[#3f3f46]",
                            )}
                          >
                            <span className={cn(
                              "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                              modelForm.modalities.includes(option.id) ? "border-[#818cf8] bg-[#6366f1]" : "border-[#3f3f46]",
                            )}>
                              {modelForm.modalities.includes(option.id) ? <Check className="h-3 w-3 text-white" /> : null}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[13px] font-medium text-[#fafafa]">{option.label}</span>
                              <span className="mt-0.5 block text-[11px] leading-4 text-[#71717a]">{option.description}</span>
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
                              <div key={option.id} className="rounded-lg border border-[#27272a] bg-[#111113] p-3">
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                  <div>
                                    <div className="text-[13px] font-medium text-[#fafafa]">{option.label}模型</div>
                                    <div className="mt-1 text-[11px] leading-5 text-[#71717a]">
                                      能力：{inferredCapabilitiesForModality(option.id).join(" / ")}
                                    </div>
                                  </div>
                                  <Badge variant="secondary" className="w-fit border-0 bg-[#1f1f23] text-[#a1a1aa]">{entries.length} 个</Badge>
                                </div>
                                <div className="mt-3 rounded-md border border-[#27272a] bg-[#1f1f23] p-2 focus-within:border-[#6366f1]">
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
                                    className="h-8 border-0 bg-transparent px-1 text-[14px] shadow-none focus-visible:ring-0"
                                  />
                                </div>
                                <p className="mt-1.5 text-[12px] text-[#71717a]">只会保存为{option.label}模型，不会套用到其他大类。</p>
                                {entries.length > 0 && (
                                  <div className="mt-3 space-y-2">
                                    {entries.map((entry) => {
                                      const entryTestKey = modelFormEntryKey(modality, entry.id);
                                      const entryTestResult = modelFormTestResults[entryTestKey];
                                      const entryTesting = testingModelFormKey === entryTestKey;
                                      return (
                                      <div key={entry.id} className="rounded-lg border border-[#27272a] bg-[#18181b]">
                                        <button
                                          type="button"
                                          onClick={() => updateModelEntry(modality, entry.id, { expanded: !entry.expanded })}
                                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                                        >
                                          <div className="min-w-0">
                                            <div className="truncate font-mono text-[13px] text-[#fafafa]">{entry.model || "未命名模型"}</div>
                                            <div className="truncate text-[11px] text-[#71717a]">显示：{entry.displayName || entry.model || "默认同模型名称"}</div>
                                          </div>
                                          <div className="flex shrink-0 items-center gap-2">
                                            {(!editingModel || entries.length > 1 || modelForm.modalities.length > 1) && (
                                              <span
                                                role="button"
                                                tabIndex={0}
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  removeModelEntry(modality, entry.id);
                                                }}
                                                onKeyDown={(event) => {
                                                  if (event.key === "Enter" || event.key === " ") {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    removeModelEntry(modality, entry.id);
                                                  }
                                                }}
                                                className="rounded p-1 text-[#71717a] hover:bg-[#ef4444]/10 hover:text-[#ef4444]"
                                              >
                                                <X className="h-4 w-4" />
                                              </span>
                                            )}
                                            <ChevronDown className={cn("h-4 w-4 text-[#71717a] transition-transform", entry.expanded ? "rotate-180" : "")} />
                                          </div>
                                        </button>
                                        {entry.expanded && (
                                          <div className="border-t border-[#27272a] p-3">
                                            <div className="grid gap-3 sm:grid-cols-2">
                                              <div>
                                              <label className="mb-1.5 block text-[12px] font-medium text-[#d4d4d8]">模型名称</label>
                                              <Input value={entry.model} onChange={(e) => updateModelEntry(modality, entry.id, { model: e.target.value })} className="h-9 border-[#27272a] bg-[#1f1f23] font-mono text-[13px]" />
                                              </div>
                                              <div>
                                              <label className="mb-1.5 block text-[12px] font-medium text-[#d4d4d8]">显示名称</label>
                                              <Input value={entry.displayName} onChange={(e) => updateModelEntry(modality, entry.id, { displayName: e.target.value })} placeholder="可留空，默认使用模型名称" className="h-9 border-[#27272a] bg-[#1f1f23] text-[13px]" />
                                              </div>
                                            </div>
                                            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                              <div className="min-h-5 text-[12px]">
                                                {entryTestResult && (
                                                  <span className={entryTestResult.ok ? "text-[#22c55e]" : "text-[#f87171]"}>
                                                    {entryTestResult.message}
                                                  </span>
                                                )}
                                              </div>
                                              <Button
                                                type="button"
                                                onClick={() => testModelFormEntry(modality, entry)}
                                                disabled={saving || entryTesting || !modelForm.providerConfigId || !entry.model.trim()}
                                                variant="outline"
                                                className="h-8 w-full border-[#27272a] text-[13px] text-[#fafafa] hover:bg-[#27272a] sm:w-auto"
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
                      <label className="mb-1.5 block text-[14px] font-medium text-[#fafafa]">单次积分</label>
                      <Input value={modelForm.costCredits} onChange={(e) => setModelForm({ ...modelForm, costCredits: e.target.value })} inputMode="numeric" className="h-10 border-[#27272a] bg-[#1f1f23] text-[14px]" />
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="flex shrink-0 flex-col justify-end gap-3 border-t border-[#1f1f23] bg-[#18181b] p-4 sm:flex-row sm:p-5">
              {modalMode === "provider" && editingProvider && (
                <>
                  <Button
                    type="button"
                    onClick={() => testProvider(editingProvider.id)}
                    disabled={saving || testingProviderId === editingProvider.id}
                    variant="outline"
                    className="border-[#27272a] text-[#fafafa] hover:bg-[#27272a]"
                  >
                    {testingProviderId === editingProvider.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    测试
                  </Button>
                  <Button
                    type="button"
                    onClick={deleteProvider}
                    disabled={saving}
                    variant="outline"
                    className="border-[#ef4444]/40 text-[#f87171] hover:bg-[#ef4444]/10 hover:text-[#fecaca]"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    删除
                  </Button>
                </>
              )}
              <Button variant="outline" onClick={closeModal} className="border-[#27272a] text-[#fafafa] hover:bg-[#27272a]">取消</Button>
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
                className="border-0 bg-gradient-to-r from-[#6366f1] to-[#818cf8] text-white hover:opacity-90 disabled:opacity-50"
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

function BillingSettings() {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-[24px] font-semibold text-[#fafafa]">账单充值</h1>
        <p className="text-[#a1a1aa] mt-1 text-[14px]">管理你的积分余额和订阅计划</p>
      </div>

      <div className="grid gap-8">
        {/* Account Balance Card */}
        <div className="relative overflow-hidden rounded-xl border border-[#27272a] bg-[#18181b] p-4 sm:p-6">
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-[#6366f1]/10 to-transparent rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
          
          <div className="relative z-10 mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row">
            <div>
              <h3 className="text-[14px] font-medium text-[#a1a1aa] mb-2">当前账户余额</h3>
              <div className="flex items-end gap-2">
                <span className="text-[28px] font-bold leading-none text-[#f59e0b] sm:text-[32px]">💰 1,250</span>
                <span className="text-[14px] font-medium text-[#71717a] mb-1">积分</span>
              </div>
            </div>
            <Badge className="bg-gradient-to-r from-[#6366f1] to-[#818cf8] text-white border-0 py-1">Pro 套餐</Badge>
          </div>

          <div className="space-y-3 relative z-10">
            <div className="flex flex-col justify-between gap-1 text-[13px] sm:flex-row">
              <span className="text-[#a1a1aa]">本月已用 (每月 5,000 积分)</span>
              <span className="font-medium text-[#fafafa]">3,750 / 5,000</span>
            </div>
            <div className="h-2 w-full bg-[#1f1f23] rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-[#6366f1] to-[#818cf8] rounded-full transition-all duration-1000" style={{ width: '75%' }}></div>
            </div>
            <div className="flex flex-col justify-between gap-1 text-[12px] text-[#71717a] sm:flex-row sm:items-center">
              <span>预计 8 天后用完</span>
              <span>下次续费: 2024-02-15</span>
            </div>
          </div>
        </div>

        {/* Top up */}
        <div>
          <h3 className="text-[16px] font-medium text-[#fafafa] mb-4">充值积分包</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              { points: 500, price: 5, popular: false },
              { points: 2000, price: 18, popular: true },
              { points: 5000, price: 40, popular: false },
            ].map((pack, i) => (
              <div 
                key={i} 
                className={cn(
                  "relative rounded-xl border p-5 cursor-pointer transition-all flex flex-col items-center justify-center bg-[#18181b]",
                  pack.popular 
                    ? "border-transparent h-[120px] bg-gradient-to-b from-[#18181b] to-[#18181b] before:absolute before:inset-0 before:-z-10 before:p-[2px] before:rounded-xl before:bg-gradient-to-br before:from-[#6366f1] before:to-[#818cf8] shadow-[0_4px_24px_-8px_rgba(99,102,241,0.5)] z-10" 
                    : "border-[#27272a] h-[112px] hover:border-[#6366f1]/50 mt-1"
                )}
              >
                {pack.popular && (
                  <div className="absolute -top-3 bg-gradient-to-r from-[#6366f1] to-[#818cf8] text-white text-[11px] font-medium px-2.5 py-0.5 rounded-md flex items-center gap-1 shadow-sm">
                    <Zap className="h-3 w-3 fill-white/20" /> 最受欢迎
                  </div>
                )}
                <div className="font-bold text-[20px] text-[#fafafa] mb-1">{pack.points} 积分</div>
                <div className="text-[14px] text-[#a1a1aa]">¥{pack.price}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Payment Method */}
        <div>
          <h3 className="text-[16px] font-medium text-[#fafafa] mb-4">支付方式</h3>
          <div className="flex flex-wrap gap-3">
            {[
              { name: '支付宝', color: "text-[#1677ff]", border: "border-[#1677ff]", bg: "bg-[#1677ff]/10" },
              { name: '微信支付', color: "text-[#09b83e]", border: "border-[#27272a]", bg: "bg-[#18181b]" },
              { name: '银联', color: "text-[#ef4444]", border: "border-[#27272a]", bg: "bg-[#18181b]" }
            ].map((method, i) => (
              <button 
                key={i} 
                className={cn(
                  "flex items-center gap-2 px-5 py-2.5 rounded-lg border transition-colors text-[14px] font-medium",
                  method.border, method.bg, 
                  i !== 0 && "hover:border-[#6366f1]/50 text-[#a1a1aa] hover:text-[#fafafa]"
                )}
              >
                <div className={cn("w-4 h-4 rounded-sm flex items-center justify-center text-[10px] font-bold bg-current/10", method.color)}>
                  ¥
                </div>
                <span className={i === 0 ? "text-[#fafafa]" : ""}>{method.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* History */}
        <div className="pt-2">
          <h3 className="text-[16px] font-medium text-[#fafafa] mb-4">消费记录</h3>
          <div className="overflow-x-auto rounded-xl border border-[#27272a] bg-[#18181b]">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead className="bg-[#1f1f23] text-[#71717a] border-b border-[#27272a]">
                <tr>
                  <th className="px-5 py-3 font-medium">时间</th>
                  <th className="px-5 py-3 font-medium">类型</th>
                  <th className="px-5 py-3 font-medium">数量</th>
                  <th className="px-5 py-3 font-medium text-right">余额</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1f1f23]">
                {[
                  { time: "今天 14:32", type: "消耗 (生成图片)", amount: -5, balance: "1,250" },
                  { time: "今天 14:30", type: "消耗 (生成图片)", amount: -15, balance: "1,255" },
                  { time: "昨天 10:00", type: "充值 (微信支付)", amount: "+500", balance: "1,270", isAdd: true },
                ].map((row, i) => (
                  <tr key={i} className="hover:bg-[#1f1f23]/50 transition-colors">
                    <td className="px-5 py-3 text-[#a1a1aa]">{row.time}</td>
                    <td className="px-5 py-3 text-[#fafafa]">{row.type}</td>
                    <td className={`px-5 py-3 font-medium ${row.isAdd ? 'text-[#22c55e]' : 'text-[#fafafa]'}`}>
                      {row.amount}
                    </td>
                    <td className="px-5 py-3 text-right text-[#a1a1aa] font-mono">{row.balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { tab } = useParams<{ tab: string }>();

  const menuItems = [
    { id: "profile", icon: <User />, label: "个人信息", path: "/app/settings/profile" },
    { id: "team", icon: <Users />, label: "团队管理", path: "/app/settings/team" },
    { id: "presets", icon: <Palette />, label: "预设管理", path: "/app/settings/presets" },
    { id: "models", icon: <Cpu />, label: "模型配置", path: "/app/settings/models" },
    { id: "billing", icon: <CreditCard />, label: "账单充值", path: "/app/settings/billing" },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#09090b] text-[14px] md:flex-row">
      {/* Settings Sidebar */}
      <div className="flex w-full shrink-0 flex-col border-b border-[#1f1f23] bg-[#0f0f11] p-3 md:w-64 md:border-b-0 md:border-r md:p-4">
        <h2 className="mb-3 px-1 text-[18px] font-semibold text-[#fafafa] md:mb-6 md:px-2">设置</h2>
        <nav className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:gap-1 md:overflow-visible md:pb-0">
          {menuItems.map((item) => {
            const isActive = tab === item.id || (tab === undefined && item.id === "billing");
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "relative flex h-10 shrink-0 items-center gap-3 rounded-md px-3 py-2 text-[14px] font-medium transition-colors group",
                  isActive
                    ? "bg-[#1f1f23] text-[#fafafa]"
                    : "text-[#71717a] hover:text-[#a1a1aa] hover:bg-[#18181b]"
                )}
              >
                {isActive && (
                  <div className="absolute bottom-0 left-3 right-3 h-[3px] rounded-t-full bg-[#6366f1] md:left-0 md:right-auto md:top-1/2 md:h-[60%] md:w-[3px] md:-translate-y-1/2 md:rounded-r-full md:rounded-t-none" />
                )}
                {React.cloneElement(item.icon as React.ReactElement, { className: "h-4 w-4" })}
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Settings Content */}
      <div className="flex w-full min-w-0 flex-1 justify-center overflow-y-auto p-4 sm:p-6 lg:p-10">
        <div className="w-full max-w-[720px]">
          {tab === "profile" && <ProfileSettings />}
          {tab === "team" && <TeamSettings />}
          {tab === "presets" && <PresetsSettings />}
          {tab === "models" && <ModelsSettings />}
          {(tab === "billing" || !tab) && <BillingSettings />}
        </div>
      </div>
    </div>
  );
}
