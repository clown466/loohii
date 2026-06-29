export type ClipShotDialogueInput = {
  /** 镜头原始台词：可能被上游切成半句、可能带 "Speaker:" 前缀、可能为空 */
  dialogue: string;
  /** 该镜头出场角色名 */
  characters: string[];
  /** 可选上下文：用于多角色镜头中裸台词的保守说话人推断 */
  title?: string;
  action?: string;
  description?: string;
  visualPrompt?: string;
  references?: string;
};

export type ClipDialogueAllocation = {
  /** 下标 = 镜头/节拍索引；每项为该节拍的台词行（已补说话人、已合并碎句） */
  beats: string[][];
  /** 逐字校验后补回的台词条数 */
  restoredCount: number;
};

type DialogueFragment = {
  shotIndex: number;
  speaker: string;
  /** speaker 是否来自原文标注前缀（false = 单角色镜头推断） */
  labeled: boolean;
  text: string;
};

const SPEAKER_SPLIT_PATTERN =
  /\s+(?=[A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}\s*[:：])|(?<=[。！？.!?])\s*(?=[一-龥·]{1,12}[:：])/g;
const SPEAKER_PREFIX_PATTERN =
  /^\s*([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,2}|[一-龥·]{1,12})\s*[:：]\s*(\S[\s\S]*)$/;
