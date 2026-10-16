import { useEffect, useState, type ReactNode } from "react";
import type { CrateIcon } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";
import type { MediaImageShape } from "./MediaEntity";

export interface MediaCoverProps {
  src?: string | null;
  fallbackUrl?: string | null;
  alt?: string;
  fallbackIcon?: CrateIcon;
  fallback?: ReactNode;
  iconSize?: number;
  shape?: MediaImageShape;
  className?: string;
}

export function MediaCover({
  src,
  fallbackUrl,
  alt = "",
  fallbackIcon,
  fallback,
  iconSize = 18,
  shape = "square",
  className,
}: MediaCoverProps) {
  const [primaryErrored, setPrimaryErrored] = useState(false);
  const [fallbackErrored, setFallbackErrored] = useState(false);

  useEffect(() => {
    setPrimaryErrored(false);
    setFallbackErrored(false);
  }, [fallbackUrl, src]);

  const showingPrimary = Boolean(src && !primaryErrored);
  const imageSrc = showingPrimary
    ? src
    : fallbackUrl && !fallbackErrored
      ? fallbackUrl
      : null;

  const baseClasses = cn(
    "crate-media-cover overflow-hidden",
    shapeClass(shape),
    className,
  );

  if (!imageSrc) {
    const Icon = fallbackIcon;
    const hasCustomFallback =
      fallback !== undefined && fallback !== null && fallback !== false;

    return (
      <div
        className={cn(baseClasses, "flex items-center justify-center")}
        data-testid="media-cover-fallback"
        role={alt ? "img" : undefined}
        aria-label={alt || undefined}
      >
        {hasCustomFallback ? (
          typeof fallback === "string" || typeof fallback === "number" ? (
            <span aria-hidden="true" className="crate-media-initials">
              {fallback}
            </span>
          ) : (
            fallback
          )
        ) : Icon ? (
          <Icon
            aria-hidden="true"
            size={iconSize}
            className="text-text-muted"
          />
        ) : (
          <span aria-hidden="true" className="crate-media-initials">
            {initials(alt)}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={baseClasses}>
      <img
        src={imageSrc}
        alt={alt}
        loading="lazy"
        className=" size-full object-cover"
        onError={() => {
          if (showingPrimary) {
            setPrimaryErrored(true);
          } else {
            setFallbackErrored(true);
          }
        }}
        data-testid="media-cover-image"
      />
    </div>
  );
}

function shapeClass(shape: MediaImageShape): string {
  if (shape === "circle") return "rounded-full";
  if (shape === "rounded") return "rounded-2xl";
  return "rounded-lg";
}

function initials(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "—";
  return (
    words.length === 1
      ? Array.from(words[0]!).slice(0, 2).join("")
      : `${Array.from(words[0]!)[0]}${Array.from(words[words.length - 1]!)[0]}`
  ).toUpperCase();
}
