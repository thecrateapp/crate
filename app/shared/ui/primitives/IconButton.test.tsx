import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("uses label for aria-label and title", () => {
    render(
      <IconButton label="Shuffle">
        <svg />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Shuffle" });
    expect(button).toHaveAttribute("title", "Shuffle");
    expect(button).toHaveAttribute("type", "button");
  });

  it("allows overriding the title", () => {
    render(
      <IconButton label="Shuffle" title="Shuffle queue">
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole("button")).toHaveAttribute(
      "title",
      "Shuffle queue",
    );
  });

  it("applies sizes and the coarse-pointer hit area", () => {
    render(
      <>
        <IconButton label="Small" size="sm">
          <svg />
        </IconButton>
        <IconButton label="Large" size="lg">
          <svg />
        </IconButton>
      </>,
    );
    const small = screen.getByRole("button", { name: "Small" });
    expect(small).toHaveClass(
      "size-8",
      "after:size-11",
      "pointer-fine:after:hidden",
    );
    expect(screen.getByRole("button", { name: "Large" })).toHaveClass(
      "size-11",
    );
  });

  it("defaults to md size with a focus ring", () => {
    render(
      <IconButton label="Medium">
        <svg />
      </IconButton>,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveClass("size-10", "focus-visible:shadow-focus");
    expect(button).toHaveAttribute("data-size", "md");
  });

  it("applies tone and card variant", () => {
    render(
      <IconButton label="Delete" tone="danger" variant="card">
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole("button")).toHaveClass(
      "text-state-danger",
      "bg-surface-icon-control",
    );
  });

  it("reflects aria-pressed as the active state", () => {
    render(
      <IconButton label="Repeat" aria-pressed={true}>
        <svg />
      </IconButton>,
    );
    const button = screen.getByRole("button", {
      name: "Repeat",
      pressed: true,
    });
    expect(button).toHaveClass(
      "text-accent-action",
      "animate-crate-icon-active-pulse",
    );
  });

  it("supports active without aria-pressed", () => {
    render(
      <IconButton label="Lyrics" active>
        <svg />
      </IconButton>,
    );
    const button = screen.getByRole("button");
    expect(button).not.toHaveAttribute("aria-pressed");
    expect(button).toHaveAttribute("data-active", "true");
  });

  it("disables and shows a spinner while loading", async () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Start" loading onClick={onClick}>
        <span data-testid="icon" />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Start" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("icon")).not.toBeInTheDocument();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("forwards refs", () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(
      <IconButton ref={ref} label="Ref">
        <svg />
      </IconButton>,
    );
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