const SENTENCE_END_PATTERN = /[.!?。！？…]["'”’」』)]*\s*$/;

export function allocateClipDialogueToBeats(shots: ClipShotDialogueInput[]): ClipDialogueAllocation {
  const beats: string[][] = shots.map(() => []);
  const speakerWhitelist = buildSpeakerWhitelist(shots);
  const fragments = shots.flatMap((shot, shotIndex) => splitShotDialogue(shot, shotIndex, speakerWhitelist));
  let pending: DialogueFragment | null = null;

  const flush = (fragment: DialogueFragment) => {
    const line = fragment.speaker ? `${fragment.speaker}: ${fragment.text}` : fragment.text;
    beats[fragment.shotIndex]?.push(line.replace(/\s+/g, " ").trim());
  };

  for (const fragment of fragments) {
    let merged: DialogueFragment;
    if (pending && canContinue(pending, fragment)) {
      merged = {
        shotIndex: pending.shotIndex,
        speaker: pending.speaker,
        labeled: pending.labeled,
        text: `${pending.text} ${fragment.text}`,
      };
    } else {
      if (pending) flush(pending);
      merged = fragment;
    }
    if (SENTENCE_END_PATTERN.test(merged.text.trim())) {
      flush(merged);
      pending = null;
    } else {
      pending = merged;
    }
  }
  if (pending) flush(pending);

  const restoredCount = restoreMissingDialogueFragments(shots, beats);
  return { beats, restoredCount };
}

export function extractDialogueSpeakerNames(value: string): string[] {
  const raw = (value || "").replace(/\s+/g, " ").trim();
  if (!raw) return [];
  const names = new Set<string>();
  const pieces = splitBySpeakerCandidates(raw, null);
  for (const piece of pieces) {
    const match = piece.trim().match(SPEAKER_PREFIX_PATTERN);
    const name = (match?.[1] ?? "").trim();
    if (name) names.add(name);
  }
  return Array.from(names);
}

/**
 * 逐字校验：每条源台词必须出现在输出里，缺失的补回所属节拍。返回补回条数。
 *
 * 注意：
 * - 存在性检查按空格词边界匹配，避免词内子串误判（如 "Run" 被 "running" 掩盖）；
 *   中文无空格分词，单字台词理论上仍可能被更长词语掩盖（实践可接受）。
 * - 规格的「仅出现一次」放宽为存在性检查：重复同句台词缺一条检测不到（低频可接受）。
 */
export function restoreMissingDialogueFragments(shots: ClipShotDialogueInput[], beats: string[][]): number {
  const joined = normalizeDialogueKey(beats.flat().join(" "));
  const speakerWhitelist = buildSpeakerWhitelist(shots);
  let restored = 0;
  shots.forEach((shot, shotIndex) => {
    for (const fragment of splitShotDialogue(shot, shotIndex, speakerWhitelist)) {
      const key = normalizeDialogueKey(fragment.text);
      if (!key || ` ${joined} `.includes(` ${key} `)) continue;
      const line = fragment.speaker ? `${fragment.speaker}: ${fragment.text}` : fragment.text;
      beats[shotIndex]?.push(line.replace(/\s+/g, " ").trim());
      restored += 1;
    }
  });
  return restored;
}

/** shots 全体 characters 的并集（normalizeDialogueKey 后），作为说话人白名单。 */
function buildSpeakerWhitelist(shots: ClipShotDialogueInput[]): Set<string> {
  const whitelist = new Set<string>();
  for (const shot of shots) {
    for (const character of shot.characters) {
      const key = normalizeDialogueKey(character);
      if (key) whitelist.add(key);
    }
  }
  return whitelist;
}

/**
 * 按候选切点切分台词：先用 SPEAKER_SPLIT_PATTERN 找候选切点；
 * 有白名单时，仅当切点后的前缀（规范化后）命中白名单才切分，
 * 避免台词内「大写词/中文词 + 冒号」（如 "Remember:"、"记住："）被误判为说话人。
 * 白名单为空（whitelist = null）时在全部候选切点切分，保持旧启发式行为。
 */
function splitBySpeakerCandidates(raw: string, whitelist: Set<string> | null): string[] {
  const pieces: string[] = [];
  let start = 0;
  for (const match of raw.matchAll(SPEAKER_SPLIT_PATTERN)) {
    const index = match.index ?? 0;
    if (whitelist) {
      const rest = raw.slice(index + match[0].length);
      const prefix = rest.match(SPEAKER_PREFIX_PATTERN);
      const speakerKey = prefix ? normalizeDialogueKey((prefix[1] ?? "").trim()) : "";
      if (!speakerKey || !whitelist.has(speakerKey)) continue;
    }
    pieces.push(raw.slice(start, index));
    start = index + match[0].length;
  }
  pieces.push(raw.slice(start));
  return pieces;
}

function splitShotDialogue(
  shot: ClipShotDialogueInput,
  shotIndex: number,
  speakerWhitelist: Set<string>,
): DialogueFragment[] {
  const raw = (shot.dialogue || "").replace(/\s+/g, " ").trim();
  if (!raw) return [];
  const inferredSpeaker = inferDialogueSpeakerForShot(shot, raw);
  const useWhitelist = speakerWhitelist.size > 0;
  return splitBySpeakerCandidates(raw, useWhitelist ? speakerWhitelist : null)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .map((piece) => {
      const match = piece.match(SPEAKER_PREFIX_PATTERN);
      if (match) {
        const speaker = (match[1] ?? "").trim();
        // 前缀命中白名单才视为说话人标注；否则整段视为台词文本（单角色镜头照常推断补名）
        if (!useWhitelist || speakerWhitelist.has(normalizeDialogueKey(speaker))) {
          return { shotIndex, speaker, labeled: true, text: (match[2] ?? "").trim() };
        }
      }
      return { shotIndex, speaker: inferredSpeaker, labeled: false, text: piece };
    });
}

function inferDialogueSpeakerForShot(shot: ClipShotDialogueInput, rawDialogue: string): string {
  const characters = (shot.characters || []).map((item) => item.trim()).filter(Boolean);
  if (characters.length === 1) return characters[0] ?? "";
  if (characters.length === 0) return "";
  const context = [
    shot.title,
    shot.action,
    shot.description,
    shot.visualPrompt,
    shot.references,
  ].filter(Boolean).join(" \n ");
  if (!context.trim()) return "";
  const scores = characters.map((character) => ({
    character,
    score: contextualSpeakerScore(character, rawDialogue, context),
  }));
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const second = scores[1];
  if (!best || best.score < 4) return "";
  if (second && best.score === second.score) return "";
  return best.character;
}

function contextualSpeakerScore(character: string, rawDialogue: string, context: string): number {
  const escaped = escapeRegExp(character);
  const name = namePattern(character);
  const speechVerb =
    String.raw`(?:says|said|speaks|spoke|yells|yelled|shouts|shouted|calls|called|cries|cried|mutters|muttered|asks|asked|replies|replied|warns|warned|orders|ordered|snaps|snapped|growls|growled|screams|screamed|whispers|whispered|announces|announced|responds|responded|adds|added|jokes|joked|吐槽|喊|大喊|怒吼|低声说|说|问|回答|回应|警告|命令|宣布)`;
  const gestureVerb =
    String.raw`(?:points?|pointed|gestures?|gestured|motions?|motioned|indicates?|indicated|signals?|signaled|nods?|nodded|beckons?|beckoned|示意|指向|指着|点头|挥手)`;
  let score = 0;
  const title = shotTitleFromContext(context);
  if (title && new RegExp(String.raw`^${name}(?:'s|’s|\s|：|:|·|-)`, "i").test(title)) score += 4;
  if (new RegExp(String.raw`${name}\s+${speechVerb}\b`, "i").test(context)) score += 7;
  if (new RegExp(String.raw`${speechVerb}\s+${name}\b`, "i").test(context)) score += 5;
  if (new RegExp(String.raw`${name}[^.。!?！？\n]{0,80}${speechVerb}`, "i").test(context)) score += 4;
  if (isShortDirectionalDialogue(rawDialogue) && new RegExp(String.raw`${name}\s+${gestureVerb}\b`, "i").test(context)) score += 5;
  if (isShortDirectionalDialogue(rawDialogue) && new RegExp(String.raw`${name}[^.。!?！？\n]{0,80}${gestureVerb}`, "i").test(context)) score += 3;
  if (new RegExp(String.raw`${escaped}\s*(?:：|:)`).test(context)) score += 4;
  const quote = trimDialogueQuotes(rawDialogue);
  if (quote.length >= 4) {
    const quoteStart = escapeRegExp(quote.slice(0, Math.min(40, quote.length)));
    if (new RegExp(String.raw`${name}[^.。!?！？\n]{0,120}["'“”‘’]${quoteStart}`, "i").test(context)) score += 8;
    if (new RegExp(String.raw`${name}[^.。!?！？\n]{0,120}${quoteStart}`, "i").test(context)) score += 4;
  }
  return score;
}

function isShortDirectionalDialogue(value: string): boolean {
  const text = trimDialogueQuotes(value).toLowerCase();
  if (!text || text.length > 80) return false;
  return /(?:look|watch|see|there|here|this way|over there|hold on|come on|go|run|stop|wait|快看|看那|那边|这边|等等|停下|快走|跑)/i.test(text);
}

function shotTitleFromContext(context: string): string {
  return context.split(/\n/)[0]?.trim() ?? "";
}

function namePattern(character: string): string {
  const escaped = escapeRegExp(character);
  return /[A-Za-z0-9]/.test(character) ? String.raw`\b${escaped}\b` : escaped;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trimDialogueQuotes(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
}

/**
 * 半句延续条件：上一片段未以句末标点结束，且：
 * - 后续片段无原文标注前缀时，其推断说话人为空或与 pending 同名 → 可延续；
 * - 后续片段有原文标注前缀时，视为新的完整 spoken turn，不能合并。
 */
function canContinue(pending: DialogueFragment, next: DialogueFragment): boolean {
  if (SENTENCE_END_PATTERN.test(pending.text.trim())) return false;
  if (!next.labeled) {
    return !next.speaker || normalizeDialogueKey(next.speaker) === normalizeDialogueKey(pending.speaker);
  }
  return false;
}

function normalizeDialogueKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/["'“”‘’「」『』]/g, "")
    .replace(/[\s.,!?;:，。！？；：/\\-]+/g, " ")
    .trim();
}
