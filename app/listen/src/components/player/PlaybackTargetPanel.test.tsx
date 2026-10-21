import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlaybackTargetPanel } from "./PlaybackTargetPanel";
import type { PlaybackTargetGroup } from "@/lib/playback-target-types";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const cast: PlaybackTargetGroup = {
  providerId: "google-cast",
  label: "Cast",
  targets: [
    {
      id: "tv",
      providerId: "google-cast",
      kind: "google-cast",
      name: "Living room TV",
      active: true,
      available: true,
      capabilities: { canPlay: true, canSeek: true, canSetVolume: true },
    },
  ],
};
const unavailable: PlaybackTargetGroup = {
  providerId: "crate-connect",
  label: "Crate devices",
  targets: [
    {
      id: "desktop",
      providerId: "crate-connect",
      kind: "crate-device",
      name: "Studio",
      active: false,
      available: false,
      unavailableReason: "Switch playback to this device first.",
      capabilities: { canPlay: false, canSeek: false, canSetVolume: false },
    },
  ],
};
const props = {
  loading: false,
  error: false,
  groups: [cast, unavailable],
  castAction: null,
  pendingTargetId: null,
  onTarget: vi.fn(),
  onRetry: vi.fn(),
  onDisconnectCast: vi.fn(),
  onStopCast: vi.fn(),
};
describe("PlaybackTargetPanel", () => {
  it("keeps real active/unavailable states and separate Cast actions", () => {
    renderWithListenProviders(<PlaybackTargetPanel {...props} />);
    expect(
      screen.getByRole("menuitemradio", { name: /Living room TV/ }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("menuitemradio", { name: /Studio/ }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText("Switch playback to this device first."),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: /Disconnect/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Stop casting/ }));
    expect(props.onDisconnectCast).toHaveBeenCalledOnce();
    expect(props.onStopCast).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: /Living room TV/ }),
    );
    expect(props.onTarget).toHaveBeenCalledWith(cast.targets[0]);
  });
  it("distinguishes load failure from empty and retries", () => {
    renderWithListenProviders(
      <PlaybackTargetPanel {...props} groups={[]} error />,
    );
    expect(screen.getByRole("alert")).toBeVisible();
    expect(
      screen.queryByText("No output targets found."),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(props.onRetry).toHaveBeenCalledOnce();
  });
  it("retains healthy groups when one provider fails", () => {
    renderWithListenProviders(
      <PlaybackTargetPanel
        {...props}
        groups={[
          cast,
          {
            providerId: "native-output",
            label: "System routes",
            targets: [],
            error: "Targets unavailable",
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("menuitemradio", { name: /Living room TV/ }),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toBeVisible();
    expect(screen.queryByText("Targets unavailable")).not.toBeInTheDocument();
  });
  it("announces connecting and prevents duplicate target/session actions", () => {
    renderWithListenProviders(
      <PlaybackTargetPanel {...props} pendingTargetId="tv" />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Connecting");
    for (const button of [
      ...screen.getAllByRole("menuitemradio"),
      ...screen.getAllByRole("menuitem"),
    ])
      expect(button).toBeDisabled();
  });
  it("uses the full-width loading state without showing stale targets", () => {
    renderWithListenProviders(<PlaybackTargetPanel {...props} loading />);
    expect(
      screen.getByRole("status", { name: "Loading targets..." }),
    ).toBeVisible();
    expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
  });
});
