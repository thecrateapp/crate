import { describe, expect, it, vi } from "vitest";
import { Play } from "@crate/ui/icons";

import { action, actionIf, divider, label } from "./shared";

describe("action factories", () => {
  it("action builds an action entry", () => {
    const onSelect = vi.fn();
    const entry = action({
      key: "play",
      label: "Play now",
      icon: Play,
      active: true,
      danger: false,
      disabled: true,
      onSelect,
    });

    expect(entry).toEqual({
      type: "action",
      key: "play",
      label: "Play now",
      icon: Play,
      active: true,
      danger: false,
      disabled: true,
      onSelect,
    });
  });

  it("action defaults type to action", () => {
    const entry = action({ key: "share", label: "Share", onSelect: vi.fn() });
    expect(entry.type).toBe("action");
  });

  it("divider builds a divider entry", () => {
    expect(divider("d1")).toEqual({ type: "divider", key: "d1" });
  });

  it("label builds a label entry", () => {
    expect(label("l1", "Section")).toEqual({
      type: "label",
      key: "l1",
      label: "Section",
    });
  });

  it("actionIf returns an action when condition is true", () => {
    const entry = actionIf(true, {
      key: "edit",
      label: "Edit",
      onSelect: vi.fn(),
    });
    expect(entry).not.toBeNull();
    expect(entry?.type).toBe("action");
  });

  it("actionIf returns null when condition is false", () => {
    const entry = actionIf(false, {
      key: "edit",
      label: "Edit",
      onSelect: vi.fn(),
    });
    expect(entry).toBeNull();
  });
});
