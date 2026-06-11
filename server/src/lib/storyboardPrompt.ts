import { stringValue } from "./typeGuards";

export const MIN_CLIP_STORYBOARD_PANEL_COUNT = 5;
export const MAX_CLIP_STORYBOARD_PANEL_COUNT = 12;

const LEGACY_STORYBOARD_PATTERN =
  /clip-level director board|technical label strip|Technical labels under each panel|compact printed production labels|compact production labels|subtitles over artwork|Storyboard layout:\s*one 16:9 board with two zones|Upper continuity zone|Lower storyboard zone|\bcamera\s*=|\bexact dialogue\s*=|\bkey prop\s*=/i;

export function hasLegacyClipStoryboardImageLayoutPrompt(prompt: unknown): boolean {
  return LEGACY_STORYBOARD_PATTERN.test(stringValue(prompt));
}

export function clipStoryboardBoardLayoutStrategy(panelCount?: number): string {
  const panelText = panelCount ? `${panelCount} sequential panels` : "the selected number of sequential panels";
  return [
    `Storyboard layout: one 16:9 compact multi-panel comic page using ${panelText} in left-to-right, top-to-bottom reading order.`,
    "Use a full-page comic grid with thin black gutters and vertical-video-friendly frames: most panels should be tighter and taller-feeling rather than very wide.",
    "Favor medium close-ups, close-ups, reaction close-ups, over-shoulders, hand/prop inserts, and expression inserts; use wide/group panels sparingly for orientation only.",
    "Each panel should contain only the characters needed for that panel beat; do not duplicate the same character multiple times inside one panel.",
    "Place a small readable panel number label such as P1, P2, P3 in a corner of each panel.",
    "Show spoken dialogue as clean white comic speech bubbles inside the relevant panels.",
    "Place each exact dialogue line in one speech bubble on the most relevant panel only; continuation and reaction panels for that same beat use no speech bubble unless they contain a different exact dialogue line.",
    "Visible text stays to panel labels and speech bubbles.",
  ].join(" ");
}

export function ensureClipStoryboardBoardLayoutPrompt(prompt: unknown, panelCount?: number): string {
  const text = stripLegacyClipStoryboardImageLayoutPrompt(stringValue(prompt));
  if (!text) return text;
  if (hasCompleteClipStoryboardBoardLayoutPrompt(text)) return text;
  return normalizeStoryboardPromptSpacing([
    clipStoryboardBoardLayoutStrategy(panelCount ?? detectStoryboardPanelCount(text)),
    text,
  ].filter(Boolean).join("\n\n"));
}

export function finalizeClipStoryboardImagePrompt(prompt: unknown, panelCount?: number): string {
  const text = ensureClipStoryboardBoardLayoutPrompt(stripComicStoryboardLayoutPrompt(prompt), panelCount);
  if (!text) return text;
  return normalizeStoryboardPromptSpacing(
    dedupeStoryboardPanelSpeechBubbles(text
      .replace(/^\s*Shots to cover across the panels\s*:/gim, "Story beats to show across the comic panels:")
      .replace(/^\s*Panel beats to render in order\s*:/gim, "Comic panels in reading order:")
      .replace(/^\s*Shot\s+(\d{1,2})(?:\s*\([^)]*\))?\s*\|\s*/gim, "Story beat $1: ")
      .replace(/\btitle\s*=\s*/gi, "title: ")
      .replace(/\bcamera\s*=\s*[^|\n.]+(?:\s*\|\s*)?/gi, "")
      .replace(/\baction\s*=\s*/gi, "show ")
      .replace(/\bexact dialogue\s*=\s*/gi, "speech bubble: ")
      .replace(/\bdialogue\s*=\s*/gi, "speech bubble when visible: ")
      .replace(/\bkey prop\s*=\s*/gi, "carried object: ")
      .replace(/\bvisual cue\s*=\s*/gi, "visual cue: ")
      .replace(/\btechnical label strip includes[^.\n]*[.\n]?/gi, "")
      .replace(/\bTechnical labels under each panel:[^\n.]*[.\n]?/gi, "")
      .replace(/\bshot size,?\s*angle,?\s*movement,?\s*lens\b/gi, "")
      .replace(/\bcompact printed production labels\b/gi, "clean comic panel labels and speech bubbles")
      .replace(/\bcompact production labels\b/gi, "clean comic panel labels")
      .replace(/\s*\|\s*/g, "; ")
      .replace(/;[ \t]*;/g, ";")),
  );
}

