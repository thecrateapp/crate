import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SidebarBrand } from "./SidebarBrand";

describe("SidebarBrand", () => {
  it("uses the theme-aware Crate logo in the expanded sidebar", () => {
    const { container } = render(
      <SidebarBrand
        discoveryGlowStrength={0}
        discoveryRadioActive={false}
        expanded
        onCollapse={vi.fn()}
        onExpand={vi.fn()}
        collapseLabel="Collapse sidebar"
        expandLabel="Expand sidebar"
      />,
    );

    const logo = screen.getByRole("img", { name: "Crate" });
    expect(logo.tagName).toBe("svg");
    expect(logo).toHaveAttribute("data-crate-logo-effects", "off");
    expect(container.querySelector("img[src='/icons/logo.svg']")).toBeNull();
  });

  it("uses the theme-aware Crate logo in the collapsed sidebar", () => {
    const { container } = render(
      <SidebarBrand
        discoveryGlowStrength={0}
        discoveryRadioActive={false}
        expanded={false}
        onCollapse={vi.fn()}
        onExpand={vi.fn()}
        collapseLabel="Collapse sidebar"
        expandLabel="Expand sidebar"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toBeVisible();
    const logo = container.querySelector("svg.crate-logo");
    expect(logo).toHaveAttribute("data-crate-logo-effects", "off");
    expect(container.querySelector("img[src='/icons/logo.svg']")).toBeNull();
  });
});
