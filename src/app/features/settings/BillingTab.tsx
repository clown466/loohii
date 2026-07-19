import { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { request } from "../../lib/api/httpClient";
import { chargeDisplayOf } from "./billingRecordDisplay";

/**
 * 账单充值：余额以 aijiekou 平台积分为准（P2 统一积分体系）。
 * 消费记录取本地 Generation.creditCost（平台实际扣点快照）；充值流水以平台为准。
 * P2-D R3：已退款记录按 parameters.billing.status 标识"已退款/金额退回"，不再显示为实扣。
 */

interface PlatformInfo {
  id: number;
  email: string;
  points: number;
  membershipActive: boolean;
}

interface MeResponse {
  user: { id: string; name: string; email: string };
  platform?: PlatformInfo;
}

interface GenerationRecord {
  id: string;
  prompt: string;
  status: string;
  creditCost: number;
  createdAt: string;
  parameters?: { billing?: { status?: string } } | null;
}

function actionLabel(_prompt: string): string {
  return "生成扣点";
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const hhmm = date.toTimeString().slice(0, 5);
  if (sameDay) return `今天 ${hhmm}`;
  return `${date.getMonth() + 1}-${date.getDate()} ${hhmm}`;
}

export function BillingSettings() {
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const [records, setRecords] = useState<GenerationRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await request<MeResponse>("/api/auth/me");
        if (!cancelled && me.platform) setPlatform(me.platform);
      } catch {
        // 忽略，展示占位
      }
      try {
        const generations = await request<GenerationRecord[]>("/api/generations?limit=50");
        if (!cancelled && Array.isArray(generations)) {
          setRecords(generations.filter((g) => Number(g.creditCost) > 0).slice(0, 20));
        }
      } catch {
        // 忽略
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-[26px] font-extrabold text-[#E8E8EC]">账单充值</h1>
        <p className="text-muted-foreground mt-1 text-[16px]">积分与 aijiekou 平台（拆剧助手）统一，同一账号两边通用</p>
      </div>

      <div className="grid gap-8">
        {/* Account Balance Card */}
        <div className="lh-card relative overflow-hidden rounded-xl border border-border p-4 sm:p-6">
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-primary/10 to-transparent rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />

          <div className="relative z-10 flex flex-col items-start justify-between gap-4 sm:flex-row">
            <div>
              <h3 className="text-[16px] font-medium text-muted-foreground mb-2">平台积分余额</h3>
              <div className="flex items-end gap-2">
                <span className="inline-flex items-end gap-2 text-[30px] font-bold leading-none text-primary sm:text-[34px]">
                  <Coins className="h-7 w-7 sm:h-8 sm:w-8" aria-hidden />
                  {loading ? "…" : (platform ? platform.points.toLocaleString() : "—")}
                </span>
                <span className="text-[16px] font-medium text-muted-foreground mb-1">积分</span>
              </div>
              {platform && (
                <p className="text-[14px] text-muted-foreground mt-2">平台账号：{platform.email}</p>
              )}
            </div>
            {platform?.membershipActive && (
              <Badge className="bg-gradient-to-r from-primary to-primary/80 text-primary-foreground font-bold border-0 py-1">会员生效中（生成只记账不扣余额）</Badge>
            )}
          </div>
        </div>

        {/* Top up */}
        <div>
          <h3 className="text-[18px] font-medium text-foreground mb-4">充值</h3>
          <div className="lh-card rounded-xl border border-border p-5 text-[16px] text-muted-foreground leading-relaxed">
            充值请前往 aijiekou 平台（拆剧助手）下单，或联系管理员充值。
            充值到账后积分在这里和拆剧助手同时可见，无需其他操作。
          </div>
        </div>

        {/* History */}
        <div className="pt-2">
          <h3 className="text-[18px] font-medium text-foreground mb-4">消费记录（生成扣点）</h3>
          <div className="lh-card overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[520px] text-left text-[15px]">
              <thead className="bg-layer-4 text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-5 py-3 font-medium">时间</th>
                  <th className="px-5 py-3 font-medium">内容</th>
                  <th className="px-5 py-3 font-medium">状态</th>
                  <th className="px-5 py-3 font-medium text-right">扣点</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {records.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                      {loading ? "加载中…" : "暂无消费记录"}
                    </td>
                  </tr>
                )}
                {records.map((row) => {
                  const charge = chargeDisplayOf(row);
                  return (
                    <tr key={row.id} className="hover:bg-layer-4/50 transition-colors">
                      <td className="px-5 py-3 text-muted-foreground">{formatTime(row.createdAt)}</td>
                      <td className="px-5 py-3 text-foreground max-w-[280px] truncate" title={row.prompt}>
                        {row.prompt.slice(0, 40) || actionLabel(row.prompt)}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          {row.status}
                          {charge.refunded && (
                            <Badge className="bg-emerald-500/15 text-emerald-400 border-0 text-[13px] py-0">已退款</Badge>
                          )}
                          {charge.refundPending && (
                            <Badge className="bg-amber-500/15 text-amber-400 border-0 text-[13px] py-0">退款处理中</Badge>
                          )}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right font-mono">
                        {charge.refunded ? (
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <span className="text-muted-foreground line-through">{charge.amountText}</span>
                            <span className="text-emerald-400">{charge.refundText}</span>
                          </span>
                        ) : (
                          <span className="text-foreground">{charge.amountText}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
