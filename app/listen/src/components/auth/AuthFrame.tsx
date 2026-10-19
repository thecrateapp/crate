import type { ReactNode } from "react";
import { CrateLogo } from "@crate/ui/domain/brand/CrateLogo";

/** Access chrome only; sessions, server selection and callbacks belong to the pages. */
export function AuthFrame({
  title,
  subtitle,
  children,
  embedded = false,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  embedded?: boolean;
}) {
  return (
    <div
      data-slot="auth-frame"
      className={`flex items-center justify-center bg-surface-canvas px-4 py-10 ${embedded ? "" : "min-h-dvh"}`}
    >
      <div className="grid w-full max-w-sm gap-6">
        <header className="grid justify-items-center gap-3 text-center">
          <CrateLogo title="Crate" className="size-14" />
          <h1 className="font-display text-3xl font-bold tracking-tight text-text-primary">
            {title}
          </h1>
          <p className="text-sm text-text-muted">{subtitle}</p>
        </header>
        {children}
      </div>
    </div>
  );
}
