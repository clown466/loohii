export function formatRemakeStage(stage: string): string {
  const labels: Record<string, string> = {
    INGEST: "素材导入",
    ANALYZE: "结构分析",
    ADAPT: "脚本改编",
    GENERATE: "镜头生成",
    ASSEMBLE: "成片合成",
    DELIVER: "交付",
  };
  return labels[stage] ?? stage;
}

export function formatShotStatus(status: string): string {
  const labels: Record<string, string> = {
    pending: "待处理",
    running: "进行中",
    succeeded: "成功",
    failed: "失败",
  };
  return labels[status] ?? status;
}

export function formatRemakeStatus(status: string): string {
  const labels: Record<string, string> = {
    PENDING: "排队中",
    RUNNING: "运行中",
    WAITING_GATE: "等待审核",
    SUCCEEDED: "已完成",
    FAILED: "失败",
    CANCELED: "已取消",
  };
  return labels[status] ?? status;
}

export function getStatusBadgeClass(status: string): string {
  if (status === "SUCCEEDED") return "bg-[#14532d] text-[#86efac] border-[#14532d]";
  if (status === "FAILED") return "bg-[#3f1f25] text-[#fca5a5] border-[#7f1d1d]";
  if (status === "WAITING_GATE") return "bg-[#2a2112] text-[#fcd34d] border-[#854d0e]";
  if (status === "RUNNING") return "bg-[#172554] text-[#93c5fd] border-[#1e3a8a]";
  return "bg-layer-4 text-muted-foreground border-border";
}

export const REMAKE_STAGES = [
  "INGEST",
  "ANALYZE",
  "ADAPT",
  "GENERATE",
  "ASSEMBLE",
  "DELIVER",
] as const;

export function stageIndex(stage: string): number {
  const index = REMAKE_STAGES.indexOf(stage as (typeof REMAKE_STAGES)[number]);
  return index >= 0 ? index : 0;
}

export function gateForStage(stage: string): "a" | "b" | "c" | null {
  if (stage === "ANALYZE") return "a";
  if (stage === "ADAPT") return "b";
  if (stage === "ASSEMBLE") return "c";
  return null;
}

export function gateLabel(gate: "a" | "b" | "c"): string {
  if (gate === "a") return "卡点 A · 结构分析";
  if (gate === "b") return "卡点 B · 脚本改编";
  return "卡点 C · 成片合成";
}
