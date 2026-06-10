import { create } from 'zustand'
import { AgentConversation, apiClient, AgentSendMessageRequest } from '../lib/apiClient'

export const AGENT_ACTIONS_APPLIED_EVENT = 'loohii:agent-actions-applied'

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  metadata?: {
    conversationId?: string
    progress?: number
    imageUrl?: string
    actions?: { label: string; action: string }[]
    actionResults?: Array<Record<string, unknown>>
    status?: string
  }
}

interface AgentStore {
  messages: AgentMessage[]
  conversations: AgentConversation[]
  activeConversationId: string
  activeProjectId: string
  isTyping: boolean
  isLoadingConversations: boolean
  isLoadingMessages: boolean
  runningConversationId: string
  startNewConversation: (projectId?: string) => string
  loadConversations: (projectId: string) => Promise<void>
  loadConversationMessages: (projectId: string, conversationId: string, options?: { silent?: boolean; background?: boolean }) => Promise<void>
  deleteConversation: (projectId: string, conversationId: string) => Promise<void>
  sendMessage: (content: string, options?: Omit<AgentSendMessageRequest, 'content'>) => void
  clearMessages: () => void
}

const mockResponses: Record<string, string> = {
  '生成': '好的，正在为你生成分镜画面，请稍候...',
  '角色': '收到，我来帮你调整角色设定。你想修改哪些属性？',
  '风格': '了解，我会根据新的风格重新生成画面。',
  '修改': '没问题，请告诉我具体要修改的内容。',
  '添加': '好的，我来帮你添加新的内容到画布上。',
}

function getResponse(content: string): string {
  for (const [keyword, response] of Object.entries(mockResponses)) {
    if (content.includes(keyword)) {
      return response
    }
  }
  return '收到，正在处理你的请求...'
}

