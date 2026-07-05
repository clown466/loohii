export { SceneNode } from './SceneNode';
export { CharacterNode } from './CharacterNode';
export { WorkflowNode } from './WorkflowNode';
export { SectionNode } from './SectionNode';
export { TranslationNode } from './TranslationNode';
export { PromptOptimizerNode } from './PromptOptimizerNode';
export { PromptInspectorNode } from './PromptInspectorNode';
export { AgentNode } from './AgentNode';
export { VideoNode } from './VideoNode';
export { ImageInputNode } from './ImageInputNode';
export { AudioInputNode } from './AudioInputNode';
export { GenerationNode } from './GenerationNode';

import { memo } from 'react';

import { SceneNode } from './SceneNode';
import { CharacterNode } from './CharacterNode';
import { WorkflowNode } from './WorkflowNode';
import { SectionNode } from './SectionNode';
import { TranslationNode } from './TranslationNode';
import { PromptOptimizerNode } from './PromptOptimizerNode';
import { PromptInspectorNode } from './PromptInspectorNode';
import { AgentNode } from './AgentNode';
import { VideoNode } from './VideoNode';
import { ImageInputNode } from './ImageInputNode';
import { AudioInputNode } from './AudioInputNode';
import { GenerationNode } from './GenerationNode';

export const nodeTypes = {
  scene: memo(SceneNode),
  character: memo(CharacterNode),
  episode: memo(WorkflowNode),
  asset: memo(WorkflowNode),
  workflow: memo(WorkflowNode),
  directorBoard: memo(WorkflowNode),
  imageInput: memo(ImageInputNode),
  generation: memo(GenerationNode),
  video: memo(VideoNode),
  audio: memo(AudioInputNode),
  translation: memo(TranslationNode),
  promptOptimizer: memo(PromptOptimizerNode),
  promptInspector: memo(PromptInspectorNode),
  agent: memo(AgentNode),
  section: memo(SectionNode),
};
