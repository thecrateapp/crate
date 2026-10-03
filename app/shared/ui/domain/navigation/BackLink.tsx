import type { MouseEvent } from "react";
import { Link, type To } from "react-router";

import { ArrowLeft, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";

export type BackLinkVariant = "text" | "icon";

export interface BackLinkProps {
  to?: To;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  label?: string;
  variant?: BackLinkVariant;
  replace?: boolean;
  className?: string;
}

const VARIANT_CLASS_NAME: Record<BackLinkVariant, string> = {
  text: "inline-flex items-center gap-2 rounded-sm text-sm text-text-muted transition-colors hover:text-text-primary",
  icon: "relative inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border-quiet text-text-primary/70 transition-colors hover:bg-text-primary/5 hover:text-text-primary after:absolute after:top-1/2 after:left-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 pointer-fine:after:hidden",
};

export function BackLink({
  to,
  onClick,
  label = "Back",
  variant = "text",
  replace,
  className,
}: BackLinkProps) {
  const isIcon = variant === "icon";
  const content = (
    <>
      <ArrowLeft size={CRATE_ICON_SIZE.sm} aria-hidden="true" />
      {isIcon ? null : <span>{label}</span>}
    </>
  );
  const sharedProps = {
    "aria-label": isIcon ? label : undefined,
    title: isIcon ? label : undefined,
    "data-testid": "back-link",
    className: cn(
      "outline-none focus-visible:shadow-focus",
      VARIANT_CLASS_NAME[variant],
      className,
    ),
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
