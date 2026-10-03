import { useEffect, useState, type HTMLAttributes } from "react";

import { cn } from "@crate/ui/lib/cn";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
export type AvatarShape = "circle" | "rounded";

const SIZE_CLASS_NAME: Record<AvatarSize, string> = {
  xs: "size-6 text-xs",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-lg",
  xl: "size-20 text-2xl",
};

export function getInitials(name?: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const firstWord = words[0];
  if (!firstWord) return "?";
  const lastWord = words.length > 1 ? words[words.length - 1] : undefined;
  const first = Array.from(firstWord)[0] ?? "";
  const last = lastWord ? Array.from(lastWord)[0] ?? "" : "";
  return `${first}${last}`.toUpperCase();
}

export interface AvatarProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  src?: string | null;
  name?: string | null;
  alt?: string;
  size?: AvatarSize;
  shape?: AvatarShape;
  imageClassName?: string;
}

export function Avatar({
  src,
  name,
  alt,
  size = "md",
  shape = "circle",
  className,
  imageClassName,
  ...props
}: AvatarProps) {
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [src]);

  const accessibleName = alt ?? name ?? "";
  const showImage = Boolean(src) && !errored;

  return (
    <span
      data-slot="avatar"
      data-size={size}
      data-shape={shape}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden bg-surface-control font-semibold text-text-secondary",
        shape === "circle" ? "rounded-full" : "rounded-md",
        SIZE_CLASS_NAME[size],
        className,
      )}
      {...props}
    >
      {showImage ? (
        <img
          src={src ?? undefined}
          alt={accessibleName}
          loading="lazy"
          decoding="async"
          className={cn("size-full object-cover", imageClassName)}
          onError={() => setErrored(true)}
        />
      ) : (
        <span
          data-slot="avatar-fallback"
          role={accessibleName ? "img" : undefined}
          aria-label={accessibleName || undefined}
          aria-hidden={accessibleName ? undefined : true}
        >
          <span aria-hidden="true">{getInitials(name)}</span>
        </span>
      )}
    </span>
  );
}
