import { useState } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PlaybackTargetPicker } from "./PlaybackTargetPicker";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
it("opens with the active target focused, navigates, and restores its trigger", async () => {
  const overlay = vi.fn();
  renderWithListenProviders(
    <PlaybackTargetPicker
      loading={false}
      error={false}
      groups={[
        {
          providerId: "local",
          label: "This device",
          targets: [
            {
              id: "local",
              providerId: "local",
              kind: "local",
              name: "This browser",
              active: true,
              available: true,
              capabilities: {
                canPlay: true,
                canSeek: true,
                canSetVolume: true,
              },
            },
            {
              id: "other",
              providerId: "local",
              kind: "system-route",
              name: "System output",
              active: false,
              available: true,
              capabilities: {
                canPlay: true,
                canSeek: false,
                canSetVolume: false,
              },
            },
          ],
        },
      ]}
      castAction={null}
      pendingTargetId={null}
      onRetry={vi.fn()}
      onTarget={async () => true}
      onDisconnectCast={async () => true}
      onStopCast={async () => true}
      onOverlayChange={overlay}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Output" });
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Output targets" });
  await waitFor(() =>
    expect(
      screen.getByRole("menuitemradio", { name: /This browser/ }),
    ).toHaveFocus(),
  );
  dialog.focus();
  fireEvent.keyDown(dialog, { key: "ArrowUp" });
  expect(
    screen.getByRole("menuitemradio", { name: /System output/ }),
  ).toHaveFocus();
  fireEvent.keyDown(dialog, { key: "End" });
  expect(
    screen.getByRole("menuitemradio", { name: /System output/ }),
  ).toHaveFocus();
  fireEvent.keyDown(dialog, { key: "Home" });
  expect(
    screen.getByRole("menuitemradio", { name: /This browser/ }),
  ).toHaveFocus();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(overlay).toHaveBeenLastCalledWith(false);
});

it("focuses the active remote rather than the first inactive output", async () => {
  const target = {
    providerId: "local",
    kind: "local" as const,
    active: false,
    available: true,
    capabilities: { canPlay: true, canSeek: true, canSetVolume: true },
  };
  renderWithListenProviders(
    <PlaybackTargetPicker
      loading={false}
      error={false}
      groups={[
        {
          providerId: "local",
          label: "This device",
          targets: [
            { ...target, id: "local", name: "Inactive browser" },
            {
              ...target,
              id: "remote",
              kind: "crate-device",
              name: "Active desktop",
              active: true,
            },
          ],
        },
      ]}
      castAction={null}
      pendingTargetId={null}
      onRetry={vi.fn()}
      onTarget={async () => true}
      onDisconnectCast={async () => true}
      onStopCast={async () => true}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Output" }));
  await waitFor(() =>
    expect(
      screen.getByRole("menuitemradio", { name: /Active desktop/ }),
    ).toHaveFocus(),
  );
});

it("does not report a closed overlay when the observer changes", () => {
  const first = vi.fn(),
    second = vi.fn();
  const props = {
    loading: false,
    error: false,
    groups: [],
    castAction: null,
    pendingTargetId: null,
    onRetry: vi.fn(),
    onTarget: async () => true,
    onDisconnectCast: async () => true,
    onStopCast: async () => true,
  };
  function Host() {
    const [changed, setChanged] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setChanged(true)}>
          Change observer
        </button>
        <PlaybackTargetPicker
          {...props}
          onOverlayChange={changed ? second : first}
        />
      </>
    );
  }
  renderWithListenProviders(<Host />);
  fireEvent.click(screen.getByRole("button", { name: "Output" }));
  fireEvent.click(screen.getByRole("button", { name: "Change observer" }));
  expect(first).toHaveBeenCalledTimes(1);
  expect(first).toHaveBeenCalledWith(true);
  expect(screen.getByRole("dialog", { name: "Output targets" })).toBeVisible();
});

it("moves focus from the loading dialog to the active target once discovery completes", async () => {
  const target = {
    id: "desktop",
    providerId: "crate-connect",
    kind: "crate-device" as const,
    name: "Active desktop",
    active: true,
    available: true,
    capabilities: { canPlay: true, canSeek: true, canSetVolume: true },
  };
  function Host() {
    const [loading, setLoading] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setLoading(false)}>
          Complete discovery
        </button>
        <PlaybackTargetPicker
          loading={loading}
          error={false}
          groups={
            loading
              ? []
              : [
                  {
                    providerId: "crate-connect",
                    label: "Crate devices",
                    targets: [target],
                  },
                ]
          }
          castAction={null}
          pendingTargetId={null}
          onRetry={vi.fn()}
          onTarget={async () => true}
          onDisconnectCast={async () => true}
          onStopCast={async () => true}
        />
      </>
    );
  }
  renderWithListenProviders(<Host />);
  fireEvent.click(screen.getByRole("button", { name: "Output" }));
  expect(screen.getByRole("dialog")).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Complete discovery" }));
  await waitFor(() =>
    expect(
      screen.getByRole("menuitemradio", { name: /Active desktop/ }),
    ).toHaveFocus(),
  );
});
