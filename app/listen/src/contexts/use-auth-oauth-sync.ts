import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { NavigateFunction } from "react-router";
import { toast } from "sonner";

import type { AuthUser } from "@/contexts/auth-context";
import {
  consumePendingOAuthNext,
  consumePendingOAuthProviderError,
} from "@/lib/capacitor";

async function completePendingOAuthFlow(
  next: string | null,
  refetch: () => Promise<AuthUser | null>,
  navigate: NavigateFunction,
) {
  if (!next) return;
  const user = await refetch();
  if (!user) return;
  navigate(next, { replace: true });
}

export function useAuthOAuthSync({
  navigate,
  refetch,
}: {
  navigate: NavigateFunction;
  refetch: () => Promise<AuthUser | null>;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    function handleTokenReceived() {
      void completePendingOAuthFlow(
        consumePendingOAuthNext() || "/",
        refetch,
        navigate,
      );
    }

    window.addEventListener("crate:auth-token-received", handleTokenReceived);
    return () => {
      window.removeEventListener(
        "crate:auth-token-received",
        handleTokenReceived,
      );
    };
  }, [navigate, refetch]);

  useEffect(() => {
    function handleProviderError() {
      consumePendingOAuthProviderError();
      toast.error(t("auth.login.connectionError"));
    }

    window.addEventListener("crate:oauth-provider-error", handleProviderError);
    if (consumePendingOAuthProviderError()) {
      toast.error(t("auth.login.connectionError"));
    }
    return () => {
      window.removeEventListener(
        "crate:oauth-provider-error",
        handleProviderError,
      );
    };
  }, [t]);

  useEffect(() => {
    void completePendingOAuthFlow(consumePendingOAuthNext(), refetch, navigate);
  }, [navigate, refetch]);
}
