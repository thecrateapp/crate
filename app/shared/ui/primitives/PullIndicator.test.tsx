import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PullIndicator } from "./PullIndicator";

describe("PullIndicator", () => {
  it("returns null when distance is 0 and not refreshing", () => {
    const { container } = render(
      <PullIndicator distance={0} refreshing={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders spinner when refreshing", () => {
    const { container } = render(<PullIndicator distance={0} refreshing />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders pull circle when distance > 0", () => {
    const { container } = render(
      <PullIndicator distance={20} refreshing={false} />,
    );
    expect(container.querySelector("div > div")).toBeInTheDocument();
  });

  it("applies correct height when refreshing", () => {
    const { container } = render(<PullIndicator distance={0} refreshing />);
    expect(container.firstChild).toHaveStyle({ height: "40px" });
  });

  it("applies distance height when not refreshing", () => {
    const { container } = render(
      <PullIndicator distance={25} refreshing={false} />,
    );
    expect(container.firstChild).toHaveStyle({ height: "25px" });
  });
});
