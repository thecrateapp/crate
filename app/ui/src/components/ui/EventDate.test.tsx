import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventDate } from "./EventDate";
describe("EventDate", () => {
  it("shows month/day/weekday and exposes the complete calendar date", () => {
    const { container } = render(<EventDate date="2026-10-24" />);
    expect(screen.getByText("OCT")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("SAT")).toBeInTheDocument();
    expect(container.querySelector("time")).toHaveAttribute(
      "dateTime",
      "2026-10-24",
    );
    expect(container.querySelector("time")).toHaveAttribute(
      "aria-label",
      "Sat, Oct 24, 2026",
    );
  });
  it.each(["", "bad-date", "2026-02-30", "2026-13-12"])(
    "does not invent a date for %s",
    (date) => {
      const { container } = render(<EventDate date={date} />);
      expect(screen.getByLabelText("Unknown date")).toHaveTextContent(
        date || "—",
      );
      expect(container.querySelector("time")).toBeNull();
    },
  );
  it("keeps a real date's source when the field is detection time", () => {
    const { container } = render(
      <EventDate date="2026-10-20" labelPrefix="Detected" />,
    );
    expect(container.querySelector("time")).toHaveAttribute(
      "aria-label",
      "Detected · Tue, Oct 20, 2026",
    );
  });
});
