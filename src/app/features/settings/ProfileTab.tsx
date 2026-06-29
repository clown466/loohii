import { useState } from "react";
import { useNavigate } from "react-router";
import { Check } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useAuthStore } from "../../stores/useAuthStore";

export function ProfileSettings() {
  const user = useAuthStore(state => state.user);
  const updateProfile = useAuthStore(state => state.updateProfile);
  const signOut = useAuthStore(state => state.signOut);
  const navigate = useNavigate();

  const [nickname, setNickname] = useState(user?.name || "");

  const handleSave = () => {
    updateProfile({ name: nickname });
  };

  const handleDeleteAccount = () => {
    if (confirm("确定要注销账号吗？此操作不可恢复。")) {
      signOut();
      navigate("/");
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-[22px] font-semibold text-foreground sm:text-[24px]">个人信息</h1>
      </div>

      <div className="space-y-6 rounded-xl border border-border bg-card p-4 sm:space-y-8 sm:p-6">
        <div>
          <label className="block text-[14px] font-medium text-foreground mb-4">头像</label>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
            <div className="h-20 w-20 rounded-full border border-border overflow-hidden bg-background">
              <img src={user?.avatar || "https://api.dicebear.com/7.x/avataaars/svg?seed=Felix"} alt="User avatar" className="h-full w-full object-cover" />
            </div>
            <Button variant="outline" className="h-9 w-full border-border text-foreground hover:bg-accent sm:w-auto">更换头像</Button>
          </div>
        </div>

        <div className="w-full max-w-md space-y-4">
          <div>
            <label className="block text-[14px] font-medium text-foreground mb-1.5">昵称</label>
            <Input value={nickname} onChange={(e) => setNickname(e.target.value)} className="h-10 text-[14px] bg-layer-4 border-border focus-visible:ring-primary" />
          </div>
          <div>
            <label className="block text-[14px] font-medium text-foreground mb-1.5">邮箱</label>
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
              <Input defaultValue={user?.email || ""} disabled className="h-10 text-[14px] bg-layer-4/50 border-border opacity-70" />
              <span className="text-[#22c55e] text-[12px] whitespace-nowrap flex items-center gap-1"><Check className="h-3 w-3" />已验证</span>
            </div>
          </div>
        </div>

        <div className="w-full max-w-md pt-4 border-t border-[#1f1f23] space-y-4">
          <label className="block text-[14px] font-medium text-foreground">修改密码</label>
          <div>
            <Input type="password" placeholder="当前密码" className="h-10 text-[14px] bg-layer-4 border-border focus-visible:ring-primary" />
          </div>
          <div>
            <Input type="password" placeholder="新密码" className="h-10 text-[14px] bg-layer-4 border-border focus-visible:ring-primary" />
          </div>
          <div>
            <Input type="password" placeholder="确认密码" className="h-10 text-[14px] bg-layer-4 border-border focus-visible:ring-primary" />
          </div>
        </div>

        <div className="pt-2">
          <Button onClick={handleSave} className="h-9 w-full rounded-md border-0 bg-gradient-to-r from-primary to-primary/80 px-6 text-white hover:opacity-90 sm:w-auto">保存修改</Button>
        </div>
      </div>

      <div className="relative mt-6 overflow-hidden rounded-xl border border-[#ef4444]/20 bg-card p-4 sm:mt-8 sm:p-6">
        <div className="absolute top-0 left-0 w-1 h-full bg-[#ef4444]" />
        <h3 className="text-[16px] font-medium text-[#ef4444] mb-2">危险操作</h3>
        <p className="text-muted-foreground text-[14px] mb-4">注销账号后，您的所有数据将被永久删除，无法恢复。</p>
        <Button onClick={handleDeleteAccount} variant="outline" className="w-full border-[#ef4444] text-[#ef4444] hover:bg-[#ef4444]/10 hover:text-[#ef4444] sm:w-auto">注销账号</Button>
      </div>
    </div>
  );
}
