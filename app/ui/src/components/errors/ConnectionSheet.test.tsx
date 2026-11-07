import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-api", () => ({
  useApi: () => ({
    data: null,
    loading: true,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("@/hooks/use-task-poll", () => ({
  useTaskPoll: () => ({ pollTask: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import { ConnectionSheet } from "./ConnectionSheet";

function Harness({ removeOpener }: { removeOpener: boolean }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const [showCta, setShowCta] = useState(true);
  const fallbackRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={fallbackRef}>
        Header
      </button>
      {showCta ? (
        <button
          type="button"
          onClick={(event) => {
            opener.current = event.currentTarget;
            setOpen(true);
            if (removeOpener) setShowCta(false);
          }}
        >
          Open
        </button>
      ) : null}
      <ConnectionSheet
        open={open}
        onOpenChange={setOpen}
        returnFocusRef={opener}
        fallbackFocusRef={fallbackRef}
      />
    </>
  );
}

describe("ConnectionSheet", () => {
  it("opens on the right with the connection title and description", async () => {
    renderWithAdminProviders(<Harness removeOpener={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));

    const drawer = await screen.findByRole("dialog", {
      name: "Sentry connection",
    });
    expect(drawer).toHaveAttribute("data-side", "right");
    expect(drawer).toHaveAccessibleDescription(/Where Crate reads issues from/);
  });

  it("returns focus to the opener, or to the fallback once it is gone", async () => {
    const { unmount } = renderWithAdminProviders(
      <Harness removeOpener={false} />,
    );
    const opener = screen.getByRole("button", { name: "Open" });
    await userEvent.click(opener);
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus());
    unmount();

    renderWithAdminProviders(<Harness removeOpener />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Header" })).toHaveFocus(),
    );
  });
});
