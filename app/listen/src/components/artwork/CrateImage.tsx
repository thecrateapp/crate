import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ImgHTMLAttributes,
  type SyntheticEvent,
} from "react";

import {
  useMediaAccessResumeVersion,
  useMediaAccessVersion,
} from "@/hooks/use-media-access-version";
import {
  canonicalArtworkTransportIdentity,
  preloadArtwork,
  preloadResolvedArtwork,
  refreshArtworkCandidate,
  resolveArtworkCandidate,
  type ResolvedArtworkCandidate,
} from "@/lib/artwork-manager";
import { requiresMediaAccessTicket } from "@/lib/api";
import {
  artworkFromUrl,
  type ArtworkRetryPolicy,
  type ArtworkSource,
} from "@/lib/artwork-source";

const EVENTUAL_RETRY_DELAYS_MS = [
  2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000, 60_000, 60_000, 60_000,
] as const;

export interface CrateImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  source?: ArtworkSource | string | null;
  src?: string | null;
  retryPolicy?: ArtworkRetryPolicy;
  onArtworkStateChange?: (state: "empty" | "loading" | "ready") => void;
}

interface ActiveArtwork {
  candidate: ResolvedArtworkCandidate;
  ready: boolean;
}

function shouldRefreshAfterResume(
  image: HTMLImageElement | null,
  loading: ImgHTMLAttributes<HTMLImageElement>["loading"],
): boolean {
  if (loading !== "lazy") return true;
  if (!image) return false;
  const bounds = image.getBoundingClientRect();
  return (
    bounds.width > 0 &&
    bounds.height > 0 &&
    bounds.bottom > 0 &&
    bounds.right > 0 &&
    bounds.top < window.innerHeight &&
    bounds.left < window.innerWidth
  );
}

function retryCandidate(
  candidate: ResolvedArtworkCandidate,
  attempt: number,
): ResolvedArtworkCandidate {
  const append = (value: string): string => {
    const separator = value.includes("?") ? "&" : "?";
    return `${value}${separator}retry=${attempt}`;
  };
  return {
    ...candidate,
    src: append(candidate.src),
    srcSet: candidate.srcSet
      ?.split(",")
      .map((entry) => {
        const match = entry.trim().match(/^(\S+)(\s+.+)?$/);
        return match?.[1]
          ? `${append(match[1])}${match[2] ?? ""}`
          : entry.trim();
      })
      .join(", "),
  };
}

