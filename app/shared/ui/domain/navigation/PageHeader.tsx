import { useId, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "@crate/ui/lib/cn";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

export type PageHeaderSize = "md" | "lg";

export interface PageHeaderLayoutProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "header" | "section";
  artwork?: ReactNode;
  actions?: ReactNode;
}

/** Shared positioning for existing rich identities and PageHeader's canonical identity. */
export function PageHeaderLayout({
  as: Tag = "div",
  artwork,
  actions,
  children,
  className,
  ...props
}: PageHeaderLayoutProps) {
  return (
    <Tag
      data-slot="page-header-layout"
      {...props}
      className={cn("@container min-w-0 w-full", className)}
    >
      <div className="flex min-w-0 flex-col gap-5 @2xl:flex-row @2xl:items-start">
        {artwork ? <div className="shrink-0">{artwork}</div> : null}
        <div
          data-slot="page-header-identity"
          className="min-w-0 flex-1 wrap-anywhere"
        >
          {children}
        </div>
        {actions ? (
          <div
            data-slot="header-actions-position"
            className="order-first flex max-w-full flex-wrap items-center gap-2 self-end empty:hidden @2xl:order-none @2xl:self-start"
          >
            {actions}
          </div>
        ) : null}
      </div>
    </Tag>
  );
}

export interface PageHeaderProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  back?: ReactNode;
  artwork?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  size?: PageHeaderSize;
}

const TITLE_CLASS_NAME: Record<PageHeaderSize, string> = {
  md: "text-2xl",
  lg: "text-3xl",
};
const hasContent = (node: ReactNode) =>
  node !== undefined && node !== null && node !== false && node !== "";

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  back,
  artwork,
  meta,
  actions,
  children,
  id,
  size = "lg",
  className,
  ...props
}: PageHeaderProps) {
  const generatedId = useId();
  const titleId = id ?? `${generatedId}-title`;
  const plainEyebrow =
    typeof eyebrow === "string" || typeof eyebrow === "number";
  return (
    <header
      aria-labelledby={titleId}
      {...props}
      className={cn("grid min-w-0 gap-4", className)}
      data-testid="page-header"
    >
      {back ? <div className="flex">{back}</div> : null}
      <PageHeaderLayout artwork={artwork} actions={actions}>
        <div className="grid min-w-0 gap-4">
          {hasContent(eyebrow) && !plainEyebrow ? (
            <div className="flex flex-wrap gap-2">{eyebrow}</div>
          ) : null}
          <div className="grid min-w-0 gap-2">
            {hasContent(eyebrow) && plainEyebrow ? (
              <MonoLabel>{eyebrow}</MonoLabel>
            ) : null}
            <h1
              id={titleId}
              className={cn(
                "min-w-0 wrap-anywhere font-display font-semibold leading-tight tracking-tight text-text-primary",
                TITLE_CLASS_NAME[size],
              )}
            >
              {title}
            </h1>
            {hasContent(subtitle) ? (
              <p className="max-w-3xl font-[family-name:var(--font-brand)] text-sm font-normal leading-6 text-text-muted">
                {subtitle}
              </p>
            ) : null}
          </div>
          {hasContent(meta) ? (
            <div data-slot="page-header-meta" className="grid gap-4">
              {meta}
            </div>
          ) : null}
        </div>
      </PageHeaderLayout>
      {children}
    </header>
  );
}
