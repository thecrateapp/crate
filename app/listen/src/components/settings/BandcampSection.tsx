import { Link } from "react-router";
import { useTranslation } from "react-i18next";

import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import {
  CRATE_ICON_SIZE,
  Loader2,
  Lock,
  RefreshCw,
  Smartphone,
} from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";
import { Textarea } from "@crate/ui/shadcn/textarea";

import { CrateImage } from "@/components/artwork/CrateImage";
import { Section } from "@/components/settings/SettingsPrimitives";

import type { BandcampCounts, BandcampStatus } from "./bandcamp-types";
import { useBandcampConnection } from "./use-bandcamp-connection";

const PRIMARY_PILL_CLASS_NAME =
  "h-auto px-4 py-2 text-xs font-semibold shadow-none has-[>svg]:px-4 hover:bg-accent-action/90 [&_svg:not([class*='size-'])]:size-3.5";

export function BandcampSection() {
  const { t } = useTranslation();
  const connection = useBandcampConnection();
  const connectedName =
    connection.status?.display_name ||
    connection.status?.username ||
    t("bandcamp.connection.accountFallback");

  return (
    <Section title="Bandcamp" description={t("settings.bandcamp.description")}>
      <BandcampConnectionSummary
        status={connection.status}
        counts={connection.counts}
        busy={connection.busy}
        isTauriRuntime={connection.isTauriRuntime}
        connectedName={connectedName}
        onSync={connection.syncBandcamp}
        onDisconnect={connection.disconnectBandcamp}
      />
      {!connection.status?.connected ? (
        <BandcampConnectInstructions
          isTauriRuntime={connection.isTauriRuntime}
          bandcampCookie={connection.bandcampCookie}
          busy={connection.busy}
          setBandcampCookie={connection.setBandcampCookie}
          onOpenDesktop={connection.openTauriBandcampInterceptor}
          onConnect={connection.connectWithCookie}
        />
      ) : null}
    </Section>
  );
}

function BandcampConnectionSummary({
  status,
  counts,
  busy,
  isTauriRuntime,
  connectedName,
  onSync,
  onDisconnect,
}: {
  status: BandcampStatus | null;
  counts: BandcampCounts;
  busy: string | null;
  isTauriRuntime: boolean;
  connectedName: string;
  onSync: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}) {
  const { t } = useTranslation();

  return (
    <div className="settings-bandcamp-connected rounded-xl p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {status?.image_url ? (
            <CrateImage
              src={status.image_url}
              retryPolicy="none"
              alt=""
              className=" size-11 rounded-full object-cover"
            />
          ) : (
            <div className="flex size-11 items-center justify-center rounded-full bg-text-primary/10 text-accent-action">
              <BandcampLogo size={20} />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-primary">
              {status?.connected ? connectedName : t("common.notConnected")}
            </p>
            <p className="text-xs text-text-muted">
              {status?.connected
                ? t("settings.bandcamp.summary", {
                    collection: counts.collection,
                    wishlist: counts.wishlist,
                    following: counts.following,
                  })
                : isTauriRuntime
                  ? t("settings.bandcamp.connectDesktopHint")
                  : t("settings.bandcamp.connectCookieHint")}
            </p>
          </div>
        </div>
        {status?.connected ? (
          <div className="flex flex-wrap gap-2">
            <Link
              to="/library?tab=bandcamp"
              className="inline-flex items-center gap-2 rounded-full border border-border-quiet/10 px-4 py-2 text-xs font-semibold text-text-primary transition-colors hover:bg-text-primary/10"
            >
              <BandcampLogo size={14} />
              {t("settings.bandcamp.viewPurchases")}
            </Link>
            <Button
              shape="pill"
              onClick={() => void onSync()}
              disabled={busy !== null}
              className={PRIMARY_PILL_CLASS_NAME}
            >
              {busy === "sync" ? (
                <Loader2 size={CRATE_ICON_SIZE.xs} className="animate-spin" />
              ) : (
                <RefreshCw size={CRATE_ICON_SIZE.xs} />
              )}
              {t("bandcamp.actions.sync")}
            </Button>
            <Button
              variant="danger-soft"
              shape="pill"
              onClick={() => void onDisconnect()}
              disabled={busy !== null}
              className="h-auto bg-transparent px-4 py-2 text-xs font-semibold text-state-danger hover:border-state-danger/25 hover:bg-state-danger/10 has-[>svg]:px-4"
            >
              {t("common.disconnect")}
            </Button>
          </div>
        ) : null}
      </div>
      {status?.last_error ? (
        <p className="mt-3 text-xs text-state-danger">{status.last_error}</p>
      ) : null}
    </div>
  );
}

