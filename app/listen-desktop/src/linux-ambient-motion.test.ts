import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// WebKitGTK repaints filter, box-shadow and opacity animations on the main
// thread every frame, even off screen: four pulsing liked-hearts and a
// blinking stats bar kept an idle window at ~20 % of a core. On the Linux
// desktop these ambient loops hold their first frame (a static glow).
// jsdom does not run CSS animations, so this is a stylesheet contract.
const css = readFileSync(new URL("./linux-theme.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s+/g, " ");

function rulesFor(fragment: string): string[] {
  const rules: string[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (let match = pattern.exec(css); match; match = pattern.exec(css)) {
    const [, selectors = "", body = ""] = match;
    if (
      selectors
        .split(",")
        .some(
          (selector) =>
            selector.includes('html[data-crate-linux-desktop="true"]') &&
            selector.includes(fragment),
        )
    ) {
      rules.push(body.trim());
    }
  }
  return rules;
}

describe("Linux desktop ambient motion", () => {
  it.each([
    ".animate-crate-icon-active-pulse",
    ".animate-pulse-subtle",
    ".stats-live-dot",
  ])("holds the %s loop on its first frame", (className) => {
    expect(rulesFor(className).join(" ")).toMatch(
      /animation-play-state:\s*paused/,
    );
  });

  it("keeps the today bar's grow-in but drops its endless blink", () => {
    const body = rulesFor(".stats-signal-bar[data-today]").join(" ");
    expect(body).toMatch(/animation:\s*stats-grow/);
    expect(body).not.toMatch(/stats-blink/);
  });

  it("leaves playback feedback (the play aura while playing) animated", () => {
    expect(rulesFor(".animate-crate-play-aura-pulse")).toEqual([]);
  });
});
