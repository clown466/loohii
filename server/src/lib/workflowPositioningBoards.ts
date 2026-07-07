type PromptClip = {
  id?: string;
  title?: string;
  setting?: string;
  startState?: string;
  endState?: string;
};

type PromptShot = {
  id?: string;
  title?: string;
  action?: string;
  description?: string;
  visualPrompt?: string;
  dialogue?: string;
  references?: string;
  characters?: string[];
  setting?: string;
  shotSize?: string;
  cameraAngle?: string;
  cameraMove?: string;
  composition?: string;
  lens?: string;
};

export type ClipPositioningBoardMode = "positioning" | "storyboard";

export function buildClipPositioningBoardPrompt(input: {
  projectName: string;
  clip: PromptClip;
  shots: PromptShot[];
  referenceLabels: string[];
  visibleCharacterNames: string[];
  sceneLockName?: string;
  sceneVisualLock?: string;
  aspectRatio?: string;
  mode?: ClipPositioningBoardMode;
}): string {
  if (input.mode === "storyboard") return buildClipStoryboardBoardPrompt(input);
  const aspectRatio = normalizeBoardAspectRatio(input.aspectRatio);
  const anchor = selectPositioningAnchorShot(input.shots, input.visibleCharacterNames);
  const anchorAction = sentence(anchor?.action || anchor?.description || anchor?.visualPrompt || input.clip.title || "a readable representative moment");
  const anchorRefs = sentence(anchor?.references || "");
  const speaker = speakerFromDialogue(anchor?.dialogue || "");
  const cues = compactBoardCues(input.shots, input.visibleCharacterNames);
  const embeddedSubjectRule = embeddedSubjectPositioningRule(input.shots, input.visibleCharacterNames);
  return [
    `Create ONE static keyframe positioning-board image for ${input.clip.title || input.clip.id || "this clip"}.`,
    `Image type: a single ${aspectRatio} still frame used as a spatial layout reference, not a storyboard, not a video prompt, not a multi-shot sequence.`,
    `Project: ${input.projectName}. Style: saturated 3D American animated dark-comedy, cinematic but readable previsualization.`,
    `Scene to lock: ${input.sceneLockName || input.clip.setting || "current scene"}. Use the connected scene reference as the spatial authority.`,
    input.sceneVisualLock ? `Scene visual continuity lock: ${sentence(input.sceneVisualLock)}.` : "",
    input.referenceLabels.length ? `Connected references to preserve exactly: ${input.referenceLabels.join(", ")}.` : "Use connected references to preserve identity and scene consistency.",
    `Visible characters for this still frame only: ${input.visibleCharacterNames.length ? input.visibleCharacterNames.join(", ") : "only characters visible in this clip event"}.`,
    `Representative frame to depict: ${anchorAction}.`,
    anchorRefs ? `Important spatial/prop cue: ${anchorRefs}.` : "",
    embeddedSubjectRule,
    speaker ? `If ${speaker} is speaking in this chosen frame, show mouth shape, expression, and gesture only; do not draw dialogue text.` : "",
    input.clip.startState ? `Continuity entering this clip: ${sentence(input.clip.startState)}.` : "",
    input.clip.endState ? `Continuity target after this clip: ${sentence(input.clip.endState)}.` : "",
    cues.length ? `Additional layout cues for this one still frame:\n- ${cues.join("\n- ")}` : "",
    "Clearly show approximate screen-left/screen-right/center positions, facing directions, body posture, facial emotion, held items, worn items, restraints, and key props for visible subjects.",
    "Keep the background as one coherent space with readable floor depth and fixed landmarks; show enough environment to locate characters in the scene.",
    "Do not render every beat. Collapse the clip context into one representative frozen frame. No motion trails, no panels, no subtitles, no labels, no UI, no watermarks, no random text.",
    "Do not redesign characters, scene architecture, props, clothing, helmets, held items, or visible restraints. Keep visible states consistent with connected references and continuity notes.",
  ].filter(Boolean).join("\n");
}

