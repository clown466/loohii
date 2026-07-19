import React, { Suspense, useState, useRef, useEffect } from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router";
import { ErrorBoundary } from "../components/ErrorBoundary";
import {
  Bell,
  Bot,
  ChevronRight,
  Coins,
  MessageSquare,
  Settings,
  X,
  Plus,
  Send,
  Paperclip,
  Menu,
  ChevronLeft,
  LogOut,
  Trash2
} from "lucide-react";
import { cn } from "../utils/cn";
import { Button } from "../components/ui/button";
import { UserAvatar } from "../components/UserAvatar";
import { useAuthStore } from "../stores/useAuthStore";
import { useAgentStore } from "../stores/useAgentStore";
import { useCanvasStore } from "../stores/useCanvasStore";
import { useProjectStore } from "../stores/useProjectStore";

export function MainLayout() {
  const [isNavMenuOpen, setIsNavMenuOpen] = useState(false);
  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [isAgentHistoryOpen, setIsAgentHistoryOpen] = useState(false);
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const avatarMenuRef = useRef<HTMLDivElement>(null);

  const user = useAuthStore(state => state.user);
  const signOut = useAuthStore(state => state.signOut);
  const projects = useProjectStore((state) => state.projects);
  const loadProjects = useProjectStore((state) => state.loadProjects);

  const isProjectPage = location.pathname.includes('/app/project/');
  const projectId = location.pathname.match(/\/app\/project\/([^/]+)/)?.[1] || '';
  const currentProject = projects.find((project) => project.id === projectId);

  const messages = useAgentStore((s) => s.messages);
  const conversations = useAgentStore((s) => s.conversations);
  const activeConversationId = useAgentStore((s) => s.activeConversationId);
  const isTyping = useAgentStore((s) => s.isTyping);
  const isLoadingConversations = useAgentStore((s) => s.isLoadingConversations);
  const isLoadingMessages = useAgentStore((s) => s.isLoadingMessages);
  const runningConversationId = useAgentStore((s) => s.runningConversationId);
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const startNewConversation = useAgentStore((s) => s.startNewConversation);
  const loadAgentConversations = useAgentStore((s) => s.loadConversations);
  const loadAgentConversationMessages = useAgentStore((s) => s.loadConversationMessages);
  const deleteAgentConversation = useAgentStore((s) => s.deleteConversation);
  const [agentInput, setAgentInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const agentInputRef = useRef<HTMLTextAreaElement>(null);
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  const agentMetadata = latestAssistant?.metadata as any;
  const agentModeLabel = formatAgentModeLabel(agentMetadata);
  const sendProjectAgentMessage = (content: string) => {
    sendMessage(content, {
      projectId: projectId || undefined,
      conversationId: activeConversationId || undefined,
      context: {
        path: location.pathname,
        projectTitle: currentProject?.title,
        canvas: buildAgentCanvasContext(projectId),
      },
    });
  };

  const handleStartNewAgentConversation = () => {
    startNewConversation(projectId || undefined);
    setIsAgentHistoryOpen(false);
  };

  const handleLoadAgentConversation = (conversationId: string) => {
    if (!projectId) return;
    void loadAgentConversationMessages(projectId, conversationId);
    setIsAgentHistoryOpen(false);
  };

  const handleDeleteAgentConversation = (event: React.MouseEvent, conversationId: string) => {
    event.stopPropagation();
    if (!projectId) return;
    const confirmed = window.confirm("删除这个历史对话？删除后不可恢复。");
    if (!confirmed) return;
    void deleteAgentConversation(projectId, conversationId);
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  useEffect(() => {
    const input = agentInputRef.current;
    if (!input) return;
    input.style.height = '0px';
    input.style.height = `${Math.max(52, input.scrollHeight)}px`;
  }, [agentInput]);

  useEffect(() => {
    if (!projectId || !runningConversationId) return;
    const timer = window.setInterval(() => {
      void loadAgentConversationMessages(projectId, runningConversationId, {
        silent: true,
        background: runningConversationId !== activeConversationId,
      });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeConversationId, loadAgentConversationMessages, projectId, runningConversationId]);

  useEffect(() => {
    // 路由切换时收起窄屏导航下拉
    setIsNavMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (isProjectPage && projectId && projectId !== "new") {
      void loadProjects();
    }
  }, [isProjectPage, loadProjects, projectId]);

  useEffect(() => {
    if (isProjectPage && projectId && projectId !== "new") {
      void loadAgentConversations(projectId);
    }
  }, [isProjectPage, loadAgentConversations, projectId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (avatarMenuRef.current && !avatarMenuRef.current.contains(event.target as Node)) {
        setIsAvatarMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSignOut = () => {
    signOut();
    navigate("/");
  };

  return (
    <div className="flex h-screen h-[100dvh] w-full flex-col overflow-hidden bg-background text-[16px] text-foreground">
      {/* Topbar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#222226] bg-[#141417] px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/app/dashboard" className="flex min-w-0 items-center gap-2 font-bold text-base tracking-tight hover:opacity-80 transition-opacity sm:text-lg">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-gradient-to-br from-primary to-primary/80 text-white">
              L
            </div>
            <span className="truncate">鹿绘AI</span>
          </Link>
          {/* 顶栏文字导航（原侧栏入口）：当前页琥珀下划线 */}
          <nav className="ml-3 hidden items-stretch gap-4 self-stretch md:flex">
            <Link to="/app/dashboard" data-active={location.pathname === '/app/dashboard'} className="lh-topnav">主页</Link>
            {isProjectPage && projectId && projectId !== 'new' && (
              <>
                <Link to={`/app/project/${projectId}/setup`} data-active={location.pathname.includes('/setup')} className="lh-topnav">全局设定</Link>
                <Link to={`/app/project/${projectId}/canvas`} data-active={location.pathname.includes('/canvas')} className="lh-topnav">节点画布</Link>
                <Link to={`/app/project/${projectId}/records`} data-active={location.pathname.includes('/records')} className="lh-topnav">生成记录</Link>
              </>
            )}
          </nav>

          {/* 窄屏：导航折叠为下拉 */}
          <div className="relative md:hidden">
            <button
              type="button"
              aria-label="打开导航"
              title="导航"
              onClick={() => setIsNavMenuOpen((value) => !value)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#71717a] transition-colors hover:bg-accent hover:text-foreground"
            >
              <Menu className="h-4 w-4" />
            </button>
            {isNavMenuOpen && (
              <div className="lh-anim-menu absolute left-0 top-full z-50 mt-2 w-40 rounded-lg border border-border bg-card py-1 shadow-xl">
                <Link to="/app/dashboard" className="block px-3 py-2 text-[15px] text-foreground transition-colors hover:bg-accent">主页</Link>
                {isProjectPage && projectId && projectId !== 'new' && (
                  <>
                    <div className="mx-3 my-1 h-px bg-layer-4" />
                    <Link to={`/app/project/${projectId}/setup`} className="block px-3 py-2 text-[15px] text-foreground transition-colors hover:bg-accent">全局设定</Link>
                    <Link to={`/app/project/${projectId}/canvas`} className="block px-3 py-2 text-[15px] text-foreground transition-colors hover:bg-accent">节点画布</Link>
                    <Link to={`/app/project/${projectId}/records`} className="block px-3 py-2 text-[15px] text-foreground transition-colors hover:bg-accent">生成记录</Link>
                  </>
                )}
                <div className="mx-3 my-1 h-px bg-layer-4" />
                <Link to="/app/settings/profile" className="block px-3 py-2 text-[15px] text-foreground transition-colors hover:bg-accent">设置</Link>
              </div>
            )}
          </div>

          {isProjectPage && (
            <div className="ml-2 hidden min-w-0 items-center gap-2 text-sm sm:flex">
              <ChevronRight className="h-4 w-4 text-[#71717a]" />
              <Link to={`/app/project/${projectId}/setup`} className="truncate font-medium hover:text-primary transition-colors">
                {currentProject?.title ?? "项目设置"}
              </Link>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <div className="flex h-8 items-center gap-1.5 rounded-full border border-border bg-layer-4 px-2 text-xs sm:px-3">
            <Coins className="h-3.5 w-3.5 text-[#f59e0b]" />
            <span className="lh-tnum font-medium">{user?.credits?.toLocaleString() ?? '0'} 积分</span>
          </div>
          <Link
            to="/app/settings/profile"
            title="设置"
            aria-label="设置"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-accent",
              location.pathname.includes('/settings') ? "text-primary" : "text-[#71717a] hover:text-foreground"
            )}
          >
            <Settings className="h-4 w-4" />
          </Link>
          <button className="relative h-8 w-8 flex items-center justify-center text-[#71717a] hover:text-foreground transition-colors rounded-full hover:bg-accent">
            <Bell className="h-4 w-4" />
            <span className="absolute top-2 right-2.5 h-1.5 w-1.5 rounded-full bg-[#ef4444]"></span>
          </button>
          <div className="relative" ref={avatarMenuRef}>
            <button
              onClick={() => setIsAvatarMenuOpen(!isAvatarMenuOpen)}
              className="h-8 w-8 rounded-full border border-border overflow-hidden ml-1 hover:border-primary transition-colors"
            >
              <UserAvatar name={user?.name} seed={user?.id || user?.email} src={user?.avatar} alt="User" className="h-full w-full" />
            </button>
            {isAvatarMenuOpen && (
              <div className="lh-anim-menu absolute right-0 top-full z-50 mt-2 w-40 rounded-lg border border-border bg-card py-1 shadow-xl">
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-2 w-full px-3 py-2 text-[15px] text-foreground hover:bg-accent transition-colors"
                >
                  <LogOut className="h-4 w-4 text-[#71717a]" />
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Content Router View */}
        <main className="relative min-w-0 flex-1 overflow-auto bg-background">
          <ErrorBoundary>
            <Suspense fallback={
              <div className="flex h-full items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
              </div>
            }>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>

        {/* AI Agent Panel */}
        {isProjectPage && (
          <aside 
            className={cn(
              "flex flex-col border-l border-[#222226] bg-[#141417] shadow-2xl transition-all duration-300 md:absolute md:bottom-0 md:right-0 md:top-0 md:z-20 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:top-12 max-md:z-50 max-md:border-l-0",
              isAgentOpen
                ? "w-full translate-x-0 md:w-[360px]"
                : "w-full translate-x-full overflow-hidden border-none md:w-0 md:translate-x-0"
            )}
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#222226] bg-card px-3 sm:h-14 sm:px-4">
              <div className="flex min-w-0 items-center gap-2 font-medium text-[16px]">
                <Bot className="h-4 w-4 shrink-0 text-primary" />
                项目总控
                <span className="h-2 w-2 rounded-full bg-[#22c55e]"></span>
                <span className="truncate rounded border border-border bg-[#141417] px-1.5 py-0.5 text-[12px] font-normal text-muted-foreground">
                  {agentModeLabel}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="新对话"
                  className="h-7 w-7 rounded-full text-[#71717a] hover:bg-accent hover:text-foreground"
                  onClick={handleStartNewAgentConversation}
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="历史对话"
                  className={cn(
                    "h-7 w-7 rounded-full text-[#71717a] hover:bg-accent hover:text-foreground",
                    isAgentHistoryOpen && "bg-accent text-foreground"
                  )}
                  onClick={() => setIsAgentHistoryOpen((value) => !value)}
                >
                  <MessageSquare className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-[#71717a] hover:text-foreground hover:bg-accent" onClick={() => setIsAgentOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {isAgentHistoryOpen && (
              <div className="shrink-0 border-b border-[#222226] bg-[#141417] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[14px] font-medium text-[#d4d4d8]">历史对话</span>
                  <button
                    type="button"
                    className="text-[14px] text-primary transition-colors hover:text-foreground"
                    onClick={() => projectId && void loadAgentConversations(projectId)}
                  >
                    刷新
                  </button>
                </div>
                <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                  {isLoadingConversations && (
                    <div className="rounded-md border border-border bg-[#141417] px-3 py-2 text-[14px] text-muted-foreground">
                      正在加载历史...
                    </div>
                  )}
                  {!isLoadingConversations && conversations.length === 0 && (
                    <div className="rounded-md border border-border bg-[#141417] px-3 py-2 text-[14px] text-muted-foreground">
                      还没有历史对话
                    </div>
                  )}
                  {!isLoadingConversations && conversations.map((conversation) => (
                    <div
                      key={conversation.id}
                      className={cn(
                        "group relative rounded-md border pr-9 transition-colors",
                        conversation.id === activeConversationId
                          ? "border-primary/70 bg-layer-4"
                          : "border-border bg-[#141417] hover:border-[#3f3f46] hover:bg-card"
                      )}
                    >
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-left"
                        onClick={() => handleLoadAgentConversation(conversation.id)}
                      >
                        <div className="truncate text-[15px] font-medium text-foreground">{conversation.title}</div>
                        <div className="mt-1 line-clamp-2 text-[14px] leading-5 text-muted-foreground">{conversation.preview}</div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-[13px] text-[#71717a]">
                          <span>{formatAgentConversationTime(conversation.updatedAt)}</span>
                          <span>{conversation.messageCount} 条</span>
                        </div>
                      </button>
                      <button
                        type="button"
                        title="删除对话"
                        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md text-[#71717a] opacity-0 transition hover:bg-[#3f1f25] hover:text-[#f87171] group-hover:opacity-100 focus:opacity-100"
                        onClick={(event) => handleDeleteAgentConversation(event, conversation.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Agent Chat Area */}
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto bg-[#141417] p-3 sm:gap-5 sm:p-4">
              {/* Welcome message with suggestions */}
              {isLoadingMessages && (
                <div className="w-full rounded-lg border-l-2 border-primary bg-[#1c1c1f] p-3.5 text-[16px] text-muted-foreground shadow-sm sm:w-[90%]">
                  正在加载对话...
                </div>
              )}

              {!isLoadingMessages && messages.length === 0 && (
                <div className="w-full rounded-lg border-l-2 border-primary bg-[#1c1c1f] p-3.5 text-[16px] text-foreground shadow-sm sm:w-[90%]">
                  <p className="mb-2">{currentProject ? `${currentProject.title} 总控已就绪。` : '项目总控已就绪。'}</p>
                  <p className="mb-1 text-muted-foreground">需要我帮你：</p>
                  <ul className="list-disc pl-4 space-y-1.5 text-primary cursor-pointer">
                    <li className="hover:text-foreground transition-colors" onClick={() => { sendProjectAgentMessage("继续生成剩余分镜"); }}>继续生成剩余分镜</li>
                    <li className="hover:text-foreground transition-colors" onClick={() => { sendProjectAgentMessage("检查当前集流程状态"); }}>检查当前集流程状态</li>
                    <li className="hover:text-foreground transition-colors" onClick={() => { sendProjectAgentMessage("根据项目全局设定优化分镜"); }}>根据全局设定优化分镜</li>
                  </ul>
                </div>
              )}

              {/* Messages */}
              {!isLoadingMessages && messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "whitespace-pre-wrap break-words rounded-lg p-3.5 text-[16px] leading-relaxed text-foreground shadow-sm",
                    msg.role === 'user'
                      ? "w-[92%] self-end bg-primary/15 sm:w-[85%]"
                      : "w-full border-l-2 border-primary bg-[#1c1c1f] sm:w-[90%]"
                  )}
                >
                  <div>{msg.content}</div>
                  {msg.role === 'assistant' && (
                    <AgentActionLog metadata={msg.metadata as Record<string, unknown> | undefined} />
                  )}
                </div>
              ))}

              {/* Typing indicator */}
              {isTyping && (
                <div className="w-full rounded-lg border-l-2 border-primary bg-[#1c1c1f] p-3.5 text-[16px] text-muted-foreground shadow-sm sm:w-[90%]">
                  <div className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="inline-block h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="inline-block h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Agent Input */}
            <div className="shrink-0 border-t border-[#222226] bg-card p-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (agentInput.trim()) {
                    sendProjectAgentMessage(agentInput.trim());
                    setAgentInput("");
                  }
                }}
                className="flex min-h-[72px] items-end rounded-lg border border-border bg-layer-4 p-1 transition-colors focus-within:border-primary"
              >
                <Button type="button" variant="ghost" size="icon" className="mb-0.5 ml-1 h-8 w-8 shrink-0 text-[#71717a] hover:text-foreground">
                  <Paperclip className="h-4 w-4" />
                </Button>
                <textarea
                  ref={agentInputRef}
                  placeholder="消息输入或 / 命令..."
                  rows={2}
                  className="min-h-[52px] min-w-0 flex-1 resize-none overflow-hidden border-none bg-transparent px-2 py-2 text-[16px] leading-5 text-foreground placeholder:text-[#71717a] focus:outline-none"
                  value={agentInput}
                  onChange={(e) => setAgentInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
                    e.preventDefault();
                    if (agentInput.trim()) {
                      sendProjectAgentMessage(agentInput.trim());
                      setAgentInput("");
                    }
                  }}
                />
                <Button type="submit" size="icon" className="mb-0.5 mr-1 h-8 w-8 shrink-0 rounded-md border-0 bg-gradient-to-r from-primary to-primary/80 text-white hover:opacity-90">
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </aside>
        )}

        {/* Folded Agent Tab */}
        {isProjectPage && !isAgentOpen && (
          <button 
            className="absolute top-1/2 right-0 z-20 flex h-20 w-6 -translate-y-1/2 items-center justify-center rounded-l-2xl border border-r-0 border-border bg-layer-4 text-[#71717a] shadow-lg transition-colors hover:bg-accent hover:text-foreground sm:h-24"
            onClick={() => setIsAgentOpen(true)}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function formatAgentConversationTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AgentActionLog({ metadata }: { metadata?: Record<string, unknown> }) {
  const actionResults = Array.isArray(metadata?.actionResults)
    ? metadata.actionResults.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    : [];
  const sourceLabel = formatAgentModeLabel(metadata);
  const statusLabel = formatAgentStatusLabel(stringValue(metadata?.status));
  if (!actionResults.length && !metadata?.source && !metadata?.status) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-border pt-2 text-[14px] leading-5 text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-[#3f3f46] bg-[#141417] px-1.5 py-0.5 text-[13px] text-[#d4d4d8]">
          {sourceLabel}
        </span>
        {statusLabel && (
          <span className={cn(
            "rounded border px-1.5 py-0.5 text-[13px]",
            metadata?.status === "FAILED"
              ? "border-[#7f1d1d] bg-[#3f1f25] text-[#fca5a5]"
              : metadata?.status === "RUNNING"
                ? "border-[#854d0e] bg-[#2a2112] text-[#fcd34d]"
                : "border-[#14532d] bg-[#14251a] text-[#86efac]"
          )}>
            {statusLabel}
          </span>
        )}
      </div>
      {actionResults.length > 0 && (
        <div className="space-y-1">
          {actionResults.map((result, index) => (
            <div key={`${stringValue(result.type)}-${index}`} className="rounded-md border border-border bg-[#141417] px-2 py-1.5">
              <span className={result.ok === false ? "text-[#fca5a5]" : "text-[#d4d4d8]"}>
                {index + 1}. {formatAgentActionResult(result)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatAgentModeLabel(metadata?: Record<string, unknown>): string {
  const source = stringValue(metadata?.source);
  const agent = isPlainRecord(metadata?.agent) ? metadata.agent : {};
  const mode = stringValue(metadata?.mode) || stringValue(agent.mode);
  const memoryProvider = stringValue(metadata?.memoryProvider) || stringValue(agent.memoryProvider);
  if (source === "hermes-agent") {
    return `Hermes${mode ? ` ${mode}` : ""}${memoryProvider === "honcho" ? " / Honcho" : ""}`;
  }
  if (source === "local-agent-controller:deterministic") return "本地兜底";
  if (source === "local-agent-controller") return "本地总控";
  if (source === "agent-runner") return "处理中";
  if (source === "backend-placeholder") return "后端占位";
  if (source) return source;
  return "本地总控";
}

function formatAgentStatusLabel(status: string): string {
  if (status === "RUNNING") return "执行中";
  if (status === "FAILED") return "失败";
  if (status === "NEEDS_ACTION") return "未完成";
  if (status === "COMPLETED") return "完成";
  return status;
}

function formatAgentActionResult(result: Record<string, unknown>): string {
  const type = stringValue(result.type) || "action";
  if (result.ok === false) {
    return `${formatAgentActionType(type)}失败：${stringValue(result.error) || "未知错误"}`;
  }
  const canvas = isPlainRecord(result.canvas) ? result.canvas : {};
  const nodes = numberOrString(result.nodes) || numberOrString(canvas.nodeCount);
  const edges = numberOrString(result.edges) || numberOrString(canvas.edgeCount);
  if (type === "load_canvas") {
    return `读取画布：${nodes || 0} 个节点 / ${edges || 0} 条连线${stringValue(result.sceneId) ? `，场景 ${stringValue(result.sceneId)}` : ""}`;
  }
  if (type === "update_canvas_node_prompt") {
    const fields = Array.isArray(result.updatedFields) ? result.updatedFields.map(stringValue).filter(Boolean).join("、") : "";
    return `更新提示词：${stringValue(result.nodeId) || "目标节点"}${fields ? `，字段 ${fields}` : ""}`;
  }
  if (type === "patch_canvas_node") {
    const fields = Array.isArray(result.updatedFields) ? result.updatedFields.map(stringValue).filter(Boolean).join("、") : "";
    return `更新节点：${stringValue(result.nodeId) || "目标节点"}${fields ? `，字段 ${fields}` : ""}`;
  }
  if (type === "connect_asset_to_clip") {
    return `连接资产：${stringValue(result.assetName) || "资产"}${numberOrString(result.targetCount) ? `，目标 ${numberOrString(result.targetCount)} 个` : ""}`;
  }
  if (type === "connect_asset_to_all_clips") {
    const parts = [
      numberOrString(result.targetClipCount) ? `${numberOrString(result.targetClipCount)} 个 Clip` : "",
      numberOrString(result.targetCount) ? `${numberOrString(result.targetCount)} 个目标节点` : "",
      numberOrString(result.edgeAddedCount) ? `新增 ${numberOrString(result.edgeAddedCount)} 条连线` : "",
    ].filter(Boolean).join("，");
    return `批量连接资产：${stringValue(result.assetName) || "资产"}${parts ? `，${parts}` : ""}`;
  }
  if (type === "remove_asset_from_clip") {
    const names = Array.isArray(result.assetNames) ? result.assetNames.map(stringValue).filter(Boolean).join("、") : "";
    const details = [
      numberOrString(result.removedCount) ? `删除 ${numberOrString(result.removedCount)} 个节点` : "",
      numberOrString(result.promptUpdateCount) ? `更新 ${numberOrString(result.promptUpdateCount)} 个提示词` : "",
    ].filter(Boolean).join("，");
    return `移除资产：${names || "资产"}${details ? `，${details}` : ""}`;
  }
  if (type === "create_canvas_image_generation") {
    return `提交生图：${stringValue(result.generationId) || "已提交"}${numberOrString(result.referenceImageCount) ? `，参考图 ${numberOrString(result.referenceImageCount)} 张` : ""}`;
  }
  if (type === "create_canvas_video_generation") {
    const video = stringValue(result.videoUrl) ? "，已取回视频" : "";
    return `提交视频：${stringValue(result.submitId) || stringValue(result.generationId) || "已提交"}${video}`;
  }
  if (type === "sync_episode_canvas") {
    return `同步本集画布：${nodes || 0} 个节点 / ${edges || 0} 条连线`;
  }
  if (type === "call_project_api") {
    return `调用接口：${stringValue(result.method)} ${stringValue(result.path)}${numberOrString(result.status) ? `，HTTP ${numberOrString(result.status)}` : ""}`;
  }
  return formatAgentActionType(type);
}

function formatAgentActionType(type: string): string {
  const labels: Record<string, string> = {
    load_canvas: "读取画布",
    update_canvas_node_prompt: "更新提示词",
    patch_canvas_node: "更新节点",
    connect_asset_to_clip: "连接资产",
    connect_asset_to_all_clips: "批量连接资产",
    remove_asset_from_clip: "移除资产",
    create_canvas_image_generation: "提交生图",
    create_canvas_video_generation: "提交视频",
    save_canvas: "保存画布",
    sync_episode_canvas: "同步画布",
    call_project_api: "调用接口",
  };
  return labels[type] || type;
}

function isPlainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberOrString(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

function buildAgentCanvasContext(projectId: string) {
  const canvas = useCanvasStore.getState();
  if (!projectId || canvas.activeProjectId !== projectId) {
    return {
      available: false,
      activeProjectId: canvas.activeProjectId,
      activeSceneId: canvas.activeSceneId,
      reason: "Canvas store is not currently scoped to this project.",
    };
  }

  const selectedNodes = canvas.nodes.filter((node) => node.selected);
  const visibleNodes = selectedNodes.length ? selectedNodes : canvas.nodes;
  const nodes = visibleNodes.slice(0, selectedNodes.length ? 12 : 24).map((node) => {
    const data = node.data && typeof node.data === "object" ? node.data as Record<string, unknown> : {};
    return {
      id: node.id,
      type: node.type,
      selected: Boolean(node.selected),
      parentId: node.parentId,
      title: shortAgentContextString(data.title),
      label: shortAgentContextString(data.label),
      name: shortAgentContextString(data.name),
      kind: shortAgentContextString(data.kind),
      workflowKind: shortAgentContextString(data.workflowKind),
      clipId: shortAgentContextString(data.clipId),
      clipTitle: shortAgentContextString(data.clipTitle),
      status: shortAgentContextString(data.status || data.videoStatus),
      prompt: shortAgentContextString(data.finalPrompt || data.videoPrompt || data.prompt || data.seedancePrompt, selectedNodes.length ? 500 : 180),
      hasImage: Boolean(data.outputImage || data.imageUrl || data.avatar || data.generatedImage),
      hasVideo: Boolean(data.outputVideo),
    };
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = canvas.edges
    .filter((edge) => nodeIds.has(edge.source) || nodeIds.has(edge.target))
    .slice(0, selectedNodes.length ? 48 : 36)
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
    }));

  return {
    available: true,
    activeProjectId: canvas.activeProjectId,
    activeSceneId: canvas.activeSceneId,
    nodeCount: canvas.nodes.length,
    edgeCount: canvas.edges.length,
    selectedNodeIds: selectedNodes.map((node) => node.id),
    nodes,
    edges,
    note: "Compact client summary only. Use load_canvas for authoritative canvas nodes, prompts, images, and edges before changing project state.",
    truncated: nodes.length < visibleNodes.length,
  };
}

function shortAgentContextString(value: unknown, limit = 240): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
