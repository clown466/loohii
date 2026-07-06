import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Github, Mail, Lock, User } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useAuthStore } from "../stores/useAuthStore";

export function AuthPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const isLogin = location.pathname === "/login";

  const signIn = useAuthStore(state => state.signIn);
  const signUp = useAuthStore(state => state.signUp);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      let result: { success: boolean; error?: string };

      if (isLogin) {
        result = await signIn(email, password);
      } else {
        result = await signUp(name, email, password);
      }

      if (result.success) {
        navigate("/app/dashboard");
      } else {
        setError(result.error || "操作失败");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = () => {
    alert("密码重置功能开发中");
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
            <h1 className="text-2xl font-extrabold text-[#E8E8EC] mb-2">{isLogin ? "欢迎回来" : "创建账号"}</h1>
            <p className="text-[#6B6B72] text-sm">
              {isLogin ? "输入您的信息登录到鹿绘AI" : "开始您的 AI 动画创作之旅"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-300">昵称</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <Input
                    type="text"
                    placeholder="你的昵称"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="pl-9 h-11"
                  />
                </div>
              </div>
            )}

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
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium text-zinc-300">密码</label>
                {isLogin && (
                  <button type="button" onClick={handleForgotPassword} className="text-xs text-primary hover:underline">
                    忘记密码？
                  </button>
                )}
              </div>
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
              {loading ? "处理中..." : (isLogin ? "登录" : "注册")}
            </Button>

            <div className="relative py-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#2A2A30]" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-[#19191E] px-2 text-[#6B6B72]">或使用以下方式</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button type="button" variant="outline" className="h-11 bg-[#141416] border-[#2A2A30] hover:bg-layer-4">
                <Github className="h-4 w-4 mr-2" />
                GitHub
              </Button>
              <Button type="button" variant="outline" className="h-11 bg-[#141416] border-[#2A2A30] hover:bg-layer-4">
                Google
              </Button>
            </div>
          </form>

          <p className="text-center text-sm text-[#6B6B72] mt-8">
            {isLogin ? "没有账号？" : "已有账号？"}
            <Link to={isLogin ? "/register" : "/login"} className="text-primary hover:underline ml-1 font-medium">
              {isLogin ? "去注册" : "去登录"}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
