import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { notify } from "@crate/ui/lib/notify";

import {
  ScrobbleSettingsView,
  type ScrobbleStatus,
} from "./ScrobbleSettingsView";
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

export function ScrobbleSection() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshAttempt, setRefreshAttempt] = useState(0);
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
    let active = true;
    setLoading(true);
    setLoadError(false);
    void Promise.all([
      api<ScrobbleStatus>("/api/me/scrobble/status"),
      api<{ remote_scrobbling_enabled: boolean }>(
        "/api/me/scrobble/preferences",
      ),
    ])
      .then(([nextStatus, preference]) => {
        if (active) {
          setStatus(nextStatus);
          setRemoteScrobblingEnabled(preference.remote_scrobbling_enabled);
        }
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshAttempt]);

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
    setConnecting("lastfm");
    try {
      await cancelNativeLastfmLink(user?.id);
      setNativeLastfmPending(false);
    } catch {
      notify.error(t("settings.scrobbling.toasts.cancelFailed"));
    } finally {
      setConnecting(null);
    }
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
    setConnecting(provider);
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
    } finally {
      setConnecting(null);
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

  return (
    <ScrobbleSettingsView
      status={status}
      loading={loading}
      loadError={loadError}
      onRetry={() => setRefreshAttempt((attempt) => attempt + 1)}
      remoteScrobblingEnabled={remoteScrobblingEnabled}
      savingRemotePreference={savingRemotePreference}
      onRemoteChange={(enabled) => void updateRemoteScrobbling(enabled)}
      lbToken={lbToken}
      onTokenChange={setLbToken}
      connecting={connecting}
      nativeLastfmPending={nativeLastfmPending}
      isTauriRuntime={isTauriRuntime}
      onLastfmConnect={() => void handleLastfmConnect()}
      onNativeComplete={() => void handleNativeLastfmComplete()}
      onNativeCancel={() => void handleNativeLastfmCancel()}
      onListenBrainzConnect={() => void handleListenBrainzConnect()}
      onDisconnect={(provider) => void handleDisconnect(provider)}
    />
  );
}
