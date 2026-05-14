import "../../shared/fonts/poppins.css";
import "../../listen/src/index.css";
import "./linux-theme.css";

import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import { Toaster } from "sonner";

import { App } from "@/App";
import { primeOfflineRuntimeProfile } from "@/lib/offline";

import { initTauriRuntime } from "./lib/tauri-init";

initTauriRuntime();
void primeOfflineRuntimeProfile();

createRoot(document.getElementById("root")!).render(
  <HashRouter>
    <App />
    <Toaster theme="dark" position="bottom-center" richColors />
  </HashRouter>,
);
