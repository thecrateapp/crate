import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "@crate/ui/shadcn/button";
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
    expect(useActionLLMStatusMock).toHaveBeenCalledWith("genres.eq.propose");
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

  it.each([
    { available: false, error: "LLM provider is not configured" },
    null,
    undefined,
  ])("does not render without an available action model (%j)", (status) => {
    useActionLLMStatusMock.mockReturnValue(status);

    const { container } = render(
      <AIButton actionId="genres.eq.propose">Generate</AIButton>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("uses the shared primary recipe and 44px size without a decorative wrapper", () => {
    const { container } = render(
      <>
        <AIButton actionId="genres.eq.propose">Research with AI</AIButton>
        <Button size="lg">Canonical action</Button>
      </>,
    );

    const button = screen.getByRole("button", { name: "Research with AI" });
    const canonical = screen.getByRole("button", { name: "Canonical action" });
    expect(button.className).toBe(canonical.className);
    expect(button).toHaveAttribute("data-variant", "default");
    expect(button).toHaveAttribute("data-size", "lg");
    expect(button).toHaveClass("h-11");
    expect(button.parentElement).toBe(container);
    expect(container.children).toHaveLength(2);
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
    expect(screen.getByRole("button").querySelector("svg")).toHaveAttribute(
      "data-slot",
      "button-spinner",
    );
    expect(screen.getByRole("button").querySelectorAll("svg")).toHaveLength(1);
    expect(document.querySelector('[data-admin-ux="ai-bot"]')).toBeNull();
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

  it("keeps the button stable while pending and blocks duplicate activation", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <AIButton actionId="playlists.description.generate" onClick={onClick}>
        Generate description with AI
      </AIButton>,
    );
    const button = screen.getByRole("button", {
      name: "Generate description with AI",
    });
    button.focus();
    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <AIButton
        actionId="playlists.description.generate"
        onClick={onClick}
        loading
      >
        Generate description with AI
      </AIButton>,
    );
    expect(screen.getByRole("button")).toBe(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <AIButton actionId="playlists.description.generate" onClick={onClick}>
        Generate description with AI
      </AIButton>,
    );
    expect(screen.getByRole("button")).toBe(button);
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button.querySelector('[data-admin-ux="ai-bot"]')).not.toBeNull();
    expect(button.querySelector('[data-slot="button-spinner"]')).toBeNull();
  });

  it("forwards consumer button attributes and refs", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <AIButton
        actionId="playlists.description.generate"
        type="submit"
        className="w-full"
        aria-describedby="generation-help"
        ref={ref}
      >
        Generate
      </AIButton>,
    );
    const button = screen.getByRole("button", { name: "Generate" });
    expect(ref.current).toBe(button);
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveAttribute("aria-describedby", "generation-help");
    expect(button).toHaveClass("w-full");
  });
});
