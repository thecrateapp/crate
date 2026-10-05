import type { ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";

export type PageHeaderSize = "md" | "lg";

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  back?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  id?: string;
  size?: PageHeaderSize;
  className?: string;
}

const TITLE_CLASS_NAME: Record<PageHeaderSize, string> = {
  md: "text-2xl font-bold",
  lg: "text-3xl font-bold",
};

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  back,
  actions,
  children,
  id,
  size = "lg",
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn("flex flex-col gap-4", className)}
      data-testid="page-header"
    >
      {back ? <div className="flex">{back}</div> : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
              {eyebrow}
            </div>
          ) : null}
          <h1
            id={id}
            className={cn(
              "leading-tight text-text-primary",
              TITLE_CLASS_NAME[size],
            )}
          >
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 text-sm text-text-muted">{subtitle}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </header>
  );
}
