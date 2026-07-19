import React, { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Mail, Lock } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useAuthStore } from "../stores/useAuthStore";

/**
 * 登录页：全站只认 aijiekou 平台账号（与拆剧助手同一套账号密码）。
 * 无 loohii 本地注册通道——新用户请先在 aijiekou 平台注册，同 email 首次登录自动建影子账号。
 */
export function AuthPage() {
  const navigate = useNavigate();
  const signIn = useAuthStore(state => state.signIn);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signIn(email, password);
      if (result.success) {
        navigate("/app/dashboard");
      } else {
        setError(result.error || "登录失败");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Brand Side - Hidden on Mobile */}
      <div className="hidden lg:flex flex-1 flex-col justify-between p-12 relative overflow-hidden bg-[#141416] border-r border-[#2A2A30]">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-transparent" />
        <div className="absolute -left-48 top-1/4 w-96 h-96 bg-primary/20 blur-[128px] rounded-full" />

        <Link to="/" className="flex items-center gap-2 font-bold text-xl tracking-tight relative z-10 text-white">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/90 text-white">
            L
          </div>
          鹿绘AI
        </Link>

        <div className="relative z-10 max-w-md">
          <h2 className="text-4xl font-bold mb-4 leading-tight">释放你的想象力</h2>
          <p className="text-[#6B6B72] text-lg">加入数以万计的创作者，使用鹿绘AI将脑海中的故事变成触手可及的视觉盛宴。</p>
        </div>
      </div>

      {/* Form Side */}
      <div className="relative flex flex-1 flex-col items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-sm lh-card rounded-xl border p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-extrabold text-[#E8E8EC] mb-2">欢迎回来</h1>
            <p className="text-[#6B6B72] text-sm">
              使用 aijiekou 平台账号登录（与拆剧助手同一套账号密码）
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-300">邮箱</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                <Input
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`pl-9 h-11 ${error && error.includes("邮箱") ? "border-red-500 focus-visible:ring-red-500/50" : ""}`}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-300">密码</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`pl-9 h-11 ${error && error.includes("密码") ? "border-red-500 focus-visible:ring-red-500/50" : ""}`}
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 mt-6 text-base disabled:opacity-50"
            >
              {loading ? "登录中..." : "登录"}
            </Button>
          </form>

          <p className="text-center text-sm text-[#6B6B72] mt-8">
            还没有账号？请先在 aijiekou 平台（拆剧助手）注册，再用同一邮箱登录。
          </p>
        </div>
      </div>
    </div>
  );
}
