import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { CrateForm, EMPTY_CRATE_FORM_VALUES } from "./CrateForm";
it("uses Select for exclusive fields and FormField for checkbox captions", () => {
  const onChange = vi.fn();
  renderWithListenProviders(
    <CrateForm
      id="review"
      values={EMPTY_CRATE_FORM_VALUES}
      isOwner
      onChange={onChange}
      onSubmit={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("combobox", { name: "Visibility" }),
  ).toHaveTextContent("Private");
  fireEvent.click(screen.getByRole("combobox", { name: "Ordering" }));
  fireEvent.click(screen.getByRole("option", { name: "Descending" }));
  expect(onChange).toHaveBeenCalledWith({ ordering: "desc" });
  expect(screen.getByText("Loop playback")).toHaveClass(
    "font-mono",
    "uppercase",
  );
  expect(screen.getByText("Allow collaboration")).toHaveClass(
    "font-mono",
    "uppercase",
  );
});
it("keeps owner-only choices hidden and disables the whole form while pending", () => {
  renderWithListenProviders(
    <CrateForm
      id="review"
      values={EMPTY_CRATE_FORM_VALUES}
      isOwner={false}
      disabled
      onChange={vi.fn()}
      onSubmit={vi.fn()}
    />,
  );
  expect(screen.queryByRole("combobox", { name: "Visibility" })).toBeNull();
  expect(
    screen.queryByRole("checkbox", { name: "Allow collaboration" }),
  ).toBeNull();
  expect(screen.getByRole("textbox", { name: "Name" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "Ordering" })).toBeDisabled();
});
