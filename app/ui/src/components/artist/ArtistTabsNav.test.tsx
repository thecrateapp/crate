import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ArtistTabsNav } from "./ArtistTabsNav";

describe("ArtistTabsNav", () => {
  it("sticks below the fixed app header and switches tabs", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <ArtistTabsNav
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "discography", label: "Discography" },
        ]}
        activeTab="overview"
        onChange={onChange}
      />,
    );
    const bar = container.firstElementChild;
    expect(bar).toHaveClass("sticky", "top-[var(--app-header-h,0px)]");
    expect(bar).not.toHaveClass("top-0");
    await userEvent.click(screen.getByRole("button", { name: "Discography" }));
    expect(onChange).toHaveBeenCalledWith("discography");
  });
});
