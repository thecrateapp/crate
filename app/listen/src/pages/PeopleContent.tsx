import type { ReactNode } from "react";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { PeopleLoadingState } from "../components/social/PeopleLoadingState";

import { PeopleSearch } from "./PeopleSearch";
import { PeopleSummary } from "./PeopleSummary";
import type { PeopleViewer, SocialSummary, UserSearchResult } from "./people-types";
import type { TFunction } from "i18next";

export function PeopleContent({
  data,
  loading,
  onQueryChange,
  query,
  results,
  searching,
  t,
  user,
  error = false,
  onRetry,
  searchError = false,
  onSearchRetry,
  renderUser,
  avatar,
}: {
  data: SocialSummary | null | undefined;
  loading: boolean;
  onQueryChange: (value: string) => void;
  query: string;
  results: UserSearchResult[];
  searching: boolean;
  t: TFunction;
  user: PeopleViewer | null;
  error?: boolean;
  onRetry?: () => void;
  searchError?: boolean;
  onSearchRetry?: () => void;
  avatar?: ReactNode;
  renderUser: (user: UserSearchResult) => ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PeopleSummary data={data} t={t} user={user} avatar={avatar} />
      {error && !data ? (
        <ErrorState
          message={t("people.loadFailed")}
          onRetry={onRetry}
          retryLabel={t("common.retry")}
        />
      ) : loading && !data ? (
        <PeopleLoadingState label={t("common.loadingShort")} />
      ) : null}
      <PeopleSearch
        onQueryChange={onQueryChange}
        query={query}
        results={results}
        searching={searching}
        t={t}
        error={searchError}
        onRetry={onSearchRetry}
        renderUser={renderUser}
      />
    </div>
  );
}
