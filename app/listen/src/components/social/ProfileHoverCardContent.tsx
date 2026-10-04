import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  CRATE_ICON_SIZE,
  Loader2,
  UserPlus,
  UserRoundCheck,
} from "@crate/ui/icons";

import { cn } from "@crate/ui/lib/cn";
import { CratePill } from "@crate/ui/primitives/CrateBadge";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { UserAvatar } from "@/components/social/UserAvatar";
import { badgeTone, formatMinutes } from "@/pages/user-profile-model";

export type AffinityBand = "low" | "medium" | "high" | "very_high" | string;

export interface ProfileCardBadge {
  key: string;
  label: string;
  tone: "cyan" | "gold" | "green" | "rose" | "neutral" | string;
}

export interface ProfileCardPayload {
  id: number;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  bio: string | null;
  relationship_state: {
    following: boolean;
    followed_by: boolean;
    is_friend: boolean;
  };
  affinity_score: number;
  affinity_band: AffinityBand;
  affinity_reasons: string[];
  top_genre: {
    name: string;
    play_count: number;
    minutes_listened: number;
  } | null;
  stats: {
    plays_30d: number;
    minutes_30d: number;
    contributions: number;
    public_playlists: number;
  };
  badges: ProfileCardBadge[];
}

function affinityTone(band: AffinityBand) {
  if (band === "very_high") return "profile-hover-affinity-very-high";
  if (band === "high") return "profile-hover-affinity-high";
  if (band === "medium") return "profile-hover-affinity-medium";
  return "profile-hover-affinity-low";
}

const PROFILE_BADGE_CLASS_NAME =
  "gap-0 px-2 text-xs leading-4 font-bold uppercase tracking-[0.12em]";

function mainBadge(card: ProfileCardPayload, t: TFunction) {
  return card.badges[0]?.label || t("profileHover.defaultBadge");
}

function cardLabel(card: ProfileCardPayload, t: TFunction) {
  return card.display_name || card.username || t("profileHover.defaultName");
}

function ProfileAvatar({ card }: { card: ProfileCardPayload }) {
  const { t } = useTranslation();

  return (
    <UserAvatar
      name={cardLabel(card, t)}
      avatar={card.avatar}
      userId={card.id}
      alt=""
      shape="rounded"
      className={cn(
        "profile-hover-avatar size-16 rounded-xl border text-2xl font-black",
        !card.avatar && "profile-hover-avatar-placeholder",
      )}
    />
  );
}

