import { createElement, useRef, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppModal } from "../primitives/AppModal";
import { useModalFocus } from "./use-modal-focus";

function SpecializedSurface() {
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocus({ active: open, panelRef, isolate: true });
  return createElement(
    "div",
    null,
    createElement(
      "main",
      null,
      createElement(
        "button",
        { onClick: () => setOpen(true) },
        "Open workspace",
      ),
    ),
    open
      ? createElement(
          "div",
          {
            ref: panelRef,
            role: "dialog",
            "aria-label": "Workspace",
            "data-app-modal-panel": "true",
            "data-modal-depth": -1,
            tabIndex: -1,
          },
          createElement(
            "button",
            { onClick: () => setOpen(false) },
            "Close workspace",
          ),
          createElement(
            "button",
            { onClick: () => setNested(true) },
            "Open nested",
          ),
          createElement(
            AppModal,
            {
              open: nested,
              onClose: () => setNested(false),
              title: "Nested actions",
            },
            createElement("button", null, "Last nested action"),
          ),
        )
      : null,
  );
}

describe("shared modal focus lifecycle", () => {
  it("isolates a specialized workspace, wraps Tab and restores its launcher", async () => {
    const user = userEvent.setup();
    render(createElement(SpecializedSurface));
    const previousOverflow = document.body.style.overflow;
    const launcher = screen.getByRole("button", { name: "Open workspace" });
    await user.click(launcher);
    const close = screen.getByRole("button", { name: "Close workspace" });
    await waitFor(() => expect(close).toHaveFocus());
    expect(document.body.style.overflow).toBe("hidden");
    expect(launcher.closest("main")).toHaveAttribute("inert");
    expect(launcher.closest("main")).toHaveAttribute("aria-hidden", "true");
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Open nested" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(close).toHaveFocus();
    await user.click(close);
    expect(launcher).toHaveFocus();
    expect(document.body.style.overflow).toBe(previousOverflow);
    expect(launcher.closest("main")).not.toHaveAttribute("inert");
    expect(launcher.closest("main")).not.toHaveAttribute("aria-hidden");
  });

  it("gives a portalled AppModal Tab priority and returns to its parent trigger", async () => {
    const user = userEvent.setup();
    render(createElement(SpecializedSurface));
    await user.click(screen.getByRole("button", { name: "Open workspace" }));
    const trigger = screen.getByRole("button", { name: "Open nested" });
    await user.click(trigger);
    const last = screen.getByRole("button", { name: "Last nested action" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Close" })).toHaveFocus(),
    );
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Nested actions" }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    expect(
      screen.getByRole("dialog", { name: "Workspace" }),
    ).toBeInTheDocument();
  });
});
