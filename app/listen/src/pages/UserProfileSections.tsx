import { Link } from "react-router";
import {
  BarChart3,
  Disc3,
  Loader2,
  Music4,
  PackagePlus,
  UserPlus,
  UserRoundCheck,
  Users,
} from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import { CrateImage } from "@/components/artwork/CrateImage";
import { UserProfileLink } from "@/components/social/UserProfileLink";
import { useUserAvatarUrl } from "@/hooks/use-user-avatar-url";
import { resolveMaybeApiAssetUrl } from "@/lib/api";
import { contributionSourceLabel } from "@/lib/contributions";
import { albumCoverApiUrl, albumPagePath } from "@/lib/library-routes";
import { formatTotalDuration } from "@/lib/utils";

import {
  affinityBandLabel,
  affinityTone,
  badgeTone,
  formatJoinedDate,
  formatMinutes,
  type ProfileContribution,
  type PublicProfile,
} from "./user-profile-model";

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
        className={className + " rounded-full object-cover"}
      />
    );
  }
  const initial = name.trim().charAt(0).toUpperCase() || "U";
  return (
    <div
      className={
        className +
        " user-profile-avatar-placeholder flex items-center justify-center rounded-full text-2xl font-semibold"
      }
    >
      {initial}
    </div>
  );
}

function ProfileMiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="user-profile-stat rounded-xl px-3 py-2">
      <div className="truncate text-lg font-black text-text-primary">
        {value}
      </div>
      <div className="mt-0.5 truncate text-[9px] font-bold uppercase tracking-[0.14em] text-text-muted">
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
        <div className="truncate text-sm font-semibold text-text-primary">
          {contribution.album_name}
        </div>
        <div className="truncate text-xs text-text-muted">
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

