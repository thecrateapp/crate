import type { TFunction } from "i18next";
import { describe, expect, it, vi } from "vitest";

import { buildRadioActions } from "./radio-actions";

const t = ((key: string) => key) as unknown as TFunction;

describe("buildRadioActions", () => {
  it("builds start and open-seed entries", () => {
    const navigate = vi.fn();
    const onStart = vi.fn();
    const entries = buildRadioActions(
      { onStart, seedKind: "genre", seedPath: "/explore?genre=hardcore" },
      { t, navigate },
    );

    expect(entries.map((entry) => entry.key)).toEqual(["start", "open-seed"]);
    expect(entries[1]).toMatchObject({ label: "actions.genre.open" });
    const openSeed = entries[1];
    if (openSeed && "onSelect" in openSeed) void openSeed.onSelect();
    expect(navigate).toHaveBeenCalledWith("/explore?genre=hardcore");
  });

  it("omits open-seed without a path and disables start", () => {
    const entries = buildRadioActions(
      { onStart: vi.fn(), seedKind: "artist", seedPath: null, disabled: true },
      { t, navigate: vi.fn() },
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      label: "actions.radio.start",
      disabled: true,
    });
  });
});
