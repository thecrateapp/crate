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

  it("renders rotating indicator when pulling", () => {
    const { container } = render(
      <PullIndicator distance={20} refreshing={false} />,
    );
    expect(container.firstChild).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });
});
