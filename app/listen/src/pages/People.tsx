import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Loader2, Search, UserRoundPlus, Users } from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { useUserAvatarUrl } from "@/hooks/use-user-avatar-url";
import { UserProfileLink } from "@/components/social/UserProfileLink";
import { CrateImage } from "@/components/artwork/CrateImage";
import { api } from "@/lib/api";

interface SocialSummary {
  followers_count: number;
  following_count: number;
  friends_count: number;
  profile: {
    id: number;
    username: string | null;
    display_name: string | null;
    avatar: string | null;
    bio: string | null;
  };
}

interface UserSearchResult {
  id: number;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  bio: string | null;
  joined_at: string;
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
      <CrateImage
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

export function People() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data, loading } = useApi<SocialSummary>("/api/me/social");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    api<UserSearchResult[]>(
      `/api/users/search?q=${encodeURIComponent(trimmed)}&limit=12`,
      "GET",
      undefined,
      {
        signal: controller.signal,
      },
    )
      .then((items) => setResults(items || []))
      .catch(() => {
        if (!controller.signal.aborted) {
          setResults([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setSearching(false);
        }
      });
    return () => controller.abort();
  }, [query]);

  const ownProfileHref = useMemo(() => {
    if (!user?.username) return "/settings";
    return `/users/${user.username}`;
  }, [user?.username]);
  const ownFollowersHref = user?.username
    ? `/users/${user.username}/followers`
    : "/people";
  const ownFollowingHref = user?.username
    ? `/users/${user.username}/following`
    : "/people";

  return (
    <div className="space-y-6">
      <div className="rounded-[12px] border border-white/10 bg-white/5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground">
              {t("people.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("people.subtitle")}
            </p>
          </div>
          <Link
            to="/jam"
            className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-white/10 transition-colors"
          >
            <Users size={16} />
            {t("people.jamSessions")}
          </Link>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <Link
            to={ownProfileHref}
            className="rounded-xl border border-cyan-400/15 bg-cyan-400/5 p-4 hover:bg-cyan-400/10 transition-colors"
          >
            <div className="text-xs uppercase tracking-wide text-cyan-300/70">
              {t("people.summary.yourProfile")}
            </div>
            <div className="mt-2 text-lg font-semibold text-foreground">
              {data?.profile.display_name ||
                user?.name ||
                user?.email ||
                t("people.fallback.you")}
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {data?.profile.username
                ? `@${data.profile.username}`
                : t("people.summary.setUsername")}
            </div>
          </Link>
          <Link
            to={ownFollowersHref}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:bg-white/[0.05] transition-colors"
          >
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("people.followers")}
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {data?.followers_count ?? "—"}
            </div>
          </Link>
          <Link
            to={ownFollowingHref}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:bg-white/[0.05] transition-colors"
          >
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("people.following")}
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {data?.following_count ?? "—"}
            </div>
          </Link>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("people.friends")}
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {data?.friends_count ?? "—"}
            </div>
          </div>
        </div>
      </div>

      <section className="rounded-[12px] border border-white/10 bg-white/[0.03] p-5 sm:p-6">
        <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-4 py-3">
          <Search size={16} className="text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("people.search.placeholder")}
            className="h-7 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-white/40"
          />
        </div>

        <div className="mt-4 space-y-3">
          {query.trim() && searching ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={15} className="animate-spin" />
              {t("people.search.loading")}
            </div>
          ) : null}

          {!query.trim() ? (
            <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
              {t("people.search.emptyPrompt")}
            </div>
          ) : null}

          {query.trim() && !searching && results.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
              {t("people.search.noMatches", { query: query.trim() })}
            </div>
          ) : null}

          {results.map((item) => {
            const label =
              item.display_name || item.username || t("people.unknownUser");
            return (
              <UserProfileLink
                key={item.id}
                username={item.username}
                hoverClassName="block"
                className="flex items-center gap-4 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 hover:bg-white/[0.05] transition-colors"
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
                  {item.bio ? (
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {item.bio}
                    </div>
                  ) : null}
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/65">
                  <UserRoundPlus size={13} />
                  {t("people.viewProfile")}
                </div>
              </UserProfileLink>
            );
          })}
        </div>
      </section>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : null}
    </div>
  );
}
