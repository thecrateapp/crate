import "../../shared/fonts/poppins.css";
import "../../listen/src/index.css";
import "./linux-theme.css";

import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import { Toaster } from "sonner";

import { App } from "@/App";
import { I18nProvider } from "@/i18n";
import { primeOfflineRuntimeProfile } from "@/lib/offline";

import { initTauriRuntime } from "./lib/tauri-init";

initTauriRuntime();
void primeOfflineRuntimeProfile();

createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <I18nProvider>
      <App />
    </I18nProvider>
    <Toaster theme="dark" position="bottom-center" richColors />
  </HashRouter>,
);
