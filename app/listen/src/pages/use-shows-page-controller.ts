import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";

import { useApi } from "@/hooks/use-api";
import {
  buildShowsPageModel,
  type ShowsFilter,
  type ShowsPageModel,
} from "@/pages/shows-page-model";
import type {
  GenreShowsResponse,
  UpcomingResponse,
} from "@/pages/shows-page-types";

export interface ShowsPageController extends ShowsPageModel {
  error: string | null;
  status: number | null | undefined;
  refetch: () => void;
  hasData: boolean;
  expandedId: string | null;
  focusShowId: string | null;
  genreName: string | undefined;
  genreSlug: string | null;
  search: string;
  setExpandedId: (id: string | null) => void;
  setFilter: (filter: ShowsFilter) => void;
  setSearch: (search: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
  filter: ShowsFilter;
}

export function useShowsPageController(): ShowsPageController {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const genreSlug = searchParams.get("genre");
  const focusShowId = searchParams.get("show");
  const [filter, setFilter] = useState<ShowsFilter>("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const upcomingRead = useApi<UpcomingResponse>(
    genreSlug ? null : "/api/me/upcoming",
  );
  const genreRead = useApi<GenreShowsResponse>(
    genreSlug ? `/api/genres/${genreSlug}?view=genre-detail-v5` : null,
    "GET",
    undefined,
    { reportCachedErrors: true },
  );
  const { data, loading: upcomingLoading } = upcomingRead;
  const { data: genreData, loading: genreLoading } = genreRead;
  const read = genreSlug ? genreRead : upcomingRead;
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const model = useMemo(
    () =>
      buildShowsPageModel({
        data,
        filter,
        focusShowId,
        genreData,
        genreLoading,
        genreSlug,
        search,
        today,
        upcomingLoading,
      }),
    [
      data,
      filter,
      focusShowId,
      genreData,
      genreLoading,
      genreSlug,
      search,
      today,
      upcomingLoading,
    ],
  );

  return {
    ...model,
    error: read.error,
    status: read.status,
    refetch: read.refetch,
    hasData: read.data != null,
    expandedId,
    filter,
    focusShowId,
    genreName: genreData?.name,
    genreSlug,
    search,
    setExpandedId,
    setFilter,
    setSearch,
    t,
  };
}
