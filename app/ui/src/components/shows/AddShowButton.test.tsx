import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { AddShowButton } from "./AddShowButton";

vi.mock("./AddShowSheet", () => ({
  AddShowSheet: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Add-show panel</div> : null,
}));

it("opens the add-show panel only for show curators", async () => {
  const { unmount } = renderWithAdminProviders(
    <AddShowButton onSaved={vi.fn()} />,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Add show" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Add-show panel");
  unmount();
  renderWithAdminProviders(<AddShowButton onSaved={vi.fn()} />, {
    auth: { hasCapability: () => false },
  });
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
