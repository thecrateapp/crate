import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Loader2, UserPlus, UserRoundCheck } from "@crate/ui/icons";

import { AppPopover } from "@crate/ui/primitives/AppPopover";
import { cn } from "@crate/ui/lib/cn";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { useUserAvatarUrl } from "@/hooks/use-user-avatar-url";
import { CrateImage } from "@/components/artwork/CrateImage";
import { api } from "@/lib/api";

type AffinityBand = "low" | "medium" | "high" | "very_high" | string;

interface ProfileCardBadge {
  key: string;
  label: string;
  tone: "cyan" | "gold" | "green" | "rose" | "neutral" | string;
}

interface ProfileCardPayload {
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

interface ProfileHoverCardProps {
  username?: string | null;
  children: ReactNode;
  className?: string;
  openDelayMs?: number;
}

const profileCardCache = new Map<string, ProfileCardPayload>();

export function clearProfileCardCacheForTests() {
  profileCardCache.clear();
}

function formatMinutes(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0m";
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  }
  return `${Math.round(minutes)}m`;
}

function affinityTone(band: AffinityBand) {
  if (band === "very_high") return "profile-hover-affinity-very-high";
  if (band === "high") return "profile-hover-affinity-high";
  if (band === "medium") return "profile-hover-affinity-medium";
  return "profile-hover-affinity-low";
}

function badgeTone(tone: string) {
  switch (tone) {
    case "gold":
      return "profile-hover-badge-gold";
    case "green":
      return "profile-hover-badge-green";
    case "rose":
      return "profile-hover-badge-rose";
    case "cyan":
      return "profile-hover-badge-cyan";
    default:
      return "profile-hover-badge-neutral";
  }
}

function mainBadge(card: ProfileCardPayload) {
  return card.badges[0]?.label || "Crate listener";
}

function cardLabel(card: ProfileCardPayload) {
  return card.display_name || card.username || "Crate user";
}

function cacheProfileCard(username: string, card: ProfileCardPayload) {
  profileCardCache.set(username, card);
}

function ProfileAvatar({ card }: { card: ProfileCardPayload }) {
  const label = cardLabel(card);
  const { avatarUrl, handleAvatarError } = useUserAvatarUrl(
    card.avatar,
    card.id,
  );

  if (avatarUrl) {
    return (
      <CrateImage
        src={avatarUrl}
        alt=""
        onError={handleAvatarError}
        className="profile-hover-avatar h-16 w-16 rounded-xl object-cover"
      />
    );
  }

  return (
    <div className="profile-hover-avatar-placeholder flex h-16 w-16 items-center justify-center rounded-xl border text-2xl font-black">
      {label.trim().charAt(0).toUpperCase() || "U"}
    </div>
  );
}

function ProfileCardBody({
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
                {cardLabel(card)}
              </div>
              <div className="profile-hover-username truncate text-xs">
                {username ? `@${username}` : t("profileHover.noUsername")}
              </div>
            </div>
            {card.relationship_state.is_friend ? (
              <span className="profile-hover-friend rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em]">
                {t("profileHover.friend")}
              </span>
            ) : null}
          </div>

          <div className="profile-hover-main-badge mt-3 inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]">
            {mainBadge(card)}
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
          <div className="profile-hover-score-label text-[10px] font-bold uppercase tracking-[0.18em]">
            Match
          </div>
        </div>
      </div>

      <div className="profile-hover-top-panel relative mt-4 rounded-xl border p-3">
        <div className="profile-hover-top-label text-[10px] font-bold uppercase tracking-[0.18em]">
          Top sound
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
        <MiniStat label="Plays" value={String(card.stats.plays_30d)} />
        <MiniStat label="Time" value={formatMinutes(card.stats.minutes_30d)} />
        <MiniStat label="Adds" value={String(card.stats.contributions)} />
        <MiniStat label="Lists" value={String(card.stats.public_playlists)} />
      </div>

      {card.badges.length ? (
        <div className="relative mt-3 flex flex-wrap gap-1.5">
          {card.badges.map((badge) => (
            <span
              key={badge.key}
              className={cn(
                "rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em]",
                badgeTone(badge.tone),
              )}
            >
              {badge.label}
            </span>
          ))}
        </div>
      ) : null}

      <div className="relative mt-4 flex items-center gap-2">
        <Link
          to={profilePath}
          className="profile-hover-secondary-control flex-1 rounded-full border px-3 py-2 text-center text-xs font-bold transition-colors"
        >
          View profile
        </Link>
        <Link
          to={statsPath}
          className="profile-hover-accent-control flex-1 rounded-full border px-3 py-2 text-center text-xs font-bold transition-colors"
        >
          Listening DNA
        </Link>
        <button
          type="button"
          onClick={onFollowToggle}
          disabled={busy}
          className={cn(
            "profile-hover-follow-control flex h-9 w-9 items-center justify-center rounded-full border transition-colors disabled:opacity-60",
            following
              ? "profile-hover-following"
              : "profile-hover-follow-default",
          )}
          title={following ? "Following" : "Follow"}
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : following ? (
            <UserRoundCheck size={14} />
          ) : (
            <UserPlus size={14} />
          )}
        </button>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="profile-hover-stat rounded-xl border px-2 py-2">
      <div className="profile-hover-stat-value truncate text-sm font-black">
        {value}
      </div>
      <div className="profile-hover-stat-label mt-0.5 truncate text-[9px] font-bold uppercase tracking-[0.14em]">
        {label}
      </div>
    </div>
  );
}

