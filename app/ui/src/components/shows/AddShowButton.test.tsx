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
  const addButton = screen.getByRole("button", { name: "Add show" });
  expect(addButton).toHaveAttribute("data-size", "icon-lg");
  expect(addButton).toHaveAttribute("data-variant", "ghost");
  expect(addButton).not.toHaveAttribute("title");
  expect(addButton.querySelector("svg")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await userEvent.click(addButton);
  expect(screen.getByRole("dialog")).toHaveTextContent("Add-show panel");
  unmount();
  renderWithAdminProviders(<AddShowButton onSaved={vi.fn()} />, {
    auth: { hasCapability: () => false },
  });
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
