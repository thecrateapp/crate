import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { api } from "@/lib/api";
import { ShowConsolidationEditor } from "./ShowConsolidationEditor";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
it("loads real revisions and requires an explicit canonical/duplicate choice", async () => {
  vi.mocked(api).mockResolvedValue({
    items: [
      {
        id: 7,
        revision: 2,
        artist_name: "Band",
        date: "2027-03-02",
        venue: "Hall",
        city: "City",
        attendance_count: 1,
        reminder_count: 1,
      },
      {
        id: 8,
        revision: 3,
        artist_name: "Band",
        date: "2027-03-02",
        venue: "Hall",
        city: "City",
        attendance_count: 0,
        reminder_count: 0,
      },
    ],
  });
  const review = vi.fn();
  renderWithAdminProviders(
    <ShowConsolidationEditor disabled={false} onReview={review} />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByText("Consolidate existing shows"));
  await user.type(
    screen.getByLabelText("Existing show IDs, separated by commas"),
    "7,8",
  );
  await user.click(
    screen.getByRole("button", { name: "Load shows for consolidation" }),
  );
  expect(
    await screen.findByRole("button", { name: "Review exact consolidation" }),
  ).toBeDisabled();
  await user.click(screen.getByLabelText("Transfer this duplicate"));
  await user.click(
    screen.getByRole("button", { name: "Review exact consolidation" }),
  );
  expect(review).toHaveBeenCalledWith({
    canonical_show_id: 7,
    duplicate_show_ids: [8],
    revisions: { "7": 2, "8": 3 },
  });
});
