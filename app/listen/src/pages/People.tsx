import { UserRow } from "../components/social/UserRow";
import { UserAvatar } from "../components/social/UserAvatar";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PeopleContent } from "@/pages/PeopleContent";
import type { SocialSummary } from "@/pages/people-types";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { usePeopleSearch } from "@/pages/use-people-search";

export function People() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data, loading, error, refetch } =
    useApi<SocialSummary>("/api/me/social");
  const [query, setQuery] = useState("");
  const {
    results,
    searching,
    error: searchError,
    retry,
  } = usePeopleSearch(query);

  return (
    <PeopleContent
      data={data}
      renderUser={(item) => <UserRow user={item} />}
      avatar={
        <UserAvatar
          name={
            data?.profile.display_name || user?.name || t("people.fallback.you")
          }
          avatar={data?.profile.avatar}
          userId={data?.profile.id}
          alt=""
          size="lg"
        />
      }
      loading={loading}
      error={!!error}
      onRetry={refetch}
      searchError={searchError}
      onSearchRetry={retry}
      onQueryChange={setQuery}
      query={query}
      results={results}
      searching={searching}
      t={t}
      user={user}
    />
  );
}