function generateMessageId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function generateConversationId(projectId?: string): string {
  const scope = projectId ? `project:${projectId}` : 'agent'
  return `${scope}:chat:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export const useAgentStore = create<AgentStore>((set) => ({
  messages: [],
  conversations: [],
  activeConversationId: '',
  activeProjectId: '',
  isTyping: false,
  isLoadingConversations: false,
  isLoadingMessages: false,
  runningConversationId: '',

  startNewConversation: (projectId) => {
    const conversationId = generateConversationId(projectId)
    set({
      activeConversationId: conversationId,
      activeProjectId: projectId || '',
      messages: [],
      isTyping: false,
      runningConversationId: '',
    })
    return conversationId
  },

  loadConversations: async (projectId) => {
    if (!projectId) return
    set((state) => ({
      isLoadingConversations: true,
      activeProjectId: projectId,
      messages: state.activeProjectId && state.activeProjectId !== projectId ? [] : state.messages,
    }))
    try {
      const conversations = await apiClient.listAgentConversations(projectId)
      const previous = useAgentStore.getState()
      const activeConversationId = belongsToProjectConversation(previous.activeConversationId, projectId)
        ? previous.activeConversationId
        : conversations[0]?.id || generateConversationId(projectId)
      set({ conversations, activeConversationId, activeProjectId: projectId })
      if (conversations.some((conversation) => conversation.id === activeConversationId) && previous.activeConversationId !== activeConversationId) {
        void useAgentStore.getState().loadConversationMessages(projectId, activeConversationId)
      }
    } finally {
      set({ isLoadingConversations: false })
    }
  },

  loadConversationMessages: async (projectId, conversationId, options) => {
    if (!projectId || !conversationId) return
    const background = options?.background === true
    if (!background) {
      set({ ...(options?.silent ? {} : { isLoadingMessages: true, isTyping: false }), activeConversationId: conversationId, activeProjectId: projectId })
    } else {
      set({ activeProjectId: projectId })
    }
    try {
      const messages = await apiClient.loadAgentConversationMessages(projectId, conversationId)
      const mappedMessages = messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          timestamp: message.createdAt ? new Date(message.createdAt).getTime() : Date.now(),
          metadata: message.metadata,
      }))
      const hasRunningAssistant = mappedMessages.some((message) => message.role === 'assistant' && message.metadata?.status === 'RUNNING')
      const latestCompletedWithActions = [...mappedMessages]
        .reverse()
        .find((message) => message.role === 'assistant' && message.metadata?.status !== 'RUNNING' && Array.isArray(message.metadata?.actionResults))
      dispatchAgentActionsApplied(projectId, latestCompletedWithActions?.metadata?.actionResults)
      if (background) {
        set((state) => ({
          runningConversationId: hasRunningAssistant ? conversationId : '',
          isTyping: state.activeConversationId === conversationId ? hasRunningAssistant : state.isTyping,
        }))
        return
      }
      set({
        messages: mappedMessages,
        isTyping: hasRunningAssistant,
        runningConversationId: hasRunningAssistant ? conversationId : '',
      })
    } finally {
      if (!options?.silent) set({ isLoadingMessages: false })
    }
  },

  deleteConversation: async (projectId, conversationId) => {
    if (!projectId || !conversationId) return
    const ok = await apiClient.deleteAgentConversation(projectId, conversationId)
    if (!ok) return

    const state = useAgentStore.getState()
    const remaining = state.conversations.filter((conversation) => conversation.id !== conversationId)
    const wasActive = state.activeConversationId === conversationId
    set({
      conversations: remaining,
      ...(wasActive
        ? {
            activeConversationId: remaining[0]?.id || generateConversationId(projectId),
            messages: [],
            isTyping: false,
            runningConversationId: '',
          }
        : {}),
    })

    if (wasActive && remaining[0]?.id) {
      void useAgentStore.getState().loadConversationMessages(projectId, remaining[0].id)
    }
  },

  sendMessage: (content: string, options) => {
    const conversationId = options?.conversationId || generateConversationId(options?.projectId)
    const userMessage: AgentMessage = {
      id: generateMessageId(),
      role: 'user',
      content,
      timestamp: Date.now(),
      metadata: { conversationId },
    }

    set((state) => ({
      activeConversationId: conversationId,
      activeProjectId: options?.projectId || state.activeProjectId,
      messages: [...state.messages, userMessage],
      isTyping: true,
      runningConversationId: conversationId,
    }))

    apiClient.sendAgentMessage({ content, ...options, conversationId }).then((response) => {
      if (!response) {
        set((state) => ({
          messages: [...state.messages, {
            id: generateMessageId(),
            role: 'assistant',
            content: '请求已提交，正在等待后端返回...',
            timestamp: Date.now(),
            metadata: { conversationId, status: 'RUNNING' },
          }],
          isTyping: true,
          runningConversationId: conversationId,
        }))
        return
      }

      const assistantMessage: AgentMessage = {
        id: response.id ?? generateMessageId(),
        role: 'assistant',
        content: response.content,
        timestamp: Date.now(),
        metadata: {
          ...response.metadata,
          conversationId: response.metadata?.conversationId || conversationId,
        },
      }
      dispatchAgentActionsApplied(options?.projectId, assistantMessage.metadata?.actionResults)
      const isRunning = assistantMessage.metadata?.status === 'RUNNING'
      set((state) => ({
        messages: [...state.messages, assistantMessage],
        conversations: upsertLocalConversation(state.conversations, {
          id: conversationId,
          title: content.slice(0, 28) || '新对话',
          preview: response.content,
          messageCount: state.messages.length + 2,
          createdAt: new Date(userMessage.timestamp).toISOString(),
          updatedAt: new Date(assistantMessage.timestamp).toISOString(),
        }),
        isTyping: isRunning,
        runningConversationId: isRunning ? conversationId : '',
      }))
    }).catch(() => {
      set((state) => ({
        messages: [...state.messages, {
          id: generateMessageId(),
          role: 'assistant',
          content: '请求已提交，但当前页面连接已中断。正在尝试从历史对话恢复结果...',
          timestamp: Date.now(),
          metadata: { conversationId, status: 'RUNNING' },
        }],
        isTyping: true,
        runningConversationId: conversationId,
      }))
    })
  },

  clearMessages: () => set({ messages: [], isTyping: false, runningConversationId: '' }),
}))

function dispatchAgentActionsApplied(projectId: string | undefined, actionResults: Array<Record<string, unknown>> | undefined) {
  if (!projectId || !Array.isArray(actionResults) || actionResults.length === 0) return
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(AGENT_ACTIONS_APPLIED_EVENT, {
    detail: { projectId, actionResults },
  }))
}

function belongsToProjectConversation(conversationId: string, projectId: string): boolean {
  const scope = `project:${projectId}`
  return conversationId === scope || conversationId.startsWith(`${scope}:`)
}

function upsertLocalConversation(conversations: AgentConversation[], conversation: AgentConversation): AgentConversation[] {
  const next = conversations.filter((item) => item.id !== conversation.id)
  return [conversation, ...next]
}
