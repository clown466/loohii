// src/app/lib/queries/generationRecords.ts
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiClient } from "../api";
import type { GenerationRecord } from "../api";
import { queryClient } from "../queryClient";
import { subscribeProjectGenerationUpdates } from "../realtimeClient";

export const generationRecordsQueryKey = (projectId: string) =>
  ["generation-records", projectId] as const;

export function invalidateGenerationRecords(projectId: string | undefined): void {
  if (!projectId || projectId === "local") return;
  void queryClient.invalidateQueries({ queryKey: ["generation-records", projectId] });
}

/** 画布页生成记录：30s stale + 60s 兜底轮询 + socket 推送 invalidate。 */
export function useGenerationRecords(projectId: string | undefined) {
  const enabled = !!projectId && projectId !== "local";
  const client = useQueryClient();

  useEffect(() => {
    if (!enabled || !projectId) return;
    return subscribeProjectGenerationUpdates(projectId, () => {
      void client.invalidateQueries({ queryKey: generationRecordsQueryKey(projectId) });
    });
  }, [enabled, projectId, client]);

  return useQuery<GenerationRecord[]>({
    queryKey: generationRecordsQueryKey(projectId ?? "none"),
    queryFn: () => apiClient.listGenerationRecords(projectId, { limit: 120, compact: true }),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}
