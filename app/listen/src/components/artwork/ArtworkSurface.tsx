import {
  useCallback,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import {
  CrateImage,
  type CrateImageProps,
} from "@/components/artwork/CrateImage";
import { canonicalArtworkTransportIdentity } from "@/lib/artwork-manager";
import type { ArtworkSource } from "@/lib/artwork-source";
import { cn } from "@/lib/utils";

interface ArtworkSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  source: ArtworkSource | string | null | undefined;
  alt: string;
  fallback: ReactNode;
  imageClassName?: string;
  imageProps?: Omit<
    CrateImageProps,
    "source" | "alt" | "className" | "onArtworkStateChange"
  >;
}

export function ArtworkSurface({
  source,
  alt,
  fallback,
  children,
  className,
  imageClassName,
  imageProps,
  ...props
}: ArtworkSurfaceProps) {
  const sourceKey =
    typeof source === "object" && source
      ? source.logicalKey
      : canonicalArtworkTransportIdentity(source);
  const [status, setStatus] = useState<{
    sourceKey: string;
    state: "empty" | "loading" | "ready";
  }>({
    sourceKey,
    state: source ? "loading" : "empty",
  });
  const state =
    status.sourceKey === sourceKey
      ? status.state
      : source
        ? "loading"
        : "empty";
  const handleStateChange = useCallback(
    (nextState: "empty" | "loading" | "ready") => {
      setStatus((current) =>
        current.sourceKey === sourceKey && current.state === nextState
          ? current
          : { sourceKey, state: nextState },
      );
    },
    [sourceKey],
  );
  const ready = state === "ready";

  return (
    <div
      {...props}
      className={cn("relative overflow-hidden", className)}
      data-artwork-state={state}
    >
      <div
        aria-hidden="true"
        data-testid="artwork-fallback"
        className={cn(
          "absolute inset-0 transition-opacity duration-150",
          ready ? "opacity-0" : "opacity-100",
        )}
      >
        {fallback}
      </div>
      <CrateImage
        {...imageProps}
        source={source}
        alt={alt}
        className={cn(
          "absolute inset-0 h-full w-full transition-opacity duration-150",
          ready ? "opacity-100" : "opacity-0",
          imageClassName,
        )}
        onArtworkStateChange={handleStateChange}
      />
      {children}
    </div>
  );
}
