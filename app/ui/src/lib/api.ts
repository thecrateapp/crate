export { ApiError } from "../../../shared/web/api";

import { createApiClient } from "../../../shared/web/api";
import { captureApiError } from "./sentry";

let sessionCheck: Promise<void> | null = null;

function checkSessionBeforeRedirect(): void {
  if (window.location.pathname === "/login" || sessionCheck) return;
  // Some endpoints require a stronger human session than ordinary Admin reads.
  // Their 401 must stay an endpoint error when the app session is still valid.
  sessionCheck = fetch("/api/auth/me", {
    credentials: "same-origin",
    cache: "no-store",
  })
    .then((response) => {
      if (response.status === 401 && window.location.pathname !== "/login") {
        const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.href = `/login?redirect=${encodeURIComponent(
          redirect,
        )}`;
      }
    })
    .catch(() => {
      // A network outage does not prove that the session has expired.
    })
    .finally(() => {
      sessionCheck = null;
    });
}

export const api = createApiClient({
  defaultHeaders: { "X-Crate-Client": "admin-web" },
  onError: captureApiError,
  onUnauthorized: checkSessionBeforeRedirect,
});

export function apiSseUrl(path: string): string {
  return path;
}
