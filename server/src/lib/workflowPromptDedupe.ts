const REPEATED_RULE_PATTERNS = [
  /\bShow the listener's reaction, speaker's expression, and body language as the line lands\.?/gi,
  /\bSame setting and character blocking, natural reaction or angle change\.?/gi,
  /\bHold the same scene geography and shift to a natural reaction or angle change\.?/gi,
  /\breaction\/cutaway detail, same scene geography, same character positions\.?/gi,
  /\bSame dialogue turn continues over this silent reaction\/cutaway shot\.?/gi,
  /\bContinue the exchange with a clean reaction beat\.?/gi,
  /\bReaction beat\.?/gi,
  /\bPerformance:\s*[^;。!?]*story-specific emotion matching the current beat[^;。!?]*[;。!?]?\s*/gi,
  /\bdelivery natural to the line's intent, not monotone, with clear emotional subtext[;。!?]?\s*/gi,
  /\b(?:masterpiece|best quality|highly detailed|cinematic lighting|consistent character design|polished render|saturated colors|clean 3D render)\b,?\s*/gi,
  /\b(?:saturated\s+)?3D\s+(?:American\s+)?(?:animated\s+)?(?:dark[- ]comedy\s+)?comic style\b,?\s*/gi,
  /\b(?:3D style|American comic style|dark humor|dark-comedy comic look)\b,?\s*/gi,
  /\bframe only (?:the )?visible subject\(s\)(?: for this shot)?\.?/gi,
  /\bkeep screen direction readable\.?/gi,
  /\bseparate foreground, midground, and background(?: for continuity)?\.?/gi,
  /\bmaintain one continuous scene geography\.?/gi,
];

export function hoistRepeatedShotRules(prompt: string): string {
  const lines = normalizeLines(prompt);
  const beatLines = lines.filter(isSBeatLine);
  if (beatLines.length < 2) return normalizeExactDialogueQuoteStyle(lines.join("\n"));

  const repeatedBlocking = mostCommonBlocking(beatLines);
  const seenBeatParts = new Set<string>();
  const cleaned = lines.map((line) => isSBeatLine(line) ? cleanSBeatLine(line, repeatedBlocking, seenBeatParts) : line);
  if (!repeatedBlocking || cleaned.some((line) => normalizeKey(line) === normalizeKey(`Clip blocking: ${repeatedBlocking}.`))) {
    return normalizeExactDialogueQuoteStyle(cleaned.join("\n"));
  }

  const firstBeatIndex = cleaned.findIndex(isSBeatLine);
  const insertIndex = firstBeatIndex >= 0 ? firstBeatIndex : cleaned.length;
  return normalizeExactDialogueQuoteStyle([
    ...cleaned.slice(0, insertIndex),
    `Clip blocking: ${repeatedBlocking}.`,
    ...cleaned.slice(insertIndex),
  ].join("\n"));
}

function cleanSBeatLine(line: string, repeatedBlocking: string, seenBeatParts = new Set<string>()): string {
  const match = line.match(/^(S\d{1,2}\s*[:：])\s*([\s\S]*)$/i);
  if (!match) return line;
  const label = match[1].replace("：", ":");
  let body = match[2] ?? "";
  if (repeatedBlocking) {
    body = body
      .replace(new RegExp(String.raw`\bblocking\s*:\s*${escapeRegExp(repeatedBlocking)}\.?`, "gi"), "")
      .replace(new RegExp(escapeRegExp(repeatedBlocking), "gi"), "");
  }
  for (const pattern of REPEATED_RULE_PATTERNS) body = body.replace(pattern, "");
  const parts = body
    .split(";")
    .map((part) => cleanInline(part))
    .filter(Boolean)
    .filter((part) => !/^(?:blocking|composition)\s*[:：]?\s*$/i.test(part))
    .filter((part) => !/^(?:Cultists s|Cultists sit r|del)\.?$/i.test(part))
    .filter((part) => keepNonRepeatedBeatPart(part, seenBeatParts));
  return cleanInline(`${label} ${parts.join("; ")}`)
    .replace(/\s+([.;,!?])/g, "$1")
    .replace(/;{2,}/g, ";");
}

function keepNonRepeatedBeatPart(part: string, seenBeatParts: Set<string>): boolean {
  if (/^(?:Exact dialogue|Dialogue|State|Shot)\s*[:：]/i.test(part)) return true;
  if (/^(?:delivery|Performance)\b/i.test(part)) {
    const key = normalizeKey(part);
    if (!key) return false;
    if (seenBeatParts.has(key)) return false;
    seenBeatParts.add(key);
    return true;
  }
  const key = normalizeKey(part);
  if (!key || key.length < 48) return true;
  if (seenBeatParts.has(key)) return false;
  seenBeatParts.add(key);
  return true;
}

function mostCommonBlocking(beatLines: string[]): string {
  const counts = new Map<string, { value: string; count: number }>();
  for (const line of beatLines) {
    const match = line.match(/\bblocking\s*:\s*([^;]+?)(?:\s+Same setting and character blocking|;|$)/i);
    const value = cleanSentence(match?.[1] ?? "");
    if (!value || value.length < 24) continue;
    const key = normalizeKey(value);
    const current = counts.get(key);
    counts.set(key, { value, count: (current?.count ?? 0) + 1 });
  }
  return Array.from(counts.values())
    .filter((item) => item.count >= 2)
    .sort((a, b) => b.count - a.count)[0]?.value ?? "";
}

function normalizeLines(prompt: string): string[] {
  return String(prompt || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isSBeatLine(line: string): boolean {
  return /^S\d{1,2}\s*[:：]/i.test(line.trim());
}

function cleanSentence(value: string): string {
  return cleanInline(value).replace(/[.;,，。；]+$/g, "").trim();
}

function cleanInline(value: string): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*/g, "; ")
    .replace(/^;\s*|\s*;$/g, "")
    .trim();
}

function normalizeKey(value: string): string {
  return cleanInline(value).toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeExactDialogueQuoteStyle(prompt: string): string {
  return String(prompt || "")
    .split("\n")
    .map((line) => line
      .replace(
        /\bExact dialogue:\s*([^:：;\n]{1,40})\s*[:：]\s*([^;\n]+?)(?=;|$)/g,
        (_match, speaker, dialogue) => `Dialogue: ${String(speaker).trim()} says “${trimDialogueQuotes(String(dialogue))}”`,
      )
      .replace(
        /\bDialogue:\s*([^:：;\n]{1,40})\s*[:：]\s*([^;\n]+?)(?=;|$)/g,
        (_match, speaker, dialogue) => `Dialogue: ${String(speaker).trim()} says “${trimDialogueQuotes(String(dialogue))}”`,
      ))
    .join("\n");
}

function trimDialogueQuotes(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
}
