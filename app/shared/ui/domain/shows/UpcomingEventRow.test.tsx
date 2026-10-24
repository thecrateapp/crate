import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { UpcomingEventRow } from "./UpcomingEventRow";

describe("UpcomingEventRow layout slots", () => {
  it.each([1, 2])(
    "keeps date and actions in fixed sibling lanes with %i action(s)",
    (actionCount) => {
      const { container } = render(
        <MemoryRouter>
          <UpcomingEventRow
            artwork={<img alt="" src="/cover.jpg" />}
            details={<span>Artist and event</span>}
            date={<time data-slot="upcoming-date">Oct 24</time>}
            actions={Array.from({ length: actionCount }, (_, index) => (
              <button key={index} type="button">
                Action {index + 1}
              </button>
            ))}
            href="/event"
            openLabel="Open event"
          />
        </MemoryRouter>,
      );

      const row = container.querySelector('[data-slot="upcoming-event-row"]');
      const identity = row?.querySelector('a[aria-label="Open event"]');
      const dateSlot = row?.querySelector(
        '[data-slot="upcoming-event-date-slot"]',
      );
      const actionsSlot = row?.querySelector(
        '[data-slot="upcoming-event-actions-slot"]',
      );

      expect(identity?.contains(dateSlot ?? null)).toBe(false);
      expect(dateSlot?.nextElementSibling).toBe(actionsSlot);
      expect(dateSlot).toHaveClass("w-14", "shrink-0");
      expect(actionsSlot).toHaveClass("w-28", "shrink-0");
      expect(actionsSlot?.querySelectorAll("button")).toHaveLength(actionCount);
    },
  );
});
