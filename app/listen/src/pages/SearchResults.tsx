import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") || "";
  const [emptyQuery, setEmptyQuery] = useState("");
  const [data, setData] = useState<SearchData | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const { playAll } = usePlayerActions();

  useEffect(() => {
    if (!query.trim()) {
      setData(null);
      setSearchError(null);
      return;
    }
    const controller = new AbortController();
    setSearchError(null);
    api<SearchData>(
      "/api/catalog/search?q=" + encodeURIComponent(query) + "&limit=50",
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then((nextData) => {
        setData(nextData);
        setSearchError(null);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setData(null);
        setSearchError(
          searchErrorHint(error, {
            sessionRefresh: t("search.sessionRefresh"),
            tryAgain: t("search.tryAgain"),
          }),
        );
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
        onSearch={(nextQuery) => setSearchParams({ q: nextQuery })}
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
    <SearchResultsContent
      data={data}
      query={query}
      trackRowData={trackRowData}
      playAll={playAll}
    />
  );
}
