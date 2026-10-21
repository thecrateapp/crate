import "../../listen/src/index.css";
import "./linux-theme.css";

import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import { Toaster } from "sonner";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { initializeUiPreferences } from "@crate/ui/lib/interface-preferences";

import { App } from "@/App";
import { I18nProvider } from "@/i18n";
import { primeOfflineRuntimeProfile } from "@/lib/offline";
import { isTauriRuntime } from "@/lib/platform";
import { migrateLegacyTauriLastfmRecord } from "@/lib/native-lastfm-oauth";
import { migrateLegacyTauriOAuthRecords } from "@/lib/capacitor-oauth";
import { captureRuntimeError, initSentry } from "@/lib/sentry";
import { bootstrapNativeSessionStore } from "@/lib/server-store";
import { renderSecureSessionError } from "@/lib/secure-session-error";

import { initTauriRuntime, startTauriOAuthRuntime } from "./lib/tauri-init";
import { LinuxWindowTitlebar } from "./components/LinuxWindowTitlebar";

const disposeFocusRingMotion = installFocusRingMotion();
import.meta.hot?.dispose(disposeFocusRingMotion);

const hasLinuxWindowTitlebar =
  isTauriRuntime &&
  typeof navigator !== "undefined" &&
  /\bLinux\b/i.test(navigator.userAgent);

if (hasLinuxWindowTitlebar) {
  document.documentElement.dataset.crateLinuxWindowChrome = "true";
}

initTauriRuntime();
initSentry();
applyCrateIdentity();
const disposePreferences = initializeUiPreferences();
import.meta.hot?.dispose(disposePreferences);

async function bootstrapDesktopApp(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) return;
  try {
    await bootstrapNativeSessionStore();
    await migrateLegacyTauriOAuthRecords();
    await migrateLegacyTauriLastfmRecord();
  } catch (error) {
    void captureRuntimeError(error, "secure_session.bootstrap");
    renderSecureSessionError(root);
    return;
  }

  void primeOfflineRuntimeProfile();
  startTauriOAuthRuntime();
  createRoot(root).render(
    <I18nProvider>
      {hasLinuxWindowTitlebar && <LinuxWindowTitlebar />}
      {hasLinuxWindowTitlebar && <div aria-hidden="true" className="h-9" />}
      <HashRouter useTransitions={hasLinuxWindowTitlebar ? false : undefined}>
        <App />
        <Toaster {...toasterConfig} theme="dark" position="bottom-center" />
      </HashRouter>
    </I18nProvider>,
  );
}

void bootstrapDesktopApp();