export function ProfileCardBody({
  card,
  busy,
  onFollowToggle,
}: {
  card: ProfileCardPayload;
  busy: boolean;
  onFollowToggle: () => void;
}) {
  const { t } = useTranslation();
  const username = card.username || "";
  const profilePath = username
    ? `/users/${encodeURIComponent(username)}`
    : "/people";
  const statsPath = username
    ? `/users/${encodeURIComponent(username)}/stats`
    : "/stats";
  const topGenre = card.top_genre?.name || t("profileHover.topGenreFallback");
  const following = card.relationship_state.following;

  return (
    <div className="profile-hover-card relative overflow-hidden rounded-[12px] border p-4">
      <div className="profile-hover-glow pointer-events-none absolute inset-0" />
      <div className="profile-hover-watermark pointer-events-none absolute -right-8 -top-8 text-[8rem] font-black leading-none">
        {card.affinity_score}
      </div>

      <div className="relative flex items-start gap-3">
        <ProfileAvatar card={card} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="min-w-0">
              <div className="profile-hover-title truncate text-base font-black">
                {cardLabel(card, t)}
              </div>
              <div className="profile-hover-username truncate text-xs">
                {username ? `@${username}` : t("profileHover.noUsername")}
              </div>
            </div>
            {card.relationship_state.is_friend ? (
              <CratePill
                tone="accent"
                className="gap-0 px-2 py-0.5 text-xs leading-4 font-bold uppercase tracking-[0.16em]"
              >
                {t("profileHover.friend")}
              </CratePill>
            ) : null}
          </div>

          <div className="profile-hover-main-badge mt-3 inline-flex rounded-full border px-2.5 py-1 text-xs font-black uppercase tracking-[0.18em]">
            {mainBadge(card, t)}
          </div>
        </div>

        <div className="text-right">
          <div
            className={cn(
              "text-4xl font-black leading-none",
              affinityTone(card.affinity_band),
            )}
          >
            {card.affinity_score}
          </div>
          <div className="profile-hover-score-label text-xs font-bold uppercase tracking-[0.18em]">
            {t("profileHover.match")}
          </div>
        </div>
      </div>

      <div className="profile-hover-top-panel relative mt-4 border-t border-border-quiet pt-3">
        <div className="profile-hover-top-label text-xs font-bold uppercase tracking-[0.18em]">
          {t("profileHover.topSound")}
        </div>
        <div className="profile-hover-top-genre mt-1 truncate text-sm font-bold">
          {topGenre}
        </div>
        {card.affinity_reasons.length ? (
          <div className="profile-hover-reasons mt-2 line-clamp-2 text-xs leading-5">
            {card.affinity_reasons.join(" · ")}
          </div>
        ) : null}
      </div>

      <div className="relative mt-3 grid grid-cols-4 gap-2">
        <MiniStat
          label={t("profileHover.stats.plays")}
          value={String(card.stats.plays_30d)}
        />
        <MiniStat
          label={t("profileHover.stats.time")}
          value={formatMinutes(card.stats.minutes_30d, t)}
        />
        <MiniStat
          label={t("profileHover.stats.adds")}
          value={String(card.stats.contributions)}
        />
        <MiniStat
          label={t("profileHover.stats.lists")}
          value={String(card.stats.public_playlists)}
        />
      </div>

      {card.badges.length ? (
        <div className="relative mt-3 flex flex-wrap gap-1.5">
          {card.badges.map((badge) => (
            <CratePill
              key={badge.key}
              tone={badgeTone(badge.tone)}
              className={PROFILE_BADGE_CLASS_NAME}
            >
              {badge.label}
            </CratePill>
          ))}
        </div>
      ) : null}

      <div className="relative mt-4 flex items-center gap-2">
        <Link
          to={profilePath}
          className="profile-hover-secondary-control flex-1 rounded-full border px-3 py-2 text-center text-xs font-bold transition-colors"
        >
          {t("people.viewProfile")}
        </Link>
        <Link
          to={statsPath}
          className="profile-hover-accent-control flex-1 rounded-full border px-3 py-2 text-center text-xs font-bold transition-colors"
        >
          {t("home.sections.listeningDna.title")}
        </Link>
        <IconButton
          label={t(following ? "common.following" : "common.follow")}
          size="sm"
          loading={busy}
          onClick={onFollowToggle}
          className={cn(
            "profile-hover-follow-control size-9 border disabled:opacity-60",
            following
              ? "profile-hover-following"
              : "profile-hover-follow-default",
          )}
        >
          {following ? (
            <UserRoundCheck size={CRATE_ICON_SIZE.xs} />
          ) : (
            <UserPlus size={CRATE_ICON_SIZE.xs} />
          )}
        </IconButton>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="profile-hover-stat rounded-xl border p-2 ">
      <div className="profile-hover-stat-value truncate text-sm font-black">
        {value}
      </div>
      <div className="profile-hover-stat-label mt-0.5 truncate text-xs font-bold uppercase tracking-[0.14em]">
        {label}
      </div>
    </div>
  );
}

export function LoadingCard() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={t("profileHover.loading")}
      className="profile-hover-loading flex h-40 w-[360px] items-center justify-center rounded-[12px] border"
    >
      <Loader2 size={18} className="profile-hover-loading-icon animate-spin" />
    </div>
  );
}

export function ErrorCard() {
  const { t } = useTranslation();
  return (
    <div className="profile-hover-error w-[320px] rounded-[12px] border p-4 text-sm">
      {t("profileHover.loadFailed")}
    </div>
  );
}
