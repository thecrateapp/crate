import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MonoLabel } from "./MonoLabel";

describe("MonoLabel", () => {
  describe.each(["label", "eyebrow"] as const)("%s case contract", (size) => {
    it.each(["normal-case", "lowercase", "capitalize"])(
      "keeps uppercase when the caller supplies %s, without rewriting the content",
      (className) => {
        render(
          <MonoLabel size={size} className={className}>
            Natural case
          </MonoLabel>,
        );
        const label = screen.getByText("Natural case");
        expect(label).toHaveClass("uppercase");
        expect(label).not.toHaveClass(className);
        expect(label.textContent).toBe("Natural case");
      },
    );
  });
  it("offers an accent tone without changing type, case, semantics or value text", () => {
    render(
      <MonoLabel as="h2" tone="accent">
        Interface
      </MonoLabel>,
    );
    const heading = screen.getByRole("heading", {
      name: "Interface",
      level: 2,
    });
    expect(heading).toHaveClass(
      "text-accent-action-hi",
      "uppercase",
      "font-mono",
      "font-normal",
      "text-label",
      "tracking-caps",
    );
    expect(heading).not.toHaveClass("text-text-subtle");
    expect(heading).toHaveTextContent("Interface");
    expect(heading).not.toHaveAttribute("tone");
  });

  it("renders the accent key word before the metadata", () => {
    render(
      <MonoLabel accent="Upcoming show" meta={["Ticketmaster", "Last.fm"]} />,
    );

    expect(screen.getByText("Upcoming show")).toHaveClass(
      "text-accent-action-hi",
      "mr-2.5",
    );
    expect(screen.getByText(/Upcoming show/).parentElement).toHaveTextContent(
      "Upcoming show Ticketmaster · Last.fm",
    );
  });

  it("drops empty metadata parts without leaving stray separators", () => {
    const { container } = render(
      <MonoLabel
        meta={[null, "Barcelona", undefined, "", false, "Razzmatazz", null]}
      />,
    );

    expect(container.firstElementChild).toHaveTextContent(
      "Barcelona · Razzmatazz",
    );
    expect(container.querySelectorAll("[aria-hidden='true']")).toHaveLength(1);
    expect(container.querySelector("[aria-hidden='true']")).toHaveTextContent(
      "·",
    );
  });

  it("uses the mono label tokens and the requested element", () => {
    render(
      <MonoLabel as="h2" accent="Next show">
        extra
      </MonoLabel>,
    );

    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveClass(
      "font-mono",
      "text-label",
      "uppercase",
      "tracking-caps",
      "text-text-subtle",
    );
    expect(heading).toHaveTextContent("Next show extra");
  });

  it("passes native attributes and ARIA relationships to the label element", () => {
    render(
      <MonoLabel
        as="div"
        id="library-heading"
        role="heading"
        aria-level={2}
        aria-describedby="library-description"
        title="Library summary"
        className="text-text-primary"
      >
        Library
      </MonoLabel>,
    );

    const heading = screen.getByRole("heading", { level: 2, name: "Library" });
    expect(heading).toHaveAttribute("id", "library-heading");
    expect(heading).toHaveAttribute("aria-describedby", "library-description");
    expect(heading).toHaveAttribute("title", "Library summary");
    expect(heading).toHaveClass("text-label", "text-text-primary");
    expect(heading).not.toHaveClass("text-text-subtle");
  });

  it.each(["dt", "figcaption", "legend"] as const)(
    "supports a semantic %s label",
    (as) => {
      render(<MonoLabel as={as}>Tracks</MonoLabel>);

      expect(screen.getByText("Tracks").tagName.toLowerCase()).toBe(as);
    },
  );

  it("uses the eyebrow size without changing the metadata semantics", () => {
    render(<MonoLabel size="eyebrow" meta={["Library", "Overview"]} />);

    const label = screen.getByText("Library").parentElement;
    expect(label).toHaveClass("font-mono", "text-eyebrow", "tracking-kicker");
    expect(label).not.toHaveClass("text-label", "tracking-caps");
    expect(label?.querySelector("[aria-hidden='true']")).toHaveTextContent("·");
  });

  it("does not render separators when all metadata is empty", () => {
    const { container } = render(
      <MonoLabel meta={[null, undefined, false, ""]}>No metadata</MonoLabel>,
    );

    expect(container.firstElementChild).toHaveTextContent("No metadata");
    expect(container.querySelector("[aria-hidden='true']")).toBeNull();
  });
});
