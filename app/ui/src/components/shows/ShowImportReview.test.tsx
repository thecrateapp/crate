import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { ShowImportReview } from "./ShowImportReview";
it("retains every tour row, pending count and editable conflicts", async () => {
  const change = vi.fn(),
    select = vi.fn();
  renderWithAdminProviders(
    <ShowImportReview
      candidates={[
        { item_id: "a", date: "2027-03-02" },
        { item_id: "b", date: "2027-03-04" },
        { item_id: "c", date: "2027-03-06" },
      ]}
      selected={["b"]}
      outcomes={[
        { item_id: "a", show_id: 7, status: "created" },
        { item_id: "b", show_id: 8, status: "conflict" },
      ]}
      onChange={change}
      onSelect={select}
    />,
  );
  expect(screen.getByText(/2 unsaved/)).toBeInTheDocument();
  expect(screen.getByLabelText("Artist for show 1")).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Artist for show 2"), "Band");
  expect(change).toHaveBeenCalled();
  expect(screen.getByLabelText("Date for show 3")).toHaveValue("2027-03-06");
  await userEvent.click(screen.getByLabelText("Select show 3"));
  expect(select).toHaveBeenCalledWith(["b", "c"]);
});

it("clears a previously selected artist UID when the artist name is corrected", async () => {
  const change = vi.fn();
  renderWithAdminProviders(
    <ShowImportReview
      candidates={[
        {
          item_id: "a",
          artist_name: "Band",
          artist_uid: "10000000-0000-0000-0000-000000000001",
        },
      ]}
      selected={["a"]}
      onChange={change}
      onSelect={vi.fn()}
    />,
  );
  await userEvent.type(screen.getByLabelText("Artist"), "s");
  expect(change).toHaveBeenLastCalledWith(
    expect.objectContaining({ artist_name: "Bands", artist_uid: null }),
  );
});
