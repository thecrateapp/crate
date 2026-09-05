import { Link } from "react-router";
import {
  BarChart3,
  Loader2,
  UserPlus,
  UserRoundCheck,
  Users,
} from "@crate/ui/icons";
import { useTranslation } from "react-i18next";

import { UserProfileAvatar } from "./UserProfileAvatar";
import {
  affinityBandLabel,
  affinityTone,
  badgeTone,
  formatJoinedDate,
  formatMinutes,
  type PublicProfile,
} from "./user-profile-model";

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
  return (
    <div className="user-profile-hero rounded-[12px] p-5 sm:p-6">
      <UserProfileHeader
        data={data}
        displayName={displayName}
        isOwnProfile={isOwnProfile}
        username={username}
        busy={busy}
        onFollowToggle={onFollowToggle}
        locale={locale}
      />
      <ProfileRelationshipStats data={data} />
      <ProfileTasteSummary data={data} />
    </div>
  );
}

function UserProfileHeader({
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
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-4">
        <UserProfileAvatar
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
      <UserProfileActions
        data={data}
        isOwnProfile={isOwnProfile}
        username={username}
        busy={busy}
        onFollowToggle={onFollowToggle}
      />
    </div>
  );
}

function UserProfileActions({
  data,
  isOwnProfile,
  username,
  busy,
  onFollowToggle,
}: {
  data: PublicProfile;
  isOwnProfile: boolean;
  username?: string;
  busy: boolean;
  onFollowToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
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
  );
}

function ProfileTasteSummary({ data }: { data: PublicProfile }) {
  const { t } = useTranslation();
  const stats = data.stats || {
    plays_30d: 0,
    minutes_30d: 0,
    contributions: 0,
    public_playlists: data.public_playlists.length,
  };
  const badges = data.badges || [];
  return (
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
      <ProfileBadges badges={badges} />
    </div>
  );
}

function ProfileBadges({ badges }: { badges: PublicProfile["badges"] }) {
  const { t } = useTranslation();
  return (
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
        <UsersIcon />
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

function UsersIcon() {
  return <Users size={16} className="user-profile-accent-icon" />;
}
