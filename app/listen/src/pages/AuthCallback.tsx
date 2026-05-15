import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "@/contexts/AuthContext";
import { persistOAuthCallbackPayload } from "@/lib/capacitor";

function buildDesktopDeepLink(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get("desktop") !== "tauri") return null;
  const token = params.get("token");
  if (!token) return null;

  const deepLink = new URL("cratemusic://oauth/callback");
  for (const key of ["token", "refresh_token", "access_expires_at", "next"]) {
    const value = params.get(key);
    if (value) deepLink.searchParams.set(key, value);
  }
  return deepLink.toString();
}

function openDesktopDeepLink(url: string): void {
  if (navigator.userAgent.includes("jsdom")) return;
  window.location.href = url;
}

export function AuthCallback() {
  const navigate = useNavigate();
  const { user, loading, refetch } = useAuth();
  const [desktopDeepLink, setDesktopDeepLink] = useState<string | null>(null);
  const nextRef = useRef("/");
  const awaitingAuthRef = useRef(false);

  useEffect(() => {
    const deepLink = buildDesktopDeepLink(window.location.search);
    if (deepLink) {
      setDesktopDeepLink(deepLink);
      openDesktopDeepLink(deepLink);
      return;
    }

    const { handled, next } = persistOAuthCallbackPayload(
      window.location.search,
    );
    if (!handled) {
      navigate("/login", { replace: true });
      return;
    }

    nextRef.current = next;
    awaitingAuthRef.current = true;
    void refetch();
  }, [navigate, refetch]);

  useEffect(() => {
    if (!awaitingAuthRef.current || loading) {
      return;
    }

    awaitingAuthRef.current = false;
    if (user) {
      navigate(nextRef.current, { replace: true });
    } else {
      navigate("/login", { replace: true });
    }
  }, [loading, navigate, user]);

  if (desktopDeepLink) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app-surface px-6 text-white">
        <div className="w-full max-w-md rounded-[24px] border border-white/10 bg-white/[0.04] p-8 text-center shadow-[0_24px_80px_-48px_rgba(0,0,0,0.9)]">
          <img
            src="/icons/logo.svg"
            alt="Crate"
            className="mx-auto mb-4 h-14 w-14"
          />
          <h1 className="text-2xl font-bold">Return to Crate</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            If the desktop app did not open automatically, use the button below.
          </p>
          <a
            href={desktopDeepLink}
            className="mt-6 inline-flex h-12 items-center justify-center rounded-full bg-cyan-300 px-6 text-sm font-semibold text-[#041217] transition hover:bg-cyan-200"
          >
            Open Crate
          </a>
        </div>
      </div>
    );
  }

  return null;
}
