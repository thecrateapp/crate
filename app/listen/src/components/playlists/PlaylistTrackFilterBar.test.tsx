import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { PlaylistTrackFilterBar } from "./PlaylistTrackFilterBar";
it("uses the canonical search control, separate uppercase count and clear semantics", () => {
  const onQueryChange = vi.fn();
  renderWithListenProviders(
    <PlaylistTrackFilterBar
      query="night"
      totalCount={5}
      filteredCount={3}
      onQueryChange={onQueryChange}
    />,
  );
  const search = screen.getByRole("searchbox");
  expect(search.className).not.toMatch(
    /md:text-base|pr-28|bg-surface-canvas\/10/,
  );
  expect(screen.getByText(/3 of 5/)).toHaveClass("font-mono", "uppercase");
  expect(screen.getByRole("button", { name: "Clear filter" })).toHaveClass(
    "crate-form-search-clear",
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
  expect(onQueryChange).toHaveBeenCalledWith("");
  expect(search).toHaveFocus();
});
