import { describe, expect, it } from "vitest";
import { CHAT } from "../../content/admin/telegram-agent";
import { chatAt, isPressed } from "./agent-math";

const BEATS = CHAT.map((entry) => entry.beat);
const pages = CHAT.flatMap((entry, index) =>
  entry.kind === "page" ? [index] : [],
);
const decision = CHAT.findIndex((entry) => entry.kind === "decision");

describe("chatAt", () => {
  it("opens on the question alone", () => {
    expect(chatAt(0, BEATS)).toEqual({ shown: 1, beat: 0, finished: false });
  });

  it("ends with the whole conversation on the last beat", () => {
    expect(chatAt(1, BEATS)).toEqual({
      shown: CHAT.length,
      beat: BEATS.at(-1),
      finished: true,
    });
  });

  it("only ever adds messages as the page scrolls down", () => {
    let last = 0;
    for (let progress = 0; progress <= 1; progress += 0.01) {
      const { shown } = chatAt(progress, BEATS);
      expect(shown).toBeGreaterThanOrEqual(last);
      last = shown;
    }
  });

  it("clamps progress outside 0..1", () => {
    expect(chatAt(-1, BEATS).shown).toBe(1);
    expect(chatAt(2, BEATS).finished).toBe(true);
  });

  it("never shows the approval before every plan page is delivered", () => {
    for (let progress = 0; progress <= 1; progress += 0.005) {
      const { shown } = chatAt(progress, BEATS);
      if (shown > decision)
        for (const page of pages) expect(page).toBeLessThan(shown);
    }
  });
});

describe("isPressed", () => {
  it("presses a button once the message it leads to is shown", () => {
    expect(isPressed(decision, decision)).toBe(false);
    expect(isPressed(decision, decision + 1)).toBe(true);
  });
});
