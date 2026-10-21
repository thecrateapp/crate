import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useSse } from "./use-sse";

interface TaskEvent {
  id: string;
  type: string;
  status: string;
  [key: string]: unknown;
}

const TYPE_LABELS: Record<string, string> = {
  scan: "Library Scan",
  compute_analytics: "Compute Analytics",
  enrich_artists: "Artist Enrichment",
  fetch_artwork_all: "Fetch All Artwork",
  batch_retag: "Batch Retag",
  batch_covers: "Batch Fetch Covers",
};

const PROMPTED_AT_KEY = "crate-admin-notifications-prompted-at";
const PROMPTED_IN_SESSION_KEY = "crate-admin-notifications-prompted";
export const NOTIFICATION_PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The permission prompt shows at most once per browser session and, once it
 * has shown, not again for 7 days, whether it was dismissed or ignored.
 * Storage is a per-viewer convenience: a store that throws counts as empty,
 * which falls back to once per page load.
 */
export function mayPromptForNotifications(now = Date.now()): boolean {
  try {
    if (sessionStorage.getItem(PROMPTED_IN_SESSION_KEY)) return false;
  } catch {
    // Unreadable; the stored time below may still apply.
  }
  try {
    const promptedAt = Number(localStorage.getItem(PROMPTED_AT_KEY));
    const elapsed = now - promptedAt;
    // A missing, malformed or future time does not snooze the prompt.
    if (
      promptedAt > 0 &&
      elapsed >= 0 &&
      elapsed < NOTIFICATION_PROMPT_SNOOZE_MS
    )
      return false;
  } catch {
    // Unreadable; nothing to honour.
  }
  return true;
}

function rememberNotificationPrompt(now = Date.now()) {
  try {
    sessionStorage.setItem(PROMPTED_IN_SESSION_KEY, "1");
  } catch {
    // Best effort; see mayPromptForNotifications.
  }
  try {
    localStorage.setItem(PROMPTED_AT_KEY, String(now));
  } catch {
    // Best effort; see mayPromptForNotifications.
  }
}

export function useNotifications() {
  const permissionAsked = useRef(false);

  const notify = useCallback((title: string, body: string) => {
    if (Notification.permission === "granted" && document.hidden) {
      new Notification(title, { body, icon: "/assets/icon-192.png" });
    }
  }, []);

  // Ask for permission via toast, throttled by mayPromptForNotifications.
  useEffect(() => {
    if (
      typeof Notification === "undefined" ||
      Notification.permission !== "default" ||
      permissionAsked.current ||
      !mayPromptForNotifications()
    ) {
      return;
    }
    permissionAsked.current = true;

    const timer = setTimeout(() => {
      // Showing it counts: dismissing or ignoring it is not a choice.
      rememberNotificationPrompt();
      toast("Enable notifications?", {
        description: "Get notified when background tasks complete.",
        action: {
          label: "Enable",
          onClick: () => {
            Notification.requestPermission();
          },
        },
        duration: 8000,
      });
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  // Listen for task completion via SSE
  const { data } = useSse<TaskEvent>("/api/events", {
    enabled:
      typeof Notification !== "undefined" &&
      Notification.permission === "granted",
  });

  const lastEventRef = useRef<string | null>(null);

  useEffect(() => {
    if (!data || data.status !== "completed") return;
    if (lastEventRef.current === data.id) return;
    lastEventRef.current = data.id;

    const label = TYPE_LABELS[data.type] ?? data.type;
    notify("Task Completed", `${label} finished successfully.`);
  }, [data, notify]);
}
