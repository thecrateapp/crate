import type { TFunction } from "i18next";
import { CRATE_ICON_SIZE, Loader2 } from "@crate/ui/icons";
import { SearchInput } from "@crate/ui/primitives/SearchInput";

import { UserRow } from "@/components/social/UserRow";
import type { UserSearchResult } from "@/pages/people-types";

const PEOPLE_SEARCH_INPUT_CLASS_NAME =
  "h-7 rounded-none border-0 bg-transparent pl-9 shadow-none backdrop-blur-none md:text-base focus-visible:bg-transparent";

export function PeopleSearch({
  onQueryChange,
  query,
  results,
  searching,
  t,
}: {
  onQueryChange: (value: string) => void;
  query: string;
  results: UserSearchResult[];
  searching: boolean;
  t: TFunction;
}) {
  const trimmedQuery = query.trim();

  return (
    <section className="rounded-panel border border-border-quiet bg-text-primary/[0.03] p-5 sm:p-6">
      <SearchInput
        value={query}
        onValueChange={onQueryChange}
        label={t("people.search.placeholder")}
        clearLabel={t("search.clear")}
        placeholder={t("people.search.placeholder")}
        containerClassName="border-b border-border-quiet py-3"
        className={PEOPLE_SEARCH_INPUT_CLASS_NAME}
      />

      <div className="mt-4 space-y-3">
        {trimmedQuery && searching ? (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 size={CRATE_ICON_SIZE.sm} className="animate-spin" />
            {t("people.search.loading")}
          </div>
        ) : null}

        {!trimmedQuery ? (
          <div className="border-y border-dashed border-border-quiet px-4 py-8 text-center text-sm text-text-muted">
            {t("people.search.emptyPrompt")}
          </div>
        ) : null}

        {trimmedQuery && !searching && results.length === 0 ? (
          <div className="border-y border-dashed border-border-quiet px-4 py-8 text-center text-sm text-text-muted">
            {t("people.search.noMatches", { query: trimmedQuery })}
          </div>
        ) : null}

        {results.map((item) => (
          <UserRow
            key={item.id}
            user={item}
            className="border border-border-quiet bg-text-primary/[0.02]"
          />
        ))}
      </div>
    </section>
  );
}
