import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { StatNumber } from "./StatNumber";

describe("StatNumber", () => {
  it("renders the value in the display face with a mono caption", () => {
    render(<StatNumber value="+4" label="1K" />);

    expect(screen.getByText("+4")).toHaveClass(
      "font-display",
      "tabular-nums",
      "text-numeral-md",
    );
    expect(screen.getByText("1K")).toHaveClass("font-mono", "uppercase");
  });

  it("maps sizes to the type scale and centres when asked", () => {
    const { container } = render(
      <StatNumber value={12} size="lg" align="center" />,
    );

    expect(screen.getByText("12")).toHaveClass("text-numeral-lg");
    expect(container.firstElementChild).toHaveClass("items-center");
    expect(container.querySelector(".font-mono")).toBeNull();
  });

  it.each(["sm", "md", "lg", "xl"] as const)(
    "uses the %s numeral tier with tabular figures",
    (size) => {
      render(<StatNumber value="48,000" size={size} />);

      expect(screen.getByText("48,000")).toHaveClass(
        `text-numeral-${size}`,
        "font-display",
        "tabular-nums",
        size === "lg" || size === "xl" ? "font-extrabold" : "font-bold",
      );
    },
  );

  it.each(["lg", "xl"] as const)(
    "uses the hero numeral tracking and leading for %s",
    (size) => {
      render(<StatNumber value="900" size={size} />);

      expect(screen.getByText("900")).toHaveClass(
        "tracking-numeral",
        "leading-numeral",
      );
    },
  );

  it("uses the small numeral tracking for compact readouts", () => {
    render(<StatNumber value="2.3" size="sm" />);

    expect(screen.getByText("2.3")).toHaveClass("tracking-numeral-sm");
  });

  it("keeps the mono unit on the same baseline as the numeral", () => {
    render(<StatNumber value="41" unit="min" label="Listening" />);

    const value = screen.getByText("41");
    const unit = screen.getByText("min");
    expect(unit).toHaveClass("font-mono", "text-label", "text-text-subtle");
    expect(value.parentElement).toBe(unit.parentElement);
    expect(unit.parentElement).toHaveClass("inline-flex", "items-baseline");
    expect(
      value.compareDocumentPosition(unit) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("places the label below the value by default", () => {
    render(<StatNumber value="900" label="Artists" />);

    expect(
      screen
        .getByText("900")
        .compareDocumentPosition(screen.getByText("Artists")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("places the label above the value for definition-list layouts", () => {
    render(<StatNumber value="900" label="Artists" labelPosition="above" />);

    expect(
      screen
        .getByText("Artists")
        .compareDocumentPosition(screen.getByText("900")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each(["span", "dd", "div"] as const)(
    "supports the %s element without losing the numeral",
    (as) => {
      const { container } = render(<StatNumber value="12" as={as} />);

      expect(container.firstElementChild?.tagName.toLowerCase()).toBe(as);
      expect(screen.getByText("12")).toHaveClass("tabular-nums");
    },
  );

  it("aligns a readout to the start by default", () => {
    const { container } = render(<StatNumber value="12" />);

    expect(container.firstElementChild).toHaveClass("items-start");
    expect(container.firstElementChild).not.toHaveClass("items-center");
  });

  it("preserves a ref-owned value node across label updates", () => {
    const valueRef = createRef<HTMLSpanElement>();
    const { rerender } = render(
      <StatNumber value={<span ref={valueRef}>12</span>} label="Tracks" />,
    );
    const valueNode = valueRef.current;
    expect(valueNode).toBe(screen.getByText("12"));
    valueNode!.textContent = "13";

    rerender(
      <StatNumber
        value={<span ref={valueRef}>12</span>}
        label="Library tracks"
      />,
    );

    expect(valueRef.current).toBe(valueNode);
    expect(valueNode).toHaveTextContent("13");
    expect(screen.getByText("Library tracks")).toBeInTheDocument();
  });
});
