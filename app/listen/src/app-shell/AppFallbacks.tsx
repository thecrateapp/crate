import { Suspense, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";

// Keep the shell exports stable while retiring their former spinner visuals.
export function RouteSpinner() {
  const { t } = useTranslation();
  return <LoadingState variant="route" label={t("common.loading")} />;
}

export function AuthSpinner() {
  const { t } = useTranslation();
  return <LoadingState variant="screen" label={t("common.loading")} />;
}

export function DeferredRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteSpinner />}>{children}</Suspense>;
}
