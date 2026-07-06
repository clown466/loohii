import React from "react";
import { Link, useParams } from "react-router";
import { User, Users, Palette, Cpu, CreditCard } from "lucide-react";
import { cn } from "../components/ui/utils";
import { ProfileSettings, TeamSettings, PresetsSettings, ModelsSettings, BillingSettings } from "../features/settings";

export function SettingsPage() {
  const { tab } = useParams<{ tab: string }>();

  const menuItems = [
    { id: "profile", icon: <User />, label: "个人信息", path: "/app/settings/profile" },
    { id: "team", icon: <Users />, label: "团队管理", path: "/app/settings/team" },
    { id: "presets", icon: <Palette />, label: "预设管理", path: "/app/settings/presets" },
    { id: "models", icon: <Cpu />, label: "模型配置", path: "/app/settings/models" },
    { id: "billing", icon: <CreditCard />, label: "账单充值", path: "/app/settings/billing" },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-[14px] md:flex-row">
      {/* Settings Sidebar */}
      <div className="flex w-full shrink-0 flex-col border-b border-[#222226] bg-[#141417] p-3 md:w-64 md:border-b-0 md:border-r md:p-4">
        <h2 className="mb-3 px-1 text-[18px] font-extrabold text-[#E8E8EC] md:mb-6 md:px-2">设置</h2>
        <nav className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:gap-1 md:overflow-visible md:pb-0">
          {menuItems.map((item) => {
            const isActive = tab === item.id || (tab === undefined && item.id === "billing");
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "relative flex h-10 shrink-0 items-center gap-3 rounded-md px-3 py-2 text-[14px] font-medium transition-colors group",
                  isActive
                    ? "bg-layer-4 text-primary border-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-card"
                )}
              >
                {isActive && (
                  <div className="absolute bottom-0 left-3 right-3 h-[3px] rounded-t-full bg-primary md:left-0 md:right-auto md:top-1/2 md:h-[60%] md:w-[3px] md:-translate-y-1/2 md:rounded-r-full md:rounded-t-none" />
                )}
                {React.cloneElement(item.icon as React.ReactElement, { className: "h-4 w-4" })}
                <span className="whitespace-nowrap">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Settings Content */}
      <div className="flex w-full min-w-0 flex-1 justify-center overflow-y-auto p-4 sm:p-6 lg:p-10">
        <div className="w-full max-w-[720px]">
          {tab === "profile" && <ProfileSettings />}
          {tab === "team" && <TeamSettings />}
          {tab === "presets" && <PresetsSettings />}
          {tab === "models" && <ModelsSettings />}
          {(tab === "billing" || !tab) && <BillingSettings />}
        </div>
      </div>
    </div>
  );
}
