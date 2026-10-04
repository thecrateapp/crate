import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  CheckCircle2,
  CRATE_ICON_SIZE,
  Plus,
  Server,
  Trash2,
} from "@crate/ui/icons";
import { notify } from "@crate/ui/lib/notify";
import { IconButton } from "@crate/ui/primitives/IconButton";
import { Button } from "@crate/ui/shadcn/button";

import { usesConfigurableServer } from "@/lib/platform";
import {
  getCurrentServerId,
  getServers,
  removeServer,
  SERVER_STORE_EVENT,
  setCurrentServerId,
  type ServerConfig,
} from "@/lib/server-store";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Settings panel listing configured Crate servers. Only rendered in
 * configurable shells — on web, there's always a single implicit server
 * (the one that served the app) so this UI would be confusing.
 *
 * Switching server drops the app back to the login screen for that
 * instance. Removing the active server clears its token and bounces
 * back to the setup screen if it was the only one.
 */
export function ServersSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [servers, setServers] = useState<ServerConfig[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      setServers(getServers());
      setCurrentId(getCurrentServerId());
    };
    sync();
    window.addEventListener(SERVER_STORE_EVENT, sync);
    return () => window.removeEventListener(SERVER_STORE_EVENT, sync);
  }, []);

  if (!usesConfigurableServer) return null;

  const handleSwitch = async (server: ServerConfig) => {
    if (server.id === currentId) return;
    setCurrentServerId(server.id);
    // Force a full re-auth against the new server. If the stored token
    // is still valid we land back in the app; if not, login screen.
    notify.success(
      t("settings.servers.toasts.switched", { name: server.label }),
    );
    if (server.token) {
      // Reload so all in-flight queries drop and re-hit the new host.
      window.location.href = "/";
    } else {
      navigate("/login", { replace: true });
    }
  };

  const handleRemove = async (server: ServerConfig) => {
    const wasCurrent = server.id === currentId;
    removeServer(server.id);
    notify.success(
      t("settings.servers.toasts.removed", { name: server.label }),
    );
    if (wasCurrent) {
      // Currently-logged-in server was removed. Logout flushes local
      // state and navigates to /login; ServerGate then bounces to
      // /server-setup if there are no remaining servers.
      await logout().catch(() => {});
    }
  };

  return (
    <section className="rounded-panel border border-border-quiet bg-text-primary/[0.03] p-5 sm:p-6">
      <div className="mb-1 flex items-center gap-2">
        <Server size={CRATE_ICON_SIZE.sm} className="text-accent-action" />
        <h2 className="text-sm font-semibold text-text-primary">
          {t("settings.servers.title")}
        </h2>
      </div>
      <p className="mb-4 text-[0.75rem] text-text-muted">
        {t("settings.servers.description")}
      </p>

      <div className="space-y-2">
        {servers.map((server) => {
          const isCurrent = server.id === currentId;
          return (
            <div
              key={server.id}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition ${
                isCurrent
                  ? "border-accent-action/40 bg-accent-action/10"
                  : "border-border-quiet bg-text-primary/[0.03]"
              }`}
            >
              <button
                type="button"
                onClick={() => handleSwitch(server)}
                className="flex-1 text-left"
                disabled={isCurrent}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-medium ${
                      isCurrent ? "text-text-accent" : "text-text-primary"
                    }`}
                  >
                    {server.label}
                  </span>
                  {isCurrent ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-caps text-text-accent">
                      <CheckCircle2 size={CRATE_ICON_SIZE.micro} />
                      {t("settings.servers.current")}
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-text-muted">{server.url}</div>
              </button>
              <IconButton
                tone="danger"
                onClick={() => handleRemove(server)}
                label={t("settings.servers.remove", {
                  name: server.label,
                })}
                className="size-9 rounded-lg border border-border-quiet text-text-muted hover:border-state-danger/40 hover:bg-state-danger/10 hover:text-state-danger-text"
              >
                <Trash2 size={CRATE_ICON_SIZE.xs} className="size-3.5" />
              </IconButton>
            </div>
          );
        })}
      </div>

      <Button
        variant="ghost"
        shape="pill"
        onClick={() => navigate("/server-setup")}
        className="mt-4 h-auto border border-text-primary/15 bg-text-primary/5 px-4 py-2 text-text-primary/80 hover:border-accent-action/30 hover:bg-accent-action/10 hover:text-text-accent has-[>svg]:px-4"
      >
        <Plus size={CRATE_ICON_SIZE.xs} className="size-3.5" />
        {t("settings.servers.add")}
      </Button>
    </section>
  );
}
