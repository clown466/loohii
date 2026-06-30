export type PersistedModelEntry = {
  configId?: string;
  model: string;
  modality: string;
};

function modelEntryKey(entry: Pick<PersistedModelEntry, "model" | "modality">) {
  return `${entry.modality.trim().toLowerCase()}::${entry.model.trim().toLowerCase()}`;
}

export function findRemovedModelConfigIds(
  originalEntries: PersistedModelEntry[],
  currentEntries: PersistedModelEntry[],
): string[] {
  const currentKeys = new Set(currentEntries.map(modelEntryKey));
  const removedIds: string[] = [];

  for (const original of originalEntries) {
    if (!original.configId) continue;
    if (currentKeys.has(modelEntryKey(original))) continue;
    removedIds.push(original.configId);
  }

  return removedIds;
}