function stripComicStoryboardLayoutPrompt(prompt: unknown): string {
  return stringValue(prompt)
    .replace(/Storyboard layout:\s*one 16:9 (?:compact\s*)?multi-panel comic page[\s\S]*?(?:Visible text stays to panel labels and speech bubbles\.|Use only panel numbers and intentional speech bubbles as visible text; camera, lens, movement, and shot metadata belong to the video prompt, not the image\.)\s*/gi, "")
    .replace(/Storyboard layout:\s*one 16:9 multi-panel comic page[\s\S]*?Place a small readable panel number label such as P1, P2, P3 in a corner of\s*(?=(?:Required continuity characters|Use linked|Create|Comic panels in reading order|Panel\s+\d+:|Character reference|Dialogue lock|$))/gi, "")
    .replace(/\b(?:each|the selected number of large sequential panels in left-to-right, top-to-bottom reading order\. Use a full-page comic grid with thin black gutters and large cinematic 3D American comic frames\. Place a small readable panel number label such as P1, P2, P3 in a corner of each)\s+panel\. Show spoken dialogue as clean white comic speech bubbles inside the relevant panels\. Visible text stays to panel labels and speech bubbles\./gi, " ");
}

function hasCompleteClipStoryboardBoardLayoutPrompt(prompt: string): boolean {
  return /Storyboard layout:\s*one 16:9 compact multi-panel comic page/i.test(prompt) &&
    /vertical-video-friendly frames/i.test(prompt) &&
    /Show spoken dialogue as clean white comic speech bubbles/i.test(prompt);
}

export function stripLegacyClipStoryboardImageLayoutPrompt(prompt: unknown): string {
  const original = stringValue(prompt);
  const hadLegacyLayout = hasLegacyClipStoryboardImageLayoutPrompt(original);
  const replaced = original
    .replace(/\bCreate one 16:9 clip-level director board image\b/gi, "Create one 16:9 multi-panel 3D American comic storyboard image")
    .replace(/Layout:\s*clean storyboard strip\/grid with clear sequential panels for the Clip action\./gi, "")
    .replace(/Storyboard layout:\s*one 16:9 board with two zones\.[\s\S]*?compact readable labels below panels only\./gi, " ")
    .replace(/Each storyboard panel must have an image area (?:above|plus)[^.]*technical label strip below it\./gi, " ")
    .replace(/Each panel must include an image area and a compact technical label strip below it\./gi, " ")
    .replace(/Technical labels under each panel:[^\n.]*[.\n]?/gi, "Visible board text: small panel number labels like P1/P2 and intentional speech-bubble dialogue only. ")
    .replace(/;\s*technical label strip includes[^.\n]*\./gi, ".")
    .replace(/\bcompact printed production labels\b/gi, "clean comic panel labels and speech bubbles")
    .replace(/\bcompact production labels\b/gi, "clean comic panel labels")
    .replace(/,\s*speech bubbles,\s*subtitles over artwork/gi, "");

  if (!hadLegacyLayout) return normalizeStoryboardPromptSpacing(cleanStrayReferenceMapText(replaced));

  const fieldCleaned = cleanLegacyStoryboardPanelFieldText(cleanLegacyStoryboardShotFieldText(cleanStrayReferenceMapText(replaced)));
  const text = cleanLegacyStoryboardText(fieldCleaned);
  return normalizeStoryboardPromptSpacing([
    clipStoryboardBoardLayoutStrategy(detectStoryboardPanelCount(text)),
    text,
    "Visible board text rule: only small P1/P2/P3 panel labels and clean comic speech-bubble dialogue appear as text.",
  ].filter(Boolean).join("\n\n"));
}

