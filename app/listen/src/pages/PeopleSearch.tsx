import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import { FormField } from "@crate/ui/primitives/FormField";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { EmptyState } from "@crate/ui/domain/lists";
import { PeopleLoadingState } from "../components/social/PeopleLoadingState";
import type { UserSearchResult } from "./people-types";

export function PeopleSearch({
  onQueryChange,
  query,
  results,
  searching,
  t,
  error = false,
  onRetry,
  renderUser,
}: {
  onQueryChange: (value: string) => void;
  query: string;
  results: UserSearchResult[];
  searching: boolean;
  t: TFunction;
  error?: boolean;
  onRetry?: () => void;
  renderUser: (user: UserSearchResult) => ReactNode;
}) {
  const trimmed = query.trim();
  return (
    <section
      aria-label={t("people.search.placeholder")}
      className="grid min-w-0 gap-4 border-t border-border-quiet pt-6"
    >
      <FormField label={t("search.label")}>
        <SearchInput
          value={query}
          onValueChange={onQueryChange}
          label={t("people.search.placeholder")}
          clearLabel={t("search.clear")}
          placeholder={t("people.search.placeholder")}
        />
      </FormField>
      {!trimmed ? (
        <EmptyState message={t("people.search.emptyPrompt")} />
      ) : searching ? (
        <PeopleLoadingState label={t("people.search.loading")} />
      ) : error ? (
        <ErrorState
          message={t("people.loadFailed")}
          onRetry={onRetry}
          retryLabel={t("common.retry")}
        />
      ) : results.length ? (
        <div className="grid min-w-0 divide-y divide-border-quiet">
          {results.map((user) => (
            <div key={user.id}>{renderUser(user)}</div>
          ))}
        </div>
      ) : (
        <EmptyState
          message={t("people.search.noMatches", { query: trimmed })}
        />
      )}
    </section>
  );
}
