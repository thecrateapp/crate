import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

import { cn } from "@crate/ui/lib/cn";

type ActionTone = "default" | "primary" | "danger";
type ActionVariant = "row" | "card";

function actionToneClassName(tone: ActionTone, disabled: boolean) {
  if (disabled) {
    return "pointer-events-none text-[var(--idle-text-subtle)]";
  }

  if (tone === "primary") {
    return "text-primary hover:text-primary hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.45)]";
  }

  if (tone === "danger") {
    return "text-[var(--status-danger-text)] hover:text-[var(--status-danger-text)] hover:drop-shadow-[0_0_8px_rgba(248,113,113,0.35)]";
  }

  return "text-[var(--idle-text-muted)] hover:text-primary hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.32)]";
}

function actionVariantClassName(variant: ActionVariant) {
  if (variant === "card") {
    return "h-9 min-h-11 w-9 min-w-11 border border-[var(--idle-border)] bg-black/55 shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-md md:min-h-0 md:min-w-0";
  }

  return "h-10 min-h-11 w-10 min-w-11 md:min-h-0 md:min-w-0";
}

interface ActionIconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  tone?: ActionTone;
  variant?: ActionVariant;
  children: ReactNode;
}

export const ActionIconButton = forwardRef<
  HTMLButtonElement,
  ActionIconButtonProps
>(function ActionIconButton(
  {
    active = false,
    className,
    disabled = false,
    tone = "default",
    type = "button",
    variant = "row",
    children,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={cn(
        "flex items-center justify-center rounded-full transition-[color,filter,transform] hover:-translate-y-px [&_svg:not([class*='size-'])]:size-[18px]",
        actionVariantClassName(variant),
        actionToneClassName(active ? "primary" : tone, disabled),
        active && "animate-crate-icon-active-pulse",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

interface ActionIconLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  active?: boolean;
  disabled?: boolean;
  tone?: ActionTone;
  variant?: ActionVariant;
  children: ReactNode;
}

export function ActionIconLink({
  active = false,
  children,
  className,
  disabled = false,
  href,
  tone = "default",
  variant = "row",
  ...props
}: ActionIconLinkProps) {
  return (
    <a
      href={href || "#"}
      aria-disabled={disabled || !href}
      className={cn(
        "flex items-center justify-center rounded-full transition-[color,filter,transform] hover:-translate-y-px [&_svg:not([class*='size-'])]:size-[18px]",
        actionVariantClassName(variant),
        actionToneClassName(active ? "primary" : tone, disabled || !href),
        active && "animate-crate-icon-active-pulse",
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}
