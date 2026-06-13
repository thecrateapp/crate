import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SectionHeader } from "@/components/home/HomeSections";

describe("SectionHeader", () => {
  it("keeps the view-all action without rendering rail navigation buttons", () => {
    const onAction = vi.fn();

    render(
      <SectionHeader
        title="Recently played"
        actionLabel="View all"
        onAction={onAction}
        railControls={{
          canScrollLeft: true,
          canScrollRight: true,
          onScrollLeft: vi.fn(),
          onScrollRight: vi.fn(),
        }}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Scroll Recently played left" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Scroll Recently played right" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /View all/i }));

    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