export function UserProfileHero({
  data,
  displayName,
  isOwnProfile,
  username,
  busy,
  onFollowToggle,
  locale,
}: {
  data: PublicProfile;
  displayName: string;
  isOwnProfile: boolean;
  username?: string;
  busy: boolean;
  onFollowToggle: () => void;
  locale: string;
}) {
  const { t } = useTranslation();
  const joinedDate =
    formatJoinedDate(data.joined_at, locale) ?? t("userProfile.recently");
  const stats = data.stats || {
    plays_30d: 0,
    minutes_30d: 0,
    contributions: 0,
    public_playlists: data.public_playlists.length,
  };
  const badges = data.badges || [];

  return (
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
              <h1 className="truncate text-3xl font-bold text-text-primary">
                {displayName}
              </h1>
              {data.relationship_state.is_friend && !isOwnProfile ? (
                <span className="user-profile-accent-badge inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium">
                  {t("people.friends")}
                </span>
              ) : null}
            </div>
            <div className="mt-1 text-sm text-text-muted">
              {data.username ? "@" + data.username : t("people.noUsername")} ·{" "}
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
                : "/users/" + (data.username || username) + "/stats"
            }
            className="inline-flex items-center gap-2 rounded-lg border border-accent-action/25 bg-accent-action/10 px-4 py-2.5 text-sm font-semibold text-accent-action transition-colors hover:bg-accent-action/15"
          >
            <BarChart3 size={15} />
            {t("userProfile.actions.viewListeningDna")}
          </Link>
          {!isOwnProfile ? (
            <button
              type="button"
              onClick={onFollowToggle}
              disabled={busy}
              className={
                "inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors " +
                (data.relationship_state.following
                  ? "border border-border-quiet/15 bg-text-primary/5 text-text-primary hover:bg-text-primary/10"
                  : "bg-accent-action text-accent-action-foreground hover:bg-accent-action/90")
              }
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
              className="inline-flex items-center gap-2 rounded-lg border border-border-quiet/15 bg-text-primary/5 px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-text-primary/10"
            >
              {t("userProfile.actions.editAccount")}
            </Link>
          )}
        </div>
      </div>

      <ProfileRelationshipStats data={data} />

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
        <div className="user-profile-accent-panel rounded-xl p-4">
          <div className="user-profile-accent-label text-[10px] font-bold uppercase tracking-[0.18em]">
            {t("userProfile.topSound")}
          </div>
          <div className="mt-2 truncate text-lg font-black text-text-primary">
            {data.top_genre?.name || t("userProfile.stillMapping")}
          </div>
          <div className="mt-1 text-xs text-text-muted">
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
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">
            {t("userProfile.badges.title")}
          </div>
          {badges.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {badges.map((badge) => (
                <span
                  key={badge.key}
                  className={
                    "rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] " +
                    badgeTone(badge.tone)
                  }
                >
                  {badge.label}
                </span>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-sm text-text-muted">
              {t("userProfile.badges.empty")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileRelationshipStats({ data }: { data: PublicProfile }) {
  const { t } = useTranslation();
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-4">
      <RelationshipStat
        label={t("people.followers")}
        value={data.followers_count}
        to={
          data.username ? "/users/" + data.username + "/followers" : "/people"
        }
      />
      <RelationshipStat
        label={t("people.following")}
        value={data.following_count}
        to={
          data.username ? "/users/" + data.username + "/following" : "/people"
        }
      />
      <RelationshipStat
        label={t("people.friends")}
        value={data.friends_count}
      />
      <div
        className={"rounded-xl border p-4 " + affinityTone(data.affinity_band)}
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
  );
}

function RelationshipStat({
  label,
  value,
  to,
}: {
  label: string;
  value: number;
  to?: string;
}) {
  return (
    <div className="user-profile-card rounded-xl p-4">
      <div className="text-xs uppercase tracking-wide text-text-muted">
        {label}
      </div>
      {to ? (
        <Link
          to={to}
          className="mt-2 block text-2xl font-semibold text-text-primary transition-colors hover:text-accent-action"
        >
          {value}
        </Link>
      ) : (
        <div className="mt-2 text-2xl font-semibold text-text-primary">
          {value}
        </div>
      )}
    </div>
  );
}

export function UserProfileMatch({
  data,
  isOwnProfile,
}: {
  data: PublicProfile;
  isOwnProfile: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section className="user-profile-card rounded-[12px] p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Users size={16} className="user-profile-accent-icon" />
        <h2 className="text-lg font-semibold text-text-primary">
          {t("userProfile.match.title")}
        </h2>
      </div>
      {isOwnProfile ? (
        <p className="mt-3 text-sm text-text-muted">
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
        <p className="mt-3 text-sm text-text-muted">
          {t("userProfile.match.notEnough")}
        </p>
      )}
    </section>
  );
}

export function UserProfileLibrary({ data }: { data: PublicProfile }) {
  const { t } = useTranslation();
  const contributions = data.contributions_preview || [];
  return (
    <section className="space-y-6">
      <div className="user-profile-card rounded-[12px] p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <PackagePlus size={16} className="user-profile-accent-icon" />
          <h2 className="text-lg font-semibold text-text-primary">
            {t("userProfile.contributions.title")}
          </h2>
        </div>
        <p className="mt-1 text-sm text-text-muted">
          {t("userProfile.contributions.subtitle")}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {contributions.length === 0 ? (
            <div className="user-profile-empty-state rounded-lg px-4 py-8 text-center text-sm text-text-muted sm:col-span-2">
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
      <UserProfilePlaylists data={data} />
    </section>
  );
}

function UserProfilePlaylists({ data }: { data: PublicProfile }) {
  const { t } = useTranslation();
  return (
    <div className="user-profile-card rounded-[12px] p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Music4 size={16} className="user-profile-accent-icon" />
        <h2 className="text-lg font-semibold text-text-primary">
          {t("userProfile.playlists.title")}
        </h2>
      </div>
      <div className="mt-4 space-y-3">
        {data.public_playlists.length === 0 ? (
          <div className="user-profile-empty-state rounded-lg px-4 py-8 text-center text-sm text-text-muted">
            {t("userProfile.playlists.empty")}
          </div>
        ) : (
          data.public_playlists.map((playlist) => {
            const coverUrl = resolveMaybeApiAssetUrl(playlist.cover_data_url);
            return (
              <Link
                key={playlist.id}
                to={"/playlist/" + playlist.id}
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
                  <div className="truncate text-sm font-medium text-text-primary">
                    {playlist.name}
                  </div>
                  <div className="mt-1 text-xs text-text-muted">
                    {t("common.trackCountLabel", {
                      count: playlist.track_count,
                    })}
                    {playlist.total_duration > 0
                      ? " · " + formatTotalDuration(playlist.total_duration)
                      : ""}
                    {playlist.is_collaborative
                      ? " · " + t("userProfile.playlists.collaborative")
                      : ""}
                  </div>
                  {playlist.description ? (
                    <div className="mt-1 truncate text-xs text-text-muted">
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
  );
}

export function UserProfileNetwork({ data }: { data: PublicProfile }) {
  return (
    <section className="space-y-6">
      <UserProfilePeopleList
        titleKey="people.followers"
        emptyKey="userProfile.followers.empty"
        seeAllPath={
          data.username ? "/users/" + data.username + "/followers" : null
        }
        items={data.followers_preview || []}
        itemKeyPrefix="follower"
      />
      <UserProfilePeopleList
        titleKey="people.following"
        emptyKey="userProfile.following.empty"
        seeAllPath={
          data.username ? "/users/" + data.username + "/following" : null
        }
        items={data.following_preview || []}
        itemKeyPrefix="following"
      />
    </section>
  );
}

function UserProfilePeopleList({
  titleKey,
  emptyKey,
  seeAllPath,
  items,
  itemKeyPrefix,
}: {
  titleKey: "people.followers" | "people.following";
  emptyKey: "userProfile.followers.empty" | "userProfile.following.empty";
  seeAllPath: string | null;
  items: PublicProfile["followers_preview"];
  itemKeyPrefix: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="user-profile-card rounded-[12px] p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text-primary">
          {t(titleKey)}
        </h2>
        {seeAllPath ? (
          <Link
            to={seeAllPath}
            className="user-profile-accent-link text-xs hover:underline"
          >
            {t("userProfile.seeAll")}
          </Link>
        ) : null}
      </div>
      <div className="mt-4 space-y-3">
        {items.slice(0, 6).map((item) => {
          const label =
            item.display_name || item.username || t("people.unknownUser");
          return (
            <UserProfileLink
              key={itemKeyPrefix + "-" + item.id}
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
                <div className="truncate text-sm font-medium text-text-primary">
                  {label}
                </div>
                <div className="truncate text-xs text-text-muted">
                  {item.username
                    ? "@" + item.username
                    : t("userProfile.profile")}
                </div>
              </div>
            </UserProfileLink>
          );
        })}
        {items.length === 0 ? (
          <p className="text-sm text-text-muted">{t(emptyKey)}</p>
        ) : null}
      </div>
    </div>
  );
}

export function UserProfileContent({
  data,
  isOwnProfile,
  username,
  busy,
  onFollowToggle,
  locale,
}: {
  data: PublicProfile;
  isOwnProfile: boolean;
  username?: string;
  busy: boolean;
  onFollowToggle: () => void;
  locale: string;
}) {
  const { t } = useTranslation();
  const displayName =
    data.display_name || data.username || t("people.unknownUser");
  return (
    <div className="space-y-6">
      <UserProfileHero
        data={data}
        displayName={displayName}
        isOwnProfile={isOwnProfile}
        username={username}
        busy={busy}
        onFollowToggle={onFollowToggle}
        locale={locale}
      />
      <UserProfileMatch data={data} isOwnProfile={isOwnProfile} />
      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <UserProfileLibrary data={data} />
        <UserProfileNetwork data={data} />
      </div>
    </div>
  );
}
