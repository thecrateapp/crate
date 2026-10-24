import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";

import { CrateLoader } from "@/components/ui/CrateLoader";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";

import {
  EmptySearchState,
  SearchErrorState,
  SearchResultsContent,
} from "./SearchResultSections";
import {
  buildTrackRowData,
  searchErrorHint,
  type SearchData,
} from "./search-results-model";

export function SearchResults() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const query = searchParams.get("q") || "";
  const [emptyQuery, setEmptyQuery] = useState("");
  const [result, setResult] = useState<{
    query: string;
    data: SearchData;
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const data = result?.data;
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const { playAll } = usePlayerActions();

  useEffect(() => {
    if (!query.trim()) {
      setResult(null);
      setSearchError(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearchError(null);
    setSearching(true);
    api<SearchData>(
      "/api/catalog/search?q=" + encodeURIComponent(query) + "&limit=50",
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then((nextData) => {
        if (controller.signal.aborted) return;
        setResult({ query, data: nextData });
        setSearchError(null);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setSearchError(
          searchErrorHint(error, {
            sessionRefresh: t("search.sessionRefresh"),
            tryAgain: t("search.tryAgain"),
          }),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });
    return () => controller.abort();
  }, [query, retryKey, t]);

  const trackRowData = useMemo(
    () => buildTrackRowData(data?.tracks ?? []),
    [data?.tracks],
  );

  if (!query.trim()) {
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
  if (searchError) {
    return (
      <SearchErrorState
        query={query}
        message={searchError}
        onRetry={() => setRetryKey((key) => key + 1)}
      />
    );
  }
  if (!data) {
    return <CrateLoader label={t("search.loadingResults")} />;
  }

  return (
    <div aria-busy={searching || result?.query !== query} className="space-y-6">
      {searching || result?.query !== query ? (
        <CrateLoader label={t("search.loadingResults")} />
      ) : null}
      <SearchResultsContent
        data={data}
        query={result!.query}
        trackRowData={trackRowData}
        playAll={playAll}
      />
    </div>
  );
}
