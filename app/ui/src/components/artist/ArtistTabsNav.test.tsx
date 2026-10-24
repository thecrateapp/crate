import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TabKey } from "./artistPageTypes";
import { ArtistTabsNav } from "./ArtistTabsNav";

describe("ArtistTabsNav", () => {
  it("uses shared tabs below the header and connects the active panel", async () => {
    const onChange = vi.fn();
    function Subject() {
      const [active, setActive] = useState<TabKey>("overview");
      return (
        <ArtistTabsNav
          tabs={[
            { key: "overview", label: "Overview" },
            { key: "discography", label: "Discography" },
          ]}
          activeTab={active}
          onChange={(value) => {
            setActive(value);
            onChange(value);
          }}
        >
          <p>{active} content</p>
        </ArtistTabsNav>
      );
    }
    render(<Subject />);
    expect(screen.getByRole("tablist").parentElement).toHaveClass(
      "sticky",
      "top-[var(--app-header-h,0px)]",
    );
    const overview = screen.getByRole("tab", { name: "Overview" });
    expect(overview).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      overview.id,
    );
    overview.focus();
    await userEvent.keyboard("{ArrowRight}");
    const discography = screen.getByRole("tab", { name: "Discography" });
    expect(discography).toHaveFocus();
    expect(discography).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent(
      "discography content",
    );
    expect(onChange).toHaveBeenCalledWith("discography");
  });
});
