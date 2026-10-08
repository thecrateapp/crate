import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import { initSentry } from "./lib/sentry";
import "./index.css";

initSentry();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<p>Crate could not load.</p>}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);
