import React, { useEffect, useState } from "react";
import { Link } from "react-router";
import { Plus, Search, LayoutGrid, List, Play, Edit2, Copy, Trash2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { useProjectStore } from "../stores/useProjectStore";

export function DashboardPage() {
  const [activeTab, setActiveTab] = useState("全部");
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState("");

  const projects = useProjectStore((s) => s.projects);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const deleteProject = useProjectStore((s) => s.deleteProject);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const filteredProjects = projects.filter((p) =>
    p.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDelete = (e: React.MouseEvent, id: string, title: string) => {
    e.stopPropagation();
    if (window.confirm(`确定要删除项目「${title}」吗？此操作不可撤销。`)) {
      deleteProject(id);
    }
  };

  const getTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "刚刚";
    if (minutes < 60) return `${minutes}分钟前`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    return `${days}天前`;
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col overflow-y-auto p-4 text-[14px] sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:mb-8 lg:flex-row lg:items-center lg:justify-between">
        <h1 className="text-[22px] font-semibold tracking-tight sm:text-[24px]">我的项目</h1>
        <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto lg:items-center">
          <div className="relative w-full sm:w-72 lg:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#71717a]" />
            <Input
              className="pl-9 bg-[#1f1f23] border-[#27272a] focus-visible:ring-[#6366f1]"
              placeholder="搜索项目..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Link to="/app/project/new/setup" className="w-full sm:w-auto">
            <Button className="h-9 w-full gap-2 rounded-md border-0 bg-gradient-to-r from-[#6366f1] to-[#818cf8] text-white hover:opacity-90 sm:w-auto">
              <Plus className="h-4 w-4" />
              新建项目
            </Button>
          </Link>
        </div>
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full space-x-1 overflow-x-auto rounded-lg border border-[#1f1f23] bg-[#111113] p-1 sm:w-fit">
          {["全部", "最近", "收藏"].map((tab) => (
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
        <div className="flex w-fit items-center gap-1 rounded-md border border-[#27272a] bg-[#1f1f23] p-1">
          <Button variant="ghost" size="icon" className={`h-7 w-7 rounded-sm ${viewMode === 'grid' ? 'bg-[#27272a] text-[#fafafa]' : 'text-[#71717a] hover:text-[#fafafa]'}`} onClick={() => setViewMode('grid')}><LayoutGrid className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className={`h-7 w-7 rounded-sm ${viewMode === 'list' ? 'bg-[#27272a] text-[#fafafa]' : 'text-[#71717a] hover:text-[#fafafa]'}`} onClick={() => setViewMode('list')}><List className="h-4 w-4" /></Button>
        </div>
      </div>

      {filteredProjects.length === 0 ? (
        <div className="flex min-h-[360px] flex-1 flex-col items-center justify-center text-center">
          <div className="mb-6 flex h-36 w-36 items-center justify-center text-[#71717a] opacity-80 sm:h-48 sm:w-48">
            {/* Simple drawing icon for empty state */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="w-24 h-24">
              <path d="M12 19l7-7 3 3-7 7-3-3z" />
              <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
              <path d="M2 2l7.586 7.586" />
              <circle cx="11" cy="11" r="2" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-[#fafafa] mb-2">{searchQuery ? "没有匹配的项目" : "还没有项目"}</h3>
          <p className="text-[#a1a1aa] mb-6">{searchQuery ? "试试其他关键词" : "创建你的第一个 AI 动画项目"}</p>
          {!searchQuery && (
            <Link to="/app/project/new/setup">
              <Button className="gap-2 bg-gradient-to-r from-[#6366f1] to-[#818cf8] hover:opacity-90 text-white border-0">
                <Plus className="h-4 w-4" />
                新建项目
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 xl:gap-6">
          {/* Create New Card */}
          <Link to="/app/project/new/setup" className="group flex h-[220px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#27272a] bg-[#111113] text-[#71717a] transition-all hover:border-[#6366f1]/50 hover:bg-[#6366f1]/5 hover:text-[#a5b4fc] sm:h-[260px]">
            <div className="h-12 w-12 rounded-full bg-[#18181b] group-hover:bg-[#6366f1]/20 flex items-center justify-center mb-4 transition-colors">
              <Plus className="h-6 w-6" />
            </div>
            <span className="font-medium text-[14px]">新建项目</span>
          </Link>

          {/* Project Cards */}
          {filteredProjects.map((project) => (
            <div key={project.id} className="group relative flex h-[220px] cursor-pointer flex-col overflow-hidden rounded-xl border border-[#27272a] bg-[#18181b] transition-all hover:border-[#6366f1] hover:shadow-[0_0_0_1px_rgba(99,102,241,1)] sm:h-[260px]">
              {/* Cover 60% */}
              <div className="h-[60%] w-full bg-[#09090b] relative overflow-hidden shrink-0">
                <img src={project.cover} alt={project.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                <div className="absolute inset-0 flex items-center justify-center gap-3 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                  <Link to={`/app/project/${project.id}/canvas`} className="h-10 w-10 rounded-full bg-[#18181b] flex items-center justify-center text-[#fafafa] hover:bg-[#6366f1] transition-colors" title="进入">
                    <Play className="h-4 w-4 ml-0.5" />
                  </Link>
                  <button className="h-10 w-10 rounded-full bg-[#18181b] flex items-center justify-center text-[#fafafa] hover:bg-[#27272a] transition-colors" title="重命名">
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button className="h-10 w-10 rounded-full bg-[#18181b] flex items-center justify-center text-[#fafafa] hover:bg-[#27272a] transition-colors" title="复制">
                    <Copy className="h-4 w-4" />
                  </button>
                  <button onClick={(e) => handleDelete(e, project.id, project.title)} className="h-10 w-10 rounded-full bg-[#18181b] flex items-center justify-center text-[#ef4444] hover:bg-[#7f1d1d] transition-colors" title="删除">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Info 40% */}
              <div className="p-4 flex flex-col h-[40%] bg-[#18181b]">
                <div className="flex justify-between items-start mb-1">
                  <Link to={`/app/project/${project.id}/canvas`} className="font-medium text-[14px] text-[#fafafa] truncate pr-2 hover:text-[#a5b4fc] transition-colors">{project.title}</Link>
                  <span className="text-[12px] text-[#a1a1aa] shrink-0">{project.completedScenes}/{project.scenes} 分镜</span>
                </div>
                <div className="mt-auto flex min-w-0 items-center gap-2 pt-2 text-[12px] text-[#71717a]">
                  <Badge variant="secondary" className="text-[11px] h-5 px-1.5 font-normal bg-[#1f1f23] text-[#a1a1aa] hover:bg-[#27272a] border-0">{project.ratio}</Badge>
                  <Badge variant="secondary" className="h-5 max-w-[120px] truncate border-0 bg-[#1f1f23] px-1.5 text-[11px] font-normal text-[#a1a1aa] hover:bg-[#27272a]">{project.style}</Badge>
                  <span className="ml-auto shrink-0">{getTimeAgo(project.createdAt)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
