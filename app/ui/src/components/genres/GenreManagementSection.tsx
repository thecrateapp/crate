import type { ReactNode } from "react";

import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

interface GenreManagementSectionProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function GenreManagementSection({
  title,
  description,
  actions,
  children,
}: GenreManagementSectionProps) {
  return (
    <section className="min-w-0 border-t border-border-quiet pt-5 first:border-t-0 first:pt-0">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <MonoLabel as="h3" tone="accent" size="eyebrow">
            {title}
          </MonoLabel>
          {description ? (
            <p className="m-0 mt-1.5 max-w-3xl text-sm leading-5 text-text-muted">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        ) : null}
      </header>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  );
}
