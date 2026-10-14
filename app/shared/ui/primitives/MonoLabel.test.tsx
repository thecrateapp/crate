import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MonoLabel } from "./MonoLabel";

describe("MonoLabel", () => {
  it("renders the accent key word before the metadata", () => {
    render(
      <MonoLabel accent="Upcoming show" meta={["Ticketmaster", "Last.fm"]} />,
    );

    expect(screen.getByText("Upcoming show")).toHaveClass(
      "text-accent-action-hi",
    );
    expect(screen.getByText(/Upcoming show/).parentElement).toHaveTextContent(
      "Upcoming show Ticketmaster · Last.fm",
    );
  });

  it("drops empty metadata parts without leaving stray separators", () => {
    const { container } = render(
      <MonoLabel meta={["Barcelona", null, "", false, "Razzmatazz"]} />,
    );

    expect(container.firstElementChild).toHaveTextContent(
      "Barcelona · Razzmatazz",
    );
    expect(container.querySelectorAll("[aria-hidden='true']")).toHaveLength(1);
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
});
