import { useApi } from "@/hooks/use-api";

interface SmartMixStemsCapabilities {
  smart_mix?: { stems?: { playlists?: boolean } };
}

/** Whether the server offers Smart Mix playlists (capability smart_mix.stems.playlists). */
export function useSmartMixPlaylistsEnabled(): boolean {
  const { data } = useApi<SmartMixStemsCapabilities>("/api/capabilities");
  return data?.smart_mix?.stems?.playlists === true;
}
