import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ImgHTMLAttributes,
} from "react";

import {
  useMediaAccessResumeVersion,
  useMediaAccessVersion,
} from "@/hooks/use-media-access-version";
import {
  ensureMediaAccessUrl,
  isUsableMediaAssetUrl,
  requiresMediaAccessTicket,
  resolveMaybeApiAssetUrl,
} from "@/lib/api";

interface AuthenticatedMediaImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string | null | undefined;
}

function canonicalSourceIdentity(source: string | null | undefined): string {
  if (!source) return "";
  if (!requiresMediaAccessTicket(source)) return source;
  if (/^(?:data|blob|file|capacitor):/i.test(source)) return source;
  try {
    const absolute = /^https?:\/\//i.test(source);
    const parsed = new URL(source, "https://crate.local");
    parsed.searchParams.delete("token");
    parsed.searchParams.delete("media_ticket");
    return absolute
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return source
      .replace(/([?&])(token|media_ticket)=[^&]*&?/g, "$1")
      .replace(/[?&]$/, "");
  }
}

function canonicalSourceSetIdentity(sourceSet: string | undefined): string {
  if (!sourceSet) return "";
  return sourceSet
    .split(",")
    .map((candidate) => {
      const match = candidate.trim().match(/^(\S+)(\s+.+)?$/);
      if (!match?.[1]) return candidate.trim();
      return `${canonicalSourceIdentity(match[1])}${match[2] ?? ""}`;
    })
    .join(", ");
}

function resolveAuthenticatedSourceSet(
  sourceSet: string | undefined,
): string | undefined {
  if (!sourceSet) return undefined;
  const candidates = sourceSet.split(",").map((candidate) => {
    const match = candidate.trim().match(/^(\S+)(\s+.+)?$/);
    if (!match?.[1]) return null;
    const resolved = resolveMaybeApiAssetUrl(match[1]);
    if (!resolved || !isUsableMediaAssetUrl(resolved)) return null;
    return `${resolved}${match[2] ?? ""}`;
  });
  return candidates.every(Boolean) ? candidates.join(", ") : undefined;
}

export function AuthenticatedMediaImage({
  src,
  srcSet,
  onError,
  onLoad,
  ...props
}: AuthenticatedMediaImageProps) {
  const ticketVersion = useMediaAccessVersion();
  const resumeVersion = useMediaAccessResumeVersion();
  const sourceKey = `${canonicalSourceIdentity(
    src,
  )}\u0000${canonicalSourceSetIdentity(srcSet)}`;
  const resolvedSource = useMemo(
    () => resolveMaybeApiAssetUrl(src),
    [resumeVersion, src, ticketVersion],
  );
  const resolvedSourceSet = useMemo(
    () => resolveAuthenticatedSourceSet(srcSet),
    [resumeVersion, srcSet, ticketVersion],
  );
  const usableSource =
    resolvedSource && isUsableMediaAssetUrl(resolvedSource)
      ? resolvedSource
      : null;
  const [active, setActive] = useState(() => ({
    key: sourceKey,
    source: usableSource,
    sourceSet: resolvedSourceSet,
  }));
  const recoveryAttemptedFor = useRef<string | null>(null);
  const handledResumeVersion = useRef(resumeVersion);

  useEffect(() => {
    recoveryAttemptedFor.current = null;
  }, [sourceKey]);

  useEffect(() => {
    setActive((current) => {
      if (current.key !== sourceKey) {
        return {
          key: sourceKey,
          source: usableSource,
          sourceSet: resolvedSourceSet,
        };
      }
      if (current.source || !usableSource) return current;
      return {
        key: sourceKey,
        source: usableSource,
        sourceSet: resolvedSourceSet,
      };
    });
  }, [resolvedSourceSet, sourceKey, usableSource]);

  useEffect(() => {
    if (handledResumeVersion.current === resumeVersion) return;
    handledResumeVersion.current = resumeVersion;
    if (!src || !requiresMediaAccessTicket(src)) return;

    let cancelled = false;
    void ensureMediaAccessUrl(src, "artwork", {
      forceRefresh: true,
    })
      .then((source) => {
        if (cancelled) return;
        setActive({
          key: sourceKey,
          source,
          sourceSet: resolveAuthenticatedSourceSet(srcSet),
        });
      })
      .catch(() => {
        // Keep the previously rendered bitmap while normal error recovery runs.
      });
    return () => {
      cancelled = true;
    };
  }, [resumeVersion, sourceKey, src, srcSet]);

  const rendered =
    active.key === sourceKey
      ? active
      : {
          key: sourceKey,
          source: usableSource,
          sourceSet: resolvedSourceSet,
        };
  if (!rendered.source) return null;

  return (
    <img
      {...props}
      data-authenticated-media="true"
      src={rendered.source}
      srcSet={rendered.sourceSet}
      onLoad={(event) => {
        recoveryAttemptedFor.current = null;
        onLoad?.(event);
      }}
      onError={(event) => {
        if (!src || !requiresMediaAccessTicket(src)) {
          onError?.(event);
          return;
        }
        if (recoveryAttemptedFor.current === sourceKey) {
          onError?.(event);
          return;
        }
        recoveryAttemptedFor.current = sourceKey;
        void ensureMediaAccessUrl(src, "artwork", {
          forceRefresh: true,
        })
          .then((source) => {
            setActive({
              key: sourceKey,
              source,
              sourceSet: resolveAuthenticatedSourceSet(srcSet),
            });
          })
          .catch(() => {
            onError?.(event);
          });
      }}
    />
  );
}
