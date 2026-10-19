import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

function Specimen({
  orientation = "horizontal",
  manual = false,
}: {
  orientation?: "horizontal" | "vertical";
  manual?: boolean;
}) {
  return (
    <Tabs
      defaultValue="overview"
      orientation={orientation}
      activationMode={manual ? "manual" : "automatic"}
    >
      <TabsList aria-label="Artist panels">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="unavailable" disabled>
          Unavailable
        </TabsTrigger>
        <TabsTrigger value="albums">Albums</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">Artist summary</TabsContent>
      <TabsContent value="albums">Album list</TabsContent>
    </Tabs>
  );
}

describe("shared text tabs", () => {
  it("owns one decorative moving indicator without changing tab semantics", () => {
    const { container } = render(<Specimen />);
    const indicator = container.querySelector('[data-slot="tabs-indicator"]');
    expect(indicator).toHaveAttribute("aria-hidden", "true");
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });
  it("names the tablist and connects the selected tab to its panel", () => {
    render(<Specimen />);
    expect(
      screen.getByRole("tablist", { name: "Artist panels" }),
    ).toHaveAttribute("aria-orientation", "horizontal");
    const selected = screen.getByRole("tab", { name: "Overview" });
    const panel = screen.getByRole("tabpanel", { name: "Overview" });
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(selected).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", selected.id);
    expect(screen.getByRole("tab", { name: "Albums" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("uses roving keyboard focus, skips disabled tabs and wraps with Home/End", async () => {
    const user = userEvent.setup();
    render(<Specimen />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Albums" })).toHaveFocus();
    expect(screen.getByRole("tabpanel", { name: "Albums" })).toHaveTextContent(
      "Album list",
    );
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Albums" })).toHaveFocus();
    await user.keyboard("{Home}{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Albums" })).toHaveFocus();
  });

  it("preserves manual activation and vertical keyboard navigation", async () => {
    const user = userEvent.setup();
    render(<Specimen orientation="vertical" manual />);
    await user.tab();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("tab", { name: "Albums" })).toHaveFocus();
    expect(screen.getByRole("tabpanel", { name: "Overview" })).toBeVisible();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("tabpanel", { name: "Albums" })).toBeVisible();
  });

  it("preserves controlled callbacks and the line variant", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    render(
      <Tabs value="one" onValueChange={change}>
        <TabsList variant="line" aria-label="Controlled">
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one">First panel</TabsContent>
      </Tabs>,
    );
    await user.click(screen.getByRole("tab", { name: "Two" }));
    expect(change).toHaveBeenCalledWith("two");
    expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tablist")).toHaveAttribute("data-variant", "line");
  });
});
