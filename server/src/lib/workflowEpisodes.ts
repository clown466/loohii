/**
 * Shared helpers for navigating the episode / workflow-center metadata tree.
 */

import { isRecord, normalizeCompareText, stringValue } from "./typeGuards";

export function getWorkflowEpisodes(metadata: unknown): Record<string, Record<string, unknown>> {
  if (!isRecord(metadata) || !isRecord(metadata.episodes)) return {};
  const result: Record<string, Record<string, unknown>> = {};
  for (const [id, value] of Object.entries(metadata.episodes)) {
    if (id && isRecord(value)) result[id] = value;
  }
  return result;
}

export function resolveWorkflowEpisodeId(metadata: unknown, episodeIdOrTitle: string): string {
  const requested = episodeIdOrTitle.trim();
  if (!requested) return "";
  const episodes = getWorkflowEpisodes(metadata);
  if (episodes[requested]) return requested;
  const requestedKey = normalizeCompareText(requested);
  for (const [id, episode] of Object.entries(episodes)) {
    const workflowCenter = isRecord(episode.workflowCenter) ? episode.workflowCenter : {};
    if (
      normalizeCompareText(id) === requestedKey ||
      normalizeCompareText(episode.title) === requestedKey ||
      normalizeCompareText(workflowCenter.selectedEpisode) === requestedKey
    ) {
      return id;
    }
  }
  return requested;
}

export function workflowEpisodeIdForTitle(title: string, fallback: string): string {
  const text = title.trim();
  const numberMatch = text.match(/(?:第\s*)?(\d{1,4})\s*(?:集|话|章|回|episode|ep\b)/i) ?? text.match(/(?:episode|ep)\s*0*(\d{1,4})/i);
  if (numberMatch) return `episode-${String(Number(numberMatch[1])).padStart(3, "0")}`;
  const slug = text
    .toLowerCase()
    .replace(/[\u3400-\u9fff]+/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug ? `episode-${slug}` : fallback;
}

export function workflowEpisodeCanvasSceneId(episodeId: string): string {
  return episodeId || "default";
}

export function getEpisodeTitle(metadata: unknown, episodeId: string): string {
  const episodes = getWorkflowEpisodes(metadata);
  const episode = episodes[resolveWorkflowEpisodeId(metadata, episodeId)];
  return isRecord(episode) ? stringValue(episode.title) : "";
}
