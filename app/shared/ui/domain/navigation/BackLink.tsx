import type { HTMLAttributes, MouseEvent } from "react";
import { Link, type To } from "react-router";

import { ArrowLeft, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";

export type BackLinkVariant = "text" | "icon";

export interface BackLinkProps
  extends Omit<HTMLAttributes<HTMLElement>, "onClick"> {
  to?: To;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  label?: string;
  variant?: BackLinkVariant;
  replace?: boolean;
  className?: string;
}

const VARIANT_CLASS_NAME: Record<BackLinkVariant, string> = {
  text: "link-meta inline-flex min-h-11 items-center gap-2 text-sm font-normal",
  icon: "relative inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border-quiet text-text-primary/70 transition-colors hover:bg-text-primary/5 hover:text-text-primary pointer-coarse:size-11",
};

export function BackLink({
  to,
  onClick,
  label = "Back",
  variant = "text",
  replace,
  className,
  ...props
}: BackLinkProps) {
  const isIcon = variant === "icon";
  const content = (
    <>
      <ArrowLeft size={CRATE_ICON_SIZE.sm} aria-hidden="true" />
      {isIcon ? null : <span>{label}</span>}
    </>
  );
  const sharedProps = {
    ...props,
    "aria-label": isIcon ? label : props["aria-label"],
    title: props.title ?? (isIcon ? label : undefined),
    "data-testid": "back-link",
    className: cn(VARIANT_CLASS_NAME[variant], className),
  };

  if (to !== undefined) {
    return (
      <Link {...sharedProps} to={to} replace={replace} onClick={onClick}>
        {content}
      </Link>
    );
  }

  return (
    <button {...sharedProps} type="button" onClick={onClick}>
      {content}
    </button>
  );
}
