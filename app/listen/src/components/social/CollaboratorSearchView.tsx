import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";
import { LoadingState, EmptyState } from "@crate/ui/domain/states";
import { FormField } from "@crate/ui/primitives/FormField";
import { SearchInput } from "@crate/ui/primitives/SearchInput";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { CRATE_ICON_SIZE, UserPlus } from "@crate/ui/icons";
import { CollectionMemberRow } from "../collections/CollectionMemberRow";
import type { UserSearchResult } from "../../pages/people-types";
export function CollaboratorSearchView({
  query,
  onQueryChange,
  searching,
  candidates,
  addingUserId,
  onAdd,
  renderAvatar,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  searching: boolean;
  candidates: UserSearchResult[];
  addingUserId: number | null;
  onAdd: (user: UserSearchResult) => void;
  renderAvatar?: (user: UserSearchResult) => ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className="space-y-3">
      <SectionHeader as="h3" title={t("collaboration.addTitle")} />
      <FormField label={t("collaboration.searchPlaceholder")}>
        {(control) => (
          <SearchInput
            {...control}
            label={t("collaboration.searchPlaceholder")}
            placeholder={t("collaboration.searchPlaceholder")}
            clearLabel={t("search.clear")}
            value={query}
            onValueChange={onQueryChange}
          />
        )}
      </FormField>
      {searching ? (
        <LoadingState label={t("common.loadingShort")} />
      ) : query.trim() && candidates.length === 0 ? (
        <EmptyState message={t("collaboration.noResults")} />
      ) : candidates.length > 0 ? (
        <ul>
          {candidates.map((candidate) => {
            const name = candidate.display_name || candidate.username || "";
            return (
              <li key={candidate.id}>
                <CollectionMemberRow
                  name={name}
                  handle={`@${candidate.username}`}
                  avatar={renderAvatar?.(candidate)}
                  action={
                    <ActionButton
                      label={t("collaboration.addUser", { name })}
                      tooltip={t("common.add")}
                      loading={addingUserId === candidate.id}
                      disabled={addingUserId !== null}
                      onClick={() => onAdd(candidate)}
                    >
                      <UserPlus size={CRATE_ICON_SIZE.md} />
                    </ActionButton>
                  }
                />
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
