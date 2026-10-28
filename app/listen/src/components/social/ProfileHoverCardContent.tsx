import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  CRATE_ICON_SIZE,
  UserPlus,
  UserRoundCheck,
  UserCheck,
  Star,
} from "@crate/ui/icons";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { LoadingState } from "@crate/ui/domain/states";
import { Skeleton } from "@crate/ui/shadcn/skeleton";
import { Button } from "@crate/ui/shadcn/button";
import type { ReactNode } from "react";
import { ProfileMetric } from "./ProfileMetric";
import { badgeTone, formatMinutes } from "../../pages/user-profile-model";

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

export function ProfileCardBody({
  card,
  busy,
  onFollowToggle,
  isOwnProfile = false,
  avatar,
}: {
  card: ProfileCardPayload;
  busy: boolean;
  onFollowToggle: () => void;
  isOwnProfile?: boolean;
  avatar: ReactNode;
}) {
  const { t } = useTranslation();
  const name =
    card.display_name || card.username || t("profileHover.defaultName");
  const profile = card.username
    ? `/users/${encodeURIComponent(card.username)}`
    : "/people";
  const stats = isOwnProfile
    ? "/stats"
    : card.username
      ? `${profile}/stats`
      : "/people";
  const following = card.relationship_state.following;
  return (
    <div className="grid min-w-0 gap-4 p-4">
      <div className="flex min-w-0 flex-wrap items-start gap-3">
        {avatar}
        <div className="min-w-0 flex-1">
          <Link
            to={profile}
            className="wrap-anywhere text-sm font-medium text-text-primary link-accent"
          >
            {name}
          </Link>
          <p className="wrap-anywhere text-caption text-text-muted">
            {card.username ? `@${card.username}` : t("profileHover.noUsername")}
          </p>
          {card.relationship_state.is_friend && !isOwnProfile ? (
            <InfoBadge icon={UserCheck}>{t("profileHover.friend")}</InfoBadge>
          ) : null}
        </div>
        <ProfileMetric
          label={t("profileHover.match")}
          value={`${card.affinity_score}%`}
        />
      </div>
      <FormField kind="group" label={t("profileHover.topSound")}>
        <div className="grid min-w-0 gap-2">
          <div className="wrap-anywhere text-sm font-medium">
            {card.top_genre?.name || t("profileHover.topGenreFallback")}
          </div>
          {card.affinity_reasons.length ? (
            <p className="wrap-anywhere text-caption leading-5 text-text-muted">
              {card.affinity_reasons.join(" · ")}
            </p>
          ) : null}
        </div>
      </FormField>
      <div className="grid grid-cols-2 gap-4 border-y border-border-quiet py-4">
        <ProfileMetric
          label={t("profileHover.stats.plays")}
          value={card.stats.plays_30d}
        />
        <ProfileMetric
          label={t("profileHover.stats.time")}
          value={formatMinutes(card.stats.minutes_30d, t)}
        />
        <ProfileMetric
          label={t("profileHover.stats.adds")}
          value={card.stats.contributions}
        />
        <ProfileMetric
          label={t("profileHover.stats.lists")}
          value={card.stats.public_playlists}
        />
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">
        {card.badges.length ? (
          card.badges.map((badge) => (
            <InfoBadge key={badge.key} icon={Star} tone={badgeTone(badge.tone)}>
              {badge.label}
            </InfoBadge>
          ))
        ) : (
          <MonoLabel>{t("profileHover.defaultBadge")}</MonoLabel>
        )}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to={profile}>{t("people.viewProfile")}</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to={stats}>{t("home.sections.listeningDna.title")}</Link>
        </Button>
        {!isOwnProfile ? (
          <Button
            variant="ghost"
            size="icon-lg"
            title={t(following ? "common.following" : "common.follow")}
            aria-label={t(following ? "common.following" : "common.follow")}
            loading={busy}
            onClick={onFollowToggle}
          >
            {following ? (
              <UserRoundCheck size={CRATE_ICON_SIZE.sm} />
            ) : (
              <UserPlus size={CRATE_ICON_SIZE.sm} />
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
export function LoadingCard() {
  const { t } = useTranslation();
  return (
    <div className="p-4">
      <LoadingState label={t("profileHover.loading")}>
        <div className="grid gap-4">
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-20 w-full" />
        </div>
      </LoadingState>
    </div>
  );
}
export function ErrorCard({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="p-4">
      <ErrorState
        message={t("profileHover.loadFailed")}
        onRetry={onRetry}
        retryLabel={t("common.retry")}
      />
    </div>
  );
}
