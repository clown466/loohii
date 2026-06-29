import React from "react";
import { Link } from "react-router";
import { ChevronRight, Play, LayoutDashboard, Wand2, Users, ArrowRight } from "lucide-react";
import { Button } from "../components/ui/button";

export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-zinc-50">
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-zinc-800/50 bg-background/80 px-4 backdrop-blur sm:px-6 lg:px-12">
        <div className="flex items-center gap-2 font-bold text-xl tracking-tight">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/90 text-white">
            L
          </div>
          鹿绘AI
        </div>
        
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-400">
          <a href="#features" className="hover:text-zinc-50 transition-colors">功能</a>
          <a href="#pricing" className="hover:text-zinc-50 transition-colors">定价</a>
          <a href="#showcase" className="hover:text-zinc-50 transition-colors">案例</a>
        </nav>

        <div className="flex items-center gap-3 sm:gap-4">
          <Link to="/login" className="text-sm font-medium text-zinc-300 hover:text-white transition-colors">登录</Link>
          <Button asChild className="bg-primary hover:bg-primary/90 max-[360px]:px-3">
            <Link to="/register">免费开始</Link>
          </Button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center">
        {/* Hero Section */}
        <section className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-16 text-center sm:px-6 md:py-32">
          <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm text-primary mb-8 backdrop-blur-sm">
            <span className="flex h-2 w-2 rounded-full bg-primary/90 mr-2 animate-pulse"></span>
            鹿绘AI 2.0 现已发布，搭载全新 AI 引擎
          </div>
          
          <h1 className="mb-6 max-w-4xl bg-gradient-to-br from-white to-zinc-500 bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-5xl md:text-7xl">
            AI 驱动的专业动画与<br />漫画创作平台
          </h1>
          
          <p className="text-lg md:text-xl text-zinc-400 max-w-2xl mb-10 leading-relaxed">
            告别繁琐的分镜绘制和渲染等待。通过节点化工作流与专属 AI Agent 协同，让你的每个好点子都能在几分钟内变成视觉杰作。
          </p>
          
          <div className="flex w-full flex-col items-center gap-4 sm:w-auto sm:flex-row">
            <Button asChild size="lg" className="h-14 px-8 text-base bg-primary hover:bg-primary/90 gap-2 w-full sm:w-auto">
              <Link to="/register">
                立即开始创作 <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="h-14 px-8 text-base gap-2 w-full sm:w-auto bg-[#141416] border-zinc-800 hover:bg-layer-4">
              <Play className="h-4 w-4" /> 观看演示
            </Button>
          </div>
        </section>

        {/* Hero Image Mockup */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24">
          <div className="rounded-2xl border border-zinc-800 bg-[#141416] p-2 shadow-2xl relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-tr from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
            <img src="https://images.unsplash.com/photo-1618331835717-801e976710b2?w=1600&q=80" alt="App Interface" className="rounded-xl w-full h-auto object-cover aspect-[16/9]" />
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="w-full border-y border-zinc-800 bg-[#141416] py-16 sm:py-24">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">专为现代创作者打造</h2>
              <p className="text-zinc-400 max-w-2xl mx-auto">整合了最先进的 AI 生成模型与节点式工作流，给你前所未有的控制力。</p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {[
                { icon: <LayoutDashboard />, title: "节点化无限画布", desc: "以可视化的方式组织分镜、角色和资产，清晰管理复杂的创作流程和逻辑分支。" },
                { icon: <Wand2 />, title: "全能 AI Agent 辅助", desc: "无论是修改画面细节、延伸剧情还是保持角色一致性，AI 助手都在你身边随时待命。" },
                { icon: <Users />, title: "预设系统与协作", desc: "保存你的专属风格预设、提示词模板和导演指导，随时在团队间共享，保证风格统一。" }
              ].map((feature, i) => (
                <div key={i} className="bg-background border border-zinc-800 p-8 rounded-2xl hover:border-zinc-600 transition-colors">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-6">
                    {React.cloneElement(feature.icon as React.ReactElement, { className: "h-6 w-6" })}
                  </div>
                  <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
                  <p className="text-zinc-400 leading-relaxed">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-800 py-12 bg-background">
        <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 font-bold tracking-tight">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-layer-4 text-zinc-300 text-xs">L</div>
            鹿绘AI © 2026
          </div>
          <div className="text-sm text-zinc-500">
            京ICP备12345678号
          </div>
        </div>
      </footer>
    </div>
  );
}
