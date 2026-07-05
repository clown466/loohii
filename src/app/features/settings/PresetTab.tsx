import { useState } from "react";
import { Plus, Trash2, UploadCloud, ChevronDown } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";

export function PresetsSettings() {
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
        <h1 className="text-[24px] font-semibold text-foreground">预设管理</h1>
        <Button onClick={() => setShowEditModal(true)} className="h-9 w-full gap-2 rounded-md border-0 bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90 sm:w-auto">
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
                ? "bg-layer-4 text-foreground shadow-sm"
                : "text-[#71717a] hover:text-foreground hover:bg-card"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 min-[380px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {presets.map((style, i) => (
          <div key={i} className="group rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 transition-colors">
            <div className="aspect-square bg-background relative overflow-hidden">
              <img loading="lazy" decoding="async" src={style.cover} alt={style.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                <Button variant="secondary" size="icon" className="h-8 w-8 rounded-full bg-card text-foreground hover:bg-primary border-0" onClick={() => setShowEditModal(true)}>
                  <span className="text-[12px] font-medium">编辑</span>
                </Button>
                {activeTab === "我的预设" && (
                  <Button variant="secondary" size="icon" className="h-8 w-8 rounded-full bg-card text-[#ef4444] hover:bg-[#ef4444] hover:text-white border-0">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="p-3 text-[13px] font-medium text-foreground">
              {style.name}
            </div>
          </div>
        ))}
      </div>

      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm animate-in fade-in sm:p-4">
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-card shadow-2xl">
            <div className="p-5 border-b border-[#1f1f23] flex items-center justify-between shrink-0">
              <h2 className="text-[16px] font-medium text-foreground">编辑预设</h2>
              <button onClick={() => setShowEditModal(false)} className="text-[#71717a] hover:text-foreground">
                <Trash2 className="h-5 w-5 hidden" />
                <span className="text-xl leading-none">&times;</span>
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
              <div>
                <label className="block text-[14px] font-medium text-foreground mb-1.5">预设名称</label>
                <Input placeholder="输入预设名称" className="h-10 bg-layer-4 border-border" />
              </div>

              <div>
                <label className="block text-[14px] font-medium text-foreground mb-1.5">分类</label>
                <button className="w-full flex items-center justify-between h-10 px-3 bg-layer-4 border border-border rounded-md text-[14px] text-foreground">
                  动漫 <ChevronDown className="h-4 w-4 text-[#71717a]" />
                </button>
              </div>

              <div>
                <label className="block text-[14px] font-medium text-foreground mb-1.5">预览图</label>
                <div className="border-2 border-dashed border-border rounded-xl p-4 flex flex-col items-center justify-center bg-layer-4 text-[#71717a] cursor-pointer hover:border-primary/50 h-24">
                  <UploadCloud className="h-6 w-6 mb-1 text-muted-foreground" />
                  <p className="text-[12px]">点击上传</p>
                </div>
              </div>

              <div>
                <label className="block text-[14px] font-medium text-foreground mb-1.5">提示词 (Prompt)</label>
                <Textarea placeholder="输入与此风格相关的提示词..." className="h-24 resize-none bg-layer-4 border-border font-mono text-[13px]" />
              </div>

              <div>
                <label className="block text-[14px] font-medium text-foreground mb-1.5">参考图 (最多5张)</label>
                <div className="flex gap-3">
                  <div className="h-16 w-16 rounded-md bg-background border border-border overflow-hidden">
                    <img loading="lazy" decoding="async" src="https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?w=100&q=80" alt="ref" className="w-full h-full object-cover" />
                  </div>
                  <div className="border-2 border-dashed border-border rounded-md flex flex-col items-center justify-center bg-layer-4 text-[#71717a] cursor-pointer hover:border-primary/50 h-16 w-16">
                    <Plus className="h-5 w-5" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-col justify-end gap-3 rounded-b-2xl border-t border-[#1f1f23] bg-card p-4 sm:flex-row sm:p-5">
              <Button variant="outline" onClick={() => setShowEditModal(false)} className="border-border text-foreground hover:bg-accent">取消</Button>
              <Button onClick={() => setShowEditModal(false)} className="bg-gradient-to-r from-primary to-primary/80 hover:opacity-90 text-white border-0">保存预设</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
