import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
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

    it("applies the default min item width", () => {
      const { container } = render(
        <MediaGrid>
          <div>Item</div>
        </MediaGrid>,
      );

      const grid = container.firstChild as HTMLElement;
      expect(grid).toHaveStyle("--media-grid-min: 160px");
      expect(grid).toHaveStyle(
        "grid-template-columns: repeat(auto-fill, minmax(var(--media-grid-min), 1fr))",
      );
    });

    it("applies a custom min item width", () => {
      const { container } = render(
        <MediaGrid minItemWidth={200}>
          <div>Item</div>
        </MediaGrid>,
      );

      expect(container.firstChild as HTMLElement).toHaveStyle(
        "--media-grid-min: 200px",
      );
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
  });
});
