import type { ComponentProps } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { EntityAvatar } from "@crate/ui/domain/entity/EntityAvatar";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import { ErrorState, LoadingState } from "@crate/ui/domain/states";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { FormField } from "@crate/ui/primitives/FormField";
import { CRATE_ICON_SIZE, RefreshCw } from "@crate/ui/icons";
import { Button } from "@crate/ui/shadcn/button";
import { Textarea } from "@crate/ui/shadcn/textarea";
import { Section } from "./SettingsPrimitives";
import type { BandcampCounts, BandcampStatus } from "./bandcamp-types";
export function BandcampSettingsView({
  status,
  counts,
  busy,
  loading,
  loadError,
  onRetry,
  isTauriRuntime,
  bandcampCookie,
  setBandcampCookie,
  onSync,
  onDisconnect,
  onOpenDesktop,
  onConnect,
  countsError = false,
  loadingCounts = false,
  onRetryCounts,
  renderImage,
}: {
  renderImage?: ComponentProps<typeof EntityAvatar>["renderImage"];
  countsError?: boolean;
  loadingCounts?: boolean;
  onRetryCounts?: () => void;
  status: BandcampStatus | null;
  counts: BandcampCounts | null;
  busy: string | null;
  loading: boolean;
  loadError: boolean;
  onRetry: () => void;
  isTauriRuntime: boolean;
  bandcampCookie: string;
  setBandcampCookie: (value: string) => void;
  onSync: () => void;
  onDisconnect: () => void;
  onOpenDesktop: () => void;
  onConnect: (cookie: string) => void;
}) {
  const { t } = useTranslation();
  const connectedName =
    status?.display_name ||
    status?.username ||
    t("bandcamp.connection.accountFallback");
  return (
    <Section title="Bandcamp" description={t("settings.bandcamp.description")}>
      {loading ? (
        <LoadingState label={t("common.loadingShort")} />
      ) : loadError ? (
        <ErrorState
          message={t("settings.readError")}
          onRetry={onRetry}
          retryLabel={t("common.retry")}
        />
      ) : (
        <>
          <EntityRow
            title={status?.connected ? connectedName : "Bandcamp"}
            truncate={false}
            density="compact"
            leading={
              status?.image_url ? (
                <EntityAvatar
                  src={status.image_url}
                  alt=""
                  name={connectedName}
                  renderImage={renderImage}
                />
              ) : (
                <BandcampLogo size={CRATE_ICON_SIZE.md} aria-hidden="true" />
              )
            }
            subtitle={
              <StatusDot
                tone={status?.connected ? "on" : "off"}
                label={t(
                  status?.connected
                    ? "common.connected"
                    : "common.notConnected",
                )}
              />
            }
            meta={
              status?.connected && counts ? (
                <MonoLabel as="span">
                  {t("settings.bandcamp.summary", {
                    collection: counts.collection,
                    wishlist: counts.wishlist,
                    following: counts.following,
                  })}
                </MonoLabel>
              ) : undefined
            }
          />
          {status?.connected && countsError ? (
            <ErrorState
              message={t("settings.bandcamp.countsError")}
              action={
                <Button
                  variant="ghost"
                  loading={loadingCounts}
                  onClick={onRetryCounts ?? onRetry}
                >
                  {t("common.retry")}
                </Button>
              }
            />
          ) : null}
          {status?.last_error ? (
            <p
              role="alert"
              className="text-caption text-state-danger-text wrap-anywhere"
            >
              {status.last_error}
            </p>
          ) : null}
          {status?.connected ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link to="/library?tab=bandcamp">
                  {t("settings.bandcamp.viewPurchases")}
                </Link>
              </Button>
              <Button
                variant="secondary"
                disabled={busy !== null}
                loading={busy === "sync"}
                onClick={onSync}
              >
                {busy !== "sync" ? (
                  <RefreshCw size={CRATE_ICON_SIZE.sm} aria-hidden="true" />
                ) : null}
                {t("bandcamp.actions.sync")}
              </Button>
              <Button
                variant="ghost"
                disabled={busy !== null}
                loading={busy === "disconnect"}
                onClick={onDisconnect}
              >
                {t("common.disconnect")}
              </Button>
            </div>
          ) : (
            <div className="grid min-w-0 gap-5">
              {isTauriRuntime ? (
                <div className="grid justify-items-start gap-3">
                  <p className="text-caption text-text-muted">
                    {t("settings.bandcamp.desktopConnectorDescription")}
                  </p>
                  <Button
                    loading={busy === "tauri-connect"}
                    disabled={busy !== null}
                    onClick={onOpenDesktop}
                  >
                    <BandcampLogo
                      size={CRATE_ICON_SIZE.sm}
                      aria-hidden="true"
                    />
                    {t("settings.bandcamp.connectWindow")}
                  </Button>
                </div>
              ) : null}
              <form
                className="grid min-w-0 justify-items-start gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!busy && bandcampCookie.trim()) onConnect(bandcampCookie);
                }}
              >
                <FormField
                  className="w-full"
                  label={t("settings.bandcamp.cookieLabel")}
                  hint={
                    <>
                      {t("settings.bandcamp.cookieInstructionsPrefix")}{" "}
                      <code>identity</code>{" "}
                      {t("settings.bandcamp.cookieInstructionsFrom")}{" "}
                      <code>bandcamp.com</code>.{" "}
                      {t("settings.bandcamp.cookieInstructionsSuffix")}{" "}
                      <code>Cookie</code>{" "}
                      {t("settings.bandcamp.cookieInstructionsHeader")}{" "}
                      {t("settings.bandcamp.cookieInstructionsEnd")}
                    </>
                  }
                >
                  <Textarea
                    value={bandcampCookie}
                    onChange={(event) => setBandcampCookie(event.target.value)}
                    rows={3}
                    spellCheck={false}
                    autoComplete="off"
                    disabled={busy !== null}
                    placeholder={t("settings.bandcamp.cookiePlaceholder")}
                  />
                </FormField>
                <Button
                  type="submit"
                  variant="secondary"
                  loading={busy === "cookie-connect"}
                  disabled={busy !== null || !bandcampCookie.trim()}
                >
                  {t("settings.bandcamp.connectWithCookie")}
                </Button>
              </form>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
