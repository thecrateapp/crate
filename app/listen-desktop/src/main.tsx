import "../../shared/fonts/poppins.css";
import "../../listen/src/index.css";
import "./linux-theme.css";

import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import { Toaster } from "sonner";

import { App } from "@/App";
import { LISTEN_APPEARANCE_SETTINGS_ENABLED } from "@/app-shell/feature-flags";
import { I18nProvider } from "@/i18n";
import { primeOfflineRuntimeProfile } from "@/lib/offline";
import { isTauriRuntime } from "@/lib/platform";
import { initSentry } from "@/lib/sentry";
import {
  getAppliedThemeSkin,
  initializeThemeSkin,
  subscribeThemeSkin,
} from "@crate/ui/lib/theme-skin";

import { initTauriRuntime } from "./lib/tauri-init";
import { LinuxWindowTitlebar } from "./components/LinuxWindowTitlebar";

const hasLinuxWindowTitlebar =
  isTauriRuntime &&
  typeof navigator !== "undefined" &&
  /\bLinux\b/i.test(navigator.userAgent);

if (hasLinuxWindowTitlebar) {
  document.documentElement.dataset.crateLinuxWindowChrome = "true";
}

initTauriRuntime();
initSentry();
void primeOfflineRuntimeProfile();
initializeThemeSkin({
  ignoreStoredPreferences: !LISTEN_APPEARANCE_SETTINGS_ENABLED,
});

function ThemeAwareToaster() {
  const resolvedMode = useSyncExternalStore(
    subscribeThemeSkin,
    () => getAppliedThemeSkin().resolvedMode,
    () => "dark" as const,
  );

  return <Toaster theme={resolvedMode} position="bottom-center" richColors />;
}

createRoot(document.getElementById("root")!).render(
  <>
    {hasLinuxWindowTitlebar && <LinuxWindowTitlebar />}
    {hasLinuxWindowTitlebar && <div aria-hidden="true" className="h-9" />}
    <HashRouter>
      <I18nProvider>
        <App />
      </I18nProvider>
      <ThemeAwareToaster />
    </HashRouter>
  </>,
);
