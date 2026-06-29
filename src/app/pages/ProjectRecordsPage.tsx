import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import {
  Check,
  Copy,
  Download,
  Filter,
  Image as ImageIcon,
  LayoutDashboard,
  LayoutGrid,
  List,
  Maximize2,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Textarea } from "../components/ui/textarea";
import { apiClient, type GenerationRecord } from "../lib/apiClient";
import { useCanvasStore } from "../stores/useCanvasStore";

type RecordCategory = "全部" | "图片" | "视频" | "音频" | "文本";
type RecordStatus = "generating" | "failed" | "completed";

interface RecordItem {
  id: string;
  type: RecordCategory;
  status: RecordStatus;
  image?: string;
  model: string;
  provider?: string;
  cost: number;
  time: string;
  error?: string;
  progress?: number;
  prompt?: string;
  paramsLabel?: string;
  raw: GenerationRecord;
}

export function ProjectRecordsPage() {
  const [activeTab, setActiveTab] = useState<RecordCategory>("全部");
  const [searchQuery, setSearchQuery] = useState("");
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [addedToCanvas, setAddedToCanvas] = useState<Set<string>>(new Set());
  const { id: projectId } = useParams();
  const addNode = useCanvasStore((s) => s.addNode);

  const loadRecords = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.listGenerationRecords(projectId);
      setRecords(result.map(toRecordItem));
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成记录加载失败");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRecords();
  }, [projectId]);

  const filteredRecords = useMemo(() => records.filter((record) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesTab = activeTab === "全部" || record.type === activeTab;
    const matchesSearch = !query ||
      record.model.toLowerCase().includes(query) ||
      (record.provider ?? "").toLowerCase().includes(query) ||
      (record.prompt ?? "").toLowerCase().includes(query);
    return matchesTab && matchesSearch;
  }), [activeTab, records, searchQuery]);

  const handleDelete = async (id: string) => {
    if (!window.confirm("确定要删除这条记录吗？")) return;
    try {
      await apiClient.deleteGenerationRecord(id);
      setRecords((prev) => prev.filter((record) => record.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除生成记录失败");
    }
  };

  const handleRetry = async (id: string) => {
    try {
      await apiClient.retryGenerationRecord(id);
      await loadRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : "重试提交失败");
    }
  };

  const handleEditPrompt = (item: RecordItem) => {
    setEditingPrompt(item.id);
    setPromptDraft(item.prompt ?? "");
  };

  const handleSavePrompt = (id: string) => {
    setRecords((prev) => prev.map((record) => record.id === id ? { ...record, prompt: promptDraft } : record));
    setEditingPrompt(null);
  };

  const handleAddToCanvas = (item: RecordItem) => {
    const nodeCount = useCanvasStore.getState().nodes.length;
    const x = 350 + (nodeCount % 4) * 350;
    const y = 100 + Math.floor(nodeCount / 4) * 250;
    const imageAsset = extractRecordImageAsset(item.raw);
    const generationData = buildRecordGenerationNodeData(item, imageAsset);
    addNode("generation", { x, y }, generationData);
    setAddedToCanvas((prev) => new Set(prev).add(item.id));
  };

  const handleDownload = async (item: RecordItem) => {
    if (!item.image) return;
    const filename = `${safeFileName(item.model || item.id)}.png`;
    const url = new URL(item.image, window.location.origin).href;
    const clickDownload = (href: string, openInNewTab = false) => {
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = filename;
      anchor.rel = "noopener";
      if (openInNewTab) anchor.target = "_blank";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    };
    try {
      let blob: Blob;
      try {
        const response = await fetch(url, {
          credentials: new URL(url).origin === window.location.origin ? "same-origin" : "omit",
        });
        if (!response.ok) throw new Error("图片下载失败");
        blob = await response.blob();
        if (blob.size === 0) throw new Error("图片内容为空");
      } catch {
        blob = await apiClient.downloadImageBlob({ url, filename });
      }
      const objectUrl = URL.createObjectURL(blob);
      clickDownload(objectUrl);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      if (/^https?:\/\//i.test(url)) {
        clickDownload(url, true);
        setError("后端代理暂时无法下载源图，已打开原图；如果浏览器没有自动保存，请在新页面右键保存。");
        return;
      }
      setError(err instanceof Error ? err.message : "图片下载失败");
    }
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col overflow-y-auto p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:mb-8 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight sm:text-2xl">生成记录</h1>
          <div className="mt-1 text-[12px] text-zinc-500">显示当前项目真实生成记录、实际提示词、模型和生成结果。</div>
        </div>
        <div className="relative w-full sm:w-72 lg:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            className="bg-[#141416] pl-9"
            placeholder="搜索提示词..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex space-x-1 overflow-x-auto pb-1 sm:pb-0">
          {(["全部", "图片", "视频", "音频", "文本"] as RecordCategory[]).map((tab) => (
            <Badge
              key={tab}
              variant={activeTab === tab ? "default" : "secondary"}
              className="shrink-0 cursor-pointer rounded-md px-4 py-1.5 text-sm font-medium"
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </Badge>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-2 border-border bg-[#141416] text-zinc-300" onClick={() => void loadRecords()}>
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-2 border-border bg-[#141416] text-zinc-300">
            <Filter className="h-3.5 w-3.5" />
            筛选
          </Button>
          <div className="flex items-center gap-1 rounded-md border border-zinc-800 bg-[#141416] p-1">
            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-sm bg-layer-4 text-zinc-100"><LayoutGrid className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-sm text-zinc-400 hover:text-zinc-100"><List className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-zinc-800 bg-[#141416] p-8 text-center text-[13px] text-zinc-500">正在读取真实生成记录...</div>
      ) : filteredRecords.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-[#141416] p-8 text-center text-[13px] text-zinc-500">暂无生成记录。</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 min-[380px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filteredRecords.map((item) => (
            <RecordCard
              key={item.id}
              item={item}
              editingPrompt={editingPrompt}
              promptDraft={promptDraft}
              setPromptDraft={setPromptDraft}
              addedToCanvas={addedToCanvas.has(item.id)}
              onEditPrompt={handleEditPrompt}
              onSavePrompt={handleSavePrompt}
              onCancelEdit={() => setEditingPrompt(null)}
              onDelete={handleDelete}
              onRetry={handleRetry}
              onAddToCanvas={handleAddToCanvas}
              onDownload={handleDownload}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RecordCard({
  item,
  editingPrompt,
  promptDraft,
  setPromptDraft,
  addedToCanvas,
  onEditPrompt,
  onSavePrompt,
  onCancelEdit,
  onDelete,
  onRetry,
  onAddToCanvas,
  onDownload,
}: {
  item: RecordItem;
  editingPrompt: string | null;
  promptDraft: string;
  setPromptDraft: (value: string) => void;
  addedToCanvas: boolean;
  onEditPrompt: (item: RecordItem) => void;
  onSavePrompt: (id: string) => void;
  onCancelEdit: () => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onAddToCanvas: (item: RecordItem) => void;
  onDownload: (item: RecordItem) => void;
}) {
  if (item.status === "generating") {
    return (
      <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-[#141416]">
        <div className="flex aspect-square flex-col items-center justify-center bg-zinc-900/50 p-4">
          <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-layer-4">
            <div className="h-full animate-pulse bg-primary/90" style={{ width: `${item.progress ?? 35}%` }} />
          </div>
          <span className="text-center text-sm font-medium text-primary">正在生成... {item.progress ?? 35}%</span>
        </div>
        <RecordMeta item={item} />
      </div>
    );
  }

  if (item.status === "failed") {
    return (
      <div className="relative flex flex-col overflow-hidden rounded-xl border border-red-500/30 bg-[#141416]">
        <div className="flex aspect-square flex-col items-center justify-center bg-red-500/5 p-4">
          <div className="mb-1 font-medium text-red-400">&#10007; 生成失败</div>
          <div className="text-center text-xs text-zinc-500">{item.error || "未知错误"}</div>
        </div>
        <div className="border-t border-zinc-800 p-3 text-xs">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-zinc-300">{item.model}</span>
            <button className="text-primary hover:underline" onClick={() => void onRetry(item.id)}>重试 &rarr;</button>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>{item.cost} 积分</span>
            <span>{item.time}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-zinc-800 bg-[#141416] transition-colors hover:border-zinc-600">
      <div className="relative aspect-square overflow-hidden bg-zinc-900">
        {item.image ? (
          <img src={item.image} alt="Generated" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-zinc-500">
            <ImageIcon className="h-8 w-8" />
            <span className="text-[12px]">此记录没有图片资产</span>
          </div>
        )}

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
          {item.image && (
            <Button size="sm" variant="secondary" className="h-8 w-24 bg-layer-4/80 hover:bg-zinc-700" onClick={() => window.open(item.image, "_blank", "noopener,noreferrer")}>
              <Maximize2 className="mr-1.5 h-3.5 w-3.5" /> 放大
            </Button>
          )}
          <div className="flex gap-2">
            <Button size="icon" variant="secondary" className="h-8 w-8 bg-layer-4/80 hover:bg-zinc-700" title="作为生成图片节点放入画布" onClick={() => onAddToCanvas(item)}>
              <LayoutDashboard className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="secondary" className="h-8 w-8 bg-layer-4/80 hover:bg-zinc-700" title="编辑提示词" onClick={() => onEditPrompt(item)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="secondary" className="h-8 w-8 bg-layer-4/80 hover:bg-zinc-700" title="复制提示词" onClick={() => void navigator.clipboard?.writeText(item.prompt ?? "").catch(() => undefined)}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
            {item.image && (
              <Button size="icon" variant="secondary" className="h-8 w-8 bg-layer-4/80 hover:bg-zinc-700" title="下载" onClick={() => void onDownload(item)}>
                <Download className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button size="icon" variant="destructive" className="h-8 w-8 bg-red-500/80 hover:bg-red-500" onClick={() => void onDelete(item.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {addedToCanvas && (
          <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-green-500/90 px-2 py-0.5 text-[11px] font-medium text-white">
            <Check className="h-3 w-3" /> 已放入画布
          </div>
        )}
      </div>

      {editingPrompt === item.id ? (
        <div className="space-y-2 border-t border-zinc-800 bg-[#141416] p-3">
          <Textarea
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            className="h-32 max-h-40 resize-none overflow-y-auto border-border bg-layer-4 text-xs leading-5 focus-visible:ring-primary"
            placeholder="输入提示词..."
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-7 text-xs text-zinc-400" onClick={onCancelEdit}>
              <X className="mr-1 h-3 w-3" /> 取消
            </Button>
            <Button size="sm" className="h-7 bg-primary text-xs text-white hover:bg-primary/90" onClick={() => onSavePrompt(item.id)}>
              <Check className="mr-1 h-3 w-3" /> 保存
            </Button>
          </div>
        </div>
      ) : (
        <RecordMeta item={item} onEditPrompt={onEditPrompt} />
      )}
    </div>
  );
}

function RecordMeta({ item, onEditPrompt }: { item: RecordItem; onEditPrompt?: (item: RecordItem) => void }) {
  return (
    <div className="relative z-10 border-t border-zinc-800 bg-[#141416] p-3 text-xs">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1 truncate font-medium text-green-500">&#10003; {item.model}</span>
        <span className="shrink-0 text-[10px] text-zinc-500">{item.type}</span>
      </div>
      {item.provider && <div className="mb-1 truncate text-[10px] text-zinc-600">{item.provider}</div>}
      {item.paramsLabel && <div className="mb-1 truncate text-[10px] text-zinc-500">{item.paramsLabel}</div>}
      {item.prompt && (
        <div
          className="mb-2 max-h-28 cursor-pointer overflow-y-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-[#101014] px-2 py-1.5 text-[11px] leading-4 text-zinc-500 transition-colors hover:border-border hover:text-zinc-300"
          onClick={() => onEditPrompt?.(item)}
          title="点击编辑提示词"
        >
          {item.prompt}
        </div>
      )}
      <div className="flex justify-between text-zinc-500">
        <span>{item.cost} 积分</span>
        <span>{item.time}</span>
      </div>
    </div>
  );
}

function toRecordItem(record: GenerationRecord): RecordItem {
  const type = inferRecordCategory(record);
  const status = normalizeRecordStatus(record.status);
  const model = record.aiModel?.displayName || record.aiModel?.model || readModelSnapshot(record.input).displayName || readModelSnapshot(record.input).model || "未知模型";
  const provider = record.aiModel?.providerConfig?.displayName || record.aiModel?.provider || readModelSnapshot(record.input).provider;
  return {
    id: record.id,
    type,
    status,
    image: extractRecordImage(record),
    model,
    provider,
    cost: record.creditCost ?? record.aiModel?.costCredits ?? 0,
    time: relativeTime(record.completedAt || record.updatedAt || record.createdAt),
    error: record.errorMessage,
    progress: status === "generating" ? (record.status === "RUNNING" ? 55 : 20) : undefined,
    prompt: record.prompt,
    paramsLabel: buildParamsLabel(record),
    raw: record,
  };
}

function normalizeRecordStatus(status: string): RecordStatus {
  const upper = status.toUpperCase();
  if (upper === "SUCCEEDED") return "completed";
  if (upper === "FAILED" || upper === "CANCELED") return "failed";
  return "generating";
}

function inferRecordCategory(record: GenerationRecord): RecordCategory {
  const modality = (record.aiModel?.modality || readModelSnapshot(record.input).modality || "").toLowerCase();
  if (modality.includes("video")) return "视频";
  if (modality.includes("audio") || modality.includes("voice") || modality.includes("tts")) return "音频";
  if (modality.includes("text") || modality.includes("chat") || modality.includes("llm")) return "文本";
  if (modality.includes("image")) return "图片";
  const asset = record.assets.find((item) => item.url || item.mimeType);
  if (asset?.mimeType?.startsWith("video/")) return "视频";
  if (asset?.mimeType?.startsWith("audio/")) return "音频";
  return "图片";
}

function extractRecordImage(record: GenerationRecord): string | undefined {
  return extractRecordImageAsset(record)?.url;
}

function extractRecordImageAsset(record: GenerationRecord) {
  return record.assets.find((asset) => {
    const type = (asset.type || "").toUpperCase();
    const mime = asset.mimeType || "";
    return Boolean(asset.url) && (type === "IMAGE" || mime.startsWith("image/") || /^data:image\//i.test(asset.url || ""));
  });
}

function buildParamsLabel(record: GenerationRecord): string {
  const input = isRecord(record.input) ? record.input : {};
  const params = isRecord(record.parameters) ? record.parameters : {};
  const nestedParams = isRecord(input.parameters) ? input.parameters : {};
  const items = [
    stringValue(input.assetKind),
    stringValue(input.assetName),
    stringValue(input.size),
    stringValue(params.resolution) || stringValue(nestedParams.resolution),
    stringValue(params.quality) || stringValue(nestedParams.quality),
  ].filter(Boolean);
  return items.join(" · ");
}

function readModelSnapshot(input: unknown): { displayName?: string; model?: string; provider?: string; modality?: string } {
  if (!isRecord(input) || !isRecord(input.modelSnapshot)) return {};
  return {
    displayName: stringValue(input.modelSnapshot.displayName),
    model: stringValue(input.modelSnapshot.model),
    provider: stringValue(input.modelSnapshot.provider),
    modality: stringValue(input.modelSnapshot.modality),
  };
}

function buildRecordGenerationNodeData(item: RecordItem, imageAsset?: GenerationRecord["assets"][number]): Record<string, unknown> {
  const input = isRecord(item.raw.input) ? item.raw.input : {};
  const params = isRecord(item.raw.parameters) ? item.raw.parameters : {};
  const nestedParams = isRecord(input.parameters) ? input.parameters : {};
  const metadata = isRecord(imageAsset?.metadata) ? imageAsset.metadata : {};
  const metadataAssetKind = normalizeRecordAssetKind(metadata.workflowAssetKind) || normalizeRecordAssetKind(metadata.assetKind);
  const inputAssetKind = normalizeRecordAssetKind(input.assetKind);
  const isStandaloneCanvasImage = stringValue(metadata.source) === "canvas-image-generation" && !metadataAssetKind && !inputAssetKind;
  const prompt = item.prompt ?? "";
  const assetName =
    (isStandaloneCanvasImage ? "" : stringValue(input.assetName) || stringValue(metadata.assetName)) ||
    imageAsset?.title ||
    item.model ||
    "生成记录";
  const assetKind = inputAssetKind || metadataAssetKind || "scenes";
  const revisedPrompt = stringValue(metadata.revisedPrompt);
  const size = normalizeRecordImageSize(
    stringValue(input.size) ||
    stringValue(params.size) ||
    stringValue(nestedParams.size) ||
    stringValue(metadata.size),
  );
  const resolution = normalizeRecordResolution(
    stringValue(params.resolution) ||
    stringValue(nestedParams.resolution) ||
    stringValue(metadata.resolution),
  );
  const quality =
    stringValue(params.quality) ||
    stringValue(nestedParams.quality) ||
    stringValue(metadata.quality) ||
    "high";

  return {
    title: assetName,
    ...(isStandaloneCanvasImage ? { mode: "standalone" } : { assetKind, assetName }),
    prompt,
    finalPrompt: prompt,
    visualPrompt: prompt,
    description: prompt,
    status: item.image && item.status === "completed" ? "completed" : "waiting",
    outputImage: item.image || "",
    outputImageAssetId: imageAsset?.id || "",
    generationId: item.id,
    revisedPrompt,
    modelId: item.raw.aiModelId || "",
    modelLabel: item.model,
    size,
    resolution,
    quality,
    format: "png",
  };
}

function normalizeRecordAssetKind(value: unknown): "characters" | "scenes" | "props" | null {
  return value === "characters" || value === "scenes" || value === "props" ? value : null;
}

function normalizeRecordImageSize(value: string): string {
  const ratioOptions = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "2:1", "1:2", "21:9", "9:21", "3:1", "1:3"];
  if (ratioOptions.includes(value)) return value;
  const pixelMatch = value.match(/^(\d{2,5})x(\d{2,5})$/i);
  if (pixelMatch) {
    const width = Number(pixelMatch[1]);
    const height = Number(pixelMatch[2]);
    if (width > 0 && height > 0) {
      const ratio = width / height;
      return ratioOptions.reduce((best, option) => {
        const [optionWidth, optionHeight] = option.split(":").map((part) => Number(part));
        const [bestWidth, bestHeight] = best.split(":").map((part) => Number(part));
        const optionDiff = Math.abs(optionWidth / optionHeight - ratio);
        const bestDiff = Math.abs(bestWidth / bestHeight - ratio);
        return optionDiff < bestDiff ? option : best;
      }, "1:1");
    }
  }
  return "1:1";
}

function normalizeRecordResolution(value: string): string {
  const normalized = value.toLowerCase();
  return ["1k", "2k", "4k"].includes(normalized) ? normalized : "1k";
}

function relativeTime(value?: string): string {
  if (!value) return "";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  const diff = Date.now() - time;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  return new Date(time).toLocaleDateString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "image";
}
