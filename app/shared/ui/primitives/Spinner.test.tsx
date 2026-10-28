import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Spinner } from "./Spinner";

describe("Spinner", () => {
  it("renders an svg icon", () => {
    const { container } = render(<Spinner />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("applies default size", () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveStyle({ fontSize: "18px" });
    expect(svg).toHaveAttribute("width", "1em");
  });

  it("applies custom size", () => {
    const { container } = render(<Spinner size={24} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveStyle({ fontSize: "24px" });
    expect(svg).toHaveAttribute("width", "1em");
  });

  it("includes animate-spin class", () => {
    const { container } = render(<Spinner />);
    expect(container.querySelector("svg")).toHaveClass("animate-spin");
  });
});
