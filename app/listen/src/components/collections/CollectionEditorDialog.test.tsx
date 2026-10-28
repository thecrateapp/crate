import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { CollectionEditorDialog } from "./CollectionEditorDialog";
it("connects the canonical footer to the actual native form and blocks pending close", () => {
  const onSubmit = vi.fn((event) => event.preventDefault()),
    onCancel = vi.fn();
  const props = {
    open: true,
    title: "Edit collection",
    formId: "edit-collection",
    submitLabel: "Save",
    cancelLabel: "Cancel",
    closeLabel: "Close",
    onCancel,
  };
  const { rerender } = renderWithListenProviders(
    <CollectionEditorDialog {...props}>
      <form id={props.formId} onSubmit={onSubmit} />
    </CollectionEditorDialog>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onSubmit).toHaveBeenCalledOnce();
  rerender(
    <CollectionEditorDialog {...props} pending>
      <form id={props.formId} />
    </CollectionEditorDialog>,
  );
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onCancel).not.toHaveBeenCalled();
});
