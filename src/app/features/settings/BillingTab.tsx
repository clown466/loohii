import { Zap } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { cn } from "../../components/ui/utils";

export function BillingSettings() {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-[24px] font-extrabold text-[#E8E8EC]">账单充值</h1>
        <p className="text-muted-foreground mt-1 text-[14px]">管理你的积分余额和订阅计划</p>
      </div>

      <div className="grid gap-8">
        {/* Account Balance Card */}
        <div className="lh-card relative overflow-hidden rounded-xl border border-border p-4 sm:p-6">
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-primary/10 to-transparent rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />

          <div className="relative z-10 mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row">
            <div>
              <h3 className="text-[14px] font-medium text-muted-foreground mb-2">当前账户余额</h3>
              <div className="flex items-end gap-2">
                <span className="text-[28px] font-bold leading-none text-primary sm:text-[32px]">💰 1,250</span>
                <span className="text-[14px] font-medium text-muted-foreground mb-1">积分</span>
              </div>
            </div>
            <Badge className="bg-gradient-to-r from-primary to-primary/80 text-primary-foreground font-bold border-0 py-1">Pro 套餐</Badge>
          </div>

          <div className="space-y-3 relative z-10">
            <div className="flex flex-col justify-between gap-1 text-[13px] sm:flex-row">
              <span className="text-muted-foreground">本月已用 (每月 5,000 积分)</span>
              <span className="font-medium text-foreground">3,750 / 5,000</span>
            </div>
            <div className="h-2 w-full bg-layer-4 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-primary to-primary/80 rounded-full transition-all duration-1000" style={{ width: '75%' }}></div>
            </div>
            <div className="flex flex-col justify-between gap-1 text-[12px] text-muted-foreground sm:flex-row sm:items-center">
              <span>预计 8 天后用完</span>
              <span>下次续费: 2024-02-15</span>
            </div>
          </div>
        </div>

        {/* Top up */}
        <div>
          <h3 className="text-[16px] font-medium text-foreground mb-4">充值积分包</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[
              { points: 500, price: 5, popular: false },
              { points: 2000, price: 18, popular: true },
              { points: 5000, price: 40, popular: false },
            ].map((pack, i) => (
              <div
                key={i}
                className={cn(
                  "lh-card relative rounded-xl border p-5 cursor-pointer transition-all flex flex-col items-center justify-center",
                  pack.popular
                    ? "border-transparent h-[120px] bg-gradient-to-b from-[#1C1C21] to-[#17171B] before:absolute before:inset-0 before:-z-10 before:p-[2px] before:rounded-xl before:bg-gradient-to-br before:from-primary before:to-primary/80 shadow-[0_4px_24px_-8px_rgba(245,166,35,0.5)] z-10"
                    : "border-border h-[112px] hover:border-primary/50 mt-1"
                )}
              >
                {pack.popular && (
                  <div className="absolute -top-3 bg-gradient-to-r from-primary to-primary/80 text-primary-foreground text-[11px] font-bold px-2.5 py-0.5 rounded-md flex items-center gap-1 shadow-sm">
                    <Zap className="h-3 w-3 fill-white/20" /> 最受欢迎
                  </div>
                )}
                <div className="font-bold text-[20px] text-foreground mb-1">{pack.points} 积分</div>
                <div className="text-[14px] text-muted-foreground">¥{pack.price}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Payment Method */}
        <div>
          <h3 className="text-[16px] font-medium text-foreground mb-4">支付方式</h3>
          <div className="flex flex-wrap gap-3">
            {[
              { name: '支付宝', color: "text-[#1677ff]", border: "border-[#1677ff]", bg: "bg-[#1677ff]/10" },
              { name: '微信支付', color: "text-[#09b83e]", border: "border-border", bg: "bg-[#141417]" },
              { name: '银联', color: "text-[#ef4444]", border: "border-border", bg: "bg-[#141417]" }
            ].map((method, i) => (
              <button
                key={i}
                className={cn(
                  "flex items-center gap-2 px-5 py-2.5 rounded-lg border transition-colors text-[14px] font-medium",
                  method.border, method.bg,
                  i !== 0 && "hover:border-primary/50 text-muted-foreground hover:text-foreground"
                )}
              >
                <div className={cn("w-4 h-4 rounded-sm flex items-center justify-center text-[10px] font-bold bg-current/10", method.color)}>
                  ¥
                </div>
                <span className={i === 0 ? "text-foreground" : ""}>{method.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* History */}
        <div className="pt-2">
          <h3 className="text-[16px] font-medium text-foreground mb-4">消费记录</h3>
          <div className="lh-card overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead className="bg-layer-4 text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-5 py-3 font-medium">时间</th>
                  <th className="px-5 py-3 font-medium">类型</th>
                  <th className="px-5 py-3 font-medium">数量</th>
                  <th className="px-5 py-3 font-medium text-right">余额</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  { time: "今天 14:32", type: "消耗 (生成图片)", amount: -5, balance: "1,250" },
                  { time: "今天 14:30", type: "消耗 (生成图片)", amount: -15, balance: "1,255" },
                  { time: "昨天 10:00", type: "充值 (微信支付)", amount: "+500", balance: "1,270", isAdd: true },
                ].map((row, i) => (
                  <tr key={i} className="hover:bg-layer-4/50 transition-colors">
                    <td className="px-5 py-3 text-muted-foreground">{row.time}</td>
                    <td className="px-5 py-3 text-foreground">{row.type}</td>
                    <td className={`px-5 py-3 font-medium ${row.isAdd ? 'text-[#7ED887]' : 'text-foreground'}`}>
                      {row.amount}
                    </td>
                    <td className="px-5 py-3 text-right text-muted-foreground font-mono">{row.balance}</td>
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
