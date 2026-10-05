import { useLocation, useParams } from "react-router";
import { BackLink } from "@crate/ui/domain/navigation";
import { LoadingState } from "@crate/ui/domain/states";
import { CRATE_ICON_SIZE, Users } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import { useApi } from "@/hooks/use-api";
import { UserRow } from "@/components/social/UserRow";

interface UserListItem {
  id: number;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  followed_at: string;
}

export function UserConnections() {
  const { t } = useTranslation();
  const { username } = useParams<{ username: string }>();
  const location = useLocation();
  const mode = location.pathname.endsWith("/following")
    ? "following"
    : "followers";
  const title =
    mode === "following" ? t("people.following") : t("people.followers");
  const { data, loading } = useApi<UserListItem[]>(
    username
      ? `/api/users/${encodeURIComponent(username)}/${mode}?limit=200`
      : null,
  );

  return (
    <div className="space-y-6">
      <div className="rounded-panel border border-border-quiet bg-text-primary/5 p-5 sm:p-6">
        <BackLink
          to={username ? `/users/${username}` : "/people"}
          label={t("userConnections.backToProfile")}
        />
        <div className="mt-4 flex items-center gap-3">
          <Users size={CRATE_ICON_SIZE.md} className="text-text-accent" />
          <div>
            <h1 className="text-3xl font-bold text-text-primary">{title}</h1>
            <p className="mt-1 text-sm text-text-muted">
              {t("userConnections.subtitle", { username })}
            </p>
          </div>
        </div>
      </div>

      <section className="rounded-panel border border-border-quiet bg-text-primary/[0.03] p-5 sm:p-6">
        {loading ? (
          <LoadingState label={t("common.loadingShort")} className="py-12" />
        ) : data && data.length > 0 ? (
          <div className="space-y-3">
            {data.map((item) => (
              <UserRow
                key={`${mode}-${item.id}`}
                user={item}
                className="border border-border-quiet bg-text-primary/[0.02]"
              />
            ))}
          </div>
        ) : (
          <div className="border-y border-dashed border-border-quiet px-4 py-10 text-center text-sm text-text-muted">
            {mode === "following"
              ? t("userConnections.empty.following")
              : t("userConnections.empty.followers")}
          </div>
        )}
      </section>
    </div>
  );
}
