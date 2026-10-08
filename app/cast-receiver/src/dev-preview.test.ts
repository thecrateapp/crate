import { describe, expect, it } from "vitest";

import { seedReceiverPreview } from "./dev-preview";
import { createReceiverStore } from "./receiver-store";

describe("receiver development preview", () => {
  it("seeds a representative playing session", () => {
    const store = createReceiverStore();

    seedReceiverPreview(store);

    expect(store.getSnapshot()).toMatchObject({
      phase: "playing",
      currentIndex: 0,
    });
    expect(store.getSnapshot().items).toHaveLength(4);
    expect(store.getSnapshot().items.slice(0, 2)).toMatchObject([
      { title: "The Shape of Sound" },
      { title: "Afterimage" },
    ]);
    expect(store.progress.getSnapshot()).toEqual({
      currentTime: 142,
      duration: 296,
    });
  });
});
