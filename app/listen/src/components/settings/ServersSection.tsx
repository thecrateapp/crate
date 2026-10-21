import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { notify } from "@crate/ui/lib/notify";
import { ServersSettingsView } from "./ServersSettingsView";

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
import { FIXED_SERVER_URL } from "@/lib/mobile-build-config";

/**
 * Settings panel listing configured Crate servers. Only rendered in
 * configurable shells — on web, there's always a single implicit server
 * (the one that served the app) so this UI would be confusing.
 *
 * Switching server resets the session and authenticates against the
 * selected instance. Removing a server revokes its session best-effort.
 */
export function ServersSection() {
  const { t } = useTranslation();
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

  if (!usesConfigurableServer || FIXED_SERVER_URL) return null;

  const handleSwitch = (server: ServerConfig) => {
    if (server.id === currentId) return;
    setCurrentServerId(server.id);
    notify.success(
      t("settings.servers.toasts.switched", { name: server.label }),
    );
  };

  const handleRemove = (server: ServerConfig) => {
    if (server.token) {
      void revokeServerSession(server).catch(() => {
        // Local removal must work when this server is offline.
      });
    }
    removeServer(server.id);
    notify.success(
      t("settings.servers.toasts.removed", { name: server.label }),
    );
  };

  return (
    <ServersSettingsView
      servers={servers.map(({ id, label, url }) => ({ id, label, url }))}
      currentId={currentId}
      onSwitch={(id) => {
        const server = servers.find((item) => item.id === id);
        if (server) handleSwitch(server);
      }}
      onRemove={(id) => {
        const server = servers.find((item) => item.id === id);
        if (server) handleRemove(server);
      }}
      onAdd={() => navigate("/server-setup")}
    />
  );
}
