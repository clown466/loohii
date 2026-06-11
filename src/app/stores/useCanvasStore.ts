import { create } from 'zustand'
import { Node, Edge, Connection, addEdge } from '@xyflow/react'
import { apiClient } from '../lib/apiClient'

export type CanvasNodeKind = 'scene' | 'character' | 'episode' | 'asset' | 'workflow' | 'directorBoard' | 'imageInput' | 'generation' | 'video' | 'audio' | 'translation' | 'promptOptimizer' | 'promptInspector' | 'section'

interface CanvasStore {
  nodes: Node[]
  edges: Edge[]
  activeProjectId: string
  activeSceneId: string
  remoteUpdatedAt: string
  deletedNodeIds: Set<string>
  localRevision: number
  lastSavedRevision: number
  loadScene: (projectId: string, sceneId?: string) => Promise<void>
  saveScene: (projectId: string, sceneId?: string) => Promise<void>
  setNodes: (nodes: Node[]) => void
  setNodesTransient: (nodes: Node[]) => void
  setEdges: (edges: Edge[]) => void
  setEdgesTransient: (edges: Edge[]) => void
  applyRemoteScene: (scene: { projectId: string; sceneId?: string; nodes: Node[]; edges: Edge[]; updatedAt?: string }) => void
  markNodesDeleted: (ids: Iterable<string>) => void
  addNode: (type: CanvasNodeKind, position: { x: number; y: number }, data?: Record<string, unknown>) => string
  removeNode: (id: string) => void
  updateNodePosition: (id: string, position: { x: number; y: number }) => void
  updateNodeData: (id: string, data: Record<string, unknown>) => void
  onConnect: (connection: Connection) => void
}

const initialNodes: Node[] = [
  {
    id: 'char-1',
    type: 'character',
    position: { x: 50, y: 150 },
    data: {
      name: 'Kael',
      traits: '主角·男·25岁·赛博黑客',
      avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=100&q=80',
    },
  },
  {
    id: 'scene-1',
    type: 'scene',
    position: { x: 350, y: 100 },
    data: {
      title: '#1 开场',
      description: 'Kael 走在下着酸雨的霓虹街道上，神情凝重，背景是高耸的巨型企业大厦。',
      status: 'completed',
      image: 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?w=600&q=80',
    },
  },
  {
    id: 'scene-2',
    type: 'scene',
    position: { x: 700, y: 100 },
    data: {
      title: '#2 巷战',
      description: '突然，一群半机械暴徒从暗巷中冲出，包围了 Kael。',
      status: 'generating',
    },
  },
  {
    id: 'scene-3',
    type: 'scene',
    position: { x: 1050, y: 100 },
    data: {
      title: '#3 拔枪',
      description: 'Kael 拔出腰间的电磁手枪，枪口闪烁着蓝色的充能光芒。',
      status: 'waiting',
    },
  },
]

const initialEdges: Edge[] = [
  { id: 'e1', source: 'char-1', target: 'scene-1', animated: true, style: { stroke: '#6366f1' } },
  { id: 'e2', source: 'scene-1', target: 'scene-2', type: 'smoothstep' },
  { id: 'e3', source: 'scene-2', target: 'scene-3', type: 'smoothstep' },
]

let nodeCounter = 4
const DEFAULT_CANVAS_MIGRATED_PROJECT_KEY = 'loohii-canvas:default-migrated-project'
let remoteSaveInFlight: Promise<void> | null = null
let queuedRemoteSave: { projectId: string; sceneId: string } | null = null

function generateNodeId(type: string): string {
  return `${type}-${Date.now().toString(36)}-${(nodeCounter++).toString()}`
}

function storageKey(projectId = 'local', sceneId = 'default'): string {
  return `loohii-canvas:${projectId}:${sceneId}`
}

function stableCanvasStoreValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'object') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function canvasDataPatchChanges(current: unknown, patch: Record<string, unknown>): boolean {
  const source = current && typeof current === 'object' && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {}
  return Object.entries(patch).some(([key, value]) => stableCanvasStoreValue(source[key]) !== stableCanvasStoreValue(value))
}

type CanvasNodeSignatureMode = 'all' | 'render' | 'persist'
type CanvasEdgeSignatureMode = 'all' | 'persist'

