import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { Loader2, Lock, RefreshCw, Smartphone } from "@crate/ui/icons";

import { CrateImage } from "@/components/artwork/CrateImage";
import { Section } from "@/components/settings/SettingsPrimitives";
import { api } from "@/lib/api";
import { isTauriRuntime } from "@/lib/platform";

interface BandcampStatus {
  connected: boolean;
  status: string;
  bridge_enabled: boolean;
  bridge_ready?: boolean;
  bridge_backend?: string | null;
  bridge_message?: string | null;
  username?: string | null;
  display_name?: string | null;
  image_url?: string | null;
  last_sync_at?: string | null;
  last_error?: string | null;
}

interface BandcampTaskResponse {
  task_id: string;
  status: string;
}

interface BandcampTaskDetail {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | string;
  error?: string | null;
  result?: {
    synced?: number;
    imports_queued?: number;
    imports_skipped_existing?: number;
    counts?: Record<string, number>;
    matches_created?: number;
    radar_upserted?: number;
  } | null;
}

interface BandcampCookieEventPayload {
  cookie?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function BandcampSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BandcampStatus | null>(null);
  const [counts, setCounts] = useState({
    collection: 0,
    wishlist: 0,
    following: 0,
  });
  const [bandcampCookie, setBandcampCookie] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const loadBandcamp = useCallback(async () => {
    const nextStatus = await api<BandcampStatus>("/api/bandcamp/me/status");
    setStatus(nextStatus);
    if (!nextStatus.connected) {
      setCounts({ collection: 0, wishlist: 0, following: 0 });
      return;
    }
    const [collection, wishlist, following] = await Promise.all([
      api<{ total: number }>("/api/bandcamp/me/collection").catch(() => ({
        total: 0,
      })),
      api<{ total: number }>("/api/bandcamp/me/wishlist").catch(() => ({
        total: 0,
      })),
      api<{ total: number }>("/api/bandcamp/me/following").catch(() => ({
        total: 0,
      })),
    ]);
    setCounts({
      collection: collection.total || 0,
      wishlist: wishlist.total || 0,
      following: following.total || 0,
    });
  }, []);

  const connectWithCookie = useCallback(
    async (
      cookie: string,
      connectionMethod: "manual_cookie" | "native_desktop" = "manual_cookie",
    ) => {
      const trimmedCookie = cookie.trim();
      if (!trimmedCookie) {
        toast.error(t("settings.bandcamp.toasts.cookieRequired"));
        return;
      }
      setBusy(
        connectionMethod === "native_desktop"
          ? "tauri-connect"
          : "cookie-connect",
      );
      try {
        await api<BandcampStatus>("/api/bandcamp/me/connect/cookie", "POST", {
          cookie: trimmedCookie,
          connection_method: connectionMethod,
        });
        toast.success(t("settings.bandcamp.toasts.connected"));
        setBandcampCookie("");
        await loadBandcamp();
      } catch (error) {
        toast.error(
          (error as Error).message ||
            t("settings.bandcamp.toasts.connectFailed"),
        );
      } finally {
        setBusy(null);
      }
    },
    [loadBandcamp],
  );

  useEffect(() => {
    loadBandcamp().catch(() => {});
  }, [loadBandcamp]);

  useEffect(() => {
    if (!isTauriRuntime) return;

    const handleBandcampCookie = (event: Event) => {
      const payload = (event as CustomEvent<BandcampCookieEventPayload>).detail;
      if (!payload?.cookie) return;
      void connectWithCookie(payload.cookie, "native_desktop");
    };

    window.addEventListener("crate:bandcamp-cookie", handleBandcampCookie);
    return () => {
      window.removeEventListener("crate:bandcamp-cookie", handleBandcampCookie);
    };
  }, [connectWithCookie]);

  const openTauriBandcampInterceptor = async () => {
    if (!window.__crateTauriInvoke) {
      toast.error(t("settings.bandcamp.toasts.desktopUnavailable"));
      return;
    }
    setBusy("tauri-connect");
    try {
      await window.__crateTauriInvoke("open_bandcamp_cookie_interceptor");
      toast.info(t("settings.bandcamp.toasts.finishLogin"));
      window.setTimeout(
        () => {
          setBusy((current) => (current === "tauri-connect" ? null : current));
        },
        5 * 60 * 1000,
      );
    } catch (error) {
      toast.error(
        (error as Error).message ||
          t("settings.bandcamp.toasts.openLoginFailed"),
      );
      setBusy(null);
    }
  };