function BandcampConnectInstructions({
  isTauriRuntime,
  bandcampCookie,
  busy,
  setBandcampCookie,
  onOpenDesktop,
  onConnect,
}: {
  isTauriRuntime: boolean;
  bandcampCookie: string;
  busy: string | null;
  setBandcampCookie: (value: string) => void;
  onOpenDesktop: () => Promise<void>;
  onConnect: (
    cookie: string,
    connectionMethod?: "manual_cookie" | "native_desktop",
  ) => Promise<void>;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4 rounded-xl border border-state-warning/20 bg-state-warning/5 p-4">
      {isTauriRuntime ? (
        <div className="space-y-3">
          <div className="flex items-start gap-3 text-xs leading-5 text-state-warning/80">
            <Smartphone
              size={CRATE_ICON_SIZE.sm}
              className="mt-0.5 shrink-0 text-state-warning"
            />
            <p>{t("settings.bandcamp.desktopConnectorDescription")}</p>
          </div>
          <Button
            shape="pill"
            onClick={() => void onOpenDesktop()}
            disabled={busy !== null}
            className={PRIMARY_PILL_CLASS_NAME}
          >
            {busy === "tauri-connect" ? (
              <Loader2 size={CRATE_ICON_SIZE.xs} className="animate-spin" />
            ) : (
              <BandcampLogo size={CRATE_ICON_SIZE.xs} />
            )}
            {t("settings.bandcamp.connectWindow")}
          </Button>
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex items-start gap-3 text-xs leading-5 text-state-warning/80">
          <Lock
            size={CRATE_ICON_SIZE.sm}
            className="mt-0.5 shrink-0 text-state-warning"
          />
          <p>
            {t("settings.bandcamp.cookieInstructionsPrefix")}{" "}
            <span className="font-mono text-state-warning">identity</span>{" "}
            {t("settings.bandcamp.cookieInstructionsFrom")}{" "}
            <span className="font-mono text-state-warning">bandcamp.com</span>.{" "}
            {t("settings.bandcamp.cookieInstructionsSuffix")}{" "}
            <span className="font-mono text-state-warning">Cookie</span>{" "}
            {t("settings.bandcamp.cookieInstructionsHeader")}{" "}
            {t("settings.bandcamp.cookieInstructionsEnd")}
          </p>
        </div>
        <Textarea
          value={bandcampCookie}
          onChange={(event) => setBandcampCookie(event.target.value)}
          rows={3}
          spellCheck={false}
          placeholder={t("settings.bandcamp.cookiePlaceholder")}
          aria-label={t("settings.bandcamp.cookiePlaceholder")}
          className="min-h-0 resize-none rounded-lg border-border-quiet/10 bg-surface-canvas/30 px-3 py-2 font-mono leading-5 shadow-none backdrop-blur-none placeholder:text-text-primary/25 focus-visible:border-accent-action/50 md:text-base"
        />
        <Button
          variant="ghost"
          shape="pill"
          onClick={() => void onConnect(bandcampCookie)}
          disabled={busy !== null || !bandcampCookie.trim()}
          className="h-auto border border-border-quiet/10 px-4 py-2 text-xs font-semibold text-text-primary hover:bg-text-primary/10 [&_svg:not([class*='size-'])]:size-3.5 has-[>svg]:px-4"
        >
          {busy === "cookie-connect" ? (
            <Loader2 size={CRATE_ICON_SIZE.xs} className="animate-spin" />
          ) : (
            <BandcampLogo size={CRATE_ICON_SIZE.xs} />
          )}
          {t("settings.bandcamp.connectWithCookie")}
        </Button>
      </div>
    </div>
  );
}
