import { useState } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@crate/ui/lib/use-hover-capability", () => ({
  useHoverCapability: () => true,
}));
import { PlayerVolumeControl } from "./PlayerVolumeControl";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function Host() {
  const [volume, setVolume] = useState(0.65);
  return (
    <PlayerVolumeControl
      volume={volume}
      onVolumeChange={setVolume}
      onOverlayChange={() => {}}
    />
  );
}
it("hover opens without stealing focus and the icon mutes/restores", () => {
  renderWithListenProviders(<Host />);
  const mute = screen.getByRole("button", { name: "Mute" });
  mute.focus();
  fireEvent.pointerEnter(mute, { pointerType: "mouse" });
  const slider = screen.getByRole("slider", { name: "Volume" });
  expect(mute).toHaveFocus();
  expect(slider).toHaveAttribute("aria-valuenow", "65");
  fireEvent.click(mute);
  expect(slider).toHaveAttribute("aria-valuenow", "0");
  fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
  expect(slider).toHaveAttribute("aria-valuenow", "65");
  fireEvent.pointerLeave(mute, { pointerType: "mouse" });
  act(() => vi.advanceTimersByTime(2500));
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
});
it("keyboard opens/focuses the slider and prevents idle dismissal until focus leaves", () => {
  renderWithListenProviders(<Host />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Mute" }), {
    key: "ArrowUp",
  });
  const slider = screen.getByRole("slider", { name: "Volume" });
  expect(slider).toHaveFocus();
  act(() => vi.advanceTimersByTime(6000));
  expect(slider).toBeVisible();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mute" })).toHaveFocus();
});

it("hover dismissal does not consume the next player action or redirect focus", () => {
  const action = vi.fn();
  renderWithListenProviders(
    <>
      <Host />
      <button type="button" onClick={action}>
        Next track
      </button>
    </>,
  );
  fireEvent.pointerEnter(screen.getByRole("button", { name: "Mute" }), {
    pointerType: "mouse",
  });
  const next = screen.getByRole("button", { name: "Next track" });
  fireEvent.pointerDown(next, { pointerType: "mouse" });
  fireEvent.click(next);
  expect(action).toHaveBeenCalledOnce();
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
});
it("a keyboard focus request on an open hover does not leak into the next hover", () => {
  renderWithListenProviders(
    <>
      <Host />
      <button type="button">Other control</button>
    </>,
  );
  const mute = screen.getByRole("button", { name: "Mute" });
  fireEvent.pointerEnter(mute, { pointerType: "mouse" });
  fireEvent.keyDown(mute, { key: "ArrowUp" });
  expect(screen.getByRole("slider")).toHaveFocus();
  fireEvent.keyDown(window, { key: "Escape" });
  const other = screen.getByRole("button", { name: "Other control" });
  other.focus();
  fireEvent.pointerEnter(mute, { pointerType: "mouse" });
  expect(screen.getByRole("slider")).toBeVisible();
  expect(other).toHaveFocus();
});
it("hybrid touch opens the slider with its separate mute action", () => {
  renderWithListenProviders(<Host />);
  const mute = screen.getByRole("button", { name: "Mute" });
  fireEvent.pointerDown(mute, { pointerType: "touch" });
  fireEvent.click(mute);
  const dialog = screen.getByRole("dialog", { name: "Volume" });
  expect(dialog.querySelector('button[aria-label="Mute"]')).not.toBeNull();
});

it("consumes wheel scrolling only over the volume button and popover", () => {
  const { unmount } = renderWithListenProviders(<Host />);
  const button = screen.getByRole("button", { name: "Mute" });
  fireEvent.pointerEnter(button, { pointerType: "mouse" });
  const slider = screen.getByRole("slider", { name: "Volume" });
  expect(fireEvent.wheel(button, { deltaY: 100, cancelable: true })).toBe(
    false,
  );
  expect(slider).toHaveAttribute("aria-valuenow", "62");
  expect(
    fireEvent.wheel(slider, { deltaX: -100, shiftKey: true, cancelable: true }),
  ).toBe(false);
  expect(slider).toHaveAttribute("aria-valuenow", "63");
  expect(
    fireEvent.wheel(screen.getByRole("dialog", { name: "Volume" }), {
      deltaY: -100,
      cancelable: true,
    }),
  ).toBe(false);
  expect(slider).toHaveAttribute("aria-valuenow", "66");
  expect(
    fireEvent.wheel(document.body, { deltaY: 100, cancelable: true }),
  ).toBe(true);
  fireEvent.keyDown(slider, { key: "End" });
  expect(fireEvent.wheel(slider, { deltaY: -100, cancelable: true })).toBe(
    false,
  );
  expect(slider).toHaveAttribute("aria-valuenow", "100");
  unmount();
  expect(fireEvent.wheel(button, { deltaY: 100, cancelable: true })).toBe(true);
  expect(fireEvent.wheel(slider, { deltaY: 100, cancelable: true })).toBe(true);
});

it("does not change volume for an empty wheel event", () => {
  renderWithListenProviders(<Host />);
  fireEvent.pointerEnter(screen.getByRole("button", { name: "Mute" }), {
    pointerType: "mouse",
  });
  const slider = screen.getByRole("slider", { name: "Volume" });
  fireEvent.wheel(slider, { deltaY: 0, deltaX: 0, cancelable: true });
  expect(slider).toHaveAttribute("aria-valuenow", "65");
});
