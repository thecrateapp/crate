import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { RemoteImportView, type RemoteImportStatus } from "./RemoteImportView";

const callbacks = {
  onRequest: vi.fn(),
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
  onRetry: vi.fn(),
};
function show(status: RemoteImportStatus, progress: number | null = null) {
  return renderWithListenProviders(
    <RemoteImportView
      status={status}
      progress={progress}
      estimatedSize={null}
      confirming={false}
      {...callbacks}
    />,
    { locale: "en" },
  );
}
it("uses the actual progress primitive for confirmed download percentage", () => {
  show("downloading", 25);
  expect(screen.getByText("Downloading 25%")).toHaveClass(
    "crate-mono-label",
    "uppercase",
  );
  expect(
    screen.getByRole("progressbar", { name: "Downloading 25%" }),
  ).toHaveAttribute("aria-valuenow", "25");
});
it.each(["reserving", "downloading", "verifying", "importing"] as const)(
  "keeps unknown progress indeterminate: %s",
  (status) => {
    show(status);
    const bar = screen.getByRole("progressbar");
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar.getAttribute("aria-label")).not.toMatch(/undefined|NaN|%/);
  },
);
it("uses a canonical completed caption and retains terminal retry", () => {
  const view = show("completed");
  expect(screen.getByText("Available locally")).toHaveClass(
    "crate-mono-label",
    "uppercase",
  );
  view.unmount();
  show("failed");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(callbacks.onRetry).toHaveBeenCalledOnce();
});
