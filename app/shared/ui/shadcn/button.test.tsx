import type * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";

describe("Button", () => {
  it("renders as button by default", () => {
    render(<Button>Click me</Button>);
    expect(
      screen.getByRole("button", { name: /Click me/i }),
    ).toBeInTheDocument();
  });

  it("is disabled when disabled prop is true", () => {
    render(<Button disabled>Click me</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("calls onClick when clicked", async () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("applies variant data attribute", () => {
    render(<Button variant="destructive">Delete</Button>);
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-variant",
      "destructive",
    );
  });

  it("uses semantic tokens for the default action", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button")).toHaveClass(
      "bg-accent-action",
      "text-accent-action-foreground",
    );
  });

  it("offsets the focus ring on the accent-filled default action", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button");
    expect(button).toHaveClass(
      "focus-visible:outline-solid",
      "focus-visible:outline-2",
      "focus-visible:outline-offset-2",
      "focus-visible:outline-focus-ring",
    );
    expect(button).not.toHaveClass("focus-visible:shadow-focus");
  });

  it("keeps the flush focus ring on non-filled variants", () => {
    render(<Button variant="outline">Cancel</Button>);
    const button = screen.getByRole("button");
    expect(button).toHaveClass(
      "focus-visible:border-border-focus",
      "focus-visible:shadow-focus",
    );
    expect(button).not.toHaveClass("focus-visible:outline-offset-2");
  });

  it("applies size data attribute", () => {
    render(<Button size="sm">Small</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("data-size", "sm");
  });

  it("renders as child when asChild is true", () => {
    render(
      <Button asChild>
        <a href="/link">Link button</a>
      </Button>,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/link");
  });
});

describe("Button extensions", () => {
  it("defaults to type=button", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("keeps an explicit submit type", () => {
    render(<Button type="submit">Save</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
  });

  it("does not submit a parent form by default", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Inline</Button>
      </form>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not force a type on asChild elements", () => {
    render(
      <Button asChild>
        <a href="/x">Link</a>
      </Button>,
    );
    expect(screen.getByRole("link")).not.toHaveAttribute("type");
  });

  it("renders a pill shape", () => {
    render(<Button shape="pill">Pill</Button>);
    const button = screen.getByRole("button");
    expect(button).toHaveClass("rounded-full");
    expect(button).not.toHaveClass("rounded-md");
    expect(button).toHaveAttribute("data-shape", "pill");
  });

  it("keeps the rect shape by default", () => {
    render(<Button>Rect</Button>);
    expect(screen.getByRole("button")).toHaveClass("rounded-md");
  });

  it("shows a spinner, disables and marks busy while loading", async () => {
    const onClick = vi.fn();
    const { container } = render(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Saving" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(
      container.querySelector("[data-slot='button-spinner']"),
    ).toBeInTheDocument();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("supports the danger-soft variant with state tokens", () => {
    render(<Button variant="danger-soft">Remove</Button>);
    expect(screen.getByRole("button")).toHaveClass(
      "bg-state-danger/10",
      "text-state-danger-text",
    );
  });

  it("uses opacity 50 when disabled", () => {
    render(<Button disabled>Off</Button>);
    expect(screen.getByRole("button")).toHaveClass("disabled:opacity-50");
  });
});
