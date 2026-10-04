import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders title and description", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete item?"
        description="This action cannot be undone."
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText("Delete item?")).toBeInTheDocument();
    expect(
      screen.getByText("This action cannot be undone."),
    ).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete?"
        description="Are you sure?"
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Confirm/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenChange when cancel is clicked", async () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete?"
        description="Are you sure?"
        onConfirm={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("uses custom confirm label", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete?"
        description="Are you sure?"
        onConfirm={vi.fn()}
        confirmLabel="Delete forever"
      />,
    );
    expect(
      screen.getByRole("button", { name: /Delete forever/i }),
    ).toBeInTheDocument();
  });

  it("applies destructive styles when variant is destructive", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete?"
        description="Are you sure?"
        onConfirm={vi.fn()}
        variant="destructive"
      />,
    );
    expect(screen.getByRole("button", { name: /Confirm/i })).toHaveClass(
      "bg-state-danger",
    );
  });

  it("renders the danger tone with translated labels and a body", () => {
    render(
      <ConfirmDialog
        open
        title="¿Borrar playlist?"
        description="No se puede deshacer."
        body={<p>Se perderán 12 canciones.</p>}
        tone="danger"
        confirmLabel="Borrar"
        cancelLabel="Cancelar"
        closeLabel="Cerrar"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("alertdialog", { name: "¿Borrar playlist?" }),
    ).toHaveAccessibleDescription("No se puede deshacer.");
    expect(screen.getByText("Se perderán 12 canciones.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Borrar" })).toHaveClass(
      "bg-state-danger",
    );
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
  });

  it("focuses cancel by default for danger and confirm for default tone", () => {
    const { rerender } = render(
      <ConfirmDialog
        open
        title="Delete?"
        tone="danger"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    rerender(
      <ConfirmDialog
        open={false}
        title="Save?"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    rerender(
      <ConfirmDialog
        open
        title="Save?"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();
  });

  it("calls onCancel from the cancel button, close button and Escape", async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete?"
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(onCancel).toHaveBeenCalledTimes(3);
  });

  it("blocks confirm, cancel and dismissal while pending", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        pending
        title="Delete?"
        tone="danger"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Close dialog backdrop" }),
    );

    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("closes through onOpenChange only after an async confirm resolves when pending is controlled", async () => {
    let resolve: () => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        pending={false}
        onOpenChange={onOpenChange}
        title="Delete?"
        onConfirm={onConfirm}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Confirm" });
    await userEvent.click(confirm);
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      resolve();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables confirm while an uncontrolled async confirm runs and closes after it resolves", async () => {
    let resolve: () => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete?"
        onConfirm={onConfirm}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Confirm" });
    await userEvent.click(confirm);
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      resolve();
    });
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(confirm).not.toBeDisabled();
  });

  it.each([
    ["controlled", false],
    ["uncontrolled", undefined],
  ])(
    "stays open and allows retry when a %s async confirm rejects",
    async (_mode, pending) => {
      const vitestListeners = process.listeners("unhandledRejection");
      process.removeAllListeners("unhandledRejection");
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      try {
        const error = new Error("boom");
        const onConfirm = vi
          .fn<() => Promise<void>>()
          .mockRejectedValueOnce(error)
          .mockResolvedValueOnce(undefined);
        const onOpenChange = vi.fn();
        const onError = vi.fn();
        render(
          <ConfirmDialog
            open
            pending={pending}
            onOpenChange={onOpenChange}
            onError={onError}
            title="Delete?"
            onConfirm={onConfirm}
          />,
        );

        const confirm = screen.getByRole("button", { name: "Confirm" });
        await userEvent.click(confirm);
        await act(async () => {
          await new Promise((done) => setTimeout(done, 0));
        });
        expect(onOpenChange).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(error);
        expect(unhandled).not.toHaveBeenCalled();
        expect(confirm).not.toBeDisabled();

        await userEvent.click(confirm);
        expect(onConfirm).toHaveBeenCalledTimes(2);
        expect(onOpenChange).toHaveBeenCalledWith(false);
      } finally {
        process.removeAllListeners("unhandledRejection");
        for (const listener of vitestListeners) {
          process.on("unhandledRejection", listener);
        }
      }
    },
  );

  it("forwards translatable aria and backdrop labels", () => {
    render(
      <ConfirmDialog
        open
        title={null}
        ariaLabel="Confirmar"
        backdropLabel="Cerrar fondo"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("alertdialog", { name: "Confirmar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cerrar fondo" }),
    ).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(
      <ConfirmDialog
        open={false}
        title="Delete?"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