function cleanStrayReferenceMapText(prompt: string): string {
  return prompt
    .replace(/\b(?:each|the selected number of large sequential panels in left-to-right, top-to-bottom reading order\. Use a full-page comic grid with thin black gutters and large cinematic 3D American comic frames\. Place a small readable panel number label such as P1, P2, P3 in a corner of each)\s+panel\. Show spoken dialogue as clean white comic speech bubbles inside the relevant panels\. Visible text stays to panel labels and speech bubbles\./gi, " ")
    .replace(/\s+Reference image map:\s+#\d+:[\s\S]*?(?=(?:\s+Required continuity characters:|\s+Use the linked previous storyboard image|\s+Create one|\s+Storyboard layout:|\s+Comic panels in reading order:|\s+Panel\s+\d+:|$))/gi, " ")
    .replace(/^Reference image map:\s+[\s\S]*?(?=(?:\n\n|\n)?(?:Storyboard layout|Comic panels in reading order|Create|Required|Use the linked previous storyboard image|Clip title|This storyboard|Each panel|First infer|Setting|Characters present|Plot goal|Start state|End state|Shots to cover|Panel\s+\d+)\b|$)/i, "");
}

export function detectStoryboardPanelCount(prompt: unknown): number | undefined {
  const text = stringValue(prompt);
  const exact = text.match(/\bUse exactly\s+(\d{1,2})\s+(?:clear\s+)?panels?\b/i);
  const comic = text.match(/\bwith\s+(\d{1,2})\s+large\s+panels?\b/i);
  const labels = Array.from(text.matchAll(/\bPanel\s+(\d{1,2})\s*[:：]/gi)).map((match) => Number(match[1]));
  const count = Number(exact?.[1] || comic?.[1] || Math.max(0, ...labels));
  if (!Number.isFinite(count) || count <= 0) return undefined;
  return Math.max(MIN_CLIP_STORYBOARD_PANEL_COUNT, Math.min(MAX_CLIP_STORYBOARD_PANEL_COUNT, Math.round(count)));
}

function cleanLegacyStoryboardText(prompt: string): string {
  return prompt
    .replace(/Shots to cover across the panels:/gi, "Story beats to show across the comic panels:")
    .replace(/Panel beats to render in order:/gi, "Comic panels in reading order:")
    .replace(/Panel planning rules:\s*distribute the Clip action across the panels;\s*/gi, "Panel continuity: distribute the Clip story across the panels; ")
    .replace(/Language rule:\s*keep dialogue and any visible board text in the original language used by the shots\./gi, "Speech bubbles use the original story language.")
    .replace(/Character personal prop continuity:/gi, "Character carried-object continuity:")
    .replace(/\baction beats\b/gi, "story beats")
    .replace(/\bdialogue only\b/gi, "speech bubbles only")
    .replace(/\brandom non-dialogue text\b/gi, "random extra text")
    .replace(/\brandom text\b/gi, "random extra text")
    .replace(/[ \t]*(Story beats to show across the comic panels:)[ \t]*/gi, "\n$1\n")
    .replace(/[ \t]*(Comic panels in reading order:)[ \t]*/gi, "\n$1\n")
    .replace(/[ \t]*(Panel continuity:)/gi, "\n$1")
    .replace(/[ \t]*(Visible board text:)/gi, "\n$1")
    .replace(/[ \t]*(Character rules:)/gi, "\n$1")
    .replace(/[ \t]*(Board style:)/gi, "\n$1")
    .replace(/[ \t]*(Speech bubbles use the original story language\.)/gi, "\n$1")
    .replace(/[ \t]*(Avoid:)/gi, "\n$1");
}

function cleanLegacyStoryboardPanelFieldText(prompt: string): string {
  const usedDialogueKeys = new Set<string>();
  return prompt.replace(
    /\bPanel\s+(\d{1,2})\s*[:：]\s*([\s\S]*?)(?=\bPanel\s+\d{1,2}\s*[:：]|\bPanel planning rules\b|\bVisible board text\b|\bCharacter rules\b|\bBoard style\b|\bLanguage rule\b|\bAvoid\b|$)/gi,
    (match, panelNumber: string, body: string) => {
      if (!/\b(?:camera|action|exact dialogue|dialogue|key prop|panel label|visible cast|framing)\s*=/i.test(body)) return match;
      const action = extractLegacyStoryboardField(body, "action");
      const dialogue = extractLegacyStoryboardField(body, "exact dialogue") || extractLegacyStoryboardField(body, "dialogue");
      const dialogueKey = normalizeStoryboardDialogueKey(dialogue);
      const shouldShowDialogue = Boolean(dialogue && dialogueKey && !usedDialogueKeys.has(dialogueKey));
      if (shouldShowDialogue) usedDialogueKeys.add(dialogueKey);
      const visual = [
        action ? `show ${action}` : "",
        shouldShowDialogue ? `speech bubble: ${dialogue}` : "no speech bubble",
        `small corner label P${Number(panelNumber)}`,
      ].filter(Boolean).join("; ");
      return `\nPanel ${Number(panelNumber)}: ${visual}. `;
    },
  );
}

function cleanLegacyStoryboardShotFieldText(prompt: string): string {
  return prompt.replace(
    /\bShot\s+(\d{1,2})\s*(?:\([^)]*\))?\s*\|\s*([\s\S]*?)(?=\bShot\s+\d{1,2}\s*(?:\([^)]*\))?\s*\||\bPanel beats to render in order\s*:|\bComic panels in reading order\s*:|\bPanel\s+\d{1,2}\s*[:：]|$)/gi,
    (match, shotNumber: string, body: string) => {
      if (!/\b(?:title|camera|action|dialogue|exact dialogue|key prop|visual cue)\s*=/i.test(body)) return match;
      const title = extractLegacyStoryboardField(body, "title");
      const action = extractLegacyStoryboardField(body, "action");
      const dialogue = extractLegacyStoryboardField(body, "dialogue") || extractLegacyStoryboardField(body, "exact dialogue");
      const visualCue = extractLegacyStoryboardField(body, "visual cue");
      const visual = [
        title ? `Story beat ${Number(shotNumber)} (${title})` : `Story beat ${Number(shotNumber)}`,
        action ? `show ${action}` : "",
        visualCue ? `visual cue: ${visualCue}` : "",
        dialogue ? `speech bubble when visible: ${dialogue}` : "no speech bubble",
      ].filter(Boolean).join("; ");
      return `\n${visual}. `;
    },
  );
}

