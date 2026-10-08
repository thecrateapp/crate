import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { notify } from "@crate/ui/lib/notify";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";

import { Section, ToggleRow } from "@/components/settings/SettingsPrimitives";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { AUTH_TOKEN_EVENT } from "@/lib/auth-session";
import {
  beginNativeLastfmLink,
  cancelNativeLastfmLink,
  completeNativeLastfmLink,
  hasPendingNativeLastfmLink,
} from "@/lib/native-lastfm-oauth";
import { isTauriRuntime } from "@/lib/platform";
import { SERVER_STORE_EVENT } from "@/lib/server-store";
import { cn } from "@/lib/utils";

const CONNECT_BUTTON_CLASS_NAME =
  "h-auto bg-accent-action/15 px-4 py-2 text-xs text-accent-action hover:bg-accent-action/25";
const DISCONNECT_BUTTON_CLASS_NAME =
  "h-auto border-0 bg-state-danger/15 px-4 py-2 text-xs text-state-danger hover:bg-state-danger/25";
const CANCEL_BUTTON_CLASS_NAME =
  "h-auto bg-text-primary/5 px-4 py-2 text-xs text-text-muted hover:bg-text-primary/10";

interface ScrobbleProviderStatus {
  connected: boolean;
  username?: string;
}

type ScrobbleStatus = Record<string, ScrobbleProviderStatus>;

