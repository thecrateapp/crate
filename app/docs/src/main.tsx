import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";

import App from "@/App";
import "@/index.css";
import { initSentry } from "@/lib/sentry";

initSentry();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<p>Crate docs could not load.</p>}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
