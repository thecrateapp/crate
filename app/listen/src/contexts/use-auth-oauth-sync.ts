import { useEffect } from "react";
import type { NavigateFunction } from "react-router";

import type { AuthUser } from "@/contexts/auth-context";
import { consumePendingOAuthNext } from "@/lib/capacitor";

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
    void completePendingOAuthFlow(consumePendingOAuthNext(), refetch, navigate);
  }, [navigate, refetch]);
}
