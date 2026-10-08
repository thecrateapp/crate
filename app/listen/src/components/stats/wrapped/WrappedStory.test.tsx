import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { WRAPPED_CHAPTER_MS, WrappedStory } from "./WrappedStory";

const chapters = ["One", "Two", "Three"].map((label) => ({
  key: label,
  label,
  render: () => <p>{`Chapter ${label}`}</p>,
}));

describe("WrappedStory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("advances on its own and stops on the last chapter", () => {
    renderWithListenProviders(
      <WrappedStory chapters={chapters} onClose={vi.fn()} />,
    );

    expect(screen.getByText("Chapter One")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(WRAPPED_CHAPTER_MS);
    });
    expect(screen.getByText("Chapter Two")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(WRAPPED_CHAPTER_MS * 3);
    });
    expect(screen.getByText("Chapter Three")).toBeInTheDocument();
  });

  it("navigates with the keyboard and closes with Escape", () => {
    const onClose = vi.fn();
    renderWithListenProviders(
      <WrappedStory chapters={chapters} onClose={onClose} />,
    );
    const dialog = screen.getByRole("dialog");

    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(screen.getByText("Chapter Two")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(screen.getByText("Chapter One")).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pauses while the chapter is held down", () => {
    renderWithListenProviders(
      <WrappedStory chapters={chapters} onClose={vi.fn()} />,
    );
    const chapter = screen.getByText("Chapter One").closest("section")!;

    fireEvent.pointerDown(chapter);
    act(() => {
      vi.advanceTimersByTime(WRAPPED_CHAPTER_MS * 2);
    });
    expect(screen.getByText("Chapter One")).toBeInTheDocument();
  });
});
