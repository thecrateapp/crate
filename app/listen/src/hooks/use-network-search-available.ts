import { useApi } from "@/hooks/use-api";

interface FederationSearchCapabilities {
  federation?: { search_stream?: boolean };
}

/**
 * Whether the server streams federated search (FED1.5, FED-D18); null while
 * the capabilities are still loading.
 *
 * Servers without the capability, and Listen builds that never read it, keep
 * the canonical /api/catalog/search path. A capabilities error counts as no.
 */
export function useNetworkSearchAvailable(): boolean | null {
  const { data, loading } =
    useApi<FederationSearchCapabilities>("/api/capabilities");
  if (data) return data.federation?.search_stream === true;
  return loading ? null : false;
}
