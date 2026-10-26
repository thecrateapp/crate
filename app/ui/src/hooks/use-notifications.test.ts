import { act, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOTIFICATION_PROMPT_SNOOZE_MS,
  mayPromptForNotifications,
  useNotifications,
} from "./use-notifications";

vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("./use-sse", () => ({ useSse: () => ({ data: null }) }));

const START = Date.parse("2026-10-20T10:00:00Z");
const PROMPT_DELAY_MS = 3000;
/** The first load shows the prompt after its delay. */
const SHOWN_AT = START + PROMPT_DELAY_MS;

const requestPermission = vi.fn();

function stubNotification(permission: NotificationPermission = "default") {
  vi.stubGlobal(
    "Notification",
    Object.assign(vi.fn(), { permission, requestPermission }),
  );
}

/** One page load: mount the shell's hook and wait out the prompt delay. */
function load() {
  const view = renderHook(() => useNotifications());
  act(() => {
    vi.advanceTimersByTime(PROMPT_DELAY_MS);
  });
  view.unmount();
}

/** A new browser session keeps localStorage and starts sessionStorage empty. */
function newSession() {
  sessionStorage.clear();
}

function prompts() {
  return vi
    .mocked(toast)
    .mock.calls.filter(([title]) => title === "Enable notifications?");
}

function throwingStorage(storage: Storage) {
  const denied = () => {
    throw new DOMException("Storage is blocked", "SecurityError");
  };
  vi.spyOn(storage, "getItem").mockImplementation(denied);
  vi.spyOn(storage, "setItem").mockImplementation(denied);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(START);
  localStorage.clear();
  sessionStorage.clear();
  stubNotification();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useNotifications permission prompt", () => {
  it("shows the prompt once per browser session", () => {
    load();
    expect(prompts()).toHaveLength(1);
    // Reloads keep the session.
    load();
    load();
    expect(prompts()).toHaveLength(1);
  });

  it("does not show the prompt again within 7 days once it was dismissed or ignored", () => {
    load();
    const [, options] = prompts()[0]!;
    // Dismissing the toast is not a choice; neither is letting it time out.
    (options as { onDismiss?: () => void }).onDismiss?.();
    newSession();
    vi.setSystemTime(SHOWN_AT + NOTIFICATION_PROMPT_SNOOZE_MS - 1);
    load();
    expect(prompts()).toHaveLength(1);
  });

  it("shows the prompt again after 7 days", () => {
    load();
    newSession();
    vi.setSystemTime(SHOWN_AT + NOTIFICATION_PROMPT_SNOOZE_MS);
    load();
    expect(prompts()).toHaveLength(2);
  });

  it("keeps the Enable action asking the browser for permission", () => {
    load();
    const [, options] = prompts()[0]!;
    const { action } = options as {
      action: { label: string; onClick: () => void };
    };
    expect(action.label).toBe("Enable");
    action.onClick();
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("does not show the prompt once the browser has a permission", () => {
    stubNotification("denied");
    load();
    stubNotification("granted");
    load();
    expect(prompts()).toHaveLength(0);
  });

  it("does not show the prompt when the page closes before the delay", () => {
    const view = renderHook(() => useNotifications());
    view.unmount();
    act(() => {
      vi.advanceTimersByTime(PROMPT_DELAY_MS);
    });
    expect(prompts()).toHaveLength(0);
    // Nothing was recorded, so the next load may still ask.
    expect(mayPromptForNotifications()).toBe(true);
  });

  it("still shows the prompt once per page load when storage throws", () => {
    throwingStorage(localStorage);
    throwingStorage(sessionStorage);
    expect(() => load()).not.toThrow();
    expect(prompts()).toHaveLength(1);
    expect(mayPromptForNotifications()).toBe(true);
  });

  it("uses whichever storage still works when the other throws", () => {
    throwingStorage(sessionStorage);
    load();
    load();
    expect(prompts()).toHaveLength(1);
  });

  it("ignores a stored time it cannot use", () => {
    for (const stored of ["garbage", String(START + 60_000), "0"]) {
      localStorage.setItem("crate-admin-notifications-prompted-at", stored);
      expect(mayPromptForNotifications(START)).toBe(true);
    }
  });
});
