import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  Check,
  Download,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import { Textarea } from "../components/ui/textarea";
import { useRemakeStore } from "../stores/useRemakeStore";
import type { RemakeBreakdown, RemakeGate, RemakeScript } from "../lib/api/remakeApi";
import {
  formatRemakeStage,
  formatRemakeStatus,
  formatShotStatus,
  gateForStage,
  gateLabel,
  getStatusBadgeClass,
  REMAKE_STAGES,
  stageIndex,
} from "./remakeLabels";

const POLL_MS = 4000;

export function RemakeJobPage() {
  const { jobId = "" } = useParams();
  const job = useRemakeStore((s) => s.currentJob);
  const detailLoading = useRemakeStore((s) => s.detailLoading);
  const error = useRemakeStore((s) => s.error);
  const loadJob = useRemakeStore((s) => s.loadJob);
  const updateBreakdown = useRemakeStore((s) => s.updateBreakdown);
  const updateScript = useRemakeStore((s) => s.updateScript);
  const approveGate = useRemakeStore((s) => s.approveGate);
  const rejectGate = useRemakeStore((s) => s.rejectGate);
  const retryFailedShots = useRemakeStore((s) => s.retryFailedShots);
  const clearCurrentJob = useRemakeStore((s) => s.clearCurrentJob);

  const [breakdownText, setBreakdownText] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [editError, setEditError] = useState("");

  useEffect(() => {
    if (!jobId) return;
    void loadJob(jobId);
    return () => clearCurrentJob();
  }, [clearCurrentJob, jobId, loadJob]);

  useEffect(() => {
    if (!jobId || !job) return;
    const shouldPoll = job.status === "PENDING" || job.status === "RUNNING";
    if (!shouldPoll) return;
    const timer = window.setInterval(() => {
      void loadJob(jobId);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [job, job?.status, jobId, loadJob]);

  useEffect(() => {
    if (!job?.breakdown) {
      setBreakdownText("");
      return;
    }
    setBreakdownText(JSON.stringify(job.breakdown, null, 2));
  }, [job?.breakdown, job?.id]);

  useEffect(() => {
    if (!job?.remakeScript) {
      setScriptText("");
      return;
    }
    setScriptText(JSON.stringify(job.remakeScript, null, 2));
  }, [job?.id, job?.remakeScript]);

  const activeGate = useMemo(() => {
    if (!job || job.status !== "WAITING_GATE") return null;
    return gateForStage(job.stage);
  }, [job]);

  const failedShots = job?.shots.filter((shot) => shot.status === "failed") ?? [];
  const progressPercent = job?.progress?.percent ?? Math.round((stageIndex(job?.stage ?? "INGEST") / (REMAKE_STAGES.length - 1)) * 100);

  const runAction = async (action: () => Promise<unknown>) => {
    setActionLoading(true);
    setEditError("");
    try {
      await action();
    } catch (actionError) {
      setEditError(actionError instanceof Error ? actionError.message : "操作失败");
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveBreakdown = () => {
    if (!jobId) return;
    void runAction(async () => {
      const parsed = JSON.parse(breakdownText) as RemakeBreakdown;
      await updateBreakdown(jobId, parsed);
    });
  };

  const handleSaveScript = () => {
    if (!jobId) return;
    void runAction(async () => {
      const parsed = JSON.parse(scriptText) as RemakeScript;
      await updateScript(jobId, parsed);
    });
  };

  const handleGate = (gate: RemakeGate, approved: boolean) => {
    if (!jobId) return;
    void runAction(async () => {
      if (approved) await approveGate(jobId, gate);
      else await rejectGate(jobId, gate);
    });
  };

  if (!job && detailLoading) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">加载任务详情...</div>;
  }

  if (!job) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-muted-foreground">{error || "任务不存在或加载失败"}</p>
        <Link to="/app/remake">
          <Button variant="outline">返回列表</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-y-auto p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <Link to="/app/remake" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          返回任务列表
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-[22px] font-extrabold tracking-tight sm:text-[24px]">
              {job.title || job.sourceUrl || `任务 ${job.id.slice(0, 8)}`}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge className={getStatusBadgeClass(job.status)}>{formatRemakeStatus(job.status)}</Badge>
              <span className="text-sm text-muted-foreground">当前阶段：{formatRemakeStage(job.stage)}</span>
            </div>
          </div>
          <Button variant="outline" className="gap-2" onClick={() => void loadJob(job.id)} disabled={detailLoading}>
            <RefreshCw className={`h-4 w-4 ${detailLoading ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
      </div>

      {(error || editError) && (
        <div className="mb-4 rounded-lg border border-[#7f1d1d] bg-[#3f1f25] px-4 py-3 text-sm text-[#fca5a5]">
          {editError || error}
        </div>
      )}

      <section className="mb-6 rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold">阶段进度</h2>
          <span className="text-sm text-muted-foreground">{progressPercent}%</span>
        </div>
        <Progress value={progressPercent} className="mb-4" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {REMAKE_STAGES.map((stage, index) => {
            const current = stageIndex(job.stage);
            const done = index < current || job.status === "SUCCEEDED";
            const active = index === current && job.status !== "SUCCEEDED";
            return (
              <div
                key={stage}
                className={`rounded-lg border px-3 py-2 text-center text-xs ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : done
                      ? "border-[#14532d] bg-[#14251a] text-[#86efac]"
                      : "border-border bg-layer-4 text-muted-foreground"
                }`}
              >
                {formatRemakeStage(stage)}
              </div>
            );
          })}
        </div>
        {job.progress?.message && (
          <p className="mt-3 text-sm text-muted-foreground">{job.progress.message}</p>
        )}
        {job.errorMessage && (
          <p className="mt-3 text-sm text-[#fca5a5]">{job.errorMessage}</p>
        )}
      </section>

      {activeGate && (
        <section className="mb-6 rounded-xl border border-[#854d0e] bg-[#2a2112] p-5">
          <h2 className="mb-2 font-semibold text-[#fcd34d]">{gateLabel(activeGate)}</h2>
          <p className="mb-4 text-sm text-[#fde68a]">请审核当前阶段产出，通过后继续下一阶段，驳回将重新执行本阶段。</p>
          <div className="flex flex-wrap gap-2">
            <Button className="gap-2" disabled={actionLoading} onClick={() => handleGate(activeGate, true)}>
              <Check className="h-4 w-4" />
              通过
            </Button>
            <Button variant="outline" className="gap-2" disabled={actionLoading} onClick={() => handleGate(activeGate, false)}>
              <X className="h-4 w-4" />
              驳回重跑
            </Button>
          </div>
        </section>
      )}

      {job.status === "WAITING_GATE" && job.stage === "ANALYZE" && job.breakdown && (
        <section className="mb-6 rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-semibold">Breakdown 编辑</h2>
            <Button size="sm" disabled={actionLoading} onClick={handleSaveBreakdown}>保存</Button>
          </div>
          <Textarea
            value={breakdownText}
            onChange={(event) => setBreakdownText(event.target.value)}
            className="min-h-[280px] font-mono text-xs"
          />
        </section>
      )}

      {job.status === "WAITING_GATE" && job.stage === "ADAPT" && job.remakeScript && (
        <section className="mb-6 rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-semibold">Script 编辑</h2>
            <Button size="sm" disabled={actionLoading} onClick={handleSaveScript}>保存</Button>
          </div>
          <Textarea
            value={scriptText}
            onChange={(event) => setScriptText(event.target.value)}
            className="min-h-[280px] font-mono text-xs"
          />
        </section>
      )}

      {job.shots.length > 0 && (
        <section className="mb-6 rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">镜头列表</h2>
            {failedShots.length > 0 && (
              <Button
                variant="outline"
                className="gap-2"
                disabled={actionLoading}
                onClick={() => void runAction(() => retryFailedShots(job.id))}
              >
                <RotateCcw className="h-4 w-4" />
                重跑失败镜 ({failedShots.length})
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {job.shots.map((shot) => (
              <div key={shot.id} className="flex items-center justify-between rounded-lg border border-border bg-layer-4 px-3 py-2 text-sm">
                <span>镜头 #{shot.shotIndex + 1}</span>
                <span className={shot.status === "failed" ? "text-[#fca5a5]" : "text-muted-foreground"}>
                  {formatShotStatus(shot.status)}
                  {shot.errorMessage ? ` · ${shot.errorMessage}` : ""}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {job.finalVideoUrl && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 font-semibold">成片下载</h2>
          <div className="mb-4 overflow-hidden rounded-lg border border-border bg-black">
            <video src={job.finalVideoUrl} controls className="max-h-[420px] w-full" />
          </div>
          <a href={job.finalVideoUrl} target="_blank" rel="noreferrer" download>
            <Button className="gap-2">
              <Download className="h-4 w-4" />
              下载成片
            </Button>
          </a>
        </section>
      )}
    </div>
  );
}
