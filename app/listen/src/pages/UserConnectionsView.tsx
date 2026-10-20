import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { BackLink, PageHeader } from "@crate/ui/domain/navigation";
import { EmptyState } from "@crate/ui/domain/lists";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { PeopleLoadingState } from "../components/social/PeopleLoadingState";
import type { UserListItem } from "./user-profile-model";
export function UserConnectionsView({
  username,
  mode,
  data,
  loading,
  error,
  onRetry,
  renderUser,
}: {
  username?: string;
  mode: "followers" | "following";
  data: UserListItem[] | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  renderUser: (user: UserListItem) => ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid min-w-0 gap-6">
      <PageHeader
        title={t(
          mode === "following" ? "people.following" : "people.followers",
        )}
        subtitle={t("userConnections.subtitle", { username })}
        back={
          <BackLink
            to={username ? `/users/${encodeURIComponent(username)}` : "/people"}
            label={t("userConnections.backToProfile")}
          />
        }
      />
      <section
        aria-label={t(
          mode === "following" ? "people.following" : "people.followers",
        )}
        className="min-w-0 border-t border-border-quiet pt-6"
      >
        {!data && loading ? (
          <PeopleLoadingState label={t("common.loadingShort")} />
        ) : !data && error ? (
          <ErrorState
            message={t("people.loadFailed")}
            onRetry={onRetry}
            retryLabel={t("common.retry")}
          />
        ) : data?.length ? (
          <div className="grid min-w-0 divide-y divide-border-quiet">
            {data.map((user) => (
              <div key={user.id}>{renderUser(user)}</div>
            ))}
          </div>
        ) : (
          <EmptyState
            message={t(
              mode === "following"
                ? "userConnections.empty.following"
                : "userConnections.empty.followers",
            )}
          />
        )}
      </section>
    </div>
  );
}
