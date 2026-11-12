import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import {
  openNetworkSearchStream,
  type NetworkSearchCoverage,
} from "@/lib/network-search-stream";

import type { SearchData } from "./search-results-model";
import {
  networkSearchEligible,
  useNetworkSearchQuery,
} from "./use-network-search-query";

export const EMPTY_SEARCH_DATA: SearchData = {
  artists: [],
  albums: [],
  tracks: [],
};

export interface NetworkSearchState {
  query: string;
  /** Null until the server says whether it asks the network. */
  coverage: NetworkSearchCoverage | null;
  /** The stream broke after local results; the network part is unknown. */
  unavailable: boolean;
  results: SearchData;
}

export interface SearchResultsState {
  result: { query: string; data: SearchData } | null;
  searching: boolean;
  error: unknown;
  network: NetworkSearchState | null;
  /** Ask the network again; late answers come back from the server cache. */
  searchNetworkAgain: () => void;
}

const SEARCH_LIMIT = 50;

function canonicalSearch(query: string, signal: AbortSignal) {
  return api<SearchData>(
    "/api/catalog/search?q=" +
      encodeURIComponent(query) +
      "&limit=" +
      String(SEARCH_LIMIT),
    "GET",
    undefined,
    { signal },
  );
}

/**
 * Search results for the search page.
 *
 * Without network search (old servers, short queries) this is the canonical
 * /api/catalog/search, as before. With it, one stream brings the local results
 * at once and the network's within the window (FED1.4); if the stream fails
 * before local results arrive, the canonical search answers instead.
 */
export function useSearchResults(
  query: string,
  retryKey: number,
  networkEnabled: boolean,
): SearchResultsState {
  const trimmed = query.trim();
  const viaNetwork = networkEnabled && networkSearchEligible(trimmed);
  const networkQuery = useNetworkSearchQuery(trimmed, networkEnabled);
  const [result, setResult] = useState<SearchResultsState["result"]>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [network, setNetwork] = useState<NetworkSearchState | null>(null);
  const [networkAttempt, setNetworkAttempt] = useState(0);

  useEffect(() => {
    if (!trimmed) {
      setResult(null);
      setError(null);
      setSearching(false);
      setNetwork(null);
      return;
    }
    if (viaNetwork) return;
    setNetwork(null);
    const controller = new AbortController();
    setError(null);
    setSearching(true);
    canonicalSearch(trimmed, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setResult({ query: trimmed, data });
      })
      .catch((nextError: unknown) => {
        if (!controller.signal.aborted) setError(nextError);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });
    return () => controller.abort();
  }, [trimmed, retryKey, viaNetwork]);

  useEffect(() => {
    if (!viaNetwork) return;
    if (networkQuery === null) {
      // The query is still settling; keep showing what we have.
      setSearching(true);
      return;
    }
    const controller = new AbortController();
    setError(null);
    setSearching(true);
    setNetwork({
      query: networkQuery,
      coverage: null,
      unavailable: false,
      results: EMPTY_SEARCH_DATA,
    });
    const update = (patch: Partial<NetworkSearchState>) =>
      setNetwork((current) =>
        current && current.query === networkQuery
          ? { ...current, ...patch }
          : current,
      );
    const close = openNetworkSearchStream(networkQuery, {
      onLocal: (data) => {
        setResult({ query: networkQuery, data });
        setSearching(false);
      },
      onCoverage: (coverage) => update({ coverage }),
      onRemote: (results, coverage) => update({ results, coverage }),
      onDone: (coverage) => update({ coverage }),
      onError: (beforeLocal) => {
        update({ unavailable: true });
        if (!beforeLocal) return;
        canonicalSearch(networkQuery, controller.signal)
          .then((data) => {
            if (!controller.signal.aborted)
              setResult({ query: networkQuery, data });
          })
          .catch((nextError: unknown) => {
            if (!controller.signal.aborted) setError(nextError);
          })
          .finally(() => {
            if (!controller.signal.aborted) setSearching(false);
          });
      },
    });
    return () => {
      close();
      controller.abort();
    };
  }, [viaNetwork, networkQuery, retryKey, networkAttempt]);

  return {
    result,
    searching,
    error,
    network: viaNetwork && network?.query === trimmed ? network : null,
    searchNetworkAgain: () => setNetworkAttempt((attempt) => attempt + 1),
  };
}
