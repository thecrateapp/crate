import { createElement, useRef, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
  it("returns focus to the launcher without a visible ring on a touch-only screen", async () => {
    vi.resetModules();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(hover: none)",
    }));
    try {
      const { useModalFocus: freshModalFocus } = await import(
        "./use-modal-focus"
      );
      function Launcher() {
        const [open, setOpen] = useState(false);
        const panelRef = useRef<HTMLDivElement>(null);
        freshModalFocus({ active: open, panelRef });
        return createElement(
          "div",
          null,
          createElement(
            "button",
            { onClick: () => setOpen(true) },
            "Open fullscreen player",
          ),
          open
            ? createElement(
                "div",
                {
                  ref: panelRef,
                  role: "dialog",
                  "aria-label": "Player",
                  "data-app-modal-panel": "true",
                  tabIndex: -1,
                },
                createElement(
                  "button",
                  { onClick: () => setOpen(false) },
                  "Close player",
                ),
              )
            : null,
        );
      }
      render(createElement(Launcher));
      const launcher = screen.getByRole("button", {
        name: "Open fullscreen player",
      });
      const focus = vi.spyOn(launcher, "focus");
      launcher.focus();
      fireEvent.click(launcher);
      await waitFor(() =>
        expect(screen.getByRole("dialog", { name: "Player" })).toHaveFocus(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Close player" }));
      await waitFor(() => expect(launcher).toHaveFocus());
      expect(focus).toHaveBeenLastCalledWith({ focusVisible: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("focuses the dialog itself on a touch-only screen without a keyboard", async () => {
    vi.resetModules();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(hover: none)",
    }));
    try {
      const { useModalFocus: freshModalFocus } = await import(
        "./use-modal-focus"
      );
      function TouchSheet() {
        const panelRef = useRef<HTMLDivElement>(null);
        freshModalFocus({ active: true, panelRef });
        return createElement(
          "div",
          {
            ref: panelRef,
            role: "dialog",
            "aria-label": "Player",
            "data-app-modal-panel": "true",
            tabIndex: -1,
          },
          createElement("button", null, "Close player"),
        );
      }
      render(createElement(TouchSheet));
      await waitFor(() =>
        expect(screen.getByRole("dialog", { name: "Player" })).toHaveFocus(),
      );
      expect(
        screen.getByRole("button", { name: "Close player" }),
      ).not.toHaveFocus();
    } finally {
      vi.unstubAllGlobals();
    }
  });

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
