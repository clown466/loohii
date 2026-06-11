export { SceneNode } from './SceneNode';
export { CharacterNode } from './CharacterNode';
export { WorkflowNode } from './WorkflowNode';
export { SectionNode } from './SectionNode';
export { TranslationNode } from './TranslationNode';
export { PromptOptimizerNode } from './PromptOptimizerNode';
export { PromptInspectorNode } from './PromptInspectorNode';
export { VideoNode } from './VideoNode';
export { ImageInputNode } from './ImageInputNode';
export { AudioInputNode } from './AudioInputNode';
export { GenerationNode } from './GenerationNode';

import { SceneNode } from './SceneNode';
import { CharacterNode } from './CharacterNode';
import { WorkflowNode } from './WorkflowNode';
import { SectionNode } from './SectionNode';
import { TranslationNode } from './TranslationNode';
import { PromptOptimizerNode } from './PromptOptimizerNode';
import { PromptInspectorNode } from './PromptInspectorNode';
import { VideoNode } from './VideoNode';
import { ImageInputNode } from './ImageInputNode';
import { AudioInputNode } from './AudioInputNode';
import { GenerationNode } from './GenerationNode';

export const nodeTypes = {
  scene: SceneNode,
  character: CharacterNode,
  episode: WorkflowNode,
  asset: WorkflowNode,
  workflow: WorkflowNode,
  directorBoard: WorkflowNode,
  imageInput: ImageInputNode,
  generation: GenerationNode,
  video: VideoNode,
  audio: AudioInputNode,
  translation: TranslationNode,
  promptOptimizer: PromptOptimizerNode,
  promptInspector: PromptInspectorNode,
  section: SectionNode,
};