function LoadingCard() {
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

function ErrorCard() {
  const { t } = useTranslation();
  return (
    <div className="profile-hover-error w-[320px] rounded-[12px] border p-4 text-sm">
      {t("profileHover.loadFailed")}
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function ProfileHoverCard({
  username,
  children,
  className,
  openDelayMs = 180,
}: ProfileHoverCardProps) {
  const isDesktop = useIsDesktop();
  const normalizedUsername = username?.trim().replace(/^@/, "") || "";
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const activeRequestRef = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const [card, setCard] = useState<ProfileCardPayload | null>(
    normalizedUsername
      ? profileCardCache.get(normalizedUsername) || null
      : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!normalizedUsername) return;
    requestIdRef.current += 1;
    activeRequestRef.current = null;
    setCard(profileCardCache.get(normalizedUsername) || null);
    setLoading(false);
    setError(false);
  }, [normalizedUsername]);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      activeRequestRef.current = null;
      if (openTimerRef.current) window.clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open || !isDesktop || !normalizedUsername || card) return;

    const cachedCard = profileCardCache.get(normalizedUsername);
    if (cachedCard) {
      setCard(cachedCard);
      setLoading(false);
      setError(false);
      return;
    }

    if (activeRequestRef.current === normalizedUsername) return;

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    activeRequestRef.current = normalizedUsername;
    setLoading(true);
    setError(false);
    api<ProfileCardPayload>(
      `/api/users/${encodeURIComponent(normalizedUsername)}/card`,
    )
      .then((payload) => {
        if (requestIdRef.current !== requestId) return;
        cacheProfileCard(normalizedUsername, payload);
        setCard(payload);
      })
      .catch(() => {
        if (requestIdRef.current === requestId) setError(true);
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return;
        activeRequestRef.current = null;
        setLoading(false);
      });
  }, [card, isDesktop, normalizedUsername, open]);

  function updatePosition() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 360;
    const left = clamp(
      rect.left + rect.width / 2 - width / 2,
      12,
      window.innerWidth - width - 12,
    );
    const top =
      rect.bottom + 14 + 260 > window.innerHeight
        ? Math.max(12, rect.top - 286)
        : rect.bottom + 14;
    setPosition({ left, top });
  }

  function cancelClose() {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function scheduleOpen() {
    if (!isDesktop || !normalizedUsername) return;
    cancelClose();
    if (openTimerRef.current) window.clearTimeout(openTimerRef.current);
    openTimerRef.current = window.setTimeout(() => {
      updatePosition();
      setOpen(true);
    }, openDelayMs);
  }

  function scheduleClose() {
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  }

  async function handleFollowToggle() {
    if (!card) return;
    setBusy(true);
    try {
      if (card.relationship_state.following) {
        await api(`/api/users/${card.id}/follow`, "DELETE");
        const nextCard = {
          ...card,
          relationship_state: {
            ...card.relationship_state,
            following: false,
            is_friend: false,
          },
        };
        cacheProfileCard(normalizedUsername, nextCard);
        setCard(nextCard);
      } else {
        const response = await api<{
          relationship_state?: ProfileCardPayload["relationship_state"];
        }>(`/api/users/${card.id}/follow`, "POST");
        const nextCard = {
          ...card,
          relationship_state: response.relationship_state || {
            ...card.relationship_state,
            following: true,
          },
        };
        cacheProfileCard(normalizedUsername, nextCard);
        setCard(nextCard);
      }
    } finally {
      setBusy(false);
    }
  }

  const trigger = (
    <span
      ref={triggerRef}
      className={className}
      onPointerEnter={scheduleOpen}
      onPointerLeave={scheduleClose}
      onFocus={scheduleOpen}
      onBlur={scheduleClose}
    >
      {children}
    </span>
  );

  if (!isDesktop || !normalizedUsername) return trigger;

  return (
    <>
      {trigger}
      {open
        ? createPortal(
            <AppPopover
              layer="popover"
              className="profile-hover-popover fixed w-[360px] overflow-visible p-0"
              style={{ left: position.left, top: position.top }}
              onPointerEnter={cancelClose}
              onPointerLeave={scheduleClose}
            >
              {loading ? (
                <LoadingCard />
              ) : error ? (
                <ErrorCard />
              ) : card ? (
                <ProfileCardBody
                  card={card}
                  busy={busy}
                  onFollowToggle={() => void handleFollowToggle()}
                />
              ) : null}
            </AppPopover>,
            document.body,
          )
        : null}
    </>
  );
}
