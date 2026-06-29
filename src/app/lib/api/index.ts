/**
 * API barrel export — re-exports all types and assembles the unified apiClient object.
 */
export { API_AUTH_EXPIRED_EVENT } from './httpClient'
export { getToken, setToken } from './httpClient'

// Re-export all types
export type {
  AgentConversation,
  AgentHistoryMessage,
  AgentSendMessageRequest,
  AgentSendMessageResponse,
  ApiUser,
  CanvasImageGenerationInput,
  CanvasPromptInspectionInput,
  CanvasPromptInspectionResponse,
  CanvasPromptOptimizationInput,
  CanvasPromptOptimizationResponse,
  CanvasPromptTranslationInput,
  CanvasPromptTranslationResponse,
  CanvasScene,
  CanvasVideoGenerationInput,
  CanvasVideoGenerationResponse,
  CharacterReferenceAudioInput,
  CharacterReferenceImageInput,
  CharacterReferenceImageResponse,
  ClearCharacterReferenceAudioInput,
  ClipSeedancePromptResponse,
  ClipStoryboardPlanResponse,
  DraftModelTestInput,
  EpisodeCanvasSyncResponse,
  GenerationRecord,
  GenerationRecordAsset,
  GenerationRecordModel,
  LocalImageUploadResponse,
  ModelConfig,
  ModelConfigInput,
  ModelConfigsResponse,
  ModelProviderConfig,
  PresignedUploadResponse,
  ProjectCharacterAsset,
  ProjectCharacterRecord,
  ProjectSceneRecord,
  ProviderConfigInput,
  ProviderTestResult,
  WorkflowAssetImageGenerationInput,
  WorkflowAssetImageGenerationResponse,
  WorkflowAssetImageHistoryItem,
  WorkflowAssetReferenceImageInput,
  WorkflowBreakdownScene,
  WorkflowClip,
  WorkflowEpisodeListResponse,
  WorkflowEpisodeSummary,
  WorkflowRunResponse,
  WorkflowState,
} from './types'

import { getToken, setToken } from './httpClient'
import { authApi } from './authApi'
import { projectApi } from './projectApi'
import { canvasApi } from './canvasApi'
import { workflowApi } from './workflowApi'
import { generationApi } from './generationApi'
import { modelApi } from './modelApi'
import { uploadApi } from './uploadApi'

/**
 * Unified API client — backward-compatible with the original single-file apiClient.
 */
export const apiClient = {
  get configured() {
    return true
  },

  getToken,
  setToken,

  // Auth
  signIn: authApi.signIn.bind(authApi),
  signUp: authApi.signUp.bind(authApi),
  updateProfile: authApi.updateProfile.bind(authApi),

  // Projects
  listProjects: projectApi.listProjects.bind(projectApi),
  createProject: projectApi.createProject.bind(projectApi),
  updateProject: projectApi.updateProject.bind(projectApi),
  deleteProject: projectApi.deleteProject.bind(projectApi),
  listProjectCharacters: projectApi.listProjectCharacters.bind(projectApi),
  listProjectScenes: projectApi.listProjectScenes.bind(projectApi),
  sendAgentMessage: projectApi.sendAgentMessage.bind(projectApi),
  listAgentConversations: projectApi.listAgentConversations.bind(projectApi),
  loadAgentConversationMessages: projectApi.loadAgentConversationMessages.bind(projectApi),
  deleteAgentConversation: projectApi.deleteAgentConversation.bind(projectApi),

  // Canvas
  loadCanvasScene: canvasApi.loadCanvasScene.bind(canvasApi),
  saveCanvasScene: canvasApi.saveCanvasScene.bind(canvasApi),
  syncEpisodeCanvas: canvasApi.syncEpisodeCanvas.bind(canvasApi),
  generateCanvasImage: canvasApi.generateCanvasImage.bind(canvasApi),
  generateCanvasVideo: canvasApi.generateCanvasVideo.bind(canvasApi),
  translateCanvasPrompt: canvasApi.translateCanvasPrompt.bind(canvasApi),
  optimizeCanvasPrompt: canvasApi.optimizeCanvasPrompt.bind(canvasApi),
  inspectCanvasPrompt: canvasApi.inspectCanvasPrompt.bind(canvasApi),

  // Workflow
  listProjectWorkflowEpisodes: workflowApi.listProjectWorkflowEpisodes.bind(workflowApi),
  createProjectWorkflowEpisode: workflowApi.createProjectWorkflowEpisode.bind(workflowApi),
  getProjectWorkflow: workflowApi.getProjectWorkflow.bind(workflowApi),
  saveProjectWorkflow: workflowApi.saveProjectWorkflow.bind(workflowApi),
  runProjectWorkflow: workflowApi.runProjectWorkflow.bind(workflowApi),
  optimizeProjectWorkflowClip: workflowApi.optimizeProjectWorkflowClip.bind(workflowApi),
  generateProjectWorkflowClipSeedancePrompt: workflowApi.generateProjectWorkflowClipSeedancePrompt.bind(workflowApi),
  planProjectWorkflowClipStoryboard: workflowApi.planProjectWorkflowClipStoryboard.bind(workflowApi),
  uploadCharacterReferenceImage: workflowApi.uploadCharacterReferenceImage.bind(workflowApi),
  uploadCharacterReferenceAudio: workflowApi.uploadCharacterReferenceAudio.bind(workflowApi),
  clearCharacterReferenceAudio: workflowApi.clearCharacterReferenceAudio.bind(workflowApi),
  uploadWorkflowAssetReferenceImage: workflowApi.uploadWorkflowAssetReferenceImage.bind(workflowApi),
  generateWorkflowAssetImage: workflowApi.generateWorkflowAssetImage.bind(workflowApi),
  listWorkflowAssetImages: workflowApi.listWorkflowAssetImages.bind(workflowApi),
  selectWorkflowAssetImage: workflowApi.selectWorkflowAssetImage.bind(workflowApi),
  clearWorkflowAssetImage: workflowApi.clearWorkflowAssetImage.bind(workflowApi),
  deleteWorkflowAssetImage: workflowApi.deleteWorkflowAssetImage.bind(workflowApi),
  removeWorkflowAsset: workflowApi.removeWorkflowAsset.bind(workflowApi),

  // Upload
  createUploadPresign: uploadApi.createUploadPresign.bind(uploadApi),
  uploadLocalImage: uploadApi.uploadLocalImage.bind(uploadApi),
  uploadLocalFile: uploadApi.uploadLocalFile.bind(uploadApi),
  downloadImageBlob: uploadApi.downloadImageBlob.bind(uploadApi),

  // Generation
  listGenerationRecords: generationApi.listGenerationRecords.bind(generationApi),
  retryGenerationRecord: generationApi.retryGenerationRecord.bind(generationApi),
  deleteGenerationRecord: generationApi.deleteGenerationRecord.bind(generationApi),

  // Model
  listModelConfigs: modelApi.listModelConfigs.bind(modelApi),
  createModelProvider: modelApi.createModelProvider.bind(modelApi),
  updateModelProvider: modelApi.updateModelProvider.bind(modelApi),
  disableModelProvider: modelApi.disableModelProvider.bind(modelApi),
  testModelProvider: modelApi.testModelProvider.bind(modelApi),
  testModelConfig: modelApi.testModelConfig.bind(modelApi),
  testDraftModelConfig: modelApi.testDraftModelConfig.bind(modelApi),
  upsertModelConfig: modelApi.upsertModelConfig.bind(modelApi),
  updateModelConfig: modelApi.updateModelConfig.bind(modelApi),
  disableModelConfig: modelApi.disableModelConfig.bind(modelApi),
}
