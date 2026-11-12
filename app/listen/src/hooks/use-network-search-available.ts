import { useApi } from "@/hooks/use-api";

interface FederationSearchCapabilities {
  federation?: { search_stream?: boolean };
}

/**
 * Whether the server streams federated search (FED1.5, FED-D18).
 *
 * Servers without the capability, and Listen builds that never read it, keep
 * the canonical /api/catalog/search path.
 */
export function useNetworkSearchAvailable(): boolean {
  const { data } = useApi<FederationSearchCapabilities>("/api/capabilities");
  return data?.federation?.search_stream === true;
}
