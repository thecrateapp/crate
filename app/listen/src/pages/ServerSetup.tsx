import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import {
  Loader2,
  ArrowRight,
  Server,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

import {
  addServer,
  normaliseServerUrl,
  setCurrentServerId,
} from "@/lib/server-store";

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
  | { status: "error"; message: string };

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
      message:
        message === "Load failed" || message === "Failed to fetch"
          ? "Could not connect. Check the URL and try again."
          : message || "Could not reach that host",
    };
  }
}

export function ServerSetup() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [probeState, setProbeState] = useState<ProbeState>({ status: "idle" });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const normalised = normaliseServerUrl(url);
    if (!normalised) {
      setProbeState({ status: "error", message: "Enter a server URL" });
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#08090d] px-6 py-10 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(6,182,212,0.18),transparent_34%),radial-gradient(circle_at_12%_70%,rgba(20,184,166,0.08),transparent_28%)]" />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-[560px] rounded-[26px] border border-white/10 bg-[#101118]/90 p-8 shadow-[0_28px_90px_-45px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:p-10"
      >
        <div className="flex flex-col items-center text-center">
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-[24px] border border-cyan-300/20 bg-cyan-300/10 shadow-[0_0_50px_-24px_rgba(34,211,238,0.9)]">
            <img src="/icons/logo.svg" alt="Crate" className="h-14 w-14" />
          </div>
          <h1 className="text-balance text-3xl font-bold tracking-[-0.04em] text-white sm:text-4xl">
            Connect to a Crate server
          </h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-slate-400">
            Enter the API URL for your Crate instance. You can add more servers
            later from Settings.
          </p>
        </div>

        <label className="mt-8 flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Server URL
          </span>
          <div className="relative">
            <Server
              size={18}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-cyan-200/50"
            />
            <input
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.your-crate.com"
              className="h-14 w-full rounded-[16px] border border-white/10 bg-white/[0.04] pl-12 pr-4 text-base text-white outline-none transition placeholder:text-slate-600 hover:border-white/20 focus:border-cyan-300/70 focus:bg-white/[0.06] focus:shadow-[0_0_0_4px_rgba(34,211,238,0.08)]"
              required
            />
          </div>
        </label>

        {/* Status strip. One line, changes tone based on probeState. */}
        <StatusLine state={probeState} />

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button
            type="submit"
            disabled={probeState.status === "probing"}
            className="group flex min-h-12 flex-1 items-center justify-center gap-2 rounded-[16px] bg-cyan-300 px-5 text-sm font-semibold text-[#041217] shadow-[0_0_34px_-12px_rgba(34,211,238,0.75)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {probeState.status === "probing" ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Checking server…
              </>
            ) : (
              <>
                Continue
                <ArrowRight
                  size={16}
                  className="transition group-hover:translate-x-0.5"
                />
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setUrl("http://localhost:8585")}
            className="min-h-12 rounded-[16px] border border-white/10 px-5 text-sm font-semibold text-slate-300 transition hover:border-white/20 hover:bg-white/[0.05] hover:text-white"
          >
            Local dev
          </button>
        </div>

        <p className="pt-5 text-center text-[12px] leading-5 text-slate-500">
          Don't run your own server yet?{" "}
          <a
            href="https://docs.cratemusic.app/technical/development-deployment-and-operations"
            className="text-cyan-300 underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Set one up in ~5 minutes
          </a>
          .
        </p>
      </form>
    </div>
  );
}

function StatusLine({ state }: { state: ProbeState }) {
  if (state.status === "idle" || state.status === "probing") {
    return <div className="h-5" />; // Reserve space so the button doesn't jump
  }
  if (state.status === "ok") {
    return (
      <div className="flex items-center gap-2 text-[13px] text-emerald-300">
        <CheckCircle2 size={14} />
        Crate instance detected{state.inviteOnly ? " (invite-only)" : ""}
      </div>
    );
  }
  if (state.status === "not-crate") {
    return (
      <div className="flex items-center gap-2 text-[13px] text-amber-300">
        <AlertCircle size={14} />
        Reachable, but not a Crate server
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-[13px] text-rose-300">
      <AlertCircle size={14} />
      {state.message}
    </div>
  );
}
