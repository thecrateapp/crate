import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Plus, Trash2, Server, CheckCircle2 } from "@crate/ui/icons";
import { toast } from "sonner";

import { usesConfigurableServer } from "@/lib/platform";
import { revokeServerSession } from "@/lib/api";
import {
  getCurrentServerId,
  getServers,
  removeServer,
  SERVER_STORE_EVENT,
  setCurrentServerId,
  type ServerConfig,
} from "@/lib/server-store";

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
  const navigate = useNavigate();
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

  const handleSwitch = (server: ServerConfig) => {
    if (server.id === currentId) return;
    setCurrentServerId(server.id);
    toast.success(`Switched to ${server.label}`);
  };

  const handleRemove = (server: ServerConfig) => {
    if (server.token) {
      void revokeServerSession(server).catch(() => {
        // Local removal must work when this server is offline.
      });
    }
    removeServer(server.id);
    toast.success(`Removed ${server.label}`);
  };

  return (
    <section className="rounded-[12px] border border-border-quiet bg-text-primary/[0.03] p-5 sm:p-6">
      <div className="mb-1 flex items-center gap-2">
        <Server size={16} className="text-accent-action" />
        <h2 className="text-sm font-semibold text-text-primary">Servers</h2>
      </div>
      <p className="mb-4 text-[0.75rem] text-text-muted">
        Crate servers this app can talk to. Switching resets the session and
        authenticates against the selected server.
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
                    <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.14em] text-text-accent">
                      <CheckCircle2 size={10} />
                      Current
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-text-muted">{server.url}</div>
              </button>
              <button
                type="button"
                onClick={() => handleRemove(server)}
                aria-label={`Remove ${server.label}`}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border-quiet text-text-muted transition hover:border-state-danger/40 hover:bg-state-danger/10 hover:text-state-danger-text"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => navigate("/server-setup")}
        className="mt-4 inline-flex items-center gap-2 rounded-full border border-text-primary/15 bg-text-primary/5 px-4 py-2 text-sm font-medium text-text-primary/80 transition hover:border-accent-action/30 hover:bg-accent-action/10 hover:text-text-accent"
      >
        <Plus size={14} />
        Add another server
      </button>
    </section>
  );
}
