import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { UpcomingMonthGroup } from "./UpcomingRows";
vi.mock("./ShowCard", () => ({
  ShowCard: ({ onToggle }: { onToggle: () => void }) => (
    <button type="button" onClick={onToggle}>
      Sample show
    </button>
  ),
}));
vi.mock("./ReleaseRow", () => ({ ReleaseRow: () => <p>Sample release</p> }));
it("names the month group and preserves show expansion through its common frame", () => {
  const toggle = vi.fn();
  render(
    <UpcomingMonthGroup
      month="2026-11"
      items={[
        {
          type: "show",
          event_key: "show-1",
          artist: "Costa Norte",
          date: "2026-11-03",
          title: "Sample venue",
          subtitle: "Sample city",
          cover_url: null,
          status: "onsale",
          is_upcoming: true,
        },
      ]}
      expandedId={null}
      onToggleExpand={toggle}
    />,
  );
  expect(
    screen.getByRole("group", { name: "November 2026" }),
  ).toContainElement(screen.getByRole("button", { name: "Sample show" }));
  fireEvent.click(screen.getByRole("button", { name: "Sample show" }));
  expect(toggle).toHaveBeenCalledWith("show-1");
});
