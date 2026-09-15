import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { createCafAdapter } from "./caf-adapter";
import type { CafRuntime } from "./caf-types";
import { seedReceiverPreview } from "./dev-preview";
import { createReceiverSessionRuntime } from "./receiver-session-runtime";
import { createReceiverStore } from "./receiver-store";
import {
  captureReceiverError,
  initReceiverSentry,
  receiverTelemetry,
  recordReceiverMetric,
} from "./sentry";
import "./styles.css";

void initReceiverSentry();
const store = createReceiverStore();
const runtime = (globalThis as typeof globalThis & { cast?: CafRuntime }).cast;
const preview =
  import.meta.env.DEV && new URLSearchParams(location.search).has("preview");

if (!runtime && !preview) {
  const error = new Error("Google Cast Application Framework is unavailable");
  captureReceiverError(error, "caf_bootstrap");
  recordReceiverMetric("receiver.startup", { outcome: "error" });
  throw error;
}

let sessionRuntime: ReturnType<typeof createReceiverSessionRuntime> | null =
  null;
const adapter =
  runtime && !preview
    ? createCafAdapter({
        runtime,
        handlers: {
          onLoad: (data) => void sessionRuntime?.load(data),
          onCurrentItem: (itemId) => sessionRuntime?.currentItem(itemId),
          onPlayerState: (state) => sessionRuntime?.playerState(state),
          onProgress: (progress) => sessionRuntime?.progress(progress),
          onQueueChange: () => void sessionRuntime?.refreshQueue(),
          onError: () => {
            sessionRuntime?.mediaError();
          },
        },
      })
    : null;

if (adapter) {
  sessionRuntime = createReceiverSessionRuntime({
    store,
    retryCurrentItem: () => adapter.retryCurrentItem(),
    sendProtocolMessage: (message) => adapter.sendProtocolMessage(message),
    skipCurrentItem: () => adapter.skipCurrentItem(),
    telemetry: receiverTelemetry,
  });
}

if (adapter) {
  adapter.start();
  sessionRuntime?.start();
  recordReceiverMetric("receiver.startup", {
    device_category: "tv",
    outcome: "success",
    source: "caf",
  });
} else seedReceiverPreview(store);

const root = document.getElementById("root");
if (!root) throw new Error("Cast receiver root is missing");

createRoot(root).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
