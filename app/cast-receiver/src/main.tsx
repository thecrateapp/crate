import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createCafAdapter } from "./caf-adapter";
import type { CafRuntime } from "./caf-types";
import { createReceiverStore } from "./receiver-store";

const store = createReceiverStore();
const runtime = (globalThis as typeof globalThis & { cast?: CafRuntime }).cast;

if (!runtime) {
  throw new Error("Google Cast Application Framework is unavailable");
}

const adapter = createCafAdapter({
  runtime,
  handlers: {
    onLoad: (data) => {
      store.dispatch({ type: "load-started", sessionId: data.sessionId });
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
});

adapter.start();

const root = document.getElementById("root");
if (!root) throw new Error("Cast receiver root is missing");

createRoot(root).render(
  <StrictMode>
    <main aria-live="polite">Crate Cast is ready</main>
  </StrictMode>,
);
