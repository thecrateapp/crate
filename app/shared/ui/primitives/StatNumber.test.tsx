import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatNumber } from "./StatNumber";

describe("StatNumber", () => {
  it("renders the value in the display face with a mono caption", () => {
    render(<StatNumber value="+4" label="1K" />);

    expect(screen.getByText("+4")).toHaveClass(
      "font-display",
      "tabular-nums",
      "text-3xl",
    );
    expect(screen.getByText("1K")).toHaveClass("font-mono", "uppercase");
  });

  it("maps sizes to the type scale and centres when asked", () => {
    const { container } = render(
      <StatNumber value={12} size="lg" align="center" />,
    );

    expect(screen.getByText("12")).toHaveClass("text-5xl");
    expect(container.firstElementChild).toHaveClass("items-center");
    expect(container.querySelector(".font-mono")).toBeNull();
  });
});
