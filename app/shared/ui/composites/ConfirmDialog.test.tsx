import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog";
import { AppModal } from "../primitives/AppModal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../shadcn/dialog";

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
    await userEvent.keyboard("{Escape}");

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

    await userEvent.keyboard("{Escape}");
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

  it("logs the confirm error and keeps the dialog open when onError is absent", async () => {
    const error = new Error("boom");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const onOpenChange = vi.fn();
    try {
      render(
        <ConfirmDialog
          open
          onOpenChange={onOpenChange}
          title="Delete?"
          onConfirm={() => Promise.reject(error)}
        />,
      );

      await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

      expect(consoleError).toHaveBeenCalledWith(error);
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

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
  it("renders editorial context and consequences without replacing the accessible title", () => {
    render(
      <ConfirmDialog
        open
        eyebrow="Library maintenance"
        title="Rebuild library?"
        description="The database will be replaced."
        consequence={<p>Audio files remain on disk.</p>}
        body={<p>Current library: 48,000 tracks.</p>}
        tone="danger"
        onConfirm={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("alertdialog", { name: "Rebuild library?" }),
    ).toHaveAccessibleDescription("The database will be replaced.");
    expect(screen.getByText("Library maintenance")).toBeInTheDocument();
    expect(screen.getByText("Audio files remain on disk.")).toBeInTheDocument();
    expect(
      screen.getByText("Current library: 48,000 tracks."),
    ).toBeInTheDocument();
  });

  it("requires the exact confirmation text and does not submit from Enter in the field", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete Roadtrip?"
        confirmation={{ value: "Roadtrip", label: "Type the playlist name" }}
        onConfirm={onConfirm}
      />,
    );
    const input = screen.getByRole("textbox", {
      name: "Type the playlist name",
    });
    const confirm = screen.getByRole("button", { name: "Confirm" });

    expect(confirm).toBeDisabled();
    await user.type(input, "roadtrip");
    expect(confirm).toBeDisabled();
    await user.clear(input);
    await user.type(input, "Roadtrip ");
    expect(confirm).toBeDisabled();
    await user.clear(input);
    await user.type(input, "Roadtrip");
    expect(confirm).toBeEnabled();

    await user.keyboard("{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("clears the confirmation text when the dialog is reopened", async () => {
    const user = userEvent.setup();
    const props = {
      title: "Wipe database?",
      confirmation: { value: "WIPE", label: "Type WIPE" },
      onConfirm: vi.fn(),
    };
    const { rerender } = render(<ConfirmDialog {...props} open />);
    await user.type(screen.getByRole("textbox", { name: "Type WIPE" }), "WIPE");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();

    rerender(<ConfirmDialog {...props} open={false} />);
    rerender(<ConfirmDialog {...props} open />);

    expect(screen.getByRole("textbox", { name: "Type WIPE" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });

  it("blocks every dismissal and a second submission during a promise even when pending is controlled false", async () => {
    const user = userEvent.setup();
    let resolve: () => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const onCancel = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        pending={false}
        title="Remove item?"
        onCancel={onCancel}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Confirm" });
    await user.click(confirm);
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    await user.click(confirm);
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", { name: "Close dialog backdrop" }),
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => {
      resolve();
    });
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("does not let an earlier promise close or unlock a newly opened confirmation", async () => {
    const user = userEvent.setup();
    let resolvePrevious: () => void = () => {};
    let resolveCurrent: () => void = () => {};
    const onConfirm = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((done) => {
            resolvePrevious = done;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((done) => {
            resolveCurrent = done;
          }),
      );
    const onOpenChange = vi.fn();
    const props = { title: "Remove item?", onConfirm, onOpenChange };
    const { rerender } = render(<ConfirmDialog {...props} open />);
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    rerender(<ConfirmDialog {...props} open={false} />);
    rerender(<ConfirmDialog {...props} open />);
    const currentConfirm = screen.getByRole("button", { name: "Confirm" });
    expect(currentConfirm).toBeEnabled();
    await user.click(currentConfirm);
    expect(onConfirm).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolvePrevious();
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(currentConfirm).toBeDisabled();
    expect(currentConfirm).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      resolveCurrent();
    });
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("closes after a void callback launches a separate background job", async () => {
    let resolveJob: () => void = () => {};
    const backgroundJob = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolveJob = done;
        }),
    );
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Start rebuild?"
        onOpenChange={onOpenChange}
        onConfirm={() => {
          void backgroundJob();
        }}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(backgroundJob).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    await act(async () => {
      resolveJob();
    });
    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the opener after cancelling a controlled dialog", async () => {
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Delete playlist
          </button>
          <ConfirmDialog
            open={open}
            title="Delete playlist?"
            onOpenChange={setOpen}
            onConfirm={vi.fn()}
          />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Example />);
    const opener = screen.getByRole("button", { name: "Delete playlist" });
    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it.each(["app", "radix"] as const)(
    "dismisses only the topmost confirmation inside a %s dialog and returns focus to its opener",
    async (parent) => {
      const user = userEvent.setup();
      const onParentClose = vi.fn();
      function Example() {
        const [confirmOpen, setConfirmOpen] = useState(false);
        const contents: ReactNode = (
          <>
            <button type="button" onClick={() => setConfirmOpen(true)}>
              Remove playlist
            </button>
            <ConfirmDialog
              open={confirmOpen}
              title="Remove playlist?"
              tone="danger"
              onOpenChange={setConfirmOpen}
              onConfirm={vi.fn()}
            />
          </>
        );
        return parent === "app" ? (
          <AppModal
            open
            onClose={onParentClose}
            title="Playlist"
            description="Edit playlist details."
          >
            {contents}
          </AppModal>
        ) : (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) onParentClose();
            }}
          >
            <DialogContent>
              <DialogTitle>Playlist</DialogTitle>
              <DialogDescription>Edit playlist details.</DialogDescription>
              {contents}
            </DialogContent>
          </Dialog>
        );
      }
      render(<Example />);
      const opener = screen.getByRole("button", { name: "Remove playlist" });
      await user.click(opener);
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
      await user.keyboard("{Escape}");

      await waitFor(() =>
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
      );
      expect(onParentClose).not.toHaveBeenCalled();
      await waitFor(() => expect(opener).toHaveFocus());
      await user.keyboard("{Escape}");
      expect(onParentClose).toHaveBeenCalledTimes(1);
    },
  );
});
