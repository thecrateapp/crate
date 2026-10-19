import { AuthFrame } from "@/components/auth/AuthFrame";
import { AuthCallbackView } from "@/components/auth/AuthCallbackView";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { useAuth } from "@/contexts/AuthContext";
import {
  clearPendingOAuthNext,
  persistOAuthCallbackPayload,
} from "@/lib/capacitor";

function getDesktopCallbackParams(
  search: string,
  hash: string,
): URLSearchParams | null {
  const queryParams = new URLSearchParams(search);
  if (queryParams.get("desktop") === "tauri") return queryParams;

  const fragmentParams = new URLSearchParams(hash.replace(/^#/, ""));
  return fragmentParams.get("desktop") === "tauri" ? fragmentParams : null;
}

function buildDesktopDeepLink(params: URLSearchParams | null): string | null {
  if (!params) return null;
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) return null;

  const deepLink = new URL("cratemusic://oauth/callback");
  for (const key of ["code", "state", "next"]) {
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
  const { t } = useTranslation();
  const { user, loading, refetch } = useAuth();
  const [desktopDeepLink, setDesktopDeepLink] = useState<string | null>(null);
  const nextRef = useRef("/");
  const awaitingAuthRef = useRef(false);

  useEffect(() => {
    const desktopParams = getDesktopCallbackParams(
      window.location.search,
      window.location.hash,
    );
    const deepLink = buildDesktopDeepLink(desktopParams);
    if (deepLink) {
      setDesktopDeepLink(deepLink);
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname,
      );
      openDesktopDeepLink(deepLink);
      return;
    }
    if (desktopParams) {
      clearPendingOAuthNext();
      navigate("/login", { replace: true });
      return;
    }

    const { handled, next } = persistOAuthCallbackPayload(
      window.location.search,
    );
    if (!handled) {
      navigate("/login", { replace: true });
      return;
    }

    clearPendingOAuthNext();
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
    return <AuthCallbackView desktopDeepLink={desktopDeepLink} />;
  }
  return (
    <AuthFrame title={t("authCallback.title")} subtitle={t("auth.tagline")}>
      <p role="status" className="text-center text-sm text-text-muted">
        {t("common.loading")}
      </p>
    </AuthFrame>
  );
}
