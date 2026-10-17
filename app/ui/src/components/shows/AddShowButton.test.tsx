import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import { AddShowButton } from "./AddShowButton";
vi.mock("./AddShowDialog", () => ({
  AddShowDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Show editor</div> : null,
}));
it("opens the shared editor only for show curators", async () => {
  const { unmount } = renderWithAdminProviders(
    <AddShowButton onSaved={vi.fn()} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Add show" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  unmount();
  renderWithAdminProviders(<AddShowButton onSaved={vi.fn()} />, {
    auth: { hasCapability: () => false },
  });
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
