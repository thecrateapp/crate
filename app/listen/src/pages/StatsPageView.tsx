import type { ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@crate/ui/domain/navigation";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";
import { EmptyState, ErrorState, LoadingState } from "@crate/ui/domain/states";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Card } from "@crate/ui/shadcn/card";
import { CardSkeleton } from "@crate/ui/composites/CardSkeleton";
import { TableSkeleton } from "@crate/ui/composites/TableSkeleton";

export function StatsHeaderView({
  title,
  scope,
  kicker,
  profileHref,
  period,
  freshness,
}: {
  title: ReactNode;
  scope: "personal" | "global" | "user";
  kicker: string;
  profileHref?: string;
  period: ReactNode;
  freshness?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid min-w-0 gap-3">
      <PageHeader
        title={title}
        eyebrow={
          <nav
            aria-label={t("stats.window.label")}
            className="flex flex-wrap items-center gap-4"
          >
            {scope === "user" ? (
              <>
                <MonoLabel as="span" tone="accent">
                  {kicker}
                </MonoLabel>
                {profileHref ? (
                  <Link to={profileHref}>
                    <MonoLabel as="span">
                      {t("stats.scope.backToProfile")}
                    </MonoLabel>
                  </Link>
                ) : null}
              </>
            ) : (
              <>
                <Link
                  to="/stats"
                  aria-current={scope === "personal" ? "page" : undefined}
                >
                  <MonoLabel
                    as="span"
                    tone={scope === "personal" ? "accent" : "subtle"}
                  >
                    {t("stats.scope.yourDna")}
                  </MonoLabel>
                </Link>
                <Link
                  to="/stats/global"
                  aria-current={scope === "global" ? "page" : undefined}
                >
                  <MonoLabel
                    as="span"
                    tone={scope === "global" ? "accent" : "subtle"}
                  >
                    {t("stats.scope.cratePulse")}
                  </MonoLabel>
                </Link>
              </>
            )}
          </nav>
        }
        actions={period}
      />
      {freshness}
    </div>
  );
}

export function StatsPageView({
  header,
  readState,
  empty,
  onRetry,
  children,
}: {
  header: ReactNode;
  readState: "ready" | "loading" | "error";
  empty: boolean;
  onRetry: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid min-w-0 gap-8 pb-12">
      {header}
      {readState === "error" ? (
        <ErrorState
          message={t("search.errors.tryAgain")}
          retryLabel={t("common.retry")}
          onRetry={onRetry}
        />
      ) : readState === "loading" ? (
        <LoadingState label={t("common.loadingShort")}>
          <div className="grid min-w-0 gap-8">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <CardSkeleton key={index} />
              ))}
            </div>
            <div className="grid gap-5 xl:grid-cols-2">
              <TableSkeleton rows={4} columns={3} />
              <TableSkeleton rows={4} columns={2} />
            </div>
          </div>
        </LoadingState>
      ) : empty ? (
        <EmptyState
          variant="dashed"
          titleAs="h2"
          title={t("stats.empty.title")}
          description={t("stats.empty.body")}
        />
      ) : (
        children
      )}
    </div>
  );
}

export function StatsPanel({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card
      as="section"
      className={
        className ? `min-w-0 gap-4 p-5 ${className}` : "min-w-0 gap-4 p-5"
      }
    >
      <SectionHeader title={title} subtitle={subtitle} />
      {children}
    </Card>
  );
}

/** Layout only: the Digging entry card and the Replay card sit side by side as siblings. */
export function StatsActionBandView({
  diggingAction,
  replay,
}: {
  /** Opens Crate Digging; omitted when Digging is unavailable. */
  diggingAction?: ReactNode;
  /** A self-contained card (StatsReplayCard); never wrapped in another card. */
  replay?: ReactNode;
}) {
  const { t } = useTranslation();
  if (!diggingAction && !replay) return null;
  return (
    <section
      className={
        diggingAction && replay
          ? "grid min-w-0 gap-4 lg:grid-cols-2"
          : "grid min-w-0 gap-4"
      }
    >
      {diggingAction ? (
        <Card className="gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <SectionHeader
            title={t("stats.digging.band.title")}
            subtitle={t("stats.digging.band.body")}
          />
          <div className="flex flex-wrap gap-2 *:grow sm:*:grow-0">
            {diggingAction}
          </div>
        </Card>
      ) : null}
      {replay}
    </section>
  );
}

export function StatsEditorialStack({
  artist,
  highlights,
}: {
  artist?: ReactNode;
  highlights?: ReactNode;
}) {
  if (!artist && !highlights) return null;
  return (
    <div className="grid min-w-0 gap-4">
      {artist}
      {highlights}
    </div>
  );
}
/** The Listening section: the full-width heatmap band, then the profile cards. */
export function StatsListeningView({
  band,
  children,
}: {
  /** ListeningHeatmap; spans the section's full width. */
  band?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section id="listening" className="grid min-w-0 gap-4">
      <SectionHeader title={t("stats.listening.title")} />
      {band}
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">{children}</div>
    </section>
  );
}

/** Rankings stack at the page width: fixed track metadata must not compete
 * with artist posters for a half-width card. Used by the live page and review. */
export function StatsRankings({ children }: { children: ReactNode }) {
  return (
    <div data-slot="stats-rankings" className="grid min-w-0 gap-5">
      {children}
    </div>
  );
}