export function buildClipStoryboardBoardPrompt(input: {
  projectName: string;
  clip: PromptClip;
  shots: PromptShot[];
  referenceLabels: string[];
  visibleCharacterNames: string[];
  sceneLockName?: string;
  sceneVisualLock?: string;
  aspectRatio?: string;
}): string {
  const aspectRatio = normalizeBoardAspectRatio(input.aspectRatio);
  const isPortrait = boardAspectRatioIsPortrait(aspectRatio);
  const shots = input.shots.length > 0 ? input.shots : [{
    id: "S1",
    title: input.clip.title || "Clip beat",
    description: input.clip.title || "representative clip action",
    action: input.clip.title || "representative clip action",
    setting: input.clip.setting,
  }];
  const panelCount = Math.max(1, Math.min(12, shots.length));
  const portraitGrid = isPortrait ? portraitStoryboardGridShape(panelCount) : null;
  const grid = portraitGrid
    ? `${portraitGrid.rows}-row x ${portraitGrid.cols}-column`
    : storyboardGridForPanelCount(panelCount);
  const sceneVisualLock = sentence(input.sceneVisualLock || "");
  const panelLines = shots.slice(0, panelCount).map((shot, index) => {
    const label = shot.id || `S${index + 1}`;
    const camera = [
      shot.shotSize ? `shot size ${shot.shotSize}` : "",
      shot.cameraAngle ? `angle ${shot.cameraAngle}` : "",
      shot.cameraMove ? `camera movement ${shot.cameraMove}` : "",
      shot.composition ? `composition ${shot.composition}` : "",
      shot.lens ? `lens ${shot.lens}` : "",
    ].filter(Boolean).join("; ");
    const action = sanitizeShotTextForSceneLock([shot.action, shot.description, shot.visualPrompt].filter(Boolean).join(" "), sceneVisualLock);
    const dialogue = sentence(shot.dialogue || "");
    const references = sentence(shot.references || "");
    const visible = Array.isArray(shot.characters) && shot.characters.length ? `Visible: ${shot.characters.join(", ")}.` : "";
    return [
      `Panel ${index + 1} (${label}):`,
      camera ? `camera: ${camera}.` : "",
      visible,
      action ? `visible action/blocking: ${action}.` : "",
      dialogue ? `dialogue moment to act, without drawing subtitles/text: ${dialogue}.` : "",
      references ? `spatial/prop cue: ${references}.` : "",
    ].filter(Boolean).join(" ");
  });
  const embeddedSubjectRule = embeddedSubjectPositioningRule(input.shots, input.visibleCharacterNames);
  return [
    `Create a ${grid} comic storyboard board for ${input.clip.title || input.clip.id || "this clip"}, matching the clip video prompt shots S1, S2, S3... in exact order.`,
    `Image type: one ${aspectRatio} storyboard sheet, multiple panels in a clean grid. Each panel is a still frame for one shot, not a single positioning still and not a video.`,
    portraitGrid
      ? [
          portraitGrid.rows === portraitGrid.cols
            ? `Grid rule: use a uniform square grid of exactly ${portraitGrid.rows} rows by ${portraitGrid.cols} columns with thin black gutters, so that every panel cell is itself a ${aspectRatio} vertical frame, the same aspect ratio as the final video.`
            : `Grid rule: use a uniform grid of exactly ${portraitGrid.rows} rows by ${portraitGrid.cols} columns with thin black gutters, filling the whole ${aspectRatio} sheet, so every panel cell is a vertical frame.`,
          `Compose the content of every panel as a standalone vertical video frame close to ${aspectRatio}, never as a wide or square cinematic crop.`,
          panelCount < portraitGrid.rows * portraitGrid.cols
            ? `Exactly ${panelCount} panels are drawn; leave the remaining ${portraitGrid.rows * portraitGrid.cols - panelCount} trailing cell(s) as solid black empty cells with no drawing and no label.`
            : `All ${panelCount} grid cells are drawn panels; do not add any extra empty or black cells.`,
        ].join(" ")
      : "",
    "Panel numbering is mandatory: draw a small, clearly readable shot-order number label in the upper-left corner of each drawn panel, exactly S1, S2, S3... matching the shot order, so a video model can tell which panel is which shot. No other text, captions, speech bubbles, subtitles, UI, watermark, or random labels.",
    `Project: ${input.projectName || "current project"}. Style: saturated 3D American animated dark-comedy storyboard/previsualization, cinematic but readable.`,
    `Scene continuity lock: ${input.sceneLockName || input.clip.setting || "current scene"}. Keep the same scene geography across all panels unless the shot explicitly changes location.`,
    sceneVisualLock ? `Scene visual continuity details: ${sceneVisualLock}.` : "",
    input.referenceLabels.length ? `Connected references to preserve exactly: ${input.referenceLabels.join(", ")}.` : "Use connected references to preserve identity and scene consistency.",
    `Visible clip characters: ${input.visibleCharacterNames.length ? input.visibleCharacterNames.join(", ") : "only characters visible in this clip event"}.`,
    input.clip.startState ? `Continuity entering this clip: ${sentence(input.clip.startState)}.` : "",
    input.clip.endState ? `Continuity target after this clip: ${sentence(input.clip.endState)}.` : "",
    embeddedSubjectRule,
    "For every panel, preserve character identity, costume, held items, worn items, restraints, prop state, screen direction, and emotional performance. Use connected scene and asset references as visual authority.",
    "Each panel should show the shot-specific camera plan through composition: shot size, angle, camera movement feeling, foreground/midground/background, and readable blocking. Do not repeat generic rules as visible text.",
    `Storyboard panels:\n${panelLines.join("\n")}`,
    "Do not redesign characters, scene architecture, props, clothing, helmets, held items, or visible restraints. Keep all visible states consistent with connected references and continuity notes.",
  ].filter(Boolean).join("\n");
}

