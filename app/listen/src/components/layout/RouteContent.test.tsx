import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteContent } from "./RouteContent";
afterEach(() => vi.useRealTimers());
describe("route identity focus", () => {
  it("leaves initial/filter renders alone and focuses a changed route after settling", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <RouteContent pathname="/library">
        <h1>Library</h1>
      </RouteContent>,
    );
    act(() => vi.advanceTimersByTime(350));
    expect(screen.getByRole("heading")).not.toHaveFocus();
    rerender(
      <RouteContent pathname="/search">
        <h1>Search</h1>
      </RouteContent>,
    );
    act(() => vi.advanceTimersByTime(350));
    expect(screen.getByRole("heading")).toHaveFocus();
  });
  it("does not steal focus after the user starts another interaction", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <RouteContent pathname="/a">
        <h1>A</h1>
      </RouteContent>,
    );
    rerender(
      <RouteContent pathname="/b">
        <h1>B</h1>
        <button type="button">Action</button>
      </RouteContent>,
    );
    const action = screen.getByRole("button");
    action.focus();
    fireEvent.pointerDown(action);
    act(() => vi.advanceTimersByTime(350));
    expect(action).toHaveFocus();
  });
  it("waits for an asynchronously mounted heading", async () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <RouteContent pathname="/a">
        <h1>A</h1>
      </RouteContent>,
    );
    rerender(
      <RouteContent pathname="/b">
        <span>Loading</span>
      </RouteContent>,
    );
    act(() => vi.advanceTimersByTime(350));
    rerender(
      <RouteContent pathname="/b">
        <h1>B</h1>
      </RouteContent>,
    );
    await act(async () => {});
    expect(screen.getByRole("heading")).toHaveFocus();
  });

  it("focuses the new heading without a ring on a touch screen", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(hover: none)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const { rerender } = render(
      <RouteContent pathname="/artists/a">
        <h1>Artist</h1>
      </RouteContent>,
    );
    rerender(
      <RouteContent pathname="/artists/b">
        <h1>Other artist</h1>
      </RouteContent>,
    );
    act(() => vi.advanceTimersByTime(350));
    expect(screen.getByRole("heading")).toHaveFocus();
    expect(focus).toHaveBeenLastCalledWith({
      preventScroll: true,
      focusVisible: false,
    });
    focus.mockRestore();
    vi.unstubAllGlobals();
  });
});