function nodeSignature(node: Node, mode: CanvasNodeSignatureMode = 'all'): string {
  return [
    node.id,
    node.type || '',
    node.parentId || '',
    node.extent || '',
    node.expandParent ? '1' : '0',
    Number(node.zIndex ?? 0),
    Number(node.position?.x ?? 0),
    Number(node.position?.y ?? 0),
    Number(node.width ?? 0),
    Number(node.height ?? 0),
    mode === 'all' ? stableCanvasStoreValue(node.measured) : '',
    mode === 'all' && node.dragging ? '1' : '0',
    mode === 'all' && node.resizing ? '1' : '0',
    stableCanvasStoreValue(node.style),
    stableCanvasStoreValue(node.data),
    mode !== 'persist' && node.selected ? '1' : '0',
  ].join('|')
}

function edgeSignature(edge: Edge, mode: CanvasEdgeSignatureMode = 'all'): string {
  return [
    edge.id,
    edge.source,
    edge.target,
    edge.sourceHandle || '',
    edge.targetHandle || '',
    edge.type || '',
    edge.animated ? '1' : '0',
    stableCanvasStoreValue(edge.style),
    stableCanvasStoreValue(edge.data),
    mode !== 'persist' && edge.selected ? '1' : '0',
  ].join('|')
}

function nodeListsEqual(a: Node[], b: Node[], mode: CanvasNodeSignatureMode = 'all') {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    if (nodeSignature(a[index], mode) !== nodeSignature(b[index], mode)) return false
  }
  return true
}

function edgeListsEqual(a: Edge[], b: Edge[], mode: CanvasEdgeSignatureMode = 'all') {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    if (edgeSignature(a[index], mode) !== edgeSignature(b[index], mode)) return false
  }
  return true
}

function defaultNodeStyle(type: CanvasNodeKind): Node['style'] {
  if (type === 'section') return { width: 720, height: 420 }
  if (type === 'character') return { width: 360 }
  if (type === 'generation') return { width: 360 }
  if (type === 'video') return { width: 520 }
  if (type === 'audio') return { width: 260, height: 112 }
  if (type === 'translation') return { width: 460 }
  if (type === 'promptOptimizer') return { width: 500 }
  if (type === 'promptInspector') return { width: 480 }
  if (type === 'imageInput') return { width: 340 }
  if (type === 'scene') return { width: 280 }
  return { width: 260 }
}

function absoluteNodePosition(node: Node, nodeById: Map<string, Node>, seen = new Set<string>()): { x: number; y: number } {
  if (!node.parentId || seen.has(node.id)) return node.position
  const parent = nodeById.get(node.parentId)
  if (!parent) return node.position
  seen.add(node.id)
  const parentPosition = absoluteNodePosition(parent, nodeById, seen)
  return {
    x: parentPosition.x + node.position.x,
    y: parentPosition.y + node.position.y,
  }
}

export function detachNodesFromRemovedParents(nodes: Node[], removedIds: Set<string>, sourceNodesForPositions = nodes): Node[] {
  if (removedIds.size === 0) return nodes
  const nodeById = new Map(sourceNodesForPositions.map((node) => [node.id, node]))
  return nodes
    .filter((node) => !removedIds.has(node.id))
    .map((node) => {
      if (!node.parentId || !removedIds.has(node.parentId)) return node
      const parent = nodeById.get(node.parentId)
      const parentPosition = parent ? absoluteNodePosition(parent, nodeById) : { x: 0, y: 0 }
      return {
        ...node,
        parentId: undefined,
        extent: node.extent === 'parent' ? undefined : node.extent,
        expandParent: undefined,
        position: {
          x: parentPosition.x + node.position.x,
          y: parentPosition.y + node.position.y,
        },
      }
    })
}

function stripTransientNodeState(node: Node): Node {
  const { selected: _selected, dragging: _dragging, resizing: _resizing, measured: _measured, ...rest } = node as Node & {
    selected?: boolean
    dragging?: boolean
    resizing?: boolean
    measured?: unknown
  }
  if (rest.data && typeof rest.data === 'object' && !Array.isArray(rest.data)) {
    const {
      canvasSubmitStatus: _canvasSubmitStatus,
      canvasSubmitError: _canvasSubmitError,
      canvasSubmitStartedAt: _canvasSubmitStartedAt,
      ...data
    } = rest.data as Record<string, unknown>
    return { ...rest, data } as Node
  }
  return rest as Node
}

function stripTransientEdgeState(edge: Edge): Edge {
  const { selected: _selected, ...rest } = edge as Edge & { selected?: boolean }
  return rest as Edge
}

