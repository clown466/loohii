import React, { useEffect } from "react";
import { Link } from "react-router";
import { Plus, RefreshCw, Clapperboard } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { useRemakeStore } from "../stores/useRemakeStore";
import {
  formatRemakeStage,
  formatRemakeStatus,
  getStatusBadgeClass,
} from "./remakeLabels";

export function RemakeListPage() {
  const jobs = useRemakeStore((s) => s.jobs);
  const loading = useRemakeStore((s) => s.loading);
  const error = useRemakeStore((s) => s.error);
  const loadJobs = useRemakeStore((s) => s.loadJobs);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-y-auto p-4 sm:p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-tight sm:text-[26px]">复刻任务</h1>
          <p className="mt-1 text-sm text-muted-foreground">爆款视频一键复刻，分阶段审核与生成</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => void loadJobs()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            刷新
          </Button>
          <Link to="/app/remake/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              新建任务
            </Button>
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[#7f1d1d] bg-[#3f1f25] px-4 py-3 text-sm text-[#fca5a5]">
          {error}
        </div>
      )}

      {loading && jobs.length === 0 ? (
        <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">加载中...</div>
      ) : jobs.length === 0 ? (
        <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
          <Clapperboard className="mb-4 h-12 w-12 text-[#71717a]" />
          <h3 className="mb-2 text-lg font-medium">还没有复刻任务</h3>
          <p className="mb-6 text-muted-foreground">上传视频或粘贴 TikTok 链接开始复刻</p>
          <Link to="/app/remake/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              新建任务
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <Link
              key={job.id}
              to={`/app/remake/${job.id}`}
              className="block rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-layer-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">
                      {job.title || job.sourceUrl || `任务 ${job.id.slice(0, 8)}`}
                    </span>
                    <Badge className={getStatusBadgeClass(job.status)}>{formatRemakeStatus(job.status)}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    阶段：{formatRemakeStage(job.stage)}
                    {job.progress?.message ? ` · ${job.progress.message}` : ""}
                  </div>
                </div>
                <div className="text-xs text-[#71717a]">
                  {new Date(job.createdAt).toLocaleString("zh-CN")}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
