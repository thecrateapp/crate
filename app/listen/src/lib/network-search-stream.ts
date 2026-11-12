import { apiSseUrl } from "@/lib/api";
import type { SearchData } from "@/pages/search-results-model";

export type NetworkSearchPeerStatus =
  "pending" | "answered" | "failed" | "rate_limited" | "timed_out";

export interface NetworkSearchPeer {
  node_uid: string;
  node_name: string;
  status: NetworkSearchPeerStatus;
}

/** How much of the network a search reached. Counts peers, never content. */
export interface NetworkSearchCoverage {
  state: "searching" | "complete" | "partial" | "skipped";
  reason: string;
  window_ms: number;
  peers_total: number;
  peers_answered: number;
  peers_failed: number;
  peers_timed_out: number;
  peers_pending: number;
  peers: NetworkSearchPeer[];
}

export interface NetworkSearchHandlers {
  onLocal: (results: SearchData) => void;
  onCoverage: (coverage: NetworkSearchCoverage) => void;
  onRemote: (results: SearchData, coverage: NetworkSearchCoverage) => void;
  onDone: (coverage: NetworkSearchCoverage) => void;
  /** The stream broke; ``beforeLocal`` when no local results arrived yet. */
  onError: (beforeLocal: boolean) => void;
}

export const NETWORK_SEARCH_LIMIT = 50;

export function networkSearchStreamPath(query: string, limit: number): string {
  return (
    "/api/catalog/search-stream?q=" +
    encodeURIComponent(query) +
    "&limit=" +
    String(limit)
  );
}

function parse<T>(event: Event): T | null {
  try {
    return JSON.parse((event as MessageEvent<string>).data) as T;
  } catch {
    return null;
  }
}

/**
 * Open one federated search (FED1.4). Returns a function that closes it.
 *
 * The server ends the stream with ``done``; the source is closed then, and on
 * any error, so EventSource never reconnects and repeats a search.
 */
export function openNetworkSearchStream(
  query: string,
  handlers: NetworkSearchHandlers,
  limit = NETWORK_SEARCH_LIMIT,
): () => void {
  const source = new EventSource(
    apiSseUrl(networkSearchStreamPath(query, limit)),
  );
  let closed = false;
  let sawLocal = false;
  const close = () => {
    if (closed) return;
    closed = true;
    source.close();
  };

  source.addEventListener("local", (event) => {
    const payload = parse<{ results: SearchData }>(event);
    if (!payload || closed) return;
    sawLocal = true;
    handlers.onLocal(payload.results);
  });
  source.addEventListener("coverage", (event) => {
    const payload = parse<NetworkSearchCoverage>(event);
    if (payload && !closed) handlers.onCoverage(payload);
  });
  source.addEventListener("remote", (event) => {
    const payload = parse<{
      results: SearchData;
      coverage: NetworkSearchCoverage;
    }>(event);
    if (payload && !closed)
      handlers.onRemote(payload.results, payload.coverage);
  });
  source.addEventListener("done", (event) => {
    const payload = parse<{ coverage: NetworkSearchCoverage }>(event);
    if (closed) return;
    close();
    if (payload) handlers.onDone(payload.coverage);
  });
  source.onerror = () => {
    if (closed) return;
    close();
    handlers.onError(!sawLocal);
  };

  return close;
}
