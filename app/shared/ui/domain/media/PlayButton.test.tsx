import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PlayButton } from "./PlayButton";

describe("PlayButton", () => {
  it("renders an English default label with a round token style", () => {
    render(<PlayButton />);
    const button = screen.getByRole("button", { name: "Play" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass(
      "rounded-full",
      "bg-accent-action",
      "shadow-action",
      "size-11",
      "focus-visible:shadow-focus",
    );
    expect(button).toHaveAttribute("data-state", "idle");
  });

  it("uses custom labels and switches to pause while playing", () => {
    const { rerender } = render(
      <PlayButton label="Reproducir" pauseLabel="Pausar" />,
    );
    expect(
      screen.getByRole("button", { name: "Reproducir" }),
    ).toBeInTheDocument();
    rerender(<PlayButton label="Reproducir" pauseLabel="Pausar" playing />);
    const button = screen.getByRole("button", { name: "Pausar" });
    expect(button).toHaveAttribute("data-state", "playing");
  });

  it("maps sizes", () => {
    render(
      <>
        <PlayButton size="sm" label="Small" />
        <PlayButton size="lg" label="Large" />
      </>,
    );
    expect(screen.getByRole("button", { name: "Small" })).toHaveClass(
      "size-10",
    );
    expect(screen.getByRole("button", { name: "Large" })).toHaveClass(
      "size-14",
    );
  });

  it("hides until hover or focus when reveal is hover", () => {
    render(<PlayButton reveal="hover" />);
    const button = screen.getByRole("button");
    expect(button).toHaveClass(
      "pointer-fine:opacity-0",
      "pointer-fine:group-hover:opacity-100",
      "pointer-fine:group-hover/card:opacity-100",
      "focus-visible:opacity-100",
    );
  });

  it("stays visible while playing even with hover reveal", () => {
    render(<PlayButton reveal="hover" playing />);
    expect(screen.getByRole("button")).not.toHaveClass(
      "pointer-fine:opacity-0",
    );
  });

  it("marks busy while loading and keeps the click", async () => {
    const onClick = vi.fn();
    render(<PlayButton loading onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Play" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("data-state", "loading");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("lets aria-label override the label", () => {
    render(<PlayButton aria-label="Play Album" />);
    expect(
      screen.getByRole("button", { name: "Play Album" }),
    ).toBeInTheDocument();
  });
});
