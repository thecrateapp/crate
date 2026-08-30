import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  BarChart3,
  Disc3,
  Loader2,
  Music4,
  PackagePlus,
  UserPlus,
  UserRoundCheck,
  Users,
} from "@crate/ui/icons";
import { type TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { useUserAvatarUrl } from "@/hooks/use-user-avatar-url";
import { UserProfileLink } from "@/components/social/UserProfileLink";
import { CrateImage } from "@/components/artwork/CrateImage";
import { CrateLoader } from "@/components/ui/CrateLoader";
import { api, resolveMaybeApiAssetUrl } from "@/lib/api";
import { contributionSourceLabel } from "@/lib/contributions";
import { albumCoverApiUrl, albumPagePath } from "@/lib/library-routes";
import { formatTotalDuration } from "@/lib/utils";

interface RelationshipState {
  following: boolean;
  followed_by: boolean;
  is_friend: boolean;
}

interface PublicPlaylist {
  id: number;
  name: string;
  description?: string | null;
  cover_data_url?: string | null;
  visibility: "public" | "private";
  is_collaborative: boolean;
  track_count: number;
  total_duration: number;
  updated_at: string;
}

interface UserListItem {
  id: number;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  followed_at: string;
}

interface ProfileTopGenre {
  name: string;
  play_count: number;
  minutes_listened: number;
}

interface ProfileStats {
  plays_30d: number;
  minutes_30d: number;
  contributions: number;
  public_playlists: number;
}

interface ProfileBadge {
  key: string;
  label: string;
  tone: "cyan" | "gold" | "green" | "rose" | "neutral" | string;
}

interface ProfileContribution {
  id: number;
  source: string;
  album_id: number | null;
  album_entity_uid: string | null;
  album_slug: string | null;
  artist_name: string;
  album_name: string;
  has_cover: boolean | null;
  imported_at: string | null;
}

interface PublicProfile {
  id: number;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  bio: string | null;
  joined_at: string;
  followers_count: number;
  following_count: number;
  friends_count: number;
  public_playlists: PublicPlaylist[];
  relationship_state: RelationshipState;
  affinity_score: number;
  affinity_band: "low" | "medium" | "high" | "very_high";
  affinity_reasons: string[];
  followers_preview: UserListItem[];
  following_preview: UserListItem[];
  top_genre: ProfileTopGenre | null;
  stats: ProfileStats;
  badges: ProfileBadge[];
  contributions_preview: ProfileContribution[];
}

function UserAvatar({
  name,
  avatar,
  userId,
  className = "h-20 w-20",
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
      className={`${className} user-profile-avatar-placeholder flex items-center justify-center rounded-full text-2xl font-semibold`}
    >
      {initial}
    </div>
  );
}

function formatJoinedDate(value: string | null | undefined, locale: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "numeric",
  }).format(date);
}

function affinityTone(band?: string) {
  switch (band) {
    case "very_high":
      return "user-profile-affinity-very-high";
    case "high":
      return "user-profile-affinity-high";
    case "medium":
      return "user-profile-affinity-medium";
    default:
      return "user-profile-affinity-low";
  }
}

function badgeTone(tone: string) {
  switch (tone) {
    case "gold":
      return "user-profile-badge-gold";
    case "green":
      return "user-profile-badge-green";
    case "rose":
      return "user-profile-badge-rose";
    case "cyan":
      return "user-profile-badge-cyan";
    default:
      return "user-profile-badge-neutral";
  }
}

function formatMinutes(minutes: number, t: TFunction) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return t("userProfile.duration.zero");
  }
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    return rest > 0
      ? t("userProfile.duration.hoursMinutes", { hours, minutes: rest })
      : t("userProfile.duration.hours", { count: hours });
  }
  return t("userProfile.duration.minutes", { count: Math.round(minutes) });
}

function affinityBandLabel(band: PublicProfile["affinity_band"], t: TFunction) {
  switch (band) {
    case "very_high":
      return t("userProfile.affinityBand.veryHigh");
    case "high":
      return t("userProfile.affinityBand.high");
    case "medium":
      return t("userProfile.affinityBand.medium");
    default:
      return t("userProfile.affinityBand.low");
  }
}

function ProfileMiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="user-profile-stat rounded-xl px-3 py-2">
      <div className="truncate text-lg font-black text-foreground">{value}</div>
      <div className="mt-0.5 truncate text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function ContributionCard({
  contribution,
}: {
  contribution: ProfileContribution;
}) {
  const { t } = useTranslation();
  const coverUrl =
    contribution.album_id && contribution.has_cover
      ? albumCoverApiUrl(
          {
            albumId: contribution.album_id,
            albumEntityUid: contribution.album_entity_uid,
            artistName: contribution.artist_name,
            albumName: contribution.album_name,
          },
          { size: 160 },
        )
      : null;
  const albumPath = contribution.album_id
    ? albumPagePath({
        albumId: contribution.album_id,
        albumEntityUid: contribution.album_entity_uid,
        albumSlug: contribution.album_slug,
        artistName: contribution.artist_name,
        albumName: contribution.album_name,
      })
    : null;
  const source =
    contributionSourceLabel(contribution.source) ||
    t("userProfile.contributions.source.library");
  const card = (
    <>
      {coverUrl ? (
        <CrateImage
          src={coverUrl}
          alt=""
          className="h-14 w-14 rounded-xl object-cover"
        />
      ) : (
        <div className="user-profile-accent-panel user-profile-accent-icon flex h-14 w-14 items-center justify-center rounded-xl">
          <Disc3 size={20} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">
          {contribution.album_name}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {contribution.artist_name}
        </div>
        <div className="user-profile-accent-label mt-1 text-[10px] font-bold uppercase tracking-[0.16em]">
          {t("userProfile.contributions.via", { source })}
        </div>
      </div>
    </>
  );

  if (!albumPath) {
    return (
      <div className="user-profile-item flex items-center gap-3 rounded-lg px-4 py-3">
        {card}
      </div>
    );
  }

  return (
    <Link
      to={albumPath}
      className="user-profile-item flex items-center gap-3 rounded-lg px-4 py-3"
    >
      {card}
    </Link>
  );
}

export function UserProfile() {
  const { t, i18n } = useTranslation();
  const { username } = useParams<{ username: string }>();
  const { user } = useAuth();
  const { data, loading, refetch } = useApi<PublicProfile>(
    username ? `/api/users/${encodeURIComponent(username)}/page` : null,
  );
  const [busy, setBusy] = useState(false);

  const isOwnProfile = useMemo(() => {
    return Boolean(data && user?.id === data.id);
  }, [data, user?.id]);

  async function handleFollowToggle() {
    if (!data || isOwnProfile) return;
    setBusy(true);
    try {
      if (data.relationship_state.following) {
        await api(`/api/users/${data.id}/follow`, "DELETE");
        toast.success(
          t("userProfile.toasts.unfollowed", {
            name:
              data.display_name || data.username || t("userProfile.thisUser"),
          }),
        );
      } else {
        await api(`/api/users/${data.id}/follow`, "POST");
        toast.success(
          t("userProfile.toasts.following", {
            name:
              data.display_name || data.username || t("userProfile.thisUser"),
          }),
        );
      }
      refetch();
    } catch {
      toast.error(t("userProfile.toasts.updateFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <CrateLoader label={t("userProfile.loadingLabel")} />;
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <p className="text-lg font-medium text-foreground">
          {t("userProfile.notFound")}
        </p>
        <Link
          to="/people"
          className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <ArrowLeft size={14} />
          {t("userProfile.backToPeople")}
        </Link>
      </div>
    );
  }

  const displayName =
    data.display_name || data.username || t("people.unknownUser");
  const joinedDate =
    formatJoinedDate(data.joined_at, i18n.language) ??
    t("userProfile.recently");
  const followers = data.followers_preview || [];
  const following = data.following_preview || [];
  const badges = data.badges || [];
  const stats = data.stats || {
    plays_30d: 0,
    minutes_30d: 0,
    contributions: 0,
    public_playlists: data.public_playlists.length,
  };
  const contributions = data.contributions_preview || [];

  return (
    <div className="space-y-6">
      <div className="user-profile-hero rounded-[12px] p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <UserAvatar
              name={displayName}
              avatar={data.avatar}
              userId={data.id}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-3xl font-bold text-foreground">
                  {displayName}
                </h1>
                {data.relationship_state.is_friend && !isOwnProfile ? (
                  <span className="user-profile-accent-badge inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium">
                    {t("people.friends")}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {data.username ? `@${data.username}` : t("people.noUsername")} ·{" "}
                {t("userProfile.joined", { date: joinedDate })}
              </div>
              {data.bio ? (
                <p className="user-profile-copy mt-3 max-w-2xl text-sm leading-6">
                  {data.bio}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={
                isOwnProfile
                  ? "/stats"
                  : `/users/${data.username || username}/stats`
              }
              className="inline-flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/15"
            >
              <BarChart3 size={15} />
              {t("userProfile.actions.viewListeningDna")}
            </Link>
            {!isOwnProfile ? (
              <button
                type="button"
                onClick={handleFollowToggle}
                disabled={busy}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                  data.relationship_state.following
                    ? "border border-border-quiet/15 bg-text-primary/5 text-foreground hover:bg-text-primary/10"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
              >
                {busy ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : data.relationship_state.following ? (
                  <UserRoundCheck size={15} />
                ) : (
                  <UserPlus size={15} />
                )}
                {data.relationship_state.following
                  ? t("common.following")
                  : t("common.follow")}
              </button>
            ) : (
              <Link
                to="/settings"
                className="inline-flex items-center gap-2 rounded-lg border border-border-quiet/15 bg-text-primary/5 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-text-primary/10"
              >
                {t("userProfile.actions.editAccount")}
              </Link>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <div className="user-profile-card rounded-xl p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("people.followers")}
            </div>
            <Link
              to={
                data.username ? `/users/${data.username}/followers` : "/people"
              }
              className="mt-2 block text-2xl font-semibold text-foreground transition-colors hover:text-accent-action"
            >
              {data.followers_count}
            </Link>
          </div>
          <div className="user-profile-card rounded-xl p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("people.following")}
            </div>
            <Link
              to={
                data.username ? `/users/${data.username}/following` : "/people"
              }
              className="mt-2 block text-2xl font-semibold text-foreground transition-colors hover:text-accent-action"
            >
              {data.following_count}
            </Link>
          </div>
          <div className="user-profile-card rounded-xl p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("people.friends")}
            </div>
            <div className="mt-2 text-2xl font-semibold text-foreground">
              {data.friends_count}
            </div>
          </div>
          <div
            className={`rounded-xl border p-4 ${affinityTone(
              data.affinity_band,
            )}`}
          >
            <div className="text-xs uppercase tracking-wide opacity-75">
              {t("userProfile.affinity")}
            </div>
            <div className="mt-2 text-2xl font-semibold">
              {data.affinity_score}%
            </div>
            <div className="mt-1 text-xs capitalize opacity-75">
              {affinityBandLabel(data.affinity_band, t)}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
          <div className="user-profile-accent-panel rounded-xl p-4">
            <div className="user-profile-accent-label text-[10px] font-bold uppercase tracking-[0.18em]">
              {t("userProfile.topSound")}
            </div>
            <div className="mt-2 truncate text-lg font-black text-foreground">
              {data.top_genre?.name || t("userProfile.stillMapping")}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {data.top_genre
                ? t("userProfile.topGenreStats", {
                    plays: t("common.playCount", {
                      count: data.top_genre.play_count,
                    }),
                    duration: formatMinutes(data.top_genre.minutes_listened, t),
                  })
                : t("userProfile.needsMoreSignal")}
            </div>
          </div>
          <div className="user-profile-card grid grid-cols-3 gap-2 rounded-xl p-3">
            <ProfileMiniStat
              label={t("userProfile.stats.plays30d")}
              value={String(stats.plays_30d)}
            />
            <ProfileMiniStat
              label={t("userProfile.stats.time30d")}
              value={formatMinutes(stats.minutes_30d, t)}
            />
            <ProfileMiniStat
              label={t("userProfile.stats.adds")}
              value={String(stats.contributions)}
            />
          </div>
          <div className="user-profile-card rounded-xl p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {t("userProfile.badges.title")}
            </div>
            {badges.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {badges.map((badge) => (
                  <span
                    key={badge.key}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${badgeTone(
                      badge.tone,
                    )}`}
                  >
                    {badge.label}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-sm text-muted-foreground">
                {t("userProfile.badges.empty")}
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="user-profile-card rounded-[12px] p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <Users size={16} className="user-profile-accent-icon" />
          <h2 className="text-lg font-semibold text-foreground">
            {t("userProfile.match.title")}
          </h2>
        </div>
        {isOwnProfile ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {t("userProfile.match.ownProfile")}
          </p>
        ) : data.affinity_reasons.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {data.affinity_reasons.map((reason) => (
              <span
                key={reason}
                className="user-profile-reason rounded-full px-3 py-1.5 text-xs"
              >
                {reason}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {t("userProfile.match.notEnough")}
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="space-y-6">
          <div className="user-profile-card rounded-[12px] p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <PackagePlus size={16} className="user-profile-accent-icon" />
              <h2 className="text-lg font-semibold text-foreground">
                {t("userProfile.contributions.title")}
              </h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("userProfile.contributions.subtitle")}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {contributions.length === 0 ? (
                <div className="user-profile-empty-state rounded-lg px-4 py-8 text-center text-sm text-muted-foreground sm:col-span-2">
                  {t("userProfile.contributions.empty")}
                </div>
              ) : (
                contributions
                  .slice(0, 6)
                  .map((contribution) => (
                    <ContributionCard
                      key={contribution.id}
                      contribution={contribution}
                    />
                  ))
              )}
            </div>
          </div>

          <div className="user-profile-card rounded-[12px] p-5 sm:p-6">
            <div className="flex items-center gap-2">
              <Music4 size={16} className="user-profile-accent-icon" />
              <h2 className="text-lg font-semibold text-foreground">
                {t("userProfile.playlists.title")}
              </h2>
            </div>
            <div className="mt-4 space-y-3">
              {data.public_playlists.length === 0 ? (
                <div className="user-profile-empty-state rounded-lg px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("userProfile.playlists.empty")}
                </div>
              ) : (
                data.public_playlists.map((playlist) => {
                  const coverUrl = resolveMaybeApiAssetUrl(
                    playlist.cover_data_url,
                  );

                  return (
                    <Link
                      key={playlist.id}
                      to={`/playlist/${playlist.id}`}
                      className="user-profile-item flex items-center gap-4 rounded-lg px-4 py-3"
                    >
                      {coverUrl ? (
                        <CrateImage
                          src={coverUrl}
                          alt={playlist.name}
                          className="h-14 w-14 rounded-xl object-cover"
                        />
                      ) : (
                        <div className="user-profile-placeholder flex h-14 w-14 items-center justify-center rounded-xl text-lg font-semibold">
                          {playlist.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                          {playlist.name}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {t("common.trackCountLabel", {
                            count: playlist.track_count,
                          })}
                          {playlist.total_duration > 0
                            ? ` · ${formatTotalDuration(
                                playlist.total_duration,
                              )}`
                            : ""}
                          {playlist.is_collaborative
                            ? ` · ${t("userProfile.playlists.collaborative")}`
                            : ""}
                        </div>
                        {playlist.description ? (
                          <div className="mt-1 truncate text-xs text-muted-foreground">
                            {playlist.description}
                          </div>
                        ) : null}
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="user-profile-card rounded-[12px] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-foreground">
                {t("people.followers")}
              </h2>
              {data.username ? (
                <Link
                  to={`/users/${data.username}/followers`}
                  className="user-profile-accent-link text-xs hover:underline"
                >
                  {t("userProfile.seeAll")}
                </Link>
              ) : null}
            </div>
            <div className="mt-4 space-y-3">
              {(followers || []).slice(0, 6).map((item) => {
                const label =
                  item.display_name || item.username || t("people.unknownUser");

                return (
                  <UserProfileLink
                    key={`follower-${item.id}`}
                    username={item.username}
                    hoverClassName="block"
                    className="user-profile-item flex items-center gap-3 rounded-lg px-3 py-2.5"
                  >
                    <UserAvatar
                      name={label}
                      avatar={item.avatar}
                      userId={item.id}
                      className="h-10 w-10"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {label}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {item.username
                          ? `@${item.username}`
                          : t("userProfile.profile")}
                      </div>
                    </div>
                  </UserProfileLink>
                );
              })}
              {!followers || followers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("userProfile.followers.empty")}
                </p>
              ) : null}
            </div>
          </div>

          <div className="user-profile-card rounded-[12px] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-foreground">
                {t("people.following")}
              </h2>
              {data.username ? (
                <Link
                  to={`/users/${data.username}/following`}
                  className="user-profile-accent-link text-xs hover:underline"
                >
                  {t("userProfile.seeAll")}
                </Link>
              ) : null}
            </div>
            <div className="mt-4 space-y-3">
              {(following || []).slice(0, 6).map((item) => {
                const label =
                  item.display_name || item.username || t("people.unknownUser");

                return (
                  <UserProfileLink
                    key={`following-${item.id}`}
                    username={item.username}
                    hoverClassName="block"
                    className="user-profile-item flex items-center gap-3 rounded-lg px-3 py-2.5"
                  >
                    <UserAvatar
                      name={label}
                      avatar={item.avatar}
                      userId={item.id}
                      className="h-10 w-10"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {label}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {item.username
                          ? `@${item.username}`
                          : t("userProfile.profile")}
                      </div>
                    </div>
                  </UserProfileLink>
                );
              })}
              {!following || following.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("userProfile.following.empty")}
                </p>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
