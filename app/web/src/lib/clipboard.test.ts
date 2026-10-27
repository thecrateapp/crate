import { describe, expect, it } from "vitest";
import { copyText } from "./clipboard";

describe("copyText", () => {
  it("reports success once the clipboard write resolves", async () => {
    const writes: string[] = [];
    const clipboard = {
      writeText: async (text: string) => void writes.push(text),
    };

    expect(await copyText("crate", clipboard)).toBe(true);
    expect(writes).toEqual(["crate"]);
  });

  it("reports failure when the clipboard write rejects", async () => {
    const clipboard = {
      writeText: () => Promise.reject(new Error("NotAllowedError")),
    };

    expect(await copyText("crate", clipboard)).toBe(false);
  });

  it("reports failure when there is no clipboard", async () => {
    expect(await copyText("crate", undefined)).toBe(false);
  });
});
