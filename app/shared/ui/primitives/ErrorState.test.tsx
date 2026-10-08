import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

import { ErrorState } from "./ErrorState";

describe("ErrorState", () => {
  it("renders default message", () => {
    render(<ErrorState />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("renders custom message", () => {
    render(<ErrorState message="Custom error" />);
    expect(screen.getByText("Custom error")).toBeInTheDocument();
  });

  it("does not render retry button when onRetry is missing", () => {
    render(<ErrorState />);
    expect(
      screen.queryByRole("button", { name: /Retry/i }),
    ).not.toBeInTheDocument();
  });

  it("renders retry button when onRetry is provided", () => {
    render(<ErrorState onRetry={() => {}} />);
    expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
  });

  it("calls onRetry when retry button is clicked", async () => {
    const handleRetry = vi.fn();
    render(<ErrorState onRetry={handleRetry} />);
    await userEvent.click(screen.getByRole("button", { name: /Retry/i }));
    expect(handleRetry).toHaveBeenCalledTimes(1);
  });

  it("uses a translated retry label", () => {
    render(<ErrorState onRetry={() => {}} retryLabel="Reintentar" />);
    expect(
      screen.getByRole("button", { name: /Reintentar/i }),
    ).toBeInTheDocument();
  });

  it("announces generic errors as an alert", () => {
    render(<ErrorState />);
    expect(screen.getByRole("alert")).toHaveAttribute("data-kind", "error");
  });

  it("renders a not found state with title, default copy hidden and back link", () => {
    render(
      <MemoryRouter>
        <ErrorState
          kind="notFound"
          title="Album not found"
          backTo="/library"
          backLabel="Back to library"
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Album not found" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("We couldn't find what you were looking for"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to library" }),
    ).toHaveAttribute("href", "/library");
  });

  it("renders unavailable kind default copy and a custom action slot", () => {
    render(
      <ErrorState
        kind="unavailable"
        action={<button type="button">Log in</button>}
      />,
    );

    expect(
      screen.getByText("This is unavailable right now"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
  });
});
