import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { AppPopover } from "@crate/ui/primitives/AppPopover";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { UserAvatar } from "./UserAvatar";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";
import { clamp } from "@/lib/utils";
import {
  ErrorCard,
  LoadingCard,
  ProfileCardBody,
  type ProfileCardPayload,
} from "./ProfileHoverCardContent";

interface ProfileHoverCardProps {
  username?: string | null;
  children: ReactNode;
  className?: string;
  openDelayMs?: number;
}

const profileCardCache = new Map<string, ProfileCardPayload>();
const profileCardRequests = new Map<string, Promise<ProfileCardPayload>>();

export function clearProfileCardCacheForTests() {
  profileCardCache.clear();
  profileCardRequests.clear();
}

export function cacheProfileCard(username: string, card: ProfileCardPayload) {
  profileCardCache.set(username, card);
}

export function getCachedProfileCard(
  username: string,
): ProfileCardPayload | null {
  return profileCardCache.get(username) ?? null;
}

export function fetchProfileCard(
  username: string,
): Promise<ProfileCardPayload> {
  const cached = profileCardCache.get(username);
  if (cached) return Promise.resolve(cached);
  const inFlight = profileCardRequests.get(username);
  if (inFlight) return inFlight;
  const request = api<ProfileCardPayload>(
    `/api/users/${encodeURIComponent(username)}/card`,
  )
    .then((card) => {
      cacheProfileCard(username, card);
      return card;
    })
    .finally(() => {
      profileCardRequests.delete(username);
    });
  profileCardRequests.set(username, request);
  return request;
}

export function ProfileHoverCard({
  username,
  children,
  className,
  openDelayMs = 180,
}: ProfileHoverCardProps) {
  const isDesktop = useIsDesktop();
  const { user } = useAuth();
  const { t } = useTranslation();
  const popoverRef = useRef<HTMLDivElement>(null);
  const restoringFocusRef = useRef(false);
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

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = triggerRef.current?.getBoundingClientRect();
    const popup = popoverRef.current?.getBoundingClientRect();
    if (!anchor || !popup) return;
    const place = () =>
      setPosition({
        left: clamp(
          anchor.left + anchor.width / 2 - popup.width / 2,
          12,
          Math.max(12, window.innerWidth - popup.width - 12),
        ),
        top: clamp(
          anchor.bottom + 14 + popup.height > window.innerHeight
            ? anchor.top - popup.height - 14
            : anchor.bottom + 14,
          12,
          Math.max(12, window.innerHeight - popup.height - 12),
        ),
      });
    place();
    const close = () => setOpen(false);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (openTimerRef.current) window.clearTimeout(openTimerRef.current);
        close();
        restoringFocusRef.current = true;
        triggerRef.current?.querySelector<HTMLElement>("a,button")?.focus();
        restoringFocusRef.current = false;
      }
    };
    window.addEventListener("resize", close);
    const outsideScroll = (event: Event) => {
      if (
        event.target instanceof Node &&
        popoverRef.current?.contains(event.target)
      )
        return;
      close();
    };
    window.addEventListener("scroll", outsideScroll, true);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", outsideScroll, true);
      window.removeEventListener("keydown", escape);
    };
  }, [open, loading, error, card]);

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
    if (!isDesktop || !normalizedUsername || restoringFocusRef.current) return;
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
    if (!card || busy || card.id === user?.id) return;
    const requestId = requestIdRef.current;
    setBusy(true);
    try {
      if (card.relationship_state.following) {
        await api(`/api/users/${card.id}/follow`, "DELETE");
        if (requestId !== requestIdRef.current) return;
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
        if (requestId !== requestIdRef.current) return;
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
    } catch {
      notify.error(t("actions.user.toasts.followFailed"));
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
              ref={popoverRef}
              role="dialog"
              aria-label={
                card?.display_name ||
                card?.username ||
                t("profileHover.defaultName")
              }
              onFocusCapture={cancelClose}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  scheduleClose();
              }}
              layer="popover"
              className="fixed w-90 max-w-full overflow-y-auto p-0"
              style={{
                left: position.left,
                top: position.top,
                maxWidth: "calc(100vw - 24px)",
                maxHeight: "calc(100dvh - 24px)",
              }}
              onPointerEnter={cancelClose}
              onPointerLeave={scheduleClose}
            >
              {loading ? (
                <LoadingCard />
              ) : error ? (
                <ErrorCard
                  onRetry={() => {
                    setOpen(false);
                    scheduleOpen();
                  }}
                />
              ) : card ? (
                <ProfileCardBody
                  card={card}
                  avatar={
                    <UserAvatar
                      name={
                        card.display_name ||
                        card.username ||
                        t("profileHover.defaultName")
                      }
                      avatar={card.avatar}
                      userId={card.id}
                      alt=""
                      size="lg"
                    />
                  }
                  isOwnProfile={card.id === user?.id}
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
