"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { DateRange } from "@/lib/records";
import type { ExportRequest, ExportResponse, RecordsResponse } from "@/lib/types/records";

export function useRecords(range: DateRange, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["records", range.from, range.to] as const,
    queryFn: () => api<RecordsResponse>(`/records?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`),
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

export function useExportRecords() {
  return useMutation({
    mutationFn: (body: ExportRequest) => api<ExportResponse>("/exports", { method: "POST", body }),
  });
}
