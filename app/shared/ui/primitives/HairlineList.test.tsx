import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { formatRowIndex, HairlineList, HairlineRow } from "./HairlineList";

describe("HairlineList", () => {
  it("renders numbered rows with hairline dividers and a trailing slot", () => {
    render(
      <HairlineList label="Probable setlist">
        <HairlineRow index={1} trailing={<span>92%</span>}>
          Shanty
        </HairlineRow>
        <HairlineRow index={2} muted>
          Skin in the Game
        </HairlineRow>
      </HairlineList>,
    );

    const list = screen.getByRole("list", { name: "Probable setlist" });
    expect(list.tagName).toBe("OL");
    const [first, second] = within(list).getAllByRole("listitem");
    expect(first).toHaveClass("border-b", "border-border-quiet-subtle");
    expect(first).toHaveTextContent("01Shanty92%");
    expect(second).toHaveAttribute("data-muted", "true");
    expect(within(second!).getByText("Skin in the Game")).toHaveClass(
      "text-text-subtle",
    );
  });

  it("omits the index column when no index is given", () => {
    render(
      <HairlineList as="ul">
        <HairlineRow>Untitled</HairlineRow>
      </HairlineList>,
    );

    expect(screen.getByRole("listitem")).toHaveTextContent(/^Untitled$/);
  });

  it("pads row indices to two digits", () => {
    expect(formatRowIndex(3)).toBe("03");
    expect(formatRowIndex(12)).toBe("12");
  });
});