export function ScrobbleSection() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [status, setStatus] = useState<ScrobbleStatus>({});
  const [lbToken, setLbToken] = useState("");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [remoteScrobblingEnabled, setRemoteScrobblingEnabled] = useState(false);
  const [savingRemotePreference, setSavingRemotePreference] = useState(false);
  const [nativeLastfmPending, setNativeLastfmPending] = useState(false);

  useEffect(() => {
    let active = true;
    const refreshPending = async () => {
      try {
        const pending =
          isTauriRuntime && (await hasPendingNativeLastfmLink(user?.id));
        if (active) setNativeLastfmPending(pending);
      } catch {
        if (active) setNativeLastfmPending(false);
      }
    };
    void refreshPending();
    const refreshOnSessionChange = () => void refreshPending();
    window.addEventListener(AUTH_TOKEN_EVENT, refreshOnSessionChange);
    window.addEventListener(SERVER_STORE_EVENT, refreshOnSessionChange);
    return () => {
      active = false;
      window.removeEventListener(AUTH_TOKEN_EVENT, refreshOnSessionChange);
      window.removeEventListener(SERVER_STORE_EVENT, refreshOnSessionChange);
    };
  }, [user?.id]);

  useEffect(() => {
    void Promise.allSettled([
      api<ScrobbleStatus>("/api/me/scrobble/status").then(setStatus),
      api<{ remote_scrobbling_enabled: boolean }>(
        "/api/me/scrobble/preferences",
      ).then((preference) =>
        setRemoteScrobblingEnabled(preference.remote_scrobbling_enabled),
      ),
    ]);
  }, []);

  const updateRemoteScrobbling = async (enabled: boolean) => {
    const previous = remoteScrobblingEnabled;
    setRemoteScrobblingEnabled(enabled);
    setSavingRemotePreference(true);
    try {
      const preference = await api<{ remote_scrobbling_enabled: boolean }>(
        "/api/me/scrobble/preferences",
        "PUT",
        { remote_scrobbling_enabled: enabled },
      );
      setRemoteScrobblingEnabled(preference.remote_scrobbling_enabled);
    } catch {
      setRemoteScrobblingEnabled(previous);
      notify.error(t("settings.scrobbling.toasts.preferenceFailed"));
    } finally {
      setSavingRemotePreference(false);
    }
  };

  const handleLastfmConnect = async () => {
    setConnecting("lastfm");
    try {
      if (isTauriRuntime) {
        if (!user) throw new Error("Sign in before linking Last.fm");
        await beginNativeLastfmLink(user.id);
        setNativeLastfmPending(true);
        setConnecting(null);
        notify.info(t("settings.scrobbling.nativeAuthOpened"));
        return;
      }
      const { api_key } = await api<{ api_key: string }>(
        "/api/me/scrobble/lastfm/auth-url",
      );
      const cb = encodeURIComponent(
        `${window.location.origin}/settings?lastfm=callback`,
      );
      window.location.href = `https://www.last.fm/api/auth/?api_key=${api_key}&cb=${cb}`;
    } catch {
      notify.error(
        t(
          isTauriRuntime
            ? "settings.scrobbling.toasts.lastfmConnectFailed"
            : "settings.scrobbling.toasts.lastfmNotConfigured",
        ),
      );
      setConnecting(null);
    }
  };

  const handleNativeLastfmComplete = async () => {
    if (!user) return;
    setConnecting("lastfm");
    try {
      await completeNativeLastfmLink(user.id);
      setNativeLastfmPending(false);
      notify.success(t("settings.scrobbling.toasts.lastfmConnected"));
      void api<ScrobbleStatus>("/api/me/scrobble/status")
        .then(setStatus)
        .catch(() => {});
    } catch {
      notify.error(t("settings.scrobbling.toasts.lastfmConnectFailed"));
    } finally {
      setConnecting(null);
    }
  };

  const handleNativeLastfmCancel = async () => {
    await cancelNativeLastfmLink(user?.id);
    setNativeLastfmPending(false);
  };

  const handleLastfmCallback = useCallback(
    async (token: string) => {
      setConnecting("lastfm");
      try {
        await api("/api/me/scrobble/lastfm", "POST", { token });
        notify.success(t("settings.scrobbling.toasts.lastfmConnected"));
        const updated = await api<ScrobbleStatus>("/api/me/scrobble/status");
        setStatus(updated);
      } catch {
        notify.error(t("settings.scrobbling.toasts.lastfmConnectFailed"));
      } finally {
        setConnecting(null);
      }
    },
    [t],
  );

  const handleListenBrainzConnect = async () => {
    if (!lbToken.trim()) return;
    setConnecting("listenbrainz");
    try {
      const result = await api<{ ok: boolean; username: string }>(
        "/api/me/scrobble/listenbrainz",
        "POST",
        { token: lbToken.trim() },
      );
      notify.success(
        t("settings.scrobbling.toasts.listenbrainzConnected", {
          username: result.username,
        }),
      );
      setLbToken("");
      const updated = await api<ScrobbleStatus>("/api/me/scrobble/status");
      setStatus(updated);
    } catch {
      notify.error(t("settings.scrobbling.toasts.invalidListenbrainzToken"));
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (provider: string) => {
    try {
      await api(`/api/me/scrobble/${provider}`, "DELETE");
      setStatus((previous) => ({
        ...previous,
        [provider]: { connected: false },
      }));
      notify.success(
        t("settings.scrobbling.toasts.disconnected", {
          provider: provider === "lastfm" ? "Last.fm" : "ListenBrainz",
        }),
      );
    } catch {
      notify.error(t("common.toasts.disconnectFailed"));
    }
  };

  useEffect(() => {
    if (isTauriRuntime) return;
    const params = new URLSearchParams(window.location.search);
    const lastfmToken = params.get("token");
    if (params.get("lastfm") === "callback" && lastfmToken) {
      window.history.replaceState({}, "", "/settings");
      void handleLastfmCallback(lastfmToken);
    }
  }, [handleLastfmCallback]);

  const lastfm = status.lastfm;
  const listenbrainz = status.listenbrainz;

  return (
    <Section
      title={t("settings.scrobbling.title")}
      description={t("settings.scrobbling.description")}
    >
      <div className={savingRemotePreference ? "opacity-70" : undefined}>
        <ToggleRow
          label={t("settings.scrobbling.remotePlays")}
          description={t("settings.scrobbling.remotePlaysDescription")}
          checked={remoteScrobblingEnabled}
          onChange={(enabled) => void updateRemoteScrobbling(enabled)}
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">Last.fm</p>
          {lastfm?.connected ? (
            <p className="text-xs text-state-success">
              {lastfm.username
                ? t("settings.scrobbling.connectedAs", {
                    username: lastfm.username,
                  })
                : t("common.connected")}
            </p>
          ) : (
            <p className="text-xs text-text-muted">
              {t("common.notConnected")}
            </p>
          )}
        </div>
        {lastfm?.connected ? (
          <Button
            variant="danger-soft"
            shape="pill"
            onClick={() => handleDisconnect("lastfm")}
            className={DISCONNECT_BUTTON_CLASS_NAME}
          >
            {t("common.disconnect")}
          </Button>
        ) : isTauriRuntime && nativeLastfmPending ? (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              shape="pill"
              onClick={() => void handleNativeLastfmComplete()}
              disabled={connecting === "lastfm"}
              className={CONNECT_BUTTON_CLASS_NAME}
            >
              {connecting === "lastfm"
                ? t("common.connecting")
                : t("settings.scrobbling.finishConnection")}
            </Button>
            <Button
              variant="ghost"
              shape="pill"
              onClick={() => void handleNativeLastfmCancel()}
              disabled={connecting === "lastfm"}
              className={CANCEL_BUTTON_CLASS_NAME}
            >
              {t("settings.scrobbling.cancelConnection")}
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            shape="pill"
            onClick={handleLastfmConnect}
            disabled={connecting === "lastfm"}
            className={CONNECT_BUTTON_CLASS_NAME}
          >
            {connecting === "lastfm"
              ? t("common.connecting")
              : t("common.connect")}
          </Button>
        )}
      </div>

      {isTauriRuntime && nativeLastfmPending ? (
        <p className="text-xs text-text-muted" aria-live="polite">
          {t("settings.scrobbling.nativeAuthPending")}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">ListenBrainz</p>
          {listenbrainz?.connected ? (
            <p className="text-xs text-state-success">
              {listenbrainz.username
                ? t("settings.scrobbling.connectedAs", {
                    username: listenbrainz.username,
                  })
                : t("common.connected")}
            </p>
          ) : (
            <p className="text-xs text-text-muted">
              {t("common.notConnected")}
            </p>
          )}
        </div>
        {listenbrainz?.connected ? (
          <Button
            variant="danger-soft"
            shape="pill"
            onClick={() => handleDisconnect("listenbrainz")}
            className={DISCONNECT_BUTTON_CLASS_NAME}
          >
            {t("common.disconnect")}
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={lbToken}
              onChange={(event) => setLbToken(event.target.value)}
              placeholder={t("settings.scrobbling.apiToken")}
              aria-label={t("settings.scrobbling.apiToken")}
              className="h-9 w-36 rounded-lg border-border-quiet/10 bg-text-primary/5 px-3 py-0 shadow-none backdrop-blur-none focus-visible:border-accent-action/50 md:text-base"
              onKeyDown={(event) => {
                if (
                  !event.nativeEvent.isComposing &&
                  event.nativeEvent.keyCode !== 229 &&
                  event.key === "Enter"
                ) {
                  void handleListenBrainzConnect();
                }
              }}
            />
            <Button
              variant="secondary"
              shape="pill"
              onClick={handleListenBrainzConnect}
              disabled={connecting === "listenbrainz" || !lbToken.trim()}
              className={cn(CONNECT_BUTTON_CLASS_NAME, "h-9 py-0")}
            >
              {connecting === "listenbrainz" ? "..." : t("common.connect")}
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}
