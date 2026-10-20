import { CollaboratorSearchView } from "./CollaboratorSearchView";
import { useState } from "react";

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
    <CollaboratorSearchView
      query={query}
      onQueryChange={setQuery}
      searching={searching}
      candidates={candidates}
      addingUserId={addingUserId}
      onAdd={(candidate) => void add(candidate)}
      renderAvatar={(candidate) => (
        <UserProfileAvatar
          name={candidate.display_name || candidate.username || ""}
          avatar={candidate.avatar}
          userId={candidate.id}
          className="size-8 shrink-0 text-xs!"
        />
      )}
    />
  );
}
