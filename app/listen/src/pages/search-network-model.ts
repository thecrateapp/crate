import type { NetworkSearchCoverage } from "@/lib/network-search-stream";

import type { SearchData } from "./search-results-model";
import type { NetworkSearchState } from "./use-search-results";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function searchDataIsEmpty(data: SearchData): boolean {
  return (
    data.artists.length === 0 &&
    data.albums.length === 0 &&
    data.tracks.length === 0
  );
}

/** The server asked the network for this query (or the stream broke trying). */
export function networkSearchInvolved(
  network: NetworkSearchState | null,
): network is NetworkSearchState {
  if (!network) return false;
  if (network.unavailable) return true;
  return Boolean(network.coverage && network.coverage.state !== "skipped");
}

export function networkStillSearching(network: NetworkSearchState): boolean {
  return (
    !network.unavailable &&
    (network.coverage === null || network.coverage.state === "searching")
  );
}

export function peersWithoutAnswer(coverage: NetworkSearchCoverage): number {
  return (
    coverage.peers_failed + coverage.peers_timed_out + coverage.peers_pending
  );
}

/** "3 of 4 peers": how much of the network answered. */
export function networkCoverageCount(
  coverage: NetworkSearchCoverage,
  t: Translate,
): string {
  return t("search.network.coverage", {
    answered: coverage.peers_answered,
    total: coverage.peers_total,
  });
}

/**
 * The coverage sentence. It only ever counts peers: an empty answer says how
 * many peers answered, never that the music is missing from the network.
 */
export function networkCoverageSummary(
  network: NetworkSearchState,
  t: Translate,
): string {
  const coverage = network.coverage;
  if (network.unavailable || !coverage) return t("search.network.unavailable");
  if (coverage.state === "searching") {
    return t("search.network.searching", { count: coverage.peers_total });
  }
  const parts: string[] = [];
  if (searchDataIsEmpty(network.results) && coverage.peers_answered > 0) {
    parts.push(
      t("search.network.noResults", {
        answered: coverage.peers_answered,
        total: coverage.peers_total,
      }),
    );
  }
  const missing = peersWithoutAnswer(coverage);
  if (missing > 0) parts.push(t("search.network.noAnswer", { count: missing }));
  return parts.join(" ");
}

/** Late answers land in the server cache; asking again brings them in. */
export function canSearchNetworkAgain(network: NetworkSearchState): boolean {
  if (network.unavailable) return true;
  const coverage = network.coverage;
  return Boolean(
    coverage &&
    coverage.state === "partial" &&
    peersWithoutAnswer(coverage) > 0,
  );
}
