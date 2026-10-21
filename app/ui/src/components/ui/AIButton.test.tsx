import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AIButton } from "./AIButton";

const { useActionLLMStatusMock } = vi.hoisted(() => ({
  useActionLLMStatusMock: vi.fn(),
}));

vi.mock("@/hooks/use-llm", () => ({
  useActionLLMStatus: useActionLLMStatusMock,
}));

beforeEach(() => {
  useActionLLMStatusMock.mockReturnValue({
    available: true,
    model: "test-model",
    provider: "test",
  });
});

describe("AIButton", () => {
  it("renders children", () => {
    render(<AIButton actionId="genres.eq.propose">Generate</AIButton>);
    expect(
      screen.getByRole("button", { name: /Generate/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button").querySelector("svg")).toHaveAttribute(
      "data-admin-ux",
      "ai-bot",
    );
    expect(screen.getByRole("button").querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByRole("button").querySelector("svg")).toHaveClass(
      "size-4",
      "scale-125",
    );
  });

  it("does not render when the LLM is unavailable", () => {
    useActionLLMStatusMock.mockReturnValue({
      available: false,
      model: "",
      provider: "",
      error: "LLM provider is not configured",
    });

    render(<AIButton actionId="genres.eq.propose">Generate</AIButton>);

    expect(
      screen.queryByRole("button", { name: /Generate/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the standard admin button sizing", () => {
    render(
      <div className="h-20">
        <AIButton actionId="genres.eq.propose">Research with AI</AIButton>
      </div>,
    );

    const button = screen.getByRole("button", { name: /Research with AI/i });
    expect(button).toHaveClass("h-8", "px-3", "text-sm");
    expect(button).not.toHaveClass("h-full", "text-xs");
    expect(button.parentElement).toHaveClass("inline-flex");
    expect(button.parentElement).not.toHaveClass("self-stretch");
  });

  it("shows spinner when loading", () => {
    render(
      <AIButton actionId="genres.eq.propose" loading>
        Generate
      </AIButton>,
    );
    expect(screen.getByRole("button").querySelector("svg")).toHaveClass(
      "animate-spin",
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button").querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("is disabled when loading", () => {
    render(
      <AIButton actionId="genres.eq.propose" loading>
        Generate
      </AIButton>,
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("is disabled when disabled prop is true", () => {
    render(
      <AIButton actionId="genres.eq.propose" disabled>
        Generate
      </AIButton>,
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("calls onClick when clicked", async () => {
    const handleClick = vi.fn();
    render(
      <AIButton actionId="genres.eq.propose" onClick={handleClick}>
        Generate
      </AIButton>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
