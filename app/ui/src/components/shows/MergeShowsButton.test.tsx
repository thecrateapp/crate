import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { MergeShowsButton } from "./MergeShowsButton";

vi.mock("./MergeShowsSheet", () => ({
  MergeShowsSheet: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Merge panel</div> : null,
}));

it("opens the merge panel only for show curators", async () => {
  const { unmount } = renderWithAdminProviders(
    <MergeShowsButton onMerged={vi.fn()} />,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const mergeButton = screen.getByRole("button", { name: "Merge duplicates" });
  expect(mergeButton).toHaveAttribute("data-size", "icon-lg");
  expect(mergeButton).toHaveAttribute("data-variant", "ghost");
  expect(mergeButton).not.toHaveAttribute("title");
  expect(mergeButton.querySelector("svg")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await userEvent.click(mergeButton);
  expect(screen.getByRole("dialog")).toHaveTextContent("Merge panel");
  unmount();
  renderWithAdminProviders(<MergeShowsButton onMerged={vi.fn()} />, {
    auth: { hasCapability: () => false },
  });
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
