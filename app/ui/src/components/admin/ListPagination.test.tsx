import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ListPagination } from "./ListPagination";

function PaginationHarness() {
  const [page, setPage] = useState(2);
  return (
    <ListPagination
      label="playlists"
      itemCount={43}
      page={page}
      pageSize={20}
      onPageChange={setPage}
    />
  );
}

describe("ListPagination", () => {
  it("announces the visible range and navigates between pages", () => {
    render(<PaginationHarness />);

    expect(screen.getByText("21–40 of 43 · page 2 of 3")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Next playlists page" }),
    );
    expect(screen.getByText("41–43 of 43 · page 3 of 3")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Next playlists page" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Previous playlists page" }),
    );
    expect(screen.getByText("21–40 of 43 · page 2 of 3")).toBeInTheDocument();
  });
});
