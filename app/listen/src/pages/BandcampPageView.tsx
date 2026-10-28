import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Radar, RefreshCw, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { PageHeader } from "@crate/ui/domain/navigation/PageHeader";
import { SectionHeader } from "@crate/ui/domain/lists/SectionHeader";
import { ErrorState, LoadingState } from "@crate/ui/domain/states";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";
import { Button } from "@crate/ui/shadcn/button";

export interface BandcampPageViewProps {
  readState: "ready" | "loading" | "error";
  connected: boolean;
  profileName: string;
  connectionError?: string | null;
  busyAction: string | null;
  totals: { owned: number; wishlist: number; radar: number };
  radar: ReactNode;
  owned: ReactNode;
  wishlist: ReactNode;
  onSync: () => void;
  onRefreshRadar: () => void;
  onRetry: () => void;
}

export function BandcampPageView({
  readState,
  connected,
  profileName,
  connectionError,
  busyAction,
  totals,
  radar,
  owned,
  wishlist,
  onSync,
  onRefreshRadar,
  onRetry,
}: BandcampPageViewProps) {
  const { t } = useTranslation();
  const unavailable =
    readState !== "ready" || !connected || busyAction !== null;
  return (
    <div className="mx-auto grid w-full max-w-content gap-8 sm:py-6">
      <PageHeader
        title={t("bandcamp.title")}
        eyebrow="Bandcamp"
        subtitle={t("bandcamp.subtitle")}
        meta={
          readState === "ready" ? (
            <div className="grid gap-2">
              {connected ? (
                <p className="flex flex-wrap items-baseline gap-2">
                  <MonoLabel as="span" tone="accent">
                    {t("bandcamp.connection.connectedAs")}
                  </MonoLabel>
                  <span>{profileName}</span>
                </p>
              ) : (
                <p className="text-sm text-state-warning-text">
                  {t("bandcamp.connection.notConnected")}
                </p>
              )}
              {connectionError ? (
                <p className="wrap-anywhere text-sm text-state-danger-text">
                  {t("bandcamp.connection.lastError", {
                    error: connectionError,
                  })}
                </p>
              ) : null}
            </div>
          ) : undefined
        }
        actions={
          <>
            <Button
              loading={busyAction === "sync"}
              disabled={unavailable}
              onClick={onSync}
            >
              {busyAction !== "sync" ? (
                <RefreshCw size={CRATE_ICON_SIZE.sm} />
              ) : null}
              {t("bandcamp.actions.sync")}
            </Button>
            <ActionButton
              label={t("bandcamp.actions.refreshRadar")}
              tooltip={t("bandcamp.actions.refreshRadar")}
              loading={busyAction === "radar"}
              disabled={unavailable}
              onClick={onRefreshRadar}
            >
              <Radar />
            </ActionButton>
          </>
        }
      />
      {readState === "loading" ? (
        <LoadingState label={t("common.loadingShort")} />
      ) : readState === "error" ? (
        <ErrorState
          message={t("search.errors.tryAgain")}
          retryLabel={t("common.retry")}
          onRetry={onRetry}
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            {(["owned", "wishlist", "radar"] as const).map((key) => (
              <StatNumber
                key={key}
                value={totals[key]}
                label={t(`bandcamp.stats.${key}`)}
                size="sm"
              />
            ))}
          </div>
          <div className="grid min-w-0 gap-8 xl:grid-cols-[1.1fr_0.9fr]">
            <BandcampSection kind="owned">{owned}</BandcampSection>
            <BandcampSection kind="radar">{radar}</BandcampSection>
          </div>
          <BandcampSection kind="wishlist">{wishlist}</BandcampSection>
        </>
      )}
    </div>
  );
}
function BandcampSection({
  kind,
  children,
}: {
  kind: "radar" | "owned" | "wishlist";
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section
      className="grid min-w-0 content-start gap-4"
      aria-label={t(`bandcamp.rails.${kind}.title`)}
    >
      <SectionHeader
        title={t(`bandcamp.rails.${kind}.title`)}
        subtitle={t(`bandcamp.rails.${kind}.subtitle`)}
      />
      {children}
    </section>
  );
}
