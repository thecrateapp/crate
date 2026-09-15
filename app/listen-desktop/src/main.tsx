import "../../shared/fonts/poppins.css";
import "../../listen/src/index.css";
import "./linux-theme.css";

import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import { Toaster } from "sonner";

import { App } from "@/App";
import { I18nProvider } from "@/i18n";
import { primeOfflineRuntimeProfile } from "@/lib/offline";
import { initSentry } from "@/lib/sentry";
import {
  getAppliedThemeSkin,
  initializeThemeSkin,
  subscribeThemeSkin,
} from "@crate/ui/lib/theme-skin";

import { initTauriRuntime } from "./lib/tauri-init";

initTauriRuntime();
initSentry();
void primeOfflineRuntimeProfile();
initializeThemeSkin();

function ThemeAwareToaster() {
  const resolvedMode = useSyncExternalStore(
    subscribeThemeSkin,
    () => getAppliedThemeSkin().resolvedMode,
    () => "dark" as const,
  );

  return <Toaster theme={resolvedMode} position="bottom-center" richColors />;
}

createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <I18nProvider>
      <App />
    </I18nProvider>
    <ThemeAwareToaster />
  </HashRouter>,
);
