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

type TauriOpenerGlobal = Window &
  typeof globalThis & {
    __TAURI__?: {
      opener?: {
        openUrl?: (url: string) => Promise<void> | void;
        open?: (url: string) => Promise<void> | void;
      };
      shell?: {
        open?: (url: string) => Promise<void> | void;
      };
    };
  };

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

function tauriOAuthCallbackUrl(returnTo: string | null): URL {
  const callbackUrl = new URL("http://127.0.0.1:17654/oauth/callback");
  if (returnTo && returnTo !== "/")
    callbackUrl.searchParams.set("next", returnTo);
  return callbackUrl;
}

export async function openExternalOAuthUrl(url: string): Promise<void> {
  const tauri = (window as TauriOpenerGlobal).__TAURI__;
  const opener =
    tauri?.opener?.openUrl ?? tauri?.opener?.open ?? tauri?.shell?.open;
  if (opener) {
    await opener(url);
    return;
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    window.location.href = url;
  }
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
      if (isTauriRuntime) {
        const callbackUrl = tauriOAuthCallbackUrl(rt);
        target.searchParams.set("return_to", callbackUrl.toString());
        target.searchParams.set("app_id", "listen-tauri");
        void openExternalOAuthUrl(target.toString()).catch(() => {
          window.location.href = target.toString();
        });
        return;
      }
      if (isNative) {
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
