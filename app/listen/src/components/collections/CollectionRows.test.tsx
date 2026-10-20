import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { CollectionMemberRow } from "./CollectionMemberRow";
import { CollectionEditorItemRow } from "./CollectionEditorItemRow";
it("uses the common member row, keeps identity case and exposes an icon-only contextual action", () => {
  const onRemove = vi.fn();
  const { rerender } = renderWithListenProviders(
    <CollectionMemberRow
      name="Jane McKay"
      handle="@DJCase"
      roleLabel="Collaborator"
      removeLabel="Remove Jane"
      onRemove={onRemove}
    />,
  );
  expect(screen.getByText("Jane McKay").closest(".uppercase")).toBeNull();
  expect(screen.getByText("@DJCase").closest(".uppercase")).toBeNull();
  expect(screen.getByText("Collaborator")).toHaveClass(
    "font-mono",
    "uppercase",
  );
  const remove = screen.getByRole("button", { name: "Remove Jane" });
  expect(remove).toHaveTextContent("");
  fireEvent.click(remove);
  expect(onRemove).toHaveBeenCalledOnce();
  rerender(<CollectionMemberRow name="Owner" roleLabel="Owner" />);
  expect(screen.queryByRole("button")).toBeNull();
});
it("keeps editor item identity and artwork in the entity recipe with separately injected actions", () => {
  renderWithListenProviders(
    <CollectionEditorItemRow
      title="Night music"
      subtitle="Chelsea Wolfe"
      artwork={<span>Artwork</span>}
      dragHandle={<span>Drag</span>}
    />,
  );
  expect(
    screen.getByText("Night music").closest('[data-slot="entity-row"]'),
  ).toBeInTheDocument();
  expect(screen.getByText("Chelsea Wolfe").closest(".uppercase")).toBeNull();
});