function normalizeBoardAspectRatio(value?: string): string {
  return /^\d+:\d+$/.test(String(value || "").trim()) ? String(value).trim() : "16:9";
}

function boardAspectRatioIsPortrait(aspectRatio: string): boolean {
  const [w, h] = aspectRatio.split(":").map(Number);
  return Number.isFinite(w) && Number.isFinite(h) && h > w;
}

/**
 * 竖屏故事板宫格：正方形 NxN 时每格恰为 9:16；
 * 但空格达到一整行及以上时收窄为 N行×(N-1)列（如 5-6 镜头用 3行×2列），避免大片黑格。
 */
export function portraitStoryboardGridShape(count: number): { rows: number; cols: number } {
  const safeCount = Math.max(1, count);
  const n = Math.ceil(Math.sqrt(safeCount));
  if (n > 1 && n * n - safeCount >= n && n * (n - 1) >= safeCount) return { rows: n, cols: n - 1 };
  return { rows: n, cols: n };
}

function storyboardGridForPanelCount(count: number): string {
  if (count <= 1) return "1-panel";
  if (count <= 2) return "1x2";
  if (count <= 4) return "2x2";
  if (count <= 6) return "2x3";
  if (count <= 9) return "3x3";
  return "3x4";
}

function embeddedSubjectPositioningRule(shots: PromptShot[], names: string[]): string {
  const text = [names.join(", "), ...shots.flatMap((shot) => [shot.action, shot.description, shot.references, shot.visualPrompt])].join("\n");
  if (!/(embedded|fused|protruding|grown into|growing out of|rooted in|vine wall|vine barricade|living wall|嵌入|嵌在|融合|长在|从.*长出|藤蔓墙|活墙)/i.test(text)) return "";
  const embeddedNames = names.filter((name) => nameIsEmbeddedSubject(name, text));
  const subject = embeddedNames.length ? embeddedNames.join(", ") : "any fused or embedded character";
  return `Embedded-character spatial rule: ${subject} must be organically embedded in and growing from the vine wall itself, with plant fibers/vines/root tissue integrated into the body and wall. Do not show them tied, strapped, chained, pinned, taped, or merely bound onto the wall surface.`;
}

function nameIsEmbeddedSubject(name: string, text: string): boolean {
  const escaped = escapeRegExp(name);
  const embeddedBeforeName = new RegExp(`\\b(?:embedded|fused|protruding|rooted|partly embedded|partially embedded|grown into|growing out of)\\b(?:\\s+\\w+){0,5}\\s+${escaped}\\b`, "i");
  const nameBeforeEmbedded = new RegExp(`\\b${escaped}\\b\\s+(?:is|are|appears|appearing|remains|stays|protrudes|protruding|embedded|fused|rooted|grown|growing)\\b[^.。!?\\n]{0,80}\\b(?:embedded|fused|protruding|rooted|grown into|growing out of|in vines|into the vine wall|from the vine wall)\\b`, "i");
  const directFusedState = new RegExp(`\\b${escaped}\\b\\s+(?:is\\s+|are\\s+|appears\\s+|appearing\\s+|remains\\s+|stays\\s+)?(?:embedded|fused|rooted|protruding|grown into|growing out of)\\b`, "i");
  return embeddedBeforeName.test(text) || nameBeforeEmbedded.test(text) || directFusedState.test(text);
}

