import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import { ArrowRight, Loader2 } from "@crate/ui/icons";

import { cn } from "@/lib/utils";

export function getHomeGreeting(t: TFunction): string {
  const hour = new Date().getHours();
  if (hour < 12) return t("home.greeting.morning");
  if (hour < 18) return t("home.greeting.afternoon");
  return t("home.greeting.evening");
}

export function getHomeDateString(locale: string): string {
  return new Date().toLocaleDateString(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function SectionHeader({
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-text-primary">{title}</h2>
        {subtitle ? (
          <p className="mt-1 line-clamp-2 text-sm text-text-muted">
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actionLabel && onAction ? (
          <button
            onClick={onAction}
            className="inline-flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-primary"
          >
            {actionLabel}
            <ArrowRight size={15} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function SectionRail({
  children,
  className,
  fit = "content",
}: {
  children: ReactNode;
  className?: string;
  fit?: "content" | "square-card";
}) {
  const squareFitClassName =
    "grid grid-flow-col auto-cols-[var(--content-rail-column-2)] sm:auto-cols-[var(--content-rail-column-3)] md:auto-cols-[var(--content-rail-column-4)] lg:auto-cols-[var(--content-rail-column-5)] xl:auto-cols-[var(--content-rail-column-6)] 2xl:auto-cols-[var(--content-rail-column-7)]";

  return (
    <div
      data-rail-fit={fit}
      className={cn(
        "hide-rail-scrollbar snap-x snap-mandatory scroll-px-4 gap-[var(--content-rail-gap)] overflow-x-auto overflow-y-hidden pb-2 transform-gpu will-change-scroll",
        fit === "square-card" ? squareFitClassName : "flex",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionLoading() {
  return (
    <div className="flex items-center justify-center py-10">
      <Loader2 size={20} className="animate-spin text-accent-action" />
    </div>
  );
}
