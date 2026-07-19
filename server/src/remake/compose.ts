export function buildConcatDemuxerList(paths: string[]): string {
  return paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
}

export function buildSubtitleBurnFilter(srtPath: string): string {
  const escaped = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  return `subtitles='${escaped}'`;
}
