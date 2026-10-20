import { createRef } from "react";
import { render, renderHook, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu, detectTouchDominant } from "./ContextMenu";
import { useContextMenuController } from "./useContextMenuController";
vi.mock("@crate/ui/lib/use-breakpoint", () => ({ useIsDesktop: () => true }));
vi.mock("@crate/ui/lib/use-hover-capability", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@crate/ui/lib/use-hover-capability")
  >()),
  useHoverCapability: () => true,
}));
function inputEnvironment(touchPoints: number, fineHover: boolean) {
  vi.stubGlobal("navigator", { ...navigator, maxTouchPoints: touchPoints });
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: fineHover
        ? query === "(hover: hover) and (pointer: fine)"
        : query === "(pointer: coarse)" || query === "(hover: none)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("Context menu primary input", () => {
  it("keeps the desktop menu for Chrome's reported ten touch points with a fine hover pointer", () => {
    inputEnvironment(10, true);
    render(
      <ContextMenu
        open
        position={{ x: 40, y: 64 }}
        menuRef={createRef()}
        onClose={() => {}}
        items={[{ key: "queue", label: "Add to queue", onSelect: () => {} }]}
        sheetLabel="Track actions"
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("menu")).toHaveStyle({ left: "40px", top: "64px" });
  });
  it("uses the same desktop decision in the positioning controller", () => {
    inputEnvironment(10, true);
    const { result } = renderHook(() => useContextMenuController());
    expect(result.current.shouldUseDesktopMenu).toBe(true);
  });
  it("retains touch-first classification when the primary pointer is coarse", () => {
    inputEnvironment(10, false);
    expect(detectTouchDominant()).toBe(true);
  });
});
