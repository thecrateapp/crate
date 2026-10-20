import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ShowPlanSummary } from "./ShowPlanSummary";
import type { ShowCandidate, ShowPlan } from "./show-import-types";

const candidates: ShowCandidate[] = [
  { item_id: "a", artist_name: "Band", date: "2027-03-02" },
  { item_id: "b", artist_name: "Band", date: "2027-03-04" },
];

function plan(overrides: Partial<ShowPlan>): ShowPlan {
  return {
    plan_id: "d105bd45-92c0-4f99-b12a-bb1cc8910fa1",
    plan_version: "a".repeat(64),
    executable: true,
    changes: [],
    ...overrides,
  };
}

function fieldRow(card: HTMLElement, label: string) {
  const term = within(card).getByText(label, { selector: "dt" });
  const row = term.closest<HTMLElement>("[data-status]")!;
  const value = term.nextElementSibling as HTMLElement;
  return { row, value };
}

it("shows an update as before → after, highlights each change and counts the rest", () => {
  render(
    <ShowPlanSummary
      plan={plan({
        changes: [
          {
            item_id: "a",
            before: {
              artist_name: "Band",
              date: "2027-03-02",
              venue: "Hall",
              city: "Madrid",
              url: "https://old.test/show",
            },
            after: {
              item_id: "a",
              artist_name: "Band",
              date: "2027-03-02",
              venue: "Hall Annex",
              city: "Madrid",
              url: null,
            },
          },
        ],
      })}
      candidates={candidates}
      onUseExisting={vi.fn()}
      onUseArtist={vi.fn()}
    />,
  );
  const card = screen.getByRole("listitem");
  expect(within(card).getByText("Update")).toBeVisible();
  expect(within(card).queryByText("New")).toBeNull();

  const venue = fieldRow(card, "Venue");
  expect(venue.row).toHaveAttribute("data-status", "changed");
  expect(venue.row.className).toContain("bg-state-warning");
  expect(venue.value).toHaveTextContent(/^Hall\s*→.*Hall Annex$/);

  const link = fieldRow(card, "Event link");
  expect(link.row).toHaveAttribute("data-status", "cleared");
  expect(link.row.className).toContain("bg-state-warning");
  expect(link.value).toHaveTextContent(
    /^https:\/\/old\.test\/show\s*→.*Cleared$/,
  );

  expect(within(card).queryByText("Artist", { selector: "dt" })).toBeNull();
  expect(within(card).getByText("3 unchanged fields")).toBeVisible();
});

it("names each issue's actions after its row while keeping the visible text", async () => {
  const onUseExisting = vi.fn();
  const onUseArtist = vi.fn();
  render(
    <ShowPlanSummary
      plan={plan({
        executable: false,
        issues: [
          { item_id: "a", reason: "May already be saved", matches: [41] },
          {
            item_id: "b",
            reason: "May already be saved",
            matches: [42],
            artist_matches: [{ artist_uid: "uid-9", name: "Band" }],
          },
        ],
      })}
      candidates={candidates}
      onUseExisting={onUseExisting}
      onUseArtist={onUseArtist}
    />,
  );
  const update = screen.getByRole("button", {
    name: "Update the existing show (Show 2)",
  });
  expect(update).toHaveTextContent(/^Update the existing show$/);
  expect(
    screen.getByRole("link", { name: "View it (Show 1)" }),
  ).toHaveAttribute("href", "/shows?show_id=41");
  expect(
    screen.getByRole("link", { name: "View it (Show 2)" }),
  ).toHaveTextContent(/^View it$/);
  const artist = screen.getByRole("button", { name: "Use Band (Show 2)" });
  expect(artist).toHaveAttribute("title", "uid-9");
  const user = userEvent.setup();
  await user.click(update);
  expect(onUseExisting).toHaveBeenCalledWith("b", 42);
  await user.click(artist);
  expect(onUseArtist).toHaveBeenCalledWith("b", {
    artist_uid: "uid-9",
    name: "Band",
  });
});
