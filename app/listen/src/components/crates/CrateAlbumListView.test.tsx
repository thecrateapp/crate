import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import {
  CrateAlbumListView,
  CrateAlbumListItem,
  CrateAlbumPreviewRowView,
} from "./CrateAlbumListView";
it("uses the actual section/count and ranked non-interactive public album identity", () => {
  renderWithListenProviders(
    <CrateAlbumListView count={1}>
      <CrateAlbumListItem>
        <CrateAlbumPreviewRowView
          title="Night music"
          artist="Chelsea Wolfe"
          year="2026"
          rank={1}
          artwork={<span>Cover</span>}
        />
      </CrateAlbumListItem>
    </CrateAlbumListView>,
  );
  expect(
    screen.getByRole("heading", { name: "The records" }),
  ).toBeInTheDocument();
  expect(screen.getByText("1 album")).toHaveClass("uppercase", "font-mono");
  expect(screen.getByText("Chelsea Wolfe").closest(".uppercase")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByRole("listitem")).toHaveClass(
    "pointer-fine:hover:bg-accent-action/[0.04]",
  );
});
it("uses the canonical actual empty crate state", () => {
  renderWithListenProviders(<CrateAlbumListView count={0} />);
  expect(
    screen.getByText("This Crate does not have any albums yet."),
  ).toBeInTheDocument();
});