function normalizeCanvasPublicImageUrl(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return value
  if (/^\/api\/uploads\/public\//i.test(trimmed)) return trimmed
  try {
    const url = new URL(trimmed)
    if (/^(localhost|127\.0\.0\.1)$/i.test(url.hostname) && /^\/api\/uploads\/public\//i.test(url.pathname)) {
      return `${url.pathname}${url.search}`
    }
  } catch {
    return value
  }
  return value
}

function normalizeCanvasNodeImageUrls(node: Node): Node {
  if (!node.data || typeof node.data !== 'object' || Array.isArray(node.data)) return node
  let changed = false
  const data = { ...(node.data as Record<string, unknown>) }
  for (const key of ['imageUrl', 'outputImage', 'avatar', 'image', 'referenceImageUrl', 'generatedImageUrl', 'clipSyncUrl']) {
    const normalized = normalizeCanvasPublicImageUrl(data[key])
    if (normalized !== data[key]) {
      data[key] = normalized
      changed = true
    }
  }
  return changed ? { ...node, data } : node
}

function dedupeCanvasNodes(nodes: Node[]): Node[] {
  const seen = new Set<string>()
  let changed = false
  const next: Node[] = []
  for (const node of nodes) {
    if (!node.id) {
      next.push(node)
      continue
    }
    if (seen.has(node.id)) {
      changed = true
      continue
    }
    seen.add(node.id)
    next.push(node)
  }
  return changed ? next : nodes
}

function dedupeCanvasEdges(edges: Edge[], nodeIds: Set<string>): Edge[] {
  const seen = new Set<string>()
  let changed = false
  const next: Edge[] = []
  for (const edge of edges) {
    if ((edge.source && !nodeIds.has(edge.source)) || (edge.target && !nodeIds.has(edge.target))) {
      changed = true
      continue
    }
    const edgeKey = edge.id || `${edge.source}|${edge.sourceHandle || ''}|${edge.target}|${edge.targetHandle || ''}`
    if (seen.has(edgeKey)) {
      changed = true
      continue
    }
    seen.add(edgeKey)
    next.push(edge)
  }
  return changed ? next : edges
}

function sanitizeCanvasNodes(nodes: Node[]): Node[] {
  return dedupeCanvasNodes(nodes.map(stripTransientNodeState).map(normalizeCanvasNodeImageUrls))
}

function sanitizeCanvasEdges(edges: Edge[], nodes: Node[]): Edge[] {
  const nodeIds = new Set(nodes.map((node) => node.id))
  return dedupeCanvasEdges(edges.map(stripTransientEdgeState), nodeIds)
}

function sanitizeCanvasScene(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const cleanNodes = sanitizeCanvasNodes(nodes)
  return {
    nodes: cleanNodes,
    edges: sanitizeCanvasEdges(edges, cleanNodes),
  }
}

function loadLocalScene(projectId = 'local', sceneId = 'default'): { nodes: Node[]; edges: Edge[] } | null {
  try {
    const value = localStorage.getItem(storageKey(projectId, sceneId))
    if (!value) return null
    const parsed = JSON.parse(value)
    return sanitizeCanvasScene(
      Array.isArray(parsed?.nodes) ? parsed.nodes : [],
      Array.isArray(parsed?.edges) ? parsed.edges : [],
    )
  } catch (error) {
    console.warn('[canvas-store] loadLocalScene failed:', error instanceof Error ? error.message : error)
    return null
  }
}

function saveLocalScene(nodes: Node[], edges: Edge[], projectId = 'local', sceneId = 'default') {
  try {
    const clean = sanitizeCanvasScene(nodes, edges)
    localStorage.setItem(storageKey(projectId, sceneId), JSON.stringify({ ...clean, updatedAt: new Date().toISOString() }))
  } catch (error) {
    console.warn('[canvas-store] saveLocalScene failed (storage may be full or unavailable):', error instanceof Error ? error.message : error)
  }
}

function loadDefaultFallbackScene(projectId: string): { nodes: Node[]; edges: Edge[] } | null {
  if (projectId === 'local') return null
  try {
    const migratedProjectId = localStorage.getItem(DEFAULT_CANVAS_MIGRATED_PROJECT_KEY)
    if (migratedProjectId && migratedProjectId !== projectId) return null
    const scene = loadLocalScene()
    if (scene) localStorage.setItem(DEFAULT_CANVAS_MIGRATED_PROJECT_KEY, projectId)
    return scene
  } catch {
    return loadLocalScene()
  }
}

const savedScene = loadLocalScene()

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  nodes: savedScene?.nodes ?? initialNodes,
  edges: savedScene?.edges ?? initialEdges,
  activeProjectId: 'local',
  activeSceneId: 'default',
  remoteUpdatedAt: '',
  deletedNodeIds: new Set(),
  localRevision: 0,
  lastSavedRevision: 0,

  loadScene: async (projectId, sceneId = 'default') => {
    const remote = await apiClient.loadCanvasScene(projectId, sceneId)
    const local = remote
      ?? (projectId === 'local' ? loadLocalScene(projectId, sceneId) : null)
      ?? loadDefaultFallbackScene(projectId)
    if (local) {
      const clean = sanitizeCanvasScene(local.nodes, local.edges)
      set({ nodes: clean.nodes, edges: clean.edges, activeProjectId: projectId, activeSceneId: sceneId, remoteUpdatedAt: remote?.updatedAt ?? '', deletedNodeIds: new Set(), localRevision: 0, lastSavedRevision: 0 })
      saveLocalScene(clean.nodes, clean.edges, projectId, sceneId)
    } else {
      set({ nodes: [], edges: [], activeProjectId: projectId, activeSceneId: sceneId, remoteUpdatedAt: '', deletedNodeIds: new Set(), localRevision: 0, lastSavedRevision: 0 })
      saveLocalScene([], [], projectId, sceneId)
    }
  },

  saveScene: async (projectId, sceneId = 'default') => {
    if (remoteSaveInFlight) {
      queuedRemoteSave = { projectId, sceneId }
      await remoteSaveInFlight
      return
    }

    remoteSaveInFlight = (async () => {
      const { nodes, edges, deletedNodeIds, localRevision, remoteUpdatedAt } = get()
      const clean = sanitizeCanvasScene(nodes, edges)
      set({ activeProjectId: projectId, activeSceneId: sceneId })
      saveLocalScene(clean.nodes, clean.edges, projectId, sceneId)
      const remote = await apiClient.saveCanvasScene({
        projectId,
        sceneId,
        nodes: clean.nodes,
        edges: clean.edges,
        deletedNodeIds: Array.from(deletedNodeIds),
        baseUpdatedAt: remoteUpdatedAt,
      })
      if (remote) {
        const latest = get()
        const saveIsCurrent = latest.localRevision === localRevision
        saveLocalScene(latest.nodes, latest.edges, projectId, sceneId)
        set({
          activeProjectId: projectId,
          activeSceneId: sceneId,
          remoteUpdatedAt: remote.updatedAt ?? latest.remoteUpdatedAt,
          deletedNodeIds: saveIsCurrent ? new Set() : latest.deletedNodeIds,
          lastSavedRevision: Math.max(latest.lastSavedRevision, localRevision),
        })
      }
    })()

    try {
      await remoteSaveInFlight
    } finally {
      remoteSaveInFlight = null
      const queued = queuedRemoteSave
      queuedRemoteSave = null
      if (queued) {
        void get().saveScene(queued.projectId, queued.sceneId)
      }
    }
  },

  setNodes: (nodes) => {
    const { nodes: currentNodes, edges, activeProjectId, activeSceneId } = get()
    const cleanNodes = sanitizeCanvasNodes(nodes)
    if (nodeListsEqual(currentNodes, cleanNodes)) return
    if (nodeListsEqual(currentNodes, cleanNodes, 'persist')) return
    set((state) => ({ nodes: cleanNodes, localRevision: state.localRevision + 1 }))
    saveLocalScene(cleanNodes, edges, activeProjectId, activeSceneId)
  },
  setNodesTransient: (nodes) => {
    const currentNodes = get().nodes
    const cleanNodes = sanitizeCanvasNodes(nodes)
    if (nodeListsEqual(currentNodes, cleanNodes)) return
    if (nodeListsEqual(currentNodes, cleanNodes, 'render')) return
    set({ nodes: cleanNodes })
  },
  setEdges: (edges) => {
    const { nodes, edges: currentEdges, activeProjectId, activeSceneId } = get()
    const cleanEdges = sanitizeCanvasEdges(edges, nodes)
    if (edgeListsEqual(currentEdges, cleanEdges)) return
    if (edgeListsEqual(currentEdges, cleanEdges, 'persist')) return
    set((state) => ({ edges: cleanEdges, localRevision: state.localRevision + 1 }))
    saveLocalScene(nodes, cleanEdges, activeProjectId, activeSceneId)
  },
  setEdgesTransient: (edges) => {
    const { nodes, edges: currentEdges } = get()
    const cleanEdges = sanitizeCanvasEdges(edges, nodes)
    if (edgeListsEqual(currentEdges, cleanEdges)) return
    set({ edges: cleanEdges })
  },
  applyRemoteScene: (scene) => {
    const clean = sanitizeCanvasScene(scene.nodes, scene.edges)
    set({
      nodes: clean.nodes,
      edges: clean.edges,
      activeProjectId: scene.projectId,
      activeSceneId: scene.sceneId ?? 'default',
      remoteUpdatedAt: scene.updatedAt ?? '',
      deletedNodeIds: new Set(),
      localRevision: 0,
      lastSavedRevision: 0,
    })
    saveLocalScene(clean.nodes, clean.edges, scene.projectId, scene.sceneId ?? 'default')
  },
  markNodesDeleted: (ids) => {
    const next = new Set(get().deletedNodeIds)
    for (const id of ids) {
      if (id) next.add(id)
    }
    set({ deletedNodeIds: next })
  },

  addNode: (type, position, data = {}) => {
    const id = generateNodeId(type)
    const sceneIndex = get().nodes.filter((n) => n.type === 'scene').length + 1
    const newNode: Node = {
      id,
      type,
      position,
      style: defaultNodeStyle(type),
      data:
        type === 'scene'
          ? {
              title: `#${sceneIndex} 新分镜`,
              description: '点击输入分镜描述...',
              status: 'waiting',
              ...data,
            }
          : type === 'character'
            ? {
                name: '新角色',
                traits: '待设定',
                ...data,
              }
            : type === 'imageInput'
              ? {
                  label: '图片输入',
                  imageUrl: '',
                  ...data,
                }
              : type === 'generation'
                ? {
                    mode: 'standalone',
                    prompt: '',
                    status: 'waiting',
                    modelId: '',
                    size: '1:1',
                    resolution: '1k',
                    quality: 'high',
                    format: 'png',
                    ...data,
                  }
                  : type === 'video'
                    ? {
                      title: '视频生成',
                      prompt: '',
                      seedancePrompt: '',
                      status: 'waiting',
                      videoStatus: 'waiting',
                      resolution: '720p',
                      durationSeconds: 5,
                      includeAudio: true,
                      ratio: 'adaptive',
                      count: 1,
                      videoParametersCollapsed: true,
                      ...data,
                    }
                  : type === 'audio'
                    ? {
                        kind: 'audio',
                        workflowKind: 'audio',
                        title: '音频参考',
                        label: '音频参考',
                        characterName: '',
                        audioUrl: '',
                        referenceAudioUrl: '',
                        uploadStatus: 'missing',
                        ...data,
                      }
                  : type === 'translation'
                    ? {
                        title: '提示词翻译',
                        sourceLanguage: 'auto',
                        targetLanguage: 'English',
                        sourcePrompt: '',
                        translatedPrompt: '',
                        status: 'waiting',
                        modelId: '',
                        preserveStructure: true,
                        ...data,
                      }
                  : type === 'promptInspector'
                    ? {
                        title: '提示词检查',
                        sourcePrompt: '',
                        question: '这个提示词里有哪些角色有台词？',
                        answer: '',
                        status: 'waiting',
                        modelId: '',
                        ...data,
                      }
                  : type === 'section'
                    ? {
                        title: '画布分区',
                        description: '',
                        tone: 'zinc',
                        itemCount: 0,
                        ...data,
                      }
                : {
                    status: 'waiting',
                    ...data,
                  },
    }
    set((state) => {
      const nodes = [...state.nodes, newNode]
      saveLocalScene(nodes, state.edges, state.activeProjectId, state.activeSceneId)
      return { nodes, localRevision: state.localRevision + 1 }
    })
    return id
  },

  removeNode: (id) => {
    set((state) => {
      const removedIds = new Set([id])
      const nodes = detachNodesFromRemovedParents(state.nodes, removedIds)
      const edges = state.edges.filter((e) => e.source !== id && e.target !== id)
      saveLocalScene(nodes, edges, state.activeProjectId, state.activeSceneId)
      return { nodes, edges, deletedNodeIds: new Set([...state.deletedNodeIds, id]), localRevision: state.localRevision + 1 }
    })
  },

  updateNodePosition: (id, position) => {
    set((state) => {
      const nodes = state.nodes.map((n) => (n.id === id ? { ...n, position } : n))
      saveLocalScene(nodes, state.edges, state.activeProjectId, state.activeSceneId)
      return { nodes, localRevision: state.localRevision + 1 }
    })
  },

  updateNodeData: (id, data) => {
    set((state) => {
      const target = state.nodes.find((n) => n.id === id)
      if (!target || !canvasDataPatchChanges(target.data, data)) return state
      const nodes = state.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...data } } : n
      )
      saveLocalScene(nodes, state.edges, state.activeProjectId, state.activeSceneId)
      return { nodes, localRevision: state.localRevision + 1 }
    })
  },

  onConnect: (connection) => {
    set((state) => {
      const edges = addEdge(connection, state.edges)
      saveLocalScene(state.nodes, edges, state.activeProjectId, state.activeSceneId)
      return { edges, localRevision: state.localRevision + 1 }
    })
  },
}))
