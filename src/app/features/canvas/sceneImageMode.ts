export type SceneImageMode = 'single' | 'quad-grid';

export function sceneImageModeInstruction(mode: SceneImageMode | undefined): string {
  if (mode !== 'quad-grid') return '';
  return [
    'Scene image layout mode: 2x2 four-panel multi-camera environment board.',
    'Create one 16:9 scene asset image split into four clean panels showing the SAME location from four camera angles or useful staging zones.',
    'Keep identical landmarks, time of day, palette, architecture, materials, lighting direction, scale, and fixed props across all four panels.',
    'This is a scene/location reference board, not a storyboard and not a prop sheet.',
    'No characters as main subjects, no captions, no labels, no readable text, no UI, no watermark.',
  ].join('\n');
}
