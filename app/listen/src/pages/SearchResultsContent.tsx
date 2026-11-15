import { useTranslation } from "react-i18next";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";

import type { TrackRowData } from "@/components/cards/TrackRow";
import type { PlayerActionsValue } from "@/contexts/player-context";

import { SearchAlbumResults } from "./SearchAlbumResults";
import { SearchArtistResults } from "./SearchArtistResults";
import { SearchNetworkResults } from "./SearchNetworkResults";
import { SearchNoResultsState } from "./SearchNoResultsState";
import { SearchTrackResults } from "./SearchTrackResults";
import {
  canSearchNetworkAgain,
  networkCoverageSummary,
  networkSearchInvolved,
  networkStillSearching,
  searchDataIsEmpty,
} from "./search-network-model";
import type { SearchData } from "./search-results-model";
import type { NetworkSearchState } from "./use-search-results";

export function SearchResultsContent({
  data,
  query,
  trackRowData,
  playAll,
  network = null,
  onSearchNetworkAgain,
}: {
  data: SearchData;
  query: string;
  trackRowData: TrackRowData[];
  playAll: PlayerActionsValue["playAll"];
  network?: NetworkSearchState | null;
  onSearchNetworkAgain?: () => void;
}) {
  const { t } = useTranslation();
  const noLocalResults = searchDataIsEmpty(data);
  const withNetwork = networkSearchInvolved(network) ? network : null;
  // Between the local results and the server's fan-out decision, an empty
  // local result is not yet the final answer.
  const networkDeciding =
    network !== null && !network.unavailable && network.coverage === null;
  const networkEmptyAndDone =
    withNetwork !== null &&
    !networkStillSearching(withNetwork) &&
    searchDataIsEmpty(withNetwork.results);
  // With nothing local and nothing remote, the empty state carries the
  // coverage; otherwise the network section does.
  const showNetworkSection =
    withNetwork !== null && !(noLocalResults && networkEmptyAndDone);
  const searchAgain = onSearchNetworkAgain ?? (() => undefined);

  return (
    <div className="space-y-8">
      <PageHeader size="md" title={t("search.resultsFor", { query })} />
      {data.artists.length > 0 ? (
        <SearchArtistResults artists={data.artists} />
      ) : null}
      {data.albums.length > 0 ? (
        <SearchAlbumResults albums={data.albums} />
      ) : null}
      {trackRowData.length > 0 ? (
        <SearchTrackResults
          data={data}
          query={query}
          trackRowData={trackRowData}
          playAll={playAll}
        />
      ) : null}
      {showNetworkSection ? (
        <SearchNetworkResults
          network={withNetwork}
          query={query}
          playAll={playAll}
          onSearchAgain={searchAgain}
        />
      ) : null}
      {noLocalResults && !withNetwork && !networkDeciding ? (
        <SearchNoResultsState />
      ) : null}
      {noLocalResults && networkEmptyAndDone ? (
        <SearchNoResultsState
          message={networkCoverageSummary(withNetwork, t)}
          onSearchAgain={
            canSearchNetworkAgain(withNetwork) ? searchAgain : undefined
          }
        />
      ) : null}
    </div>
  );
}
