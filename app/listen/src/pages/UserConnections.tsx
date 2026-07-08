import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, Loader2, UserPlus, Users } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import { useApi } from "@/hooks/use-api";
import { useUserAvatarUrl } from "@/hooks/use-user-avatar-url";
import { UserProfileLink } from "@/components/social/UserProfileLink";

interface UserListItem {
  id: number;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  followed_at: string;
}

function UserAvatar({
  name,
  avatar,
  userId,
  className = "h-11 w-11",
}: {
  name: string;
  avatar?: string | null;
  userId?: number | null;
  className?: string;
}) {
  const { avatarUrl, handleAvatarError } = useUserAvatarUrl(avatar, userId);
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        onError={handleAvatarError}
        className={`${className} rounded-full object-cover`}
      />
    );
  }
  const initial = name.trim().charAt(0).toUpperCase() || "U";
  return (
    <div
      className={`${className} rounded-full bg-cyan-400/15 text-cyan-300 flex items-center justify-center font-semibold`}
    >
      {initial}
    </div>
  );
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
      <div className="rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-6">
        <Link
          to={username ? `/users/${username}` : "/people"}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
          {t("userConnections.backToProfile")}
        </Link>
        <div className="mt-4 flex items-center gap-3">
          <Users size={18} className="text-cyan-300" />
          <div>
            <h1 className="text-3xl font-bold text-foreground">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("userConnections.subtitle", { username })}
            </p>
          </div>
        </div>
      </div>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : data && data.length > 0 ? (
          <div className="space-y-3">
            {data.map((item) => {
              const label =
                item.display_name || item.username || t("people.unknownUser");
              return (
                <UserProfileLink
                  key={`${mode}-${item.id}`}
                  username={item.username}
                  hoverClassName="block"
                  className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 hover:bg-white/[0.05] transition-colors"
                >
                  <UserAvatar
                    name={label}
                    avatar={item.avatar}
                    userId={item.id}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {label}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {item.username
                        ? `@${item.username}`
                        : t("people.noUsername")}
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/65">
                    <UserPlus size={13} />
                    {t("people.viewProfile")}
                  </div>
                </UserProfileLink>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-muted-foreground">
            {mode === "following"
              ? t("userConnections.empty.following")
              : t("userConnections.empty.followers")}
          </div>
        )}
      </section>
    </div>
  );
}
