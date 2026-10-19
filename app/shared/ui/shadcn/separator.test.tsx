import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Separator } from "./separator";
describe("Separator", () => {
  it("is decorative by default and keeps native props/ref", () => {
    const ref = createRef<HTMLDivElement>();
    render(<Separator ref={ref} data-testid="rule" />);
    expect(screen.queryByRole("separator")).toBeNull();
    expect(ref.current).toBe(screen.getByTestId("rule"));
    expect(ref.current).toHaveAttribute("data-orientation", "horizontal");
  });
  it.each(["horizontal", "vertical"] as const)(
    "can expose a semantic %s separator",
    (orientation) => {
      render(
        <Separator
          decorative={false}
          orientation={orientation}
          aria-label="Between sections"
        />,
      );
      const rule = screen.getByRole("separator", { name: "Between sections" });
      expect(rule).toHaveAttribute("data-orientation", orientation);
      if (orientation === "vertical")
        expect(rule).toHaveAttribute("aria-orientation", "vertical");
    },
  );
});
