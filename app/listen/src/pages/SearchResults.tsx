import { useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";

import { CrateLoader } from "@/components/ui/CrateLoader";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useNetworkSearchAvailable } from "@/hooks/use-network-search-available";

import {
  EmptySearchState,
  SearchErrorState,
  SearchResultsContent,
} from "./SearchResultSections";
import { buildTrackRowData, searchErrorHint } from "./search-results-model";
import { useSearchResults } from "./use-search-results";

export function SearchResults() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const query = searchParams.get("q") || "";
  const [emptyQuery, setEmptyQuery] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const { playAll } = usePlayerActions();
  const networkAvailable = useNetworkSearchAvailable();
  const { result, searching, error, network, searchNetworkAgain } =
    useSearchResults(query, retryKey, networkAvailable);
  const data = result?.data;
  const currentQuery = query.trim();

  const trackRowData = useMemo(
    () => buildTrackRowData(data?.tracks ?? []),
    [data?.tracks],
  );

  if (!currentQuery) {
    return (
      <EmptySearchState
        value={emptyQuery}
        onChange={setEmptyQuery}
        onSearch={(nextQuery) => {
          const next = new URLSearchParams(searchParams);
          next.set("q", nextQuery);
          void navigate(
            {
              pathname: location.pathname,
              search: `?${next}`,
              hash: location.hash,
            },
            { state: location.state },
          );
        }}
      />
    );
  }
  if (error) {
    return (
      <SearchErrorState
        query={query}
        message={searchErrorHint(error, {
          sessionRefresh: t("search.sessionRefresh"),
          tryAgain: t("search.tryAgain"),
        })}
        onRetry={() => setRetryKey((key) => key + 1)}
      />
    );
  }
  if (!data) {
    return <CrateLoader label={t("search.loadingResults")} />;
  }

  const pending = searching || result?.query !== currentQuery;
  return (
    <div aria-busy={pending} className="space-y-6">
      {pending ? <CrateLoader label={t("search.loadingResults")} /> : null}
      <SearchResultsContent
        data={data}
        query={result!.query}
        trackRowData={trackRowData}
        playAll={playAll}
        network={pending ? null : network}
        onSearchNetworkAgain={searchNetworkAgain}
      />
    </div>
  );
}
