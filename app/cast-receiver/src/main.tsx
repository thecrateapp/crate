import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { createCafAdapter } from "./caf-adapter";
import type { CafRuntime } from "./caf-types";
import { seedReceiverPreview } from "./dev-preview";
import { loadReceiverSession } from "./receiver-client";
import { createReceiverStore } from "./receiver-store";
import "./styles.css";

const store = createReceiverStore();
const runtime = (globalThis as typeof globalThis & { cast?: CafRuntime }).cast;
const preview =
  import.meta.env.DEV && new URLSearchParams(location.search).has("preview");

if (!runtime && !preview) {
  throw new Error("Google Cast Application Framework is unavailable");
}

const adapter =
  runtime && !preview
    ? createCafAdapter({
        runtime,
        handlers: {
          onLoad: (data) => {
            store.dispatch({ type: "load-started", sessionId: data.sessionId });
            void loadReceiverSession(data.bootstrapUrl, data.sessionId)
              .then((session) => {
                store.dispatch({
                  type: "session-loaded",
                  appearance: session.appearance,
                  queue: session.queue,
                });
              })
              .catch(() => {
                store.dispatch({
                  type: "terminal-error",
                  message: "Playback unavailable",
                });
              });
          },
          onPlayerState: (state) => {
            store.dispatch({ type: "player-state", state });
          },
          onProgress: (progress) => {
            store.progress.set(progress);
          },
          onError: () => {
            store.dispatch({
              type: "terminal-error",
              message: "Unable to play this item",
            });
          },
        },
      })
    : null;

if (adapter) adapter.start();
else seedReceiverPreview(store);

const root = document.getElementById("root");
if (!root) throw new Error("Cast receiver root is missing");

createRoot(root).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
