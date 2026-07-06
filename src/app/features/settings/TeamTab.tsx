import { Plus, Trash2, ChevronDown } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";

export function TeamSettings() {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:mb-8 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-[24px] font-extrabold text-[#E8E8EC]">团队管理</h1>
          <p className="text-muted-foreground mt-1 text-[14px]">当前团队: Loohii Studio</p>
        </div>
        <Button className="h-9 w-full gap-2 sm:w-auto">
          <Plus className="h-4 w-4" />
          邀请成员
        </Button>
      </div>

      <div className="lh-card rounded-xl border border-border overflow-hidden">
        <div className="p-4 border-b border-border bg-layer-4/50">
          <h3 className="text-[14px] font-medium text-foreground">成员 (3/5)</h3>
        </div>
        <div className="divide-y divide-border">
          <div className="flex flex-col gap-3 p-4 transition-colors hover:bg-layer-4/50 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <img loading="lazy" decoding="async" src="https://api.dicebear.com/7.x/avataaars/svg?seed=Felix" alt="张三" className="w-8 h-8 rounded-full border border-border" />
              <div>
                <div className="text-[14px] font-medium text-foreground">张三</div>
                <div className="text-[12px] text-muted-foreground">admin@xx.com</div>
              </div>
            </div>
            <Badge variant="secondary" className="bg-layer-4 text-muted-foreground border-0 text-[12px] font-normal">管理员</Badge>
          </div>

          <div className="flex flex-col gap-3 p-4 transition-colors hover:bg-layer-4/50 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <img loading="lazy" decoding="async" src="https://api.dicebear.com/7.x/avataaars/svg?seed=Oliver" alt="李四" className="w-8 h-8 rounded-full border border-border" />
              <div>
                <div className="text-[14px] font-medium text-foreground">李四</div>
                <div className="text-[12px] text-muted-foreground">li@xx.com</div>
              </div>
            </div>
            <div className="flex items-center gap-3 self-end sm:self-auto">
              <button className="flex items-center gap-1 text-[13px] text-foreground bg-layer-4 px-2.5 py-1.5 rounded border border-border hover:border-primary transition-colors">
                编辑者 <ChevronDown className="h-3 w-3" />
              </button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 p-4 transition-colors hover:bg-layer-4/50 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <img loading="lazy" decoding="async" src="https://api.dicebear.com/7.x/avataaars/svg?seed=Sam" alt="王五" className="w-8 h-8 rounded-full border border-border" />
              <div>
                <div className="text-[14px] font-medium text-foreground">王五</div>
                <div className="text-[12px] text-muted-foreground">wang@xx.com</div>
              </div>
            </div>
            <div className="flex items-center gap-3 self-end sm:self-auto">
              <button className="flex items-center gap-1 text-[13px] text-foreground bg-layer-4 px-2.5 py-1.5 rounded border border-border hover:border-primary transition-colors">
                查看者 <ChevronDown className="h-3 w-3" />
              </button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-b border-border bg-layer-4/50 mt-4">
          <h3 className="text-[14px] font-medium text-foreground">待接受邀请</h3>
        </div>
        <div className="divide-y divide-border">
          <div className="flex flex-col gap-3 p-4 transition-colors hover:bg-layer-4/50 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[14px] font-medium text-foreground">zhao@xx.com</div>
              <div className="text-[12px] text-muted-foreground">已发送 2天前</div>
            </div>
            <Button variant="outline" className="h-8 w-full border-border text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground sm:w-auto">取消</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