  const syncBandcamp = async () => {
    setBusy("sync");
    try {
      const result = await api<BandcampTaskResponse>(
        "/api/bandcamp/me/sync",
        "POST",
      );
      toast.success(t("settings.bandcamp.toasts.syncStarted"));
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await delay(1500);
        const task = await api<BandcampTaskDetail>(
          `/api/tasks/${encodeURIComponent(result.task_id)}`,
        );
        if (task.status === "completed") {
          await loadBandcamp();
          const synced = task.result?.synced;
          const importsQueued = task.result?.imports_queued ?? 0;
          const skippedExisting = task.result?.imports_skipped_existing ?? 0;
          const suffix = [
            synced != null
              ? t("settings.bandcamp.syncSummary.synced", { count: synced })
              : null,
            importsQueued
              ? t("settings.bandcamp.syncSummary.importsQueued", {
                  count: importsQueued,
                })
              : null,
            skippedExisting
              ? t("settings.bandcamp.syncSummary.alreadyInCrate", {
                  count: skippedExisting,
                })
              : null,
          ]
            .filter(Boolean)
            .join(", ");
          toast.success(
            suffix
              ? t("settings.bandcamp.toasts.syncCompleteWithSummary", {
                  summary: suffix,
                })
              : t("settings.bandcamp.toasts.syncComplete"),
          );
          return;
        }
        if (task.status === "failed" || task.status === "cancelled") {
          toast.error(task.error || t("settings.bandcamp.toasts.syncFailed"));
          return;
        }
      }
      toast.info(t("settings.bandcamp.toasts.syncBackground"));
    } catch (error) {
      toast.error(
        (error as Error).message || t("settings.bandcamp.toasts.syncFailed"),
      );
    } finally {
      setBusy(null);
    }
  };

  const disconnectBandcamp = async () => {
    setBusy("disconnect");
    try {
      await api("/api/bandcamp/me/disconnect", "POST");
      toast.success(t("settings.bandcamp.toasts.disconnected"));
      await loadBandcamp();
    } catch (error) {
      toast.error(
        (error as Error).message ||
          t("settings.bandcamp.toasts.disconnectFailed"),
      );
    } finally {
      setBusy(null);
    }
  };

  const connectedName =
    status?.display_name ||
    status?.username ||
    t("bandcamp.connection.accountFallback");

  return (
    <Section title="Bandcamp" description={t("settings.bandcamp.description")}>
      <div className="settings-bandcamp-connected rounded-xl p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {status?.image_url ? (
              <CrateImage
                src={status.image_url}
                retryPolicy="none"
                alt=""
                className="h-11 w-11 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-text-primary/10 text-accent-action">
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
              <button
                onClick={syncBandcamp}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-full bg-accent-action px-4 py-2 text-xs font-semibold text-accent-action-foreground transition-colors hover:bg-accent-action/90 disabled:opacity-50"
              >
                {busy === "sync" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                {t("bandcamp.actions.sync")}
              </button>
              <button
                onClick={disconnectBandcamp}
                disabled={busy !== null}
                className="rounded-full border border-state-danger/25 px-4 py-2 text-xs font-semibold text-state-danger transition-colors hover:bg-state-danger/10 disabled:opacity-50"
              >
                {t("common.disconnect")}
              </button>
            </div>
          ) : null}
        </div>
        {status?.last_error ? (
          <p className="mt-3 text-xs text-state-danger">{status.last_error}</p>
        ) : null}
      </div>

      {!status?.connected ? (
        <div className="space-y-4 rounded-xl border border-state-warning/20 bg-state-warning/5 p-4">
          {isTauriRuntime ? (
            <div className="space-y-3">
              <div className="flex items-start gap-3 text-xs leading-5 text-state-warning/80">
                <Smartphone
                  size={16}
                  className="mt-0.5 shrink-0 text-state-warning"
                />
                <p>{t("settings.bandcamp.desktopConnectorDescription")}</p>
              </div>
              <button
                onClick={openTauriBandcampInterceptor}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-full bg-accent-action px-4 py-2 text-xs font-semibold text-accent-action-foreground transition-colors hover:bg-accent-action/90 disabled:opacity-50"
              >
                {busy === "tauri-connect" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <BandcampLogo size={14} />
                )}
                {t("settings.bandcamp.connectWindow")}
              </button>
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="flex items-start gap-3 text-xs leading-5 text-state-warning/80">
              <Lock size={16} className="mt-0.5 shrink-0 text-state-warning" />
              <p>
                {t("settings.bandcamp.cookieInstructionsPrefix")}{" "}
                <span className="font-mono text-state-warning">identity</span>{" "}
                {t("settings.bandcamp.cookieInstructionsFrom")}{" "}
                <span className="font-mono text-state-warning">
                  bandcamp.com
                </span>
                .{t("settings.bandcamp.cookieInstructionsSuffix")}{" "}
                <span className="font-mono text-state-warning">Cookie</span>{" "}
                {t("settings.bandcamp.cookieInstructionsHeader")}{" "}
                {t("settings.bandcamp.cookieInstructionsEnd")}
              </p>
            </div>
            <textarea
              value={bandcampCookie}
              onChange={(event) => setBandcampCookie(event.target.value)}
              rows={3}
              spellCheck={false}
              placeholder={t("settings.bandcamp.cookiePlaceholder")}
              className="w-full resize-none rounded-lg border border-border-quiet/10 bg-surface-canvas/30 px-3 py-2 font-mono text-xs leading-5 text-text-primary outline-none transition-colors placeholder:text-text-primary/25 focus:border-accent-action/50"
            />
            <button
              onClick={() => void connectWithCookie(bandcampCookie)}
              disabled={busy !== null || !bandcampCookie.trim()}
              className="inline-flex items-center gap-2 rounded-full border border-border-quiet/10 px-4 py-2 text-xs font-semibold text-text-primary transition-colors hover:bg-text-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "cookie-connect" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <BandcampLogo size={14} />
              )}
              {t("settings.bandcamp.connectWithCookie")}
            </button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
