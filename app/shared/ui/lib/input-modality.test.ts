import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

async function freshModality(touchOnly: boolean) {
  vi.resetModules();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: touchOnly && query === "(hover: none)",
  }));
  const modality = await import("./input-modality");
  modality.trackInputModality();
  return modality;
}

describe("input modality", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("treats a touch-only screen as touch until the keyboard is used", async () => {
    const modality = await freshModality(true);
    expect(modality.touchWithoutKeyboard()).toBe(true);
    expect(modality.focusFollowsPointer()).toBe(true);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(modality.touchWithoutKeyboard()).toBe(false);
    expect(modality.focusFollowsPointer()).toBe(false);
  });

  it("follows the pointer on screens that hover", async () => {
    const modality = await freshModality(false);
    expect(modality.focusFollowsPointer()).toBe(false);
    fireEvent.pointerDown(document.body);
    expect(modality.focusFollowsPointer()).toBe(true);
    expect(modality.touchWithoutKeyboard()).toBe(false);
  });

  it("moves focus without a ring after touch and keeps the browser's choice for keyboard", async () => {
    const modality = await freshModality(true);
    const target = document.createElement("button");
    document.body.append(target);
    const focus = vi.spyOn(target, "focus");

    modality.focusWithModality(target, { preventScroll: true });
    expect(focus).toHaveBeenLastCalledWith({
      preventScroll: true,
      focusVisible: false,
    });

    fireEvent.keyDown(document, { key: "Tab" });
    modality.focusWithModality(target, { preventScroll: true });
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    target.remove();
  });

  it("ignores a missing element", async () => {
    const modality = await freshModality(true);
    expect(() => modality.focusWithModality(null)).not.toThrow();
  });
});
