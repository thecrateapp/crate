import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import { SectionHeader } from "@crate/ui/domain/lists";
import { Disc3, User } from "@crate/ui/icons";

import type { PlayerActionsValue } from "@/contexts/player-context";

import { buildTrackRowData } from "./search-results-model";
import {
  canSearchNetworkAgain,
  networkCoverageCount,
  networkCoverageSummary,
  networkStillSearching,
  searchDataIsEmpty,
} from "./search-network-model";
import { SearchTrackResults } from "./SearchTrackResults";
import type { NetworkSearchState } from "./use-search-results";

/**
 * "More results from the network" (FED1.4): coverage and the remote results
 * grouped by entity. Remote artists and albums are not links yet: their pages
 * accept source identities in FED5, and a result never links to a canonical
 * entity that does not exist.
 */
export function SearchNetworkResults({
  network,
  query,
  playAll,
  onSearchAgain,
}: {
  network: NetworkSearchState;
  query: string;
  playAll: PlayerActionsValue["playAll"];
  onSearchAgain: () => void;
}) {
  const { t } = useTranslation();
  const results = network.results;
  const trackRowData = useMemo(
    () => buildTrackRowData(results.tracks),
    [results.tracks],
  );
  const searching = networkStillSearching(network);
  const summary = networkCoverageSummary(network, t);

  return (
    <section
      aria-labelledby="search-network-title"
      aria-busy={searching}
      className="space-y-4"
      data-testid="search-network-results"
    >
      <SectionHeader
        id="search-network-title"
        title={t("search.network.title")}
        count={
          network.coverage && !network.unavailable
            ? networkCoverageCount(network.coverage, t)
            : undefined
        }
        subtitle={<span role="status">{summary}</span>}
        actionLabel={
          canSearchNetworkAgain(network) ? t("search.network.again") : undefined
        }
        onAction={canSearchNetworkAgain(network) ? onSearchAgain : undefined}
      />
      {results.artists.length > 0 ? (
        <div className="space-y-1">
          {results.artists.map((artist) => (
            <EntityRow
              key={`${artist.node_uid}:${artist.remote_entity_uid}`}
              title={artist.name}
              subtitle={t("trackRow.via", { node: artist.node_name })}
              shape="circle"
              cover={{ src: null, fallbackIcon: User }}
            />
          ))}
        </div>
      ) : null}
      {results.albums.length > 0 ? (
        <div className="space-y-1">
          {results.albums.map((album) => (
            <EntityRow
              key={`${album.node_uid}:${album.remote_entity_uid}`}
              title={album.name}
              subtitle={[
                album.year ? album.year + " · " + album.artist : album.artist,
                t("trackRow.via", { node: album.node_name }),
              ].join(" · ")}
              cover={{ src: null, fallbackIcon: Disc3 }}
            />
          ))}
        </div>
      ) : null}
      {!searchDataIsEmpty(results) && trackRowData.length > 0 ? (
        <SearchTrackResults
          data={results}
          query={query}
          trackRowData={trackRowData}
          playAll={playAll}
        />
      ) : null}
    </section>
  );
}