function extractLegacyStoryboardField(body: string, field: string): string {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`${escaped}\\s*=\\s*([\\s\\S]*?)(?=\\s*\\|\\s*(?:title|camera|action|exact dialogue|dialogue|key prop|visual cue|panel label|visible cast|framing)\\s*=|;\\s*technical label|$)`, "i"));
  return compactPromptText(match?.[1] || "", 420);
}

function dedupeStoryboardPanelSpeechBubbles(prompt: string): string {
  const panelsHeaderMatch = prompt.match(/\bComic panels in reading order\s*:/i);
  if (!panelsHeaderMatch || typeof panelsHeaderMatch.index !== "number") return prompt;
  const beforePanels = prompt.slice(0, panelsHeaderMatch.index + panelsHeaderMatch[0].length);
  const panelsAndAfter = prompt.slice(panelsHeaderMatch.index + panelsHeaderMatch[0].length);
  const usedDialogueKeys = new Set<string>();
  const cleanedPanels = panelsAndAfter.replace(
    /\bPanel\s+(\d{1,2})\s*[:：]\s*([\s\S]*?)(?=\bPanel\s+\d{1,2}\s*[:：]|\bPanel planning rules\b|\bPanel continuity\b|\bVisible board text\b|\bCharacter rules\b|\bBoard style\b|\bLanguage rule\b|\bSpeech bubbles\b|\bAvoid\b|$)/gi,
    (match, panelNumber: string, body: string) => {
      const nextBody = body.replace(/\bspeech bubble(?:\s+when\s+visible)?\s*:\s*([^|;\n]+)/gi, (bubbleMatch, dialogue: string) => {
        const cleanDialogue = compactPromptText(dialogue, 420);
        const dialogueKey = normalizeStoryboardDialogueKey(cleanDialogue);
        if (!dialogueKey) return "no speech bubble";
        if (usedDialogueKeys.has(dialogueKey)) return "no speech bubble";
        usedDialogueKeys.add(dialogueKey);
        return `speech bubble: ${cleanDialogue}`;
      });
      return `Panel ${Number(panelNumber)}: ${nextBody}`;
    },
  );
  return `${beforePanels}${cleanedPanels}`;
}

function normalizeStoryboardDialogueKey(dialogue: string): string {
  return compactPromptText(dialogue)
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function compactPromptText(value: unknown, max = Number.POSITIVE_INFINITY): string {
  return stringValue(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeStoryboardPromptSpacing(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