export function positioningBoardReferenceMetadata(input: {
  clipId: string;
  episodeId: string;
  assetId?: string;
  imageUrl?: string;
}): Record<string, unknown> {
  return {
    assetKind: "positioning-board",
    clipNodeKind: "positioning-board-reference",
    positioningBoardForClip: true,
    spatialAuthority: true,
    clipId: input.clipId,
    sourceEpisodeId: input.episodeId,
    assetId: input.assetId || "",
    imageUrl: input.imageUrl || "",
  };
}

function selectPositioningAnchorShot(shots: PromptShot[], names: string[]): PromptShot | undefined {
  return shots
    .map((shot, index) => ({ shot, score: scoreShot(shot, names, index, shots.length) }))
    .sort((a, b) => b.score - a.score)[0]?.shot;
}

function scoreShot(shot: PromptShot, names: string[], index: number, total: number): number {
  const text = [shot.action, shot.description, shot.visualPrompt, shot.references, shot.dialogue].filter(Boolean).join(" ");
  let score = 0;
  for (const name of names) if (name && text.toLowerCase().includes(name.toLowerCase())) score += 20;
  if (/\b(left|right|center|foreground|midground|background|screen|facing|holds?|wears?|bound|restrained|corner|speaker|table)\b/i.test(text)) score += 30;
  if (shot.dialogue) score += 8;
  score += total > 1 ? (1 - Math.abs(index / Math.max(1, total - 1) - 0.45)) * 10 : 10;
  return score;
}

function compactBoardCues(shots: PromptShot[], names: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const shot of shots) {
    const cue = sentence([shot.action, shot.references].filter(Boolean).join(" "));
    if (!cue) continue;
    const hasName = names.some((name) => name && cue.toLowerCase().includes(name.toLowerCase()));
    const hasSpatial = /\b(left|right|center|foreground|midground|background|screen|facing|holds?|wears?|bound|restrained|corner|speaker|table)\b/i.test(cue);
    if (!hasName && !hasSpatial) continue;
    const compact = cue.length > 180 ? `${cue.slice(0, 177).trim()}...` : cue;
    const key = compact.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(compact);
    if (output.length >= 5) break;
  }
  return output;
}

function speakerFromDialogue(value: string): string {
  return String(value || "").match(/^([^:：]{1,40})[:：]/)?.[1]?.trim() ?? "";
}

function escapeRegExp(value: string): string {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sentence(value: string): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\bShow the listener's reaction, speaker's expression, and body language as the line lands\.?/gi, "")
    .replace(/\bHold the same scene geography and shift to a natural reaction or angle change\.?/gi, "")
    .replace(/\bSame setting and character blocking, natural reaction or angle change\.?/gi, "")
    .replace(/[。.!?;,，；：:]+$/g, "")
    .trim();
}

function sanitizeShotTextForSceneLock(value: string, sceneVisualLock: string): string {
  let output = sentence(value);
  if (!output || !sceneVisualLock) return output;
  const lock = sceneVisualLock.toLowerCase();
  const forbidsWarmDaylight = /\b(?:night|pre-dawn|black-blue|cold|no warm|no orange dusk|no golden|no sunset)\b/i.test(lock);
  if (!forbidsWarmDaylight) return output;
  output = output
    .replace(/\b(?:golden\s+)?dawn\s+light\b/gi, "cold moonlit night light")
    .replace(/\bwarm\s+morning\s+light\b/gi, "cold black-blue night light")
    .replace(/\bmorning\s+sky\b/gi, "black-blue night sky")
    .replace(/\bgolden\s+dawn\b/gi, "cold pre-dawn darkness")
    .replace(/\bgolden\s+light\b/gi, "cold moonlit light")
    .replace(/\bmorning\s+light\b/gi, "cold moonlit light")
    .replace(/\bdawn\s+variants?\s+add\s+pale\s+gold\b/gi, "no warm dawn or pale gold")
    .replace(/\bdynamic lighting\b/gi, "cold moonlit lighting");
  if (!/\bno warm sunrise\b/i.test(output)) {
    output = `${output}. No warm sunrise, no golden daylight, no orange dusk`;
  }
  return sentence(output);
}
