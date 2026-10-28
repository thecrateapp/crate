import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, CRATE_ICON_SIZE } from "@crate/ui/icons";
import { ServerSetupView } from "@/components/auth/ServerSetupView";

import {
  addServer,
  isAllowedServerUrl,
  normaliseServerUrl,
  setCurrentServerId,
} from "@/lib/server-store";
import { FIXED_SERVER_URL } from "@/lib/mobile-build-config";

/**
 * First-run setup for Capacitor builds. Lets the user point the app at
 * their Crate instance before anything else can happen.
 *
 * We deliberately don't use the shared `api` client here because that
 * client reads the current server from the store — and at this point
 * the store is empty. Instead we do a plain `fetch` against the probe
 * endpoint, then if it looks like a Crate server we persist it.
 */

type ProbeState =
  | { status: "idle" }
  | { status: "probing" }
  | { status: "ok"; inviteOnly: boolean }
  | { status: "not-crate" }
  | {
      status: "error";
      messageKey?:
        | "serverSetup.errors.connect"
        | "serverSetup.errors.host"
        | "serverSetup.errors.required";
      message?: string;
    };

async function probe(url: string): Promise<ProbeState> {
  try {
    const response = await fetch(`${url}/api/auth/config`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      // Upstream responded but not with 2xx. If it's a 404 the URL is
      // reachable but almost certainly isn't a Crate instance.
      return { status: "not-crate" };
    }
    const data = await response.json();
    if (data == null || typeof data !== "object") {
      return { status: "not-crate" };
    }
    // /api/auth/config returns { invite_only: bool, google: bool, ... }
    // — the presence of the config shape is enough to consider it Crate.
    const hasKnownField =
      "invite_only" in data || "google" in data || "apple" in data;
    if (!hasKnownField) return { status: "not-crate" };
    return {
      status: "ok",
      inviteOnly: Boolean((data as { invite_only?: boolean }).invite_only),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    return {
      status: "error",
      messageKey:
        message === "Load failed" || message === "Failed to fetch"
          ? "serverSetup.errors.connect"
          : message
            ? undefined
            : "serverSetup.errors.host",
      message: message || undefined,
    };
  }
}

export function ServerSetup() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [probeState, setProbeState] = useState<ProbeState>({ status: "idle" });

  if (FIXED_SERVER_URL) {
    return <Navigate to="/login" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const normalised = normaliseServerUrl(url);
    if (!normalised) {
      setProbeState({
        status: "error",
        messageKey: "serverSetup.errors.required",
      });
      return;
    }
    if (
      !isAllowedServerUrl(normalised, {
        allowInsecureLoopback:
          import.meta.env.DEV &&
          import.meta.env.VITE_ALLOW_INSECURE_LOOPBACK === "true",
      })
    ) {
      setProbeState({
        status: "error",
        messageKey: "serverSetup.errors.host",
      });
      return;
    }
    setProbeState({ status: "probing" });
    const result = await probe(normalised);
    setProbeState(result);
    if (result.status === "ok") {
      const server = addServer(normalised);
      setCurrentServerId(server.id);
      // Give the checkmark a beat, then move on.
      window.setTimeout(() => navigate("/login", { replace: true }), 400);
    }
  }

  return (
    <ServerSetupView
      url={url}
      onUrlChange={setUrl}
      busy={probeState.status === "probing"}
      onSubmit={handleSubmit}
      status={<StatusLine state={probeState} />}
    />
  );
}

function StatusLine({ state }: { state: ProbeState }) {
  const { t } = useTranslation();
  if (state.status === "idle" || state.status === "probing") {
    return <div className="h-5" />; // Reserve space so the button doesn't jump
  }
  if (state.status === "ok") {
    return (
      <div className="flex items-center gap-2 text-caption text-state-success-text">
        <CheckCircle2 size={CRATE_ICON_SIZE.xs} />
        {t("serverSetup.status.detected")}
        {state.inviteOnly ? ` ${t("serverSetup.status.inviteOnly")}` : ""}
      </div>
    );
  }
  if (state.status === "not-crate") {
    return (
      <div className="flex items-center gap-2 text-caption text-state-warning-text">
        <AlertCircle size={CRATE_ICON_SIZE.xs} />
        {t("serverSetup.status.notCrate")}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-caption text-state-danger-text">
      <AlertCircle size={CRATE_ICON_SIZE.xs} />
      {state.messageKey ? t(state.messageKey) : state.message}
    </div>
  );
}
