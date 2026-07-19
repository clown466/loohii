export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

/** Phase 0 stub: empty transcript; real ASR provider swaps in later. */
export async function transcribeAudio(_videoPath: string): Promise<TranscriptSegment[]> {
  return [];
}
