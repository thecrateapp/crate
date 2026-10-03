import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import * as HomeSections from "@/components/home/HomeSections";
import { SectionHeader, SectionRail } from "@/components/home/HomeSections";

describe("SectionHeader", () => {
  it("keeps the view-all action without rendering rail navigation buttons", () => {
    const onAction = vi.fn();

    render(
      <SectionHeader
        title="Recently played"
        actionLabel="View all"
        onAction={onAction}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /View all/i }));

    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe("SectionRail", () => {
  it("renders children without rail scroll tracking", () => {
    const observe = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(() => ({ observe, disconnect: vi.fn(), unobserve: vi.fn() })),
    );

    render(
      <SectionRail fit="square-card">
        <span>Item</span>
      </SectionRail>,
    );

    expect(screen.getByText("Item")).toBeTruthy();
    expect(observe).not.toHaveBeenCalled();
    expect("useSectionRail" in HomeSections).toBe(false);
    vi.unstubAllGlobals();
  });
});
