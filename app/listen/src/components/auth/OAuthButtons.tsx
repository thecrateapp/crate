import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";

import { api, getApiBase } from "@/lib/api";
import { beginNativeOAuth, isNative } from "@/lib/capacitor";
import { openExternalUrl } from "@/lib/external-links";
import { isTauriRuntime } from "@/lib/platform";
import { recordTauriAuthDiagnostic } from "@/lib/tauri-auth-diagnostic";
import { OAuthButtons as OAuthButtonsBase } from "@crate/ui/domain/auth/OAuthButtons";

interface OAuthButtonsProps {
  returnTo?: string;
  inviteToken?: string;
}

const fetchProviders = async () => {
  try {
    const providers = await api<
      Record<
        string,
        { enabled: boolean; configured: boolean; login_url: string | null }
      >
    >("/api/auth/providers");

    if (isTauriRuntime) {
      const google = providers.google;
      const enabled = google?.enabled ?? "missing";
      const configured = google?.configured ?? "missing";
      recordTauriAuthDiagnostic(
        google?.enabled && google?.configured
          ? "Google OAuth available"
          : "Google OAuth unavailable",
        `enabled=${enabled}, configured=${configured}`,
      );
    }

    return providers;
  } catch (error) {
    if (isTauriRuntime) {
      recordTauriAuthDiagnostic(
        "OAuth providers request failed",
        error instanceof Error ? error.name : "UnknownError",
      );
    }
    throw error;
  }
};

function oauthProvider(loginUrl: string): "google" | "apple" {
  return /(?:^|[/?])apple(?:[/?]|$)/i.test(loginUrl) ? "apple" : "google";
}

export function OAuthButtons({
  returnTo = "/",
  inviteToken,
}: OAuthButtonsProps) {
  const { t } = useTranslation();
  const handleNavigate = useCallback(
    (loginUrl: string, rt: string | null, invite?: string) => {
      const base = getApiBase() || window.location.origin;
      const target = new URL(loginUrl, base);
      if (invite) target.searchParams.set("invite", invite);
      if (isTauriRuntime || isNative) {
        // Desktop (Tauri) and mobile (Capacitor) both use the PKCE +
        // one-time-code exchange through the cratemusic:// deep link.
        void beginNativeOAuth(
          oauthProvider(target.toString()),
          rt || "/",
          invite,
        )
          .then(async (nativeLoginUrl) => {
            if (isTauriRuntime) {
              await openExternalUrl(nativeLoginUrl);
              return;
            }
            const { Browser } = await import("@capacitor/browser");
            await Browser.open({ url: nativeLoginUrl });
          })
          .catch((error) => {
            notify.error(
              error instanceof Error && error.message
                ? error.message
                : t("auth.login.connectionError"),
            );
          });
      } else {
        const callbackUrl = new URL("/auth/callback", window.location.origin);
        if (rt && rt !== "/") callbackUrl.searchParams.set("next", rt);
        target.searchParams.set("return_to", callbackUrl.toString());
        window.location.href = target.toString();
      }
    },
    [t],
  );

  return (
    <OAuthButtonsBase
      returnTo={returnTo}
      inviteToken={inviteToken}
      fetchProviders={fetchProviders}
      onOAuthNavigate={handleNavigate}
      buttonClassName="rounded-full"
      labels={{
        separator: t("auth.oauth.separator"),
        google: t("auth.oauth.google"),
        apple: t("auth.oauth.apple"),
        appleUnavailable: t("auth.oauth.appleUnavailable"),
      }}
    />
  );
}
