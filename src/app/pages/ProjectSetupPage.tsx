import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Check, ChevronRight, UploadCloud, Plus } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import { cn } from "../utils/cn";
import { useProjectStore } from "../stores/useProjectStore";

const STYLE_TABS = ["全部", "动漫", "写实", "漫画", "3D"] as const;

const PRESETS = [
  { name: "赛博朋克", category: "动漫", cover: "https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?w=400&q=80" },
  { name: "吉卜力风", category: "动漫", cover: "https://images.unsplash.com/photo-1578305716160-5f25a77ccbe7?w=400&q=80" },
  { name: "美漫风格", category: "漫画", cover: "https://images.unsplash.com/photo-1618331835717-801e976710b2?w=400&q=80" },
  { name: "水墨国风", category: "漫画", cover: "https://images.unsplash.com/photo-1541961017774-22349e4a1262?w=400&q=80" },
  { name: "写实电影", category: "写实", cover: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&q=80" },
  { name: "日系动画", category: "动漫", cover: "https://images.unsplash.com/photo-1580477651817-21a48c668615?w=400&q=80" },
  { name: "欧美卡通", category: "动漫", cover: "https://images.unsplash.com/photo-1634824888825-9c8646b14f85?w=400&q=80" },
  { name: "像素风", category: "3D", cover: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=400&q=80" },
  { name: "油画风", category: "写实", cover: "https://images.unsplash.com/photo-1578926288410-b4bd6982eb4b?w=400&q=80" },
  { name: "扁平插画", category: "漫画", cover: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80" },
  { name: "3D 渲染", category: "3D", cover: "https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=400&q=80" },
  { name: "水彩风", category: "写实", cover: "https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&q=80" },
];

const GENERATION_STRATEGIES = [
  { id: "seedance-multi-ref", title: "Seedance 多参", desc: "角色/场景/导演板多参考" },
  { id: "chapter-board", title: "章节导演板", desc: "默认推荐，先用导演板统一空间与连续性" },
  { id: "first-frame", title: "首帧衔接", desc: "暂未开发，请先使用 Seedance 多参或章节导演板", disabled: true },
];

const SCRIPT_RULE_TEMPLATES = [
  { id: "continuity", title: "人物与气质一致性", hint: "Keep character appearance, personality, carried items, wardrobe state, and performance state continuous across shots and clips." },
  { id: "world", title: "叙事与世界观", hint: "Respect the story world, era, location, technology level, and physical rules established by the source text and assets." },
  { id: "camera", title: "镜头与节奏", hint: "Use fast short-drama pacing with clear camera changes, visible actions, readable dialogue timing, and 1-3 second shots unless the story requires otherwise." },
  { id: "safety", title: "边界与禁用元素", hint: "Avoid watermarks, random text, low quality output, identity drift, and visual details that conflict with locked assets." },
];

const DEFAULT_GLOBAL_PROMPT = "masterpiece, best quality, highly detailed, cinematic lighting, consistent character design";
const DEFAULT_NEGATIVE_PROMPT = "No text, no watermarks, low quality, bad anatomy";
const DEFAULT_COVER = "https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=800&auto=format&fit=crop";

const defaultScriptRules = () => Object.fromEntries(SCRIPT_RULE_TEMPLATES.map((item) => [item.id, item.hint]));

function firstLineAfterLabel(value: string | undefined, label: string): string | undefined {
  if (!value) return undefined;
  const line = value.split("\n").find((item) => item.trim().startsWith(label));
  return line?.slice(label.length).trim() || undefined;
}

function generationStrategyFromPrompt(value: string | undefined): string | undefined {
  const stored = firstLineAfterLabel(value, "Default generation strategy:");
  if (!stored) return undefined;
  return GENERATION_STRATEGIES.find((item) => item.id === stored || item.title === stored)?.id;
}

function scriptRulesFromPrompt(value: string | undefined): Record<string, string> {
  if (!value) return {};
  const rules: Record<string, string> = {};
  for (const template of SCRIPT_RULE_TEMPLATES) {
    const line = value.split("\n").find((item) => item.trim().startsWith(`- ${template.title}:`));
    const content = line?.slice(`- ${template.title}:`.length).trim();
    if (content) rules[template.id] = content;
  }
  return rules;
}

export function ProjectSetupPage() {
  const [step, setStep] = useState(1);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [selectedRatio, setSelectedRatio] = useState("16:9");
  const [selectedStyle, setSelectedStyle] = useState("赛博朋克");
  const [activeStyleTab, setActiveStyleTab] = useState<(typeof STYLE_TABS)[number]>("动漫");
  const [customStyleName, setCustomStyleName] = useState("");
  const [customStylePrompt, setCustomStylePrompt] = useState("");
  const [generationStrategy, setGenerationStrategy] = useState("chapter-board");
  const [projectTone, setProjectTone] = useState("");
  const [directorNotes, setDirectorNotes] = useState("");
  const [characterIdentityRules, setCharacterIdentityRules] = useState("");
  const [scriptRules, setScriptRules] = useState<Record<string, string>>(defaultScriptRules);
  const [globalPrompt, setGlobalPrompt] = useState(DEFAULT_GLOBAL_PROMPT);
  const [negativePrompt, setNegativePrompt] = useState(DEFAULT_NEGATIVE_PROMPT);
  const [nameError, setNameError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [hydratedProjectId, setHydratedProjectId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const addProject = useProjectStore((s) => s.addProject);
  const updateProject = useProjectStore((s) => s.updateProject);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const projects = useProjectStore((s) => s.projects);
  const isEditMode = Boolean(id && id !== "new");
  const currentProject = useMemo(() => (isEditMode ? projects.find((project) => project.id === id) : undefined), [id, isEditMode, projects]);
  const filteredPresets = activeStyleTab === "全部" ? PRESETS : PRESETS.filter((style) => style.category === activeStyleTab);
  const finalStyle = selectedStyle === "自定义" ? (customStyleName.trim() || "自定义风格") : selectedStyle;

  useEffect(() => {
    let cancelled = false;
    if (isEditMode) {
      setIsLoadingProject(true);
      setLoadError(null);
      setHydratedProjectId(null);
      void loadProjects()
        .catch((error) => {
          if (!cancelled) setLoadError(error instanceof Error ? error.message : "项目设定加载失败");
        })
        .finally(() => {
          if (!cancelled) setIsLoadingProject(false);
        });
    } else {
      setIsLoadingProject(false);
      setLoadError(null);
      setHydratedProjectId(null);
    }
    return () => {
      cancelled = true;
    };
  }, [id, isEditMode, loadProjects]);

  useEffect(() => {
    if (!isEditMode) {
      setHydratedProjectId(null);
      return;
    }

    if (isLoadingProject || !currentProject || hydratedProjectId === currentProject.id) return;

    const settings = currentProject.setupSettings ?? {};
    const presetStyle = PRESETS.some((preset) => preset.name === currentProject.style);
    const storedGlobalPrompt =
      settings.globalPrompt ??
      firstLineAfterLabel(currentProject.globalPrompt, "Global prompt:") ??
      currentProject.globalPrompt ??
      DEFAULT_GLOBAL_PROMPT;

    setProjectName(currentProject.title);
    setProjectDescription(currentProject.description ?? "");
    setCoverPreview(currentProject.cover ?? null);
    setSelectedRatio(currentProject.ratio || "16:9");
    setSelectedStyle(presetStyle ? currentProject.style : "自定义");
    setCustomStyleName(settings.customStyleName ?? (presetStyle ? "" : currentProject.style));
    setCustomStylePrompt(settings.customStylePrompt ?? firstLineAfterLabel(currentProject.globalPrompt, "Custom style notes:"));
    setGenerationStrategy(settings.generationStrategy ?? generationStrategyFromPrompt(currentProject.globalPrompt) ?? "chapter-board");
    setProjectTone(settings.projectTone ?? firstLineAfterLabel(currentProject.globalPrompt, "Project tone:"));
    setDirectorNotes(settings.directorNotes ?? firstLineAfterLabel(currentProject.globalPrompt, "Director guidance:"));
    setCharacterIdentityRules(settings.characterIdentityRules ?? firstLineAfterLabel(currentProject.globalPrompt, "Character identity rules:") ?? "");
    setGlobalPrompt(storedGlobalPrompt || DEFAULT_GLOBAL_PROMPT);
    setNegativePrompt(currentProject.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT);
    setScriptRules({ ...defaultScriptRules(), ...scriptRulesFromPrompt(currentProject.globalPrompt), ...(settings.scriptRules ?? {}) });
    setHydratedProjectId(currentProject.id);
  }, [currentProject, hydratedProjectId, isEditMode, isLoadingProject]);

  const buildGlobalPrompt = () => {
    return [
      `Base style: ${finalStyle}`,
      customStylePrompt.trim() ? `Custom style notes: ${customStylePrompt.trim()}` : "",
      `Default generation strategy: ${GENERATION_STRATEGIES.find((item) => item.id === generationStrategy)?.title ?? generationStrategy}`,
      projectTone.trim() ? `Project tone: ${projectTone.trim()}` : "",
      directorNotes.trim() ? `Director guidance: ${directorNotes.trim()}` : "",
      characterIdentityRules.trim() ? `Character identity rules: ${characterIdentityRules.trim()}` : "",
      globalPrompt.trim() ? `Global prompt: ${globalPrompt.trim()}` : "",
      "Script rules:",
      ...SCRIPT_RULE_TEMPLATES.map((item) => `- ${item.title}: ${scriptRules[item.id]?.trim() || item.hint}`),
    ].filter(Boolean).join("\n");
  };

  const buildProjectPayload = () => ({
    title: projectName.trim(),
    ratio: selectedRatio,
    style: finalStyle,
    cover: coverPreview || DEFAULT_COVER,
    description: projectDescription,
    globalPrompt: buildGlobalPrompt(),
    negativePrompt,
    setupSettings: {
      customStyleName: customStyleName.trim(),
      customStylePrompt: customStylePrompt.trim(),
      generationStrategy,
      projectTone,
      directorNotes,
      characterIdentityRules,
      globalPrompt,
      scriptRules,
    },
    scenes: currentProject?.scenes ?? 0,
    completedScenes: currentProject?.completedScenes ?? 0,
  });

  const handleNext = async () => {
    if (step === 1) {
      if (!projectName.trim()) {
        setNameError(true);
        return;
      }
      setNameError(false);
    }
    setSaveError(null);
    if (step < 4) {
      setStep(step + 1);
    } else {
      setIsSaving(true);
      const payload = buildProjectPayload();
      try {
        if (isEditMode && id) {
          const updated = await updateProject(id, payload);
          if (!updated) throw new Error("项目保存失败，请确认项目仍然存在后重试");
          navigate(`/app/project/${updated.id}/canvas`);
        } else {
          const newId = await addProject(payload);
          navigate(`/app/project/${newId}/canvas`);
        }
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "项目保存失败，请稍后重试");
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCoverPreview(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const contentMaxWidth = step === 4 ? "max-w-[980px]" : "max-w-[640px]";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-[14px]">
      {isEditMode && isLoadingProject && (
        <div className="border-b border-[#1f1f23] bg-card px-4 py-2 text-center text-[12px] text-muted-foreground">
          正在从后端加载项目全局设定...
        </div>
      )}
      <div className="flex flex-1 flex-col items-center overflow-y-auto px-4 pb-28 pt-4 sm:px-6 sm:pb-32 sm:pt-8">
        {/* Stepper */}
        <div className={cn("mb-8 w-full sm:mb-10", contentMaxWidth)}>
          <div className="flex items-center justify-between relative">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 h-px w-full bg-layer-4 -z-10" />
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 h-px bg-primary -z-10 transition-all duration-500"
              style={{ width: `${((step - 1) / 3) * 100}%` }}
            />

            {["基本信息", "画面比例", "风格预设", "导演指导"].map((label, i) => {
              const num = i + 1;
              const isCompleted = step > num;
              const isActive = step === num;
              const canClick = isEditMode || isCompleted || isActive;

              return (
                <div
                  key={num}
                  className={cn("flex min-w-0 flex-1 flex-col items-center gap-2", canClick ? "cursor-pointer" : "cursor-not-allowed opacity-70")}
                  onClick={() => canClick && setStep(num)}
                >
                  <button
                    className={cn(
                      "h-7 w-7 rounded-full flex items-center justify-center text-xs font-medium border transition-colors",
                      isCompleted
                        ? "bg-primary border-primary text-white"
                        : isActive
                          ? "bg-layer-4 border-primary text-primary"
                          : "bg-background border-border text-[#71717a]"
                    )}
                  >
                    {isCompleted ? <Check className="h-3 w-3" /> : num}
                  </button>
                  <span className={cn("max-w-[72px] truncate text-[11px] font-medium min-[420px]:max-w-none min-[420px]:text-[12px]", isActive ? "text-foreground" : "text-[#71717a]")}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Content Area */}
        <div className={cn("flex w-full flex-col", contentMaxWidth, step === 4 ? "justify-start" : "justify-center sm:min-h-[400px]")}>
          {loadError && (
            <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
              {loadError}
            </div>
          )}
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
              <div className="mb-6 text-center sm:mb-8">
                <h2 className="mb-2 text-[22px] font-semibold text-foreground sm:text-[24px]">给项目起个名字</h2>
                <p className="text-muted-foreground">好的开始是成功的一半</p>
              </div>
              <div className="space-y-5">
                <div>
                  <label className="block text-[14px] font-medium text-foreground mb-1.5">项目名称 <span className="text-[#ef4444]">*</span></label>
                  <Input
                    placeholder="例如：赛博朋克 2077 第一季"
                    className={cn("h-10 text-[14px] bg-layer-4 border-border focus-visible:ring-primary", nameError && "border-[#ef4444] focus-visible:ring-[#ef4444]")}
                    value={projectName}
                    onChange={(e) => { setProjectName(e.target.value); setNameError(false); }}
                  />
                  {nameError && <p className="text-[12px] text-[#ef4444] mt-1">项目名称不能为空</p>}
                </div>
                <div>
                  <label className="block text-[14px] font-medium text-foreground mb-1.5">项目描述 <span className="text-[#71717a] font-normal">(选填)</span></label>
                  <Textarea
                    placeholder="一句话描述这个项目的故事背景..."
                    className="h-20 resize-none bg-layer-4 border-border focus-visible:ring-primary"
                    value={projectDescription}
                    onChange={(e) => setProjectDescription(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[14px] font-medium text-foreground mb-1.5">项目封面 <span className="text-[#71717a] font-normal">(选填)</span></label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <div
                    className="border-2 border-dashed border-border rounded-xl p-6 flex flex-col items-center justify-center text-[#71717a] hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer bg-card overflow-hidden"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {coverPreview ? (
                      <img src={coverPreview} alt="Cover preview" className="w-full h-32 object-cover rounded-lg" />
                    ) : (
                      <>
                        <UploadCloud className="h-8 w-8 mb-2 text-muted-foreground" />
                        <p className="font-medium text-foreground mb-1">点击或拖拽上传封面图</p>
                        <p className="text-[12px]">支持 JPG, PNG, WEBP，最大 5MB</p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
              <div className="mb-6 text-center sm:mb-8">
                <h2 className="mb-2 text-[22px] font-semibold text-foreground sm:text-[24px]">选择画面比例</h2>
                <p className="text-muted-foreground">设定全局的默认输出尺寸</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4 lg:gap-6">
                {[
                  { ratio: "16:9", label: "横屏", desc: "视频 / 电影", boxW: 72, boxH: 40 },
                  { ratio: "1:1", label: "方形", desc: "社交媒体", boxW: 56, boxH: 56 },
                  { ratio: "9:16", label: "竖屏", desc: "短视频", boxW: 40, boxH: 72 },
                ].map((item, i) => {
                  const isActive = selectedRatio === item.ratio;
                  return (
                    <div
                      key={i}
                      onClick={() => setSelectedRatio(item.ratio)}
                      className={cn(
                        "relative flex h-[148px] w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 p-4 transition-all sm:h-[200px]",
                        isActive
                          ? "border-primary bg-primary/10 text-primary scale-[1.02] shadow-[0_0_0_2px_rgba(245,166,35,0.2)]"
                          : "border-border bg-card text-[#71717a] hover:border-primary/50 hover:bg-accent"
                      )}
                    >
                      {isActive && (
                        <div className="absolute top-3 right-3 h-5 w-5 bg-primary rounded-full flex items-center justify-center text-white">
                          <Check className="h-3 w-3" />
                        </div>
                      )}
                      <div className="mb-2 flex h-14 items-center justify-center sm:h-20">
                        <div 
                          className="bg-primary/30 border border-primary rounded-sm transition-all"
                          style={{ width: item.boxW, height: item.boxH }}
                        />
                      </div>
                      <div className="mb-1 text-lg font-bold text-foreground">{item.ratio}</div>
                      <div className="text-[14px] font-medium mb-0.5">{item.label}</div>
                      <div className="text-[12px] opacity-70">{item.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
              <div className="mb-6 text-center sm:mb-8">
                <h2 className="mb-2 text-[22px] font-semibold text-foreground sm:text-[24px]">风格预设</h2>
                <p className="text-muted-foreground">选择一个基础的艺术风格</p>
              </div>
              
              <div className="flex space-x-2 mb-6 overflow-x-auto pb-2">
                {STYLE_TABS.map((tab) => (
                  <Badge
                    key={tab}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveStyleTab(tab)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") setActiveStyleTab(tab);
                    }}
                    variant={activeStyleTab === tab ? "default" : "secondary"}
                    className={cn(
                      "px-3 py-1 cursor-pointer rounded-md font-normal text-[12px]",
                      activeStyleTab === tab ? "bg-primary hover:bg-primary" : "bg-layer-4 text-muted-foreground hover:bg-accent border-0"
                    )}
                  >
                    {tab}
                  </Badge>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 min-[420px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 lg:gap-4">
                {filteredPresets.map((style, i) => {
                  const isActive = selectedStyle === style.name;
                  return (
                    <div 
                      key={i} 
                      onClick={() => setSelectedStyle(style.name)}
                      className={cn(
                        "group relative rounded-xl border-2 overflow-hidden cursor-pointer transition-all",
                        isActive ? "border-primary shadow-[0_0_0_2px_rgba(245,166,35,0.2)] scale-[1.02]" : "border-border hover:border-primary/50"
                      )}
                    >
                      <div className="aspect-square bg-background relative">
                        <img src={style.cover} alt={style.name} className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
                        {isActive && (
                          <div className="absolute top-2 right-2 h-5 w-5 bg-primary rounded-full flex items-center justify-center text-white shadow-md">
                            <Check className="h-3 w-3" />
                          </div>
                        )}
                      </div>
                      <div className={cn("p-1.5 text-center text-[12px] font-medium bg-card", isActive ? "text-foreground" : "text-muted-foreground")}>
                        {style.name}
                      </div>
                    </div>
                  );
                })}
                {/* Custom Add Button */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedStyle("自定义")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setSelectedStyle("自定义");
                  }}
                  className={cn(
                    "group relative rounded-xl border-2 border-dashed overflow-hidden cursor-pointer transition-all bg-card hover:border-primary/50 hover:bg-primary/5 flex flex-col",
                    selectedStyle === "自定义" ? "border-primary bg-primary/10 shadow-[0_0_0_2px_rgba(245,166,35,0.2)]" : "border-border"
                  )}
                >
                  <div className="aspect-square flex items-center justify-center relative">
                    <Plus className="h-6 w-6 text-[#71717a] group-hover:text-primary" />
                    {selectedStyle === "自定义" && (
                      <div className="absolute top-2 right-2 h-5 w-5 bg-primary rounded-full flex items-center justify-center text-white shadow-md">
                        <Check className="h-3 w-3" />
                      </div>
                    )}
                  </div>
                  <div className={cn("p-1.5 text-center text-[12px] font-medium bg-card border-t border-border", selectedStyle === "自定义" ? "text-foreground" : "text-[#71717a]")}>
                    + 自定义
                  </div>
                </div>
              </div>
              {selectedStyle === "自定义" && (
                <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-foreground">自定义风格名称</label>
                    <Input
                      value={customStyleName}
                      onChange={(event) => setCustomStyleName(event.target.value)}
                      placeholder="例如：拟人水果美剧"
                      className="h-10 border-border bg-layer-4 text-[14px]"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[13px] font-medium text-foreground">风格关键词</label>
                    <Input
                      value={customStylePrompt}
                      onChange={(event) => setCustomStylePrompt(event.target.value)}
                      placeholder="例如：黑色幽默、3D 美式动画、夸张表演"
                      className="h-10 border-border bg-layer-4 text-[14px]"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
              <div className="mb-6 text-center sm:mb-8">
                <h2 className="mb-2 text-[22px] font-semibold text-foreground sm:text-[24px]">导演指导</h2>
                <p className="text-muted-foreground">设定全局生成策略、调性和剧本规则</p>
              </div>
              <div className="space-y-5">
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-[14px] font-medium text-foreground">默认生成策略</div>
                      <div className="mt-1 text-[12px] text-[#71717a]">后续分镜图、导演板、视频生成会优先使用该策略</div>
                    </div>
                    <Badge className="w-fit border border-primary/30 bg-primary/10 text-primary hover:bg-primary/10">{selectedRatio}</Badge>
                  </div>
                  <div className="grid gap-2 md:grid-cols-4">
                    {GENERATION_STRATEGIES.map((strategy) => {
                      const active = generationStrategy === strategy.id;
                      const disabled = Boolean(strategy.disabled);
                      return (
                        <button
                          key={strategy.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => {
                            if (!disabled) setGenerationStrategy(strategy.id);
                          }}
                          className={cn(
                            "min-h-[88px] rounded-lg border p-3 text-left transition-colors",
                            disabled && "cursor-not-allowed opacity-55",
                            active ? "border-[#d6a200] bg-[#d6a200]/10" : "border-border bg-[#111113] hover:border-[#3f3f46]"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-medium text-foreground">{strategy.title}</span>
                            {disabled ? <span className="text-[10px] text-amber-300">暂未开发</span> : active && <Check className="h-4 w-4 text-[#facc15]" />}
                          </div>
                          <div className="mt-1 text-[12px] leading-5 text-[#71717a]">{strategy.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <label className="block text-[14px] font-medium text-foreground mb-1.5">项目调性</label>
                    <Textarea
                      placeholder="例如：黑色幽默、快节奏美剧短剧、角色反应夸张但世界观保持一致。"
                      className="h-24 resize-none text-[13px] text-foreground bg-layer-4 border-border focus-visible:ring-primary"
                      value={projectTone}
                      onChange={(e) => setProjectTone(e.target.value)}
                    />
                  </div>
	                  <div>
	                    <label className="block text-[14px] font-medium text-foreground mb-1.5">导演人工指导</label>
	                    <Textarea
	                      placeholder="例如：每个角色保持统一造型；重要动作先给近景反应，再给环境关系；导演板优先表达空间、站位和镜头推进。"
	                      className="h-24 resize-none text-[13px] text-foreground bg-layer-4 border-border focus-visible:ring-primary"
	                      value={directorNotes}
	                      onChange={(e) => setDirectorNotes(e.target.value)}
	                    />
	                  </div>
	                  <div>
	                    <label className="block text-[14px] font-medium text-foreground mb-1.5">角色身份约束</label>
	                    <Textarea
	                      placeholder="例如：本项目所有角色都是拟人化水果，必须推理并锁定具体水果身份；Chloe 是水蜜桃，Leo 是黄色柠檬。"
	                      className="h-24 resize-none text-[13px] text-foreground bg-layer-4 border-border focus-visible:ring-primary"
	                      value={characterIdentityRules}
	                      onChange={(e) => setCharacterIdentityRules(e.target.value)}
	                    />
	                  </div>
	                  <div>
	                    <label className="block text-[14px] font-medium text-foreground mb-1.5">全局画面提示词</label>
                    <Textarea
                      placeholder="例如：最高画质，大师杰作，极其详细的细节。所有人物都要有边缘光..."
                      className="h-24 resize-none font-mono text-[13px] text-foreground bg-layer-4 border-border focus-visible:ring-primary"
                      value={globalPrompt}
                      onChange={(e) => setGlobalPrompt(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[14px] font-medium text-foreground mb-1.5">负面约束</label>
                    <Textarea
                      placeholder="例如：不要生成带有血腥暴力的画面..."
                      className="h-24 resize-none font-mono text-[13px] text-foreground bg-layer-4 border-border focus-visible:ring-primary"
                      value={negativePrompt}
                      onChange={(e) => setNegativePrompt(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <div className="mb-3 text-[14px] font-medium text-foreground">详细剧本规则</div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {SCRIPT_RULE_TEMPLATES.map((rule) => (
                      <div key={rule.id} className="rounded-xl border border-border bg-card p-4">
                        <div className="mb-2 flex items-center gap-2">
                          <Badge className="border border-[#d6a200]/30 bg-[#d6a200]/10 text-[#facc15] hover:bg-[#d6a200]/10">{rule.id.slice(0, 2).toUpperCase()}</Badge>
                          <div className="text-[13px] font-medium text-foreground">{rule.title}</div>
                        </div>
                        <Textarea
                          value={scriptRules[rule.id] ?? ""}
                          onChange={(event) => setScriptRules((current) => ({ ...current, [rule.id]: event.target.value }))}
                          className="h-28 resize-none border-border bg-[#111113] text-[12px] leading-5 text-[#d4d4d8]"
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-card p-3 text-[12px] leading-5 text-[#71717a]">
                  这些设定会保存到项目全局提示词中，影响后续资产、分镜、导演板和视频生成。
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer Actions (Sticky bottom) */}
      <div className="sticky bottom-0 left-0 z-10 flex w-full shrink-0 justify-center border-t border-[#1f1f23] bg-background/95 px-4 py-3 backdrop-blur sm:px-6 sm:py-4">
        <div className={cn("flex w-full flex-col gap-3", contentMaxWidth)}>
          {saveError && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
              {saveError}
            </div>
          )}
          <div className="flex w-full justify-between gap-3">
          <Button 
            variant="ghost" 
            onClick={() => {
              if (step > 1) {
                setStep(step - 1);
                return;
              }
              if (isEditMode && id) navigate(`/app/project/${id}/canvas`);
            }}
            disabled={step === 1 && !isEditMode}
            className="flex-1 text-muted-foreground hover:bg-card hover:text-foreground sm:flex-none"
          >
            {step === 1 && isEditMode ? "返回画布" : "上一步"}
          </Button>
          <Button 
            className="flex-1 gap-2 rounded-md border-0 bg-gradient-to-r from-primary to-primary/80 px-4 text-white hover:opacity-90 sm:flex-none sm:px-8"
            onClick={handleNext}
            disabled={isSaving}
          >
            {step === 4 ? (isSaving ? "保存中" : isEditMode ? "保存设置" : "完成创建") : "下一步"}
            {step < 4 && <ChevronRight className="h-4 w-4" />}
          </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
