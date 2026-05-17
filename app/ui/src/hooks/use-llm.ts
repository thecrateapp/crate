import { useApi } from "@/hooks/use-api";

interface LLMStatus {
  available: boolean;
  model: string;
  provider: string;
  error?: string | null;
}

export function useLLMStatus(): LLMStatus | null {
  const { data } = useApi<LLMStatus>("/api/admin/llm/status");
  return data ?? null;
}

export function useLLMAvailable(): boolean {
  return useLLMStatus()?.available ?? false;
}
