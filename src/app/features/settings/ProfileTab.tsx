import { useState } from "react";
import { useNavigate } from "react-router";
import { Check } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { UserAvatar } from "../../components/UserAvatar";
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
        <h1 className="text-[24px] font-extrabold text-[#E8E8EC] sm:text-[26px]">个人信息</h1>
      </div>

      <div className="lh-card space-y-6 rounded-xl border border-border p-4 sm:space-y-8 sm:p-6">
        <div>
          <label className="block text-[16px] font-medium text-foreground mb-4">头像</label>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
            <div className="h-20 w-20 rounded-full border border-border overflow-hidden bg-background">
              <UserAvatar name={user?.name} seed={user?.id || user?.email} src={user?.avatar} alt="User avatar" className="h-full w-full" />
            </div>
            <Button variant="outline" className="h-9 w-full border-border text-foreground hover:bg-accent sm:w-auto">更换头像</Button>
          </div>
        </div>

        <div className="w-full max-w-md space-y-4">
          <div>
            <label className="block text-[16px] font-medium text-foreground mb-1.5">昵称</label>
            <Input value={nickname} onChange={(e) => setNickname(e.target.value)} className="h-10 text-[16px] bg-layer-4 border-border focus-visible:ring-primary" />
          </div>
          <div>
            <label className="block text-[16px] font-medium text-foreground mb-1.5">邮箱</label>
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
              <Input defaultValue={user?.email || ""} disabled className="h-10 text-[16px] bg-layer-4/50 border-border opacity-70" />
              <span className="text-[#7ED887] text-[14px] whitespace-nowrap flex items-center gap-1"><Check className="h-3 w-3" />已验证</span>
            </div>
          </div>
        </div>

        <div className="w-full max-w-md pt-4 border-t border-border space-y-4">
          <label className="block text-[16px] font-medium text-foreground">修改密码</label>
          <div>
            <Input type="password" placeholder="当前密码" className="h-10 text-[16px] bg-layer-4 border-border focus-visible:ring-primary" />
          </div>
          <div>
            <Input type="password" placeholder="新密码" className="h-10 text-[16px] bg-layer-4 border-border focus-visible:ring-primary" />
          </div>
          <div>
            <Input type="password" placeholder="确认密码" className="h-10 text-[16px] bg-layer-4 border-border focus-visible:ring-primary" />
          </div>
        </div>

        <div className="pt-2">
          <Button onClick={handleSave} className="h-9 w-full px-6 sm:w-auto">保存修改</Button>
        </div>
      </div>

      <div className="lh-card relative mt-6 overflow-hidden rounded-xl border border-destructive/20 p-4 sm:mt-8 sm:p-6">
        <div className="absolute top-0 left-0 w-1 h-full bg-destructive" />
        <h3 className="text-[18px] font-medium text-destructive mb-2">危险操作</h3>
        <p className="text-muted-foreground text-[16px] mb-4">注销账号后，您的所有数据将被永久删除，无法恢复。</p>
        <Button onClick={handleDeleteAccount} variant="outline" className="w-full border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto">注销账号</Button>
      </div>
    </div>
  );
}
