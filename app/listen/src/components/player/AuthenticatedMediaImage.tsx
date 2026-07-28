import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ImgHTMLAttributes,
} from "react";

import { useMediaAccessVersion } from "@/hooks/use-media-access-version";
import { ensureMediaAccessUrl, resolveMaybeApiAssetUrl } from "@/lib/api";

interface AuthenticatedMediaImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string | null | undefined;
}

export function AuthenticatedMediaImage({
  src,
  onError,
  ...props
}: AuthenticatedMediaImageProps) {
  const ticketVersion = useMediaAccessVersion();
  const resolvedSource = useMemo(
    () => resolveMaybeApiAssetUrl(src),
    [src, ticketVersion],
  );
  const [recoveredSource, setRecoveredSource] = useState<string | null>(null);
  const recoveryAttemptedFor = useRef<string | null>(null);

  useEffect(() => {
    setRecoveredSource(null);
    recoveryAttemptedFor.current = null;
  }, [src, ticketVersion]);

  if (!resolvedSource && !recoveredSource) return null;

  return (
    <img
      {...props}
      src={recoveredSource || resolvedSource || undefined}
      onError={(event) => {
        onError?.(event);
        if (!src || recoveryAttemptedFor.current === src) return;
        recoveryAttemptedFor.current = src;
        void ensureMediaAccessUrl(src, "artwork", {
          forceRefresh: true,
        })
          .then(setRecoveredSource)
          .catch(() => {
            // The caller's placeholder remains visible after one bounded retry.
          });
      }}
    />
  );
}
