import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

import { cn } from "@crate/ui/lib/cn";
import {
  iconButtonToneClassName,
  type IconButtonTone,
} from "@crate/ui/primitives/IconButton";

type ActionTone = IconButtonTone;
type ActionVariant = "row" | "card";

const actionToneClassName = iconButtonToneClassName;

function actionVariantClassName(variant: ActionVariant) {
  if (variant === "card") {
    return "h-9 min-h-11 w-9 min-w-11 border border-border-quiet bg-surface-object pointer-fine:min-h-0 pointer-fine:min-w-0";
  }

  return "h-10 min-h-11 w-10 min-w-11 pointer-fine:min-h-0 pointer-fine:min-w-0";
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
        "flex items-center justify-center rounded-full transition-[color,filter,transform,box-shadow] hover:-translate-y-px [&_svg:not([class*='size-'])]:size-[18px]",
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
  onClick,
  onClickCapture,
  onKeyDown,
  onKeyDownCapture,
  tabIndex,
  ...props
}: ActionIconLinkProps) {
  const unavailable = disabled || !href;
  return (
    <a
      href={href || "#"}
      aria-disabled={unavailable}
      className={cn(
        "flex items-center justify-center rounded-full transition-[color,filter,transform,box-shadow] hover:-translate-y-px [&_svg:not([class*='size-'])]:size-[18px]",
        actionVariantClassName(variant),
        actionToneClassName(active ? "primary" : tone, disabled || !href),
        active && "animate-crate-icon-active-pulse",
        className,
      )}
      {...props}
      tabIndex={unavailable ? -1 : tabIndex}
      onClickCapture={(event) => {
        if (unavailable) {
          event.preventDefault();
          event.stopPropagation();
        } else onClickCapture?.(event);
      }}
      onKeyDownCapture={(event) => {
        if (unavailable && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          event.stopPropagation();
        } else onKeyDownCapture?.(event);
      }}
      onClick={(event) => {
        if (unavailable) {
          event.preventDefault();
          event.stopPropagation();
        } else onClick?.(event);
      }}
      onKeyDown={(event) => {
        if (unavailable && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          event.stopPropagation();
        } else onKeyDown?.(event);
      }}
    >
      {children}
    </a>
  );
}