export function CrateImage({
  source,
  src,
  srcSet,
  sizes,
  retryPolicy,
  onArtworkStateChange,
  onError,
  onLoad,
  loading,
  ...props
}: CrateImageProps) {
  const ticketVersion = useMediaAccessVersion();
  const resumeVersion = useMediaAccessResumeVersion();
  const rawSource = source ?? src ?? null;
  const artwork = useMemo<ArtworkSource>(() => {
    if (typeof rawSource !== "string") {
      if (rawSource) return rawSource;
      return artworkFromUrl(null, {
        logicalKey: "unknown:missing",
        retryPolicy: retryPolicy ?? "none",
      });
    }
    return artworkFromUrl(rawSource, {
      logicalKey: `unknown:url:${canonicalArtworkTransportIdentity(rawSource)}`,
      retryPolicy:
        retryPolicy ??
        (requiresMediaAccessTicket(rawSource) ? "credentials" : "none"),
      srcSet,
      sizes,
    });
  }, [rawSource, retryPolicy, sizes, srcSet]);
  const isTicketedArtwork = requiresMediaAccessTicket(artwork.src);
  const preservesReadyArtwork =
    artwork.retryPolicy === "credentials" || isTicketedArtwork;
  const resolved = useMemo(
    () => resolveArtworkCandidate(artwork),
    // ticketVersion intentionally re-registers protected paths. Content
    // identity prevents credential-only churn from reaching the DOM.
    [artwork, resumeVersion, ticketVersion],
  );
  const initial = resolved ? { candidate: resolved, ready: false } : null;
  const [active, setActive] = useState<ActiveArtwork | null>(initial);
  const activeRef = useRef(active);
  const desiredRef = useRef(
    resolved ? `${resolved.logicalKey}\u0000${resolved.contentKey}` : "",
  );
  const handledResumeVersion = useRef(resumeVersion);
  const recoveryAttempts = useRef(0);
  const mountedRef = useRef(true);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const commit = (next: ActiveArtwork | null) => {
    activeRef.current = next;
    setActive(next);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const desired = resolved
      ? `${resolved.logicalKey}\u0000${resolved.contentKey}`
      : "";
    if (desiredRef.current !== desired) {
      recoveryAttempts.current = 0;
    }
    desiredRef.current = desired;
    const current = activeRef.current;
    if (!resolved) {
      if (current?.ready && preservesReadyArtwork) return;
      commit(null);
      return;
    }
    if (!current || current.candidate.logicalKey !== resolved.logicalKey) {
      commit({ candidate: resolved, ready: false });
      return;
    }
    if (current.candidate.contentKey === resolved.contentKey) return;

    let cancelled = false;
    void preloadArtwork(artwork)
      .then((candidate) => {
        if (
          cancelled ||
          !candidate ||
          desiredRef.current !==
            `${candidate.logicalKey}\u0000${candidate.contentKey}`
        ) {
          return;
        }
        commit({ candidate, ready: true });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [artwork, preservesReadyArtwork, resolved]);

  useEffect(() => {
    if (handledResumeVersion.current === resumeVersion) return;
    handledResumeVersion.current = resumeVersion;
    if (!artwork.src || !preservesReadyArtwork) return;
    const wasReady = Boolean(activeRef.current?.ready);
    if (wasReady && !shouldRefreshAfterResume(imageRef.current, loading)) {
      return;
    }
    recoveryAttempts.current = 0;

    let cancelled = false;
    void refreshArtworkCandidate(artwork)
      .then((candidate) => {
        if (!candidate || cancelled) return null;
        if (!wasReady) {
          commit({ candidate, ready: false });
          return null;
        }
        return preloadResolvedArtwork(candidate);
      })
      .then((candidate) => {
        if (
          cancelled ||
          !candidate ||
          desiredRef.current !==
            `${candidate.logicalKey}\u0000${candidate.contentKey}`
        ) {
          return;
        }
        commit({ candidate, ready: true });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [artwork, loading, preservesReadyArtwork, resumeVersion]);

  const displayed = !resolved
    ? active?.ready && preservesReadyArtwork
      ? active
      : null
    : !active || active.candidate.logicalKey !== resolved.logicalKey
      ? { candidate: resolved, ready: false }
      : active;

  useEffect(() => {
    onArtworkStateChange?.(
      !displayed ? "empty" : displayed.ready ? "ready" : "loading",
    );
  }, [displayed, onArtworkStateChange]);

  if (!displayed) return null;
  const displayedSizes =
    resolved &&
    resolved.logicalKey === displayed.candidate.logicalKey &&
    resolved.contentKey === displayed.candidate.contentKey
      ? resolved.sizes
      : displayed.candidate.sizes;

  const recover = (event: SyntheticEvent<HTMLImageElement, Event>) => {
    const reportTerminalFailure = () => {
      const current = activeRef.current;
      if (
        current?.ready &&
        current.candidate.logicalKey === artwork.logicalKey
      ) {
        commit({ ...current, ready: false });
      }
      onError?.(event);
    };
    const policy = artwork.retryPolicy;
    const attempt = recoveryAttempts.current;
    const maxAttempts =
      policy === "eventual" ? EVENTUAL_RETRY_DELAYS_MS.length : 1;
    if (policy === "none" || attempt >= maxAttempts) {
      reportTerminalFailure();
      return;
    }
    const nextAttempt = attempt + 1;
    recoveryAttempts.current = nextAttempt;
    const recoveryDesired = desiredRef.current;
    const isCurrentRecovery = () =>
      mountedRef.current && desiredRef.current === recoveryDesired;

    const recovery = (() => {
      if (policy === "credentials") {
        if (requiresMediaAccessTicket(artwork.src)) {
          return refreshArtworkCandidate(artwork);
        }
        const candidate = resolveArtworkCandidate(artwork);
        return Promise.resolve(
          candidate ? retryCandidate(candidate, nextAttempt) : null,
        );
      }
      return new Promise<ResolvedArtworkCandidate | null>((resolve) => {
        window.setTimeout(() => {
          const candidate = resolveArtworkCandidate(artwork);
          resolve(candidate ? retryCandidate(candidate, nextAttempt) : null);
        }, EVENTUAL_RETRY_DELAYS_MS[attempt]);
      });
    })();
    void recovery
      .then((candidate) => {
        if (!isCurrentRecovery()) return undefined;
        if (!candidate) {
          reportTerminalFailure();
          return undefined;
        }
        if (!activeRef.current?.ready) {
          commit({ candidate, ready: false });
          return undefined;
        }
        return preloadResolvedArtwork(candidate);
      })
      .then((candidate) => {
        if (candidate && isCurrentRecovery()) {
          commit({ candidate, ready: true });
        }
      })
      .catch(() => {
        if (isCurrentRecovery()) reportTerminalFailure();
      });
  };

  return (
    <img
      {...props}
      ref={imageRef}
      data-artwork-managed="true"
      data-artwork-state={displayed.ready ? "ready" : "loading"}
      loading={loading}
      src={displayed.candidate.src}
      srcSet={displayed.candidate.srcSet}
      sizes={displayedSizes}
      onLoad={(event) => {
        recoveryAttempts.current = 0;
        if (!displayed.ready) {
          commit({ ...displayed, ready: true });
        }
        onLoad?.(event);
      }}
      onError={recover}
    />
  );
}
