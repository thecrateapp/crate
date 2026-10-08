import type { ReactNode } from "react";
import { Link } from "react-router";

import type { EntityPrimaryActionProps } from "./types";

export function EntityPrimaryAction({
  onOpen,
  href,
  external = false,
  openLabel,
  disabled = false,
  current = false,
  className,
  children,
}: EntityPrimaryActionProps & {
  disabled?: boolean;
  current?: boolean;
  className: string;
  children: ReactNode;
}) {
  const shared = {
    "aria-label": openLabel,
    "aria-current": current ? ("true" as const) : undefined,
    className,
  };

  if (href && !disabled) {
    if (external) {
      return (
        <a
          {...shared}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onOpen}
          data-slot="entity-primary"
        >
          {children}
        </a>
      );
    }
    return (
      <Link {...shared} to={href} onClick={onOpen} data-slot="entity-primary">
        {children}
      </Link>
    );
  }

  if (onOpen || href) {
    return (
      <button
        {...shared}
        type="button"
        disabled={disabled}
        onClick={onOpen}
        data-slot="entity-primary"
      >
        {children}
      </button>
    );
  }

  return (
    <div className={className} data-slot="entity-primary">
      {children}
    </div>
  );
}
