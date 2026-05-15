import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CardSkeleton } from "./card-skeleton";

describe("CardSkeleton", () => {
  it("renders two skeleton elements", () => {
    const { container } = render(<CardSkeleton />);
    expect(container.querySelectorAll(".bg-card").length).toBe(1);
  });
});
