import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { CrateLogo } from "@crate/ui/domain/brand/CrateLogo";
import { Button } from "@crate/ui/shadcn/button";

import { loginPathWithReturnTo } from "@/lib/auth-route-policy";

export function PublicShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const location = useLocation();
  const loginPath = loginPathWithReturnTo(
    `${location.pathname}${location.search}${location.hash}`,
  );

  return (
    <div
      data-testid="public-shell"
      className="flex min-h-dvh flex-col bg-surface-canvas"
    >
      <header className="z-app-header sticky top-0 border-b border-border-quiet bg-surface-chrome shadow-chrome backdrop-blur-xl pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-16 w-full max-w-content items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            to="/"
            className="flex items-center gap-2.5 rounded-md text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <CrateLogo title="Crate" className="size-8" />
            <span className="text-lg font-black tracking-eyebrow">CRATE</span>
          </Link>
          <Button asChild size="sm">
            <Link to={loginPath}>{t("auth.login")}</Link>
          </Button>
        </div>
      </header>
      <main className="relative flex-1 overflow-x-hidden">
        <div className="mx-auto w-full max-w-content px-4 py-6 sm:px-6">
          {children}
        </div>
      </main>
      <footer className="border-t border-border-quiet pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-content flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-text-muted sm:flex-row sm:px-6">
          <span className="flex items-center gap-2">
            <CrateLogo className="size-5" effects={false} />
            <span className="font-bold text-text-primary">Crate</span>
            <span aria-hidden="true">·</span>
            <span>{t("auth.tagline")}</span>
          </span>
          <Link to={loginPath} className="font-semibold link-accent">
            {t("auth.login")}
          </Link>
        </div>
      </footer>
    </div>
  );
}
