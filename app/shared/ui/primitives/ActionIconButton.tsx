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
    return "h-9 min-h-11 w-9 min-w-11 border border-border-subtle bg-surface-icon-control shadow-icon-control backdrop-blur-md md:min-h-0 md:min-w-0";
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
        "flex items-center justify-center rounded-full outline-none transition-[color,filter,transform,box-shadow] hover:-translate-y-px focus-visible:shadow-focus [&_svg:not([class*='size-'])]:size-[18px]",
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
        "flex items-center justify-center rounded-full outline-none transition-[color,filter,transform,box-shadow] hover:-translate-y-px focus-visible:shadow-focus [&_svg:not([class*='size-'])]:size-[18px]",
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
