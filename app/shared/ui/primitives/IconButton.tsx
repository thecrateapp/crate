import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { Loader2 } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";

export type IconButtonSize = "sm" | "md" | "lg";
export type IconButtonTone = "default" | "primary" | "danger";
export type IconButtonVariant = "ghost" | "card";

export function iconButtonToneClassName(
  tone: IconButtonTone,
  disabled = false,
) {
  if (disabled) {
    return "pointer-events-none text-text-subtle";
  }

  if (tone === "primary") {
    return "text-accent-action hover:text-accent-action hover:drop-shadow-accent-action-active";
  }

  if (tone === "danger") {
    return "text-state-danger hover:text-state-danger hover:drop-shadow-state-danger";
  }

  return "text-text-muted hover:text-accent-action hover:drop-shadow-accent-action";
}

const SIZE_CLASS_NAME: Record<IconButtonSize, string> = {
  sm: "size-8 [&_svg:not([class*='size-'])]:size-4",
  md: "size-10 [&_svg:not([class*='size-'])]:size-[18px]",
  lg: "size-11 [&_svg:not([class*='size-'])]:size-5",
};

const VARIANT_CLASS_NAME: Record<IconButtonVariant, string> = {
  ghost: "",
  card: "border border-border-subtle bg-surface-icon-control shadow-icon-control backdrop-blur-md",
};

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  label: string;
  size?: IconButtonSize;
  tone?: IconButtonTone;
  variant?: IconButtonVariant;
  active?: boolean;
  loading?: boolean;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      label,
      size = "md",
      tone = "default",
      variant = "ghost",
      active,
      loading = false,
      className,
      disabled = false,
      title,
      type = "button",
      children,
      ...props
    },
    ref,
  ) {
    const pressed = props["aria-pressed"];
    const isActive = active ?? (pressed === true || pressed === "true");

    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={title ?? label}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        data-size={size}
        data-variant={variant}
        data-active={isActive || undefined}
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center rounded-full outline-none transition-[color,filter,transform,box-shadow] hover:-translate-y-px focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50",
          "after:absolute after:top-1/2 after:left-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 pointer-fine:after:hidden",
          SIZE_CLASS_NAME[size],
          VARIANT_CLASS_NAME[variant],
          iconButtonToneClassName(isActive ? "primary" : tone),
          isActive && "animate-crate-icon-active-pulse",
          className,
        )}
        {...props}
      >
        {loading ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : (
          children
        )}
      </button>
    );
  },
);
