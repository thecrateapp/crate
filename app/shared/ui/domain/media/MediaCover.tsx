import { useState, type ComponentPropsWithRef, type ReactNode } from "react";
import type { CrateIcon } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";
import type { MediaImageShape } from "./MediaEntity";

export interface MediaCoverImageProps {
  src: string;
  alt: string;
  className: string;
  onError: () => void;
  /** Managed transports own loading/recovery and can keep this visible until ready. */
  fallback: ReactNode;
}

export type MediaCoverSize = 48 | 56 | 64 | 80 | 88 | 96 | "fill";

const SIZE_CLASS: Record<MediaCoverSize, string> = {
  48: "size-12 shrink-0",
  56: "size-14 shrink-0",
  64: "size-16 shrink-0",
  80: "size-20 shrink-0",
  88: "size-22 shrink-0",
  96: "size-24 shrink-0",
  fill: "size-full",
};

export interface MediaCoverProps extends Omit<
  ComponentPropsWithRef<"div">,
  "children"
> {
  src?: string | null;
  fallbackUrl?: string | null;
  alt?: string;
  fallbackIcon?: CrateIcon;
  fallback?: ReactNode;
  iconSize?: number;
  shape?: MediaImageShape;
  size?: MediaCoverSize;
  renderImage?: (image: MediaCoverImageProps) => ReactNode;
}

export function MediaCover({
  src,
  fallbackUrl,
  alt = "",
  fallbackIcon,
  fallback,
  iconSize = 18,
  shape = "square",
  size,
  className,
  renderImage,
  ...props
}: MediaCoverProps) {
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);
  const [erroredFallback, setErroredFallback] = useState<string | null>(null);
  const showingPrimary = Boolean(src && src !== erroredSrc);
  const imageSrc = showingPrimary
    ? src
    : fallbackUrl && fallbackUrl !== erroredFallback
      ? fallbackUrl
      : null;
  const Icon = fallbackIcon;
  const hasCustomFallback =
    fallback !== undefined && fallback !== null && fallback !== false;
  const fallbackContent = hasCustomFallback ? (
    typeof fallback === "string" || typeof fallback === "number" ? (
      <span aria-hidden="true" className="crate-media-initials">
        {fallback}
      </span>
    ) : (
      fallback
    )
  ) : Icon ? (
    <Icon aria-hidden="true" size={iconSize} className="text-text-muted" />
  ) : (
    <span aria-hidden="true" className="crate-media-initials">
      {initials(alt)}
    </span>
  );
  const baseClasses = cn(
    "crate-media-cover overflow-hidden",
    shapeClass(shape),
    size !== undefined && SIZE_CLASS[size],
    className,
  );
  const handleError = () => {
    if (showingPrimary) setErroredSrc(src ?? null);
    else setErroredFallback(fallbackUrl ?? null);
  };

  return (
    <div
      {...props}
      data-slot="media-cover"
      data-shape={shape}
      data-size={size}
      data-min-size="48"
      data-state={imageSrc ? "image" : "fallback"}
      className={cn(
        baseClasses,
        !imageSrc && "flex items-center justify-center",
      )}
      data-testid={imageSrc ? undefined : "media-cover-fallback"}
      role={!imageSrc && alt ? "img" : props.role}
      aria-label={!imageSrc && alt ? alt : props["aria-label"]}
    >
      {imageSrc ? (
        renderImage ? (
          renderImage({
            src: imageSrc,
            alt,
            className: "size-full object-cover",
            onError: handleError,
            fallback: (
              <div
                aria-hidden="true"
                className="flex size-full items-center justify-center"
              >
                {fallbackContent}
              </div>
            ),
          })
        ) : (
          <img
            src={imageSrc}
            alt={alt}
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
            onError={handleError}
            data-testid="media-cover-image"
          />
        )
      ) : (
        fallbackContent
      )}
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
