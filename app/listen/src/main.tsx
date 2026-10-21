import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { Toaster } from "sonner";
import { toasterConfig } from "@crate/ui/lib/toaster-config";
import { installFocusRingMotion } from "@crate/ui/lib/focus-ring-motion";
import { App } from "./App";
import { I18nProvider } from "./i18n/I18nProvider";
import { startMediaAccessTicketRefresh } from "./lib/api";
import { initCapacitor } from "./lib/capacitor";
import {
  isOfflineMediaCacheName,
  primeOfflineRuntimeProfile,
} from "./lib/offline";
import { shouldRegisterServiceWorker } from "./lib/platform";
import { initRuntimeSentry, reportRuntimeError } from "./lib/runtime-sentry";
import { bootstrapNativeSessionStore } from "./lib/server-store";
import { renderSecureSessionError } from "./lib/secure-session-error";
import { syncThemeColor } from "./lib/theme-color";
import { applyCrateIdentity } from "@crate/ui/lib/crate-identity";
import { initializeUiPreferences } from "@crate/ui/lib/interface-preferences";
import "./index.css";

const disposeFocusRingMotion = installFocusRingMotion();
import.meta.hot?.dispose(disposeFocusRingMotion);

async function disableDevServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.map((registration) => registration.unregister()),
    );
  } catch {
    // Ignore cleanup failures; the page can still boot without dev offline support.
  }

  if (!("caches" in window)) return;

  try {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.map((cacheName) =>
        cacheName.startsWith("crate-listen") &&
        !isOfflineMediaCacheName(cacheName)
          ? caches.delete(cacheName)
          : Promise.resolve(false),
      ),
    );
  } catch {
    // Ignore cache cleanup failures; the next hard refresh can finish the reset.
  }
}

function ListenToaster() {
  return (
    <Toaster
      {...toasterConfig}
      theme="dark"
      position="bottom-center"
      mobileOffset={{
        bottom: "calc(var(--listen-mobile-bottom-chrome-height) + 0.75rem)",
      }}
    />
  );
}

function renderApp(): void {
  createRoot(document.getElementById("root")!).render(
    <BrowserRouter>
      <I18nProvider>
        <App />
      </I18nProvider>
      <ListenToaster />
    </BrowserRouter>,
  );
}

async function bootstrap(): Promise<void> {
  try {
    await bootstrapNativeSessionStore();
  } catch (error) {
    await reportRuntimeError(error, "bootstrap.secure_session").catch(
      () => undefined,
    );
    const root = document.getElementById("root");
    if (root) renderSecureSessionError(root);
    return;
  }

  startMediaAccessTicketRefresh();
  applyCrateIdentity();
  const disposePreferences = initializeUiPreferences();
  import.meta.hot?.dispose(disposePreferences);
  syncThemeColor(document.documentElement);
  await initCapacitor();
  void primeOfflineRuntimeProfile().catch((error) => {
    void reportRuntimeError(error, "offline.profile.prime").catch(
      () => undefined,
    );
  });

  if (
    shouldRegisterServiceWorker &&
    typeof window !== "undefined" &&
    "serviceWorker" in navigator
  ) {
    if (import.meta.env.DEV) {
      void disableDevServiceWorker();
    } else {
      void navigator.serviceWorker.register("/sw.js").catch((error) => {
        void reportRuntimeError(error, "service_worker.register").catch(
          () => undefined,
        );
      });
    }
  }
  renderApp();
}

async function start(): Promise<void> {
  await initRuntimeSentry().catch(() => undefined);

  try {
    await bootstrap();
  } catch (error) {
    await reportRuntimeError(error, "bootstrap.unhandled").catch(
      () => undefined,
    );
  }
}

void start();
