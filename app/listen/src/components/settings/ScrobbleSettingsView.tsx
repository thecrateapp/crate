import { useTranslation } from "react-i18next";
import { EntityRow } from "@crate/ui/domain/entity/EntityRow";
import { ErrorState, LoadingState } from "@crate/ui/domain/states";
import { FormField } from "@crate/ui/primitives/FormField";
import { StatusDot } from "@crate/ui/primitives/StatusDot";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { Section, ToggleRow } from "./SettingsPrimitives";
export interface ScrobbleProviderStatus {
  connected: boolean;
  username?: string;
}
export type ScrobbleStatus = Record<string, ScrobbleProviderStatus>;
export function ScrobbleSettingsView({
  status,
  loading,
  loadError,
  onRetry,
  remoteScrobblingEnabled,
  savingRemotePreference,
  onRemoteChange,
  lbToken,
  onTokenChange,
  connecting,
  nativeLastfmPending,
  isTauriRuntime,
  onLastfmConnect,
  onNativeComplete,
  onNativeCancel,
  onListenBrainzConnect,
  onDisconnect,
}: {
  status: ScrobbleStatus;
  loading: boolean;
  loadError: boolean;
  onRetry: () => void;
  remoteScrobblingEnabled: boolean;
  savingRemotePreference: boolean;
  onRemoteChange: (enabled: boolean) => void;
  lbToken: string;
  onTokenChange: (value: string) => void;
  connecting: string | null;
  nativeLastfmPending: boolean;
  isTauriRuntime: boolean;
  onLastfmConnect: () => void;
  onNativeComplete: () => void;
  onNativeCancel: () => void;
  onListenBrainzConnect: () => void;
  onDisconnect: (provider: string) => void;
}) {
  const { t } = useTranslation();
  const connectionLabel = (provider: ScrobbleProviderStatus | undefined) => (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-2">
      <StatusDot
        tone={provider?.connected ? "on" : "off"}
        label={t(
          provider?.connected ? "common.connected" : "common.notConnected",
        )}
      />
      {provider?.connected && provider.username ? (
        <span data-slot="connected-username" className="wrap-anywhere">
          {provider.username}
        </span>
      ) : null}
    </span>
  );

  return (
    <Section
      title={t("settings.scrobbling.title")}
      description={t("settings.scrobbling.description")}
    >
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
          <ToggleRow
            label={t("settings.scrobbling.remotePlays")}
            description={t("settings.scrobbling.remotePlaysDescription")}
            checked={remoteScrobblingEnabled}
            disabled={savingRemotePreference}
            onChange={onRemoteChange}
          />
          <div className="grid min-w-0 gap-4">
            <EntityRow
              title="Last.fm"
              truncate={false}
              density="compact"
              subtitle={connectionLabel(status.lastfm)}
              trailing={
                status.lastfm?.connected ? (
                  <Button
                    variant="ghost"
                    disabled={connecting !== null}
                    onClick={() => onDisconnect("lastfm")}
                  >
                    {t("common.disconnect")}
                  </Button>
                ) : isTauriRuntime && nativeLastfmPending ? (
                  <>
                    <Button
                      variant="secondary"
                      disabled={connecting !== null}
                      loading={connecting === "lastfm"}
                      onClick={onNativeComplete}
                    >
                      {t("settings.scrobbling.finishConnection")}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={connecting !== null}
                      onClick={onNativeCancel}
                    >
                      {t("common.cancel")}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="secondary"
                    disabled={connecting !== null}
                    loading={connecting === "lastfm"}
                    onClick={onLastfmConnect}
                  >
                    {connecting === "lastfm"
                      ? t("common.connecting")
                      : t("common.connect")}
                  </Button>
                )
              }
            />
            {isTauriRuntime && nativeLastfmPending ? (
              <p aria-live="polite" className="text-caption text-text-muted">
                {t("settings.scrobbling.nativeAuthPending")}
              </p>
            ) : null}
            <EntityRow
              title="ListenBrainz"
              truncate={false}
              density="compact"
              subtitle={connectionLabel(status.listenbrainz)}
              trailing={
                status.listenbrainz?.connected ? (
                  <Button
                    variant="ghost"
                    disabled={connecting !== null}
                    onClick={() => onDisconnect("listenbrainz")}
                  >
                    {t("common.disconnect")}
                  </Button>
                ) : null
              }
            />
            {!status.listenbrainz?.connected ? (
              <form
                aria-label="ListenBrainz"
                className="flex min-w-0 flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (lbToken.trim() && connecting === null)
                    onListenBrainzConnect();
                }}
              >
                <FormField
                  className="min-w-0 flex-1 basis-64"
                  label={t("settings.scrobbling.apiToken")}
                >
                  <Input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={lbToken}
                    disabled={connecting !== null}
                    onChange={(event) => onTokenChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        (event.nativeEvent.isComposing || event.keyCode === 229)
                      )
                        event.preventDefault();
                    }}
                  />
                </FormField>
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={connecting !== null || !lbToken.trim()}
                  loading={connecting === "listenbrainz"}
                >
                  {t("common.connect")}
                </Button>
              </form>
            ) : null}
          </div>
        </>
      )}
    </Section>
  );
}
