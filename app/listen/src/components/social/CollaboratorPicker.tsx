import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CRATE_ICON_SIZE, Loader2, UserPlus } from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";

import { usePeopleSearch } from "@/pages/use-people-search";
import { UserProfileAvatar } from "@/pages/UserProfileAvatar";
import type { UserSearchResult } from "@/pages/people-types";

export function CollaboratorPicker({
  excludeUserIds,
  onAdd,
}: {
  excludeUserIds: number[];
  onAdd: (user: UserSearchResult) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [addingUserId, setAddingUserId] = useState<number | null>(null);
  const { results, searching } = usePeopleSearch(query);
  const excluded = new Set(excludeUserIds);
  const candidates = results.filter(
    (candidate) => candidate.username && !excluded.has(candidate.id),
  );

  async function add(candidate: UserSearchResult) {
    setAddingUserId(candidate.id);
    try {
      await onAdd(candidate);
      setQuery("");
    } finally {
      setAddingUserId(null);
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-text-primary">
        {t("collaboration.addTitle")}
      </h3>
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("collaboration.searchPlaceholder")}
        aria-label={t("collaboration.searchPlaceholder")}
        className="h-11"
      />
      {searching ? (
        <div className="flex justify-center py-2">
          <Loader2
            size={CRATE_ICON_SIZE.md}
            className="animate-spin text-accent-action"
          />
        </div>
      ) : query.trim() && candidates.length === 0 ? (
        <p className="text-sm text-text-muted">
          {t("collaboration.noResults")}
        </p>
      ) : candidates.length > 0 ? (
        <ul className="space-y-2">
          {candidates.map((candidate) => {
            const name = candidate.display_name || candidate.username || "";
            return (
              <li
                key={candidate.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border-quiet bg-text-primary/[0.03] px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <UserProfileAvatar
                    name={name}
                    avatar={candidate.avatar}
                    userId={candidate.id}
                    className="size-8 shrink-0 text-xs!"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text-primary">
                      {name}
                    </div>
                    <div className="truncate text-xs text-text-muted">
                      @{candidate.username}
                    </div>
                  </div>
                </div>
                <Button
                  size="xs"
                  shape="pill"
                  onClick={() => void add(candidate)}
                  loading={addingUserId === candidate.id}
                  disabled={addingUserId !== null}
                  aria-label={t("collaboration.addUser", { name })}
                >
                  {addingUserId === candidate.id ? null : (
                    <UserPlus size={CRATE_ICON_SIZE.micro} />
                  )}
                  {t("collaboration.add")}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
