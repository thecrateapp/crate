import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Disc, Music } from "@crate/ui/icons";

import { EmptyState, MediaGrid, MediaRail, SectionHeader } from "./index";

describe("lists", () => {
  describe("MediaGrid", () => {
    it("renders children and applies className", () => {
      const { getByTestId } = render(
        <MediaGrid className="custom-grid">
          <div data-testid="grid-child">Item</div>
        </MediaGrid>,
      );

      expect(getByTestId("grid-child")).toBeInTheDocument();
      expect(getByTestId("grid-child").parentElement).toHaveClass(
        "custom-grid",
      );
    });

    it("uses the default density aligned with rail columns", () => {
      const { getByTestId } = render(
        <MediaGrid>
          <div>Item</div>
        </MediaGrid>,
      );

      const grid = getByTestId("media-grid");
      expect(grid).toHaveAttribute("data-density", "default");
      expect(grid).toHaveClass(
        "grid-cols-2",
        "md:grid-cols-4",
        "2xl:grid-cols-7",
      );
    });

    it.each([
      ["compact", "grid-cols-3"],
      ["wide", "grid-cols-1"],
    ] as const)("applies the %s density", (density, className) => {
      const { getByTestId } = render(
        <MediaGrid density={density}>
          <div>Item</div>
        </MediaGrid>,
      );

      expect(getByTestId("media-grid")).toHaveClass(className);
    });

    it("applies a custom min item width", () => {
      const { container } = render(
        <MediaGrid minItemWidth={200}>
          <div>Item</div>
        </MediaGrid>,
      );

      const grid = container.firstChild as HTMLElement;
      expect(grid).toHaveStyle("--media-grid-min: 200px");
      expect(grid).toHaveStyle(
        "grid-template-columns: repeat(auto-fill, minmax(var(--media-grid-min), 1fr))",
      );
      expect(grid).not.toHaveAttribute("data-density");
    });
  });

  describe("MediaRail", () => {
    it("renders children horizontally", () => {
      const { getByTestId } = render(
        <MediaRail className="custom-rail">
          <div data-testid="rail-child">Item</div>
        </MediaRail>,
      );

      expect(getByTestId("rail-child")).toBeInTheDocument();
      expect(getByTestId("rail-child").parentElement).toHaveClass("flex");
      expect(getByTestId("rail-child").parentElement).toHaveClass(
        "[&>*]:shrink-0",
      );
      expect(getByTestId("media-rail")).toHaveClass("custom-rail");
      expect(getByTestId("media-rail")).toHaveAttribute(
        "data-rail-fit",
        "content",
      );
    });

    it("lays out items in rail columns with fit=columns", () => {
      const { getByTestId } = render(
        <MediaRail fit="columns">
          <div>Item</div>
        </MediaRail>,
      );

      const rail = getByTestId("media-rail");
      expect(rail).toHaveClass("grid", "grid-flow-col");
      expect(rail).not.toHaveClass("flex");
    });

    it("snaps cards flush with the section header start", () => {
      const { getByTestId } = render(
        <MediaRail fit="columns">
          <div>Item</div>
        </MediaRail>,
      );

      const rail = getByTestId("media-rail");
      expect(rail).toHaveClass("snap-x", "snap-mandatory");
      expect(rail.className).not.toMatch(
        /(^|\s)(scroll-px|scroll-pl|px|pl|-mx|-ml)-/,
      );
    });

    it("exposes a labelled region when labelledBy is set", () => {
      const { getByRole } = render(
        <>
          <h2 id="rail-title">New releases</h2>
          <MediaRail labelledBy="rail-title">
            <div>Item</div>
          </MediaRail>
        </>,
      );

      expect(getByRole("region", { name: "New releases" })).toBeInTheDocument();
    });
  });

  describe("SectionHeader", () => {
    it("renders title, subtitle, and action", () => {
      const { getByText, getByTestId } = render(
        <SectionHeader
          title="Featured"
          subtitle="Hand-picked for you"
          action={<button type="button">See all</button>}
        />,
      );

      expect(getByText("Featured")).toBeInTheDocument();
      expect(getByText("Hand-picked for you")).toBeInTheDocument();
      expect(getByText("See all")).toBeInTheDocument();
      expect(getByTestId("section-header")).toBeInTheDocument();
    });

    it("renders without subtitle or action", () => {
      const { getByText, queryByText } = render(
        <SectionHeader title="Featured" />,
      );

      expect(getByText("Featured")).toBeInTheDocument();
      expect(queryByText("Hand-picked for you")).not.toBeInTheDocument();
      expect(queryByText("See all")).not.toBeInTheDocument();
    });

    it("renders an h2 by default and supports custom heading levels", () => {
      const { getByRole, rerender } = render(<SectionHeader title="Recent" />);
      expect(
        getByRole("heading", { level: 2, name: "Recent" }),
      ).toBeInTheDocument();

      rerender(<SectionHeader title="Recent" as="h1" size="display" />);
      expect(getByRole("heading", { level: 1, name: "Recent" })).toHaveClass(
        "text-3xl",
      );
    });

    it("links the heading id for aria-labelledby consumers", () => {
      const { getByRole } = render(
        <section aria-labelledby="sec-title">
          <SectionHeader id="sec-title" title="Mixes" />
        </section>,
      );

      expect(getByRole("region", { name: "Mixes" })).toBeInTheDocument();
      expect(getByRole("heading", { name: "Mixes" })).toHaveAttribute(
        "id",
        "sec-title",
      );
    });

    it("renders the count next to the title", () => {
      const { getByTestId } = render(
        <SectionHeader title="Albums" count={42} />,
      );
      expect(getByTestId("section-header-count")).toHaveTextContent("42");
    });

    it("renders the default action button from actionLabel and onAction", async () => {
      const onAction = vi.fn();
      const { getByRole } = render(
        <SectionHeader
          title="Mixes"
          actionLabel="See all"
          onAction={onAction}
        />,
      );

      const button = getByRole("button", { name: "See all" });
      expect(button).toHaveAttribute("type", "button");
      await userEvent.click(button);
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  describe("EmptyState", () => {
    it("renders title, message, and default icon", () => {
      const { getByText, getByTestId, container } = render(
        <EmptyState
          title="No music"
          message="Add some tracks to get started."
        />,
      );

      expect(getByTestId("empty-state")).toBeInTheDocument();
      expect(getByText("No music")).toBeInTheDocument();
      expect(getByText("Add some tracks to get started.")).toBeInTheDocument();
      expect(container.querySelector("svg")).toBeInTheDocument();
    });

    it("renders a custom icon", () => {
      const { container } = render(
        <EmptyState icon={Disc} title="No albums" />,
      );

      expect(container.querySelector("svg")).toBeInTheDocument();
    });

    it("does not render title or message when omitted", () => {
      const { container } = render(<EmptyState icon={Music} />);

      expect(container.querySelector("svg")).toBeInTheDocument();
      expect(container.textContent).toBe("");
    });

    it("renders the inline variant without an icon by default", () => {
      const { getByTestId, container } = render(
        <EmptyState variant="inline" description="Nothing here yet" />,
      );

      expect(getByTestId("empty-state")).toHaveAttribute(
        "data-variant",
        "inline",
      );
      expect(container.querySelector("svg")).not.toBeInTheDocument();
    });

    it("renders the dashed variant with heading, description and action", async () => {
      const onAction = vi.fn();
      const { getByRole, getByText, getByTestId } = render(
        <EmptyState
          variant="dashed"
          title="No crates"
          titleAs="h2"
          description="Create one to start collecting."
          action={
            <button type="button" onClick={onAction}>
              Create crate
            </button>
          }
        />,
      );

      expect(getByTestId("empty-state")).toHaveClass("border-dashed");
      expect(
        getByRole("heading", { level: 2, name: "No crates" }),
      ).toBeInTheDocument();
      expect(getByText("Create one to start collecting.")).toBeInTheDocument();
      await userEvent.click(getByRole("button", { name: "Create crate" }));
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("hides the panel icon when icon is null", () => {
      const { container } = render(<EmptyState icon={null} title="Empty" />);
      expect(container.querySelector("svg")).not.toBeInTheDocument();
    });
  });
});
