import { useState } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppModal } from "@crate/ui/primitives/AppModal";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { DIGGING_CHAPTER_MS, DiggingStory } from "./DiggingStory";

const chapters = ["One", "Two", "Three"].map((label) => ({
  key: label,
  label,
  render: () => <p>{`Chapter ${label}`}</p>,
}));

describe("DiggingStory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("advances on its own and stops on the last chapter", () => {
    renderWithListenProviders(
      <DiggingStory chapters={chapters} onClose={vi.fn()} />,
    );

    expect(screen.getByText("Chapter One")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(DIGGING_CHAPTER_MS);
    });
    expect(screen.getByText("Chapter Two")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(DIGGING_CHAPTER_MS * 3);
    });
    expect(screen.getByText("Chapter Three")).toBeInTheDocument();
  });

  it("navigates with the keyboard and closes with Escape", () => {
    const onClose = vi.fn();
    renderWithListenProviders(
      <DiggingStory chapters={chapters} onClose={onClose} />,
    );
    const dialog = screen.getByRole("dialog");

    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(screen.getByText("Chapter Two")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(screen.getByText("Chapter One")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks background scrolling, contains Tab and restores the launcher on unmount", () => {
    const launcher = document.createElement("button");
    document.body.append(launcher);
    launcher.focus();
    const previous = document.body.style.overflow;
    const { unmount } = renderWithListenProviders(
      <DiggingStory chapters={chapters} onClose={vi.fn()} />,
    );
    expect(document.body.style.overflow).toBe("hidden");
    const close = screen.getByRole("button", { name: "Close" });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    unmount();
    expect(document.body.style.overflow).toBe(previous);
    expect(document.activeElement).toBe(launcher);
    launcher.remove();
  });

  it("keeps a global share modal locked and focused if navigation unmounts Digging first", () => {
    const originalBody = document.body.style.overflow,
      originalHtml = document.documentElement.style.overflow;
    const launcher = document.createElement("button");
    document.body.append(launcher);
    launcher.focus();
    let change!: (state: { story: boolean; share: boolean }) => void;
    function Fixture() {
      const [state, setState] = useState({ story: true, share: false });
      change = setState;
      return (
        <>
          {state.story ? (
            <DiggingStory chapters={chapters} onClose={vi.fn()} />
          ) : null}
          <AppModal
            open={state.share}
            onClose={vi.fn()}
            ariaLabel="Share music"
          >
            <button type="button">Prepare image</button>
          </AppModal>
        </>
      );
    }
    renderWithListenProviders(<Fixture />);
    act(() => change({ story: true, share: true }));
    act(() => vi.advanceTimersByTime(20));
    const share = screen.getByRole("dialog", { name: "Share music" });
    act(() => change({ story: false, share: true }));
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(share.contains(document.activeElement)).toBe(true);
    act(() => change({ story: false, share: false }));
    expect(document.body.style.overflow).toBe(originalBody);
    expect(document.documentElement.style.overflow).toBe(originalHtml);
    launcher.remove();
  });

  it("pauses while the chapter is held down", () => {
    renderWithListenProviders(
      <DiggingStory chapters={chapters} onClose={vi.fn()} />,
    );
    const chapter = screen.getByText("Chapter One").closest("section")!;

    fireEvent.pointerDown(chapter);
    act(() => {
      vi.advanceTimersByTime(DIGGING_CHAPTER_MS * 2);
    });
    expect(screen.getByText("Chapter One")).toBeInTheDocument();
  });
});
