import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UpcomingDateStamp } from "./UpcomingDateStamp";
import { itemKey } from "./upcoming-model";
import type { UpcomingItem } from "./upcoming-types";
describe("Upcoming dates and identity", () => {
  it.each(["", "not-a-date", "2030-02-31"])(
    "omits missing or impossible dates: %s",
    (date) => {
      const { container } = render(
        <UpcomingDateStamp date={date} locale="en" />,
      );
      expect(container).toBeEmptyDOMElement();
    },
  );
  it("formats the actual local date in the requested language", () => {
    render(<UpcomingDateStamp date="2030-01-20" locale="es" />);
    expect(
      screen.getByLabelText("domingo, 20 de enero de 2030"),
    ).toHaveAttribute("datetime", "2030-01-20");
  });
  it("keeps an identified show key when filtering changes its list position", () => {
    const show: UpcomingItem = {
      id: 42,
      type: "show",
      date: "2030-01-20",
      artist: "Converge",
      title: "Venue",
      subtitle: "City",
      cover_url: null,
      status: "onsale",
      is_upcoming: true,
    };
    expect(itemKey(show, 0)).toBe(itemKey(show, 7));
  });
});
