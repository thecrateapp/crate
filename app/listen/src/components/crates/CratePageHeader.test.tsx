import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Button } from "@crate/ui/shadcn/button";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import type { CrateDetail } from "@/pages/crates-types";
import { CrateHero } from "./CratePageHeader";
const emptyCrate: CrateDetail = {
  id: "empty",
  owner_id: 1,
  owner_name: "Diego",
  name: "Empty collection",
  description: "",
  visibility: "private",
  is_collaborative: false,
  is_ordered: false,
  sort_direction: "asc",
  loop_enabled: false,
  access: "owner",
  album_count: 0,
  track_count: 0,
  first_album: null,
  albums: [],
};
it("keeps the empty crate on the shared content-sized hero contract with its actions visible", () => {
  renderWithListenProviders(
    <CrateHero
      crate={emptyCrate}
      albums={[]}
      coverUrl={() => null}
      followerCount={0}
      actions={<Button>Add albums</Button>}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Empty collection" }),
  ).toBeVisible();
  expect(screen.getByTestId("page-hero")).toHaveAttribute(
    "data-height",
    "content",
  );
  expect(screen.getByRole("button", { name: "Add albums" })).toBeVisible();
  expect(screen.queryByTestId("crate-coverflow")).not.toBeInTheDocument();
  expect(screen.getByText("0 albums")).toHaveClass("font-mono", "uppercase");
});
