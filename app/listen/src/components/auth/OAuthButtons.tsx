import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { api, getApiBase } from "@/lib/api";
import { beginNativeOAuth, isNative } from "@/lib/capacitor";
import { isTauriRuntime } from "@/lib/platform";
import { OAuthButtons as OAuthButtonsBase } from "@crate/ui/domain/auth/OAuthButtons";

interface OAuthButtonsProps {
  returnTo?: string;
  inviteToken?: string;
}

const fetchProviders = () =>
  api<
    Record<
      string,
      { enabled: boolean; configured: boolean; login_url: string | null }
    >
  >("/api/auth/providers");

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
        // Desktop (Tauri) and mobile (Capacitor) both do the PKCE +
        // one-time-code exchange dance through the cratemusic:// deep
        // link — Tauri registers that same custom scheme as an OS-level
        // deep link, so it reaches the app the exact same way. The
        // @capacitor/browser import resolves to a stub on desktop that
        // opens the system browser via Tauri's opener plugin instead of
        // a Capacitor bridge that doesn't exist there.
        void beginNativeOAuth(
          oauthProvider(target.toString()),
          rt || "/",
          invite,
        )
          .then((nativeLoginUrl) =>
            import("@capacitor/browser").then(({ Browser }) =>
              Browser.open({ url: nativeLoginUrl }),
            ),
          )
          .catch((error) => {
            toast.error(
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
