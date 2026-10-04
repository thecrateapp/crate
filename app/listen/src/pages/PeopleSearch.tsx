import type { TFunction } from "i18next";
import { Loader2, Search } from "@crate/ui/icons";

import { UserRow } from "@/components/social/UserRow";
import type { UserSearchResult } from "@/pages/people-types";

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
    <section className="rounded-[12px] border border-border-quiet bg-text-primary/[0.03] p-5 sm:p-6">
      <div className="flex items-center gap-3 border-b border-border-quiet px-1 py-3">
        <Search size={16} className="text-text-muted" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("people.search.placeholder")}
          className="h-7 flex-1 bg-transparent text-base text-text-primary outline-none placeholder:text-text-primary/40"
        />
      </div>

      <div className="mt-4 space-y-3">
        {trimmedQuery && searching ? (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 size={15} className="animate-spin" />
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
