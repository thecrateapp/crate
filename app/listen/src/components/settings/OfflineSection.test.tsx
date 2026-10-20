import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OfflineSection } from "@/components/settings/OfflineSection";
import type { OfflineItemRecord } from "@/lib/offline";
import type { OfflineContextValue } from "@/contexts/offline-context";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const nativeFilesystem = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform")>();
  return {
    ...actual,
    get usesNativeFilesystem() {
      return nativeFilesystem.enabled;
    },
  };
});

const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");
const offlineSummary = {
  itemCount: 3,
  readyItemCount: 2,
  errorItemCount: 1,
  readyTrackCount: 8,
  trackCount: 10,
  totalBytes: 256 * 1024 * 1024,
};

function setStorage(
  storage: { estimate?: () => Promise<StorageEstimate> } | undefined,
) {
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: storage,
  });
}

function renderOffline(overrides: Partial<OfflineContextValue> = {}) {
  return renderWithListenProviders(<OfflineSection />, {
    locale: "en",
    offline: { summary: { ...offlineSummary }, ...overrides },
  });
}

describe("OfflineSection meters", () => {
  beforeEach(() => {
    nativeFilesystem.enabled = false;
    setStorage(undefined);
  });

  afterEach(() => {
    if (originalStorage)
      Object.defineProperty(navigator, "storage", originalStorage);
    else Reflect.deleteProperty(navigator, "storage");
  });

  it("always shows the actual ready and total track counts", () => {
    renderOffline();

    const meter = screen.getByRole("meter", { name: "Tracks" });
    expect(meter).toHaveAttribute("aria-valuenow", "8");
    expect(meter).toHaveAttribute("aria-valuemax", "10");
    expect(meter).toHaveAttribute(
      "aria-valuetext",
      expect.stringMatching(/8\s*\/\s*10/),
    );
    expect(screen.getAllByRole("meter")).toHaveLength(1);
  });

  it("measures profile bytes against the browser quota, rather than unrelated origin usage", async () => {
    const quota = 1024 * 1024 * 1024;
    const estimate = vi.fn(async () => ({ quota, usage: 900 * 1024 * 1024 }));
    setStorage({ estimate });
    renderOffline();

    const storage = await screen.findByRole("meter", { name: "Storage" });
    expect(storage).toHaveAttribute(
      "aria-valuenow",
      String(offlineSummary.totalBytes),
    );
    expect(storage).toHaveAttribute("aria-valuemax", String(quota));
    expect(storage).toHaveAttribute(
      "aria-valuetext",
      expect.stringContaining("256"),
    );
    expect(estimate).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("meter")).toHaveLength(2);
  });

  it.each([
    "missing estimate",
    "rejected estimate",
    "missing quota",
    "zero quota",
    "non-finite quota",
  ] as const)("keeps only the count meter with %s", async (scenario) => {
    const estimate = vi.fn<() => Promise<StorageEstimate>>();
    if (scenario === "rejected estimate")
      estimate.mockRejectedValue(new Error("Storage unavailable"));
    else
      estimate.mockResolvedValue(
        scenario === "missing quota"
          ? { usage: 1234 }
          : { quota: scenario === "zero quota" ? 0 : Number.NaN },
      );
    setStorage(scenario === "missing estimate" ? {} : { estimate });
    renderOffline();

    if (scenario !== "missing estimate")
      await waitFor(() => expect(estimate).toHaveBeenCalledOnce());
    expect(screen.getAllByRole("meter")).toHaveLength(1);
    expect(screen.getByRole("meter", { name: "Tracks" })).toHaveAttribute(
      "aria-valuenow",
      "8",
    );
    expect(
      screen.queryByRole("meter", { name: "Storage" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("256 MB")).toBeInTheDocument();
  });

  it("keeps native filesystem bytes outside the browser quota meter", () => {
    const estimate = vi.fn(async () => ({
      quota: 1024 * 1024 * 1024,
      usage: 512 * 1024 * 1024,
    }));
    setStorage({ estimate });
    nativeFilesystem.enabled = true;
    renderOffline();

    expect(screen.getAllByRole("meter")).toHaveLength(1);
    expect(screen.getByRole("meter", { name: "Tracks" })).toHaveAttribute(
      "aria-valuenow",
      "8",
    );
    expect(
      screen.queryByRole("meter", { name: "Storage" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("256 MB")).toBeInTheDocument();
    expect(estimate).not.toHaveBeenCalled();
  });

  it("preserves an empty mirror as 0/0 without reporting a percentage or an invented range", () => {
    renderOffline({
      summary: {
        ...offlineSummary,
        itemCount: 0,
        trackCount: 0,
        readyTrackCount: 0,
        totalBytes: 0,
      },
    });

    const meter = screen.getByRole("group", { name: "Tracks" });
    expect(meter).not.toHaveAttribute("aria-valuenow");
    expect(meter).toHaveAccessibleDescription(/0\s*\/\s*0/);
    expect(
      screen.queryByRole("meter", { name: "Tracks" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
  });

  it("preserves sync and remove-copy actions", async () => {
    const user = userEvent.setup();
    const syncAll = vi.fn(async () => {});
    const clearActiveProfile = vi.fn(async () => {});
    renderOffline({ syncAll, clearActiveProfile });

    await user.click(
      screen.getByRole("button", { name: "Sync offline copy now" }),
    );
    expect(syncAll).toHaveBeenCalledOnce();
    await user.click(
      screen.getByRole("button", { name: "Remove offline copies" }),
    );
    expect(clearActiveProfile).toHaveBeenCalledOnce();
  });

  it.each(["unsupported", "syncing", "empty mirror"] as const)(
    "keeps destructive and sync controls disabled for %s",
    (scenario) => {
      renderOffline({
        supported: scenario !== "unsupported",
        syncing: scenario === "syncing",
        summary: {
          ...offlineSummary,
          itemCount: scenario === "empty mirror" ? 0 : 3,
        },
      });

      expect(
        screen.getByRole("button", { name: "Sync offline copy now" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Remove offline copies" }),
      ).toBeDisabled();
      expect(screen.getByRole("meter", { name: "Tracks" })).toBeInTheDocument();
    },
  );
});

const download = (
  overrides: Partial<OfflineItemRecord> = {},
): OfflineItemRecord => ({
  key: "album:1",
  kind: "album",
  entityId: "1",
  title: "Mixed Case Album",
  state: "downloading",
  trackCount: 10,
  readyTrackCount: 6,
  totalBytes: 1024,
  tracks: [],
  ...overrides,
});
it("shows real download states and track-based progress without exposing internal errors", () => {
  renderOffline({
    items: [
      download(),
      download({
        key: "playlist:2",
        kind: "playlist",
        entityId: "2",
        title: "A Playlist",
        state: "error",
        errorMessage: "Internal filesystem secret /tmp/cache-123",
      }),
    ],
  });
  const list = screen.getByRole("group", { name: "Downloads on this device" });
  const progress = within(list).getByRole("progressbar", {
    name: "Mixed Case Album",
  });
  expect(progress).toHaveAttribute("aria-valuenow", "60");
  expect(progress).toHaveAttribute("aria-valuetext", "6 / 10 tracks available");
  expect(within(list).getByText("Needs attention")).toBeVisible();
  expect(screen.queryByText(/cache-123/)).not.toBeInTheDocument();
});
it("keeps an unknown download total indeterminate and does not invent zero percent", () => {
  renderOffline({
    items: [download({ trackCount: 0, readyTrackCount: 0, state: "queued" })],
  });
  const progress = screen.getByRole("progressbar", {
    name: "Mixed Case Album",
  });
  expect(progress).not.toHaveAttribute("aria-valuenow");
  expect(progress).not.toHaveAttribute("aria-valuetext");
  expect(screen.getByText("Waiting to download")).toBeVisible();
});
it("keeps offline-identity management read-only even if stale writable callbacks are supplied", async () => {
  const syncAll = vi.fn(async () => {}),
    clearActiveProfile = vi.fn(async () => {});
  renderOffline({ readOnly: true, syncAll, clearActiveProfile });
  const sync = screen.getByRole("button", { name: "Sync offline copy now" });
  const clear = screen.getByRole("button", { name: "Remove offline copies" });
  expect(sync).toBeDisabled();
  expect(clear).toBeDisabled();
  await userEvent.click(clear);
  await userEvent.click(sync);
  expect(syncAll).not.toHaveBeenCalled();
  expect(clearActiveProfile).not.toHaveBeenCalled();
});
it.each(["queued", "error"] as const)(
  "does not present a provisional %s record's zero-byte sentinel as a known file size",
  (state) => {
    renderOffline({
      items: [
        download({
          state,
          totalBytes: 0,
          trackCount: 0,
          readyTrackCount: 0,
          contentVersion: null,
        }),
      ],
    });
    const downloads = screen.getByRole("group", {
      name: "Downloads on this device",
    });
    expect(
      within(downloads).queryByText("Total size 0 B"),
    ).not.toBeInTheDocument();
  },
);
it("retains an actual zero size confirmed by a received manifest", () => {
  renderOffline({
    items: [
      download({
        state: "ready",
        totalBytes: 0,
        trackCount: 0,
        readyTrackCount: 0,
        contentVersion: "empty-v1",
      }),
    ],
  });
  expect(
    within(
      screen.getByRole("group", { name: "Downloads on this device" }),
    ).getByText("Total size 0 B"),
  ).toBeVisible();
});
