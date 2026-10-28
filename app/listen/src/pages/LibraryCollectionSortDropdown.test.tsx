import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { CollectionSortDropdown } from "./LibraryCollectionSortDropdown";
it("uses the canonical Select trigger and keyboard menu with the existing values", () => {
  const change = vi.fn();
  renderWithListenProviders(
    <CollectionSortDropdown
      label="Sort albums"
      value="recent"
      onChange={change}
      options={[
        { value: "recent", labelKey: "library.sort.recent" },
        { value: "name", labelKey: "common.name" },
      ]}
    />,
  );
  expect(screen.getByRole("combobox")).toHaveAttribute(
    "data-slot",
    "select-trigger",
  );
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  expect(screen.getByRole("listbox")).toBeVisible();
});
