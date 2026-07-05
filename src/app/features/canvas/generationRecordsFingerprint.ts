export function generationRecordsFingerprint(
  records: ReadonlyArray<{ id?: string; updatedAt?: string | null; status?: string | null }>,
): string {
  return records
    .map((r) => `${r.id ?? ""}:${r.updatedAt ?? ""}:${r.status ?? ""}`)
    .join("|");
}
