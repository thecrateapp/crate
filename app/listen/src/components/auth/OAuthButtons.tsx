import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { api, getApiBase } from "@/lib/api";
import {
  beginDesktopOAuthHandoff,
  beginNativeOAuth,
  isNative,
} from "@/lib/capacitor";
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

function tauriOAuthCallbackUrl(
  returnTo: string | null,
  state: string,
  port: number,
): URL {
  const callbackUrl = new URL(`http://127.0.0.1:${port}/oauth/callback`);
  if (returnTo && returnTo !== "/")
    callbackUrl.searchParams.set("next", returnTo);
  callbackUrl.searchParams.set("state", state);
  return callbackUrl;
}

// The loopback listener binds an OS-assigned ephemeral port rather than a
// fixed one — a fixed, predictable port could be squatted by another
// local process before Crate starts, which would then receive the real
// access/refresh token straight from the browser instead of us. Failing
// closed (no login attempt) if we can't confirm the port beats silently
// falling back to a guessed one.
async function fetchTauriOAuthLoopbackPort(): Promise<number | null> {
  const invoke = window.__crateTauriInvoke;
  if (!invoke) return null;
  try {
    const port = await invoke<number | null>("get_oauth_loopback_port");
    return typeof port === "number" ? port : null;
  } catch {
    return null;
  }
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
        void fetchTauriOAuthLoopbackPort().then((port) => {
          if (!port) {
            toast.error(t("auth.login.connectionError"));
            return;
          }
          let state: string;
          try {
            state = beginDesktopOAuthHandoff(rt || "/");
          } catch {
            toast.error(t("auth.login.connectionError"));
            return;
          }
          const callbackUrl = tauriOAuthCallbackUrl(rt, state, port);
          target.searchParams.set("return_to", callbackUrl.toString());
          target.searchParams.set("app_id", "listen-tauri");
          void openExternalOAuthUrl(target.toString()).catch(() => {
            window.location.href = target.toString();
          });
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
