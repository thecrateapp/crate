import { describe, expect, it } from "vitest";
import { parseScreen, screenText } from "../../lib/terminal-screen";
import { install } from "./en";
import { SCREENS } from "./screens";

const TITLES = [
  "Checking this machine",
  "Your music and Crate's data",
  "How you will reach Crate",
  "Integrations",
  "Your admin account",
  "Review",
  "Installing",
];

describe("wizard screens", () => {
  it("has one screen per wizard step, each under its own step header and title", () => {
    expect(SCREENS).toHaveLength(7);
    SCREENS.forEach((screen, index) => {
      const lines = parseScreen(screen.text, screen.marks).lines;
      const counter = lines.findIndex((line) => line.kind === "counter");
      expect(lines[counter]!.segs[0]!.text.trim()).toBe(
        `STEP ${index + 1} OF 7`,
      );
      expect(lines[counter + 1]!.kind).toBe("rule");
      expect(lines[counter + 2]!.segs[0]!.text.trim()).toBe(TITLES[index]);
    });
  });

  it("matches the step titles the page prints", () => {
    expect(install.wizard.steps.map((step) => step.title)).toEqual(TITLES);
  });

  it("parses without losing a character", () => {
    for (const screen of SCREENS) {
      const text = screen.text.replace(/^\n/, "").replace(/\s+$/, "");
      expect(screenText(parseScreen(screen.text, screen.marks))).toBe(text);
    }
  });

  it("never shows the development version label", () => {
    for (const screen of SCREENS)
      expect(screen.text).not.toMatch(/installer dev/);
  });

  it("uses a status dot colour for every dot", () => {
    for (const screen of SCREENS) {
      const dots = (screen.text.match(/^\s*● /gm) ?? []).length;
      expect(screen.marks.dots ?? []).toHaveLength(dots);
    }
  });

  it("labels the one screen that comes from the source rather than the recording", () => {
    expect(SCREENS.map((screen) => screen.source)).toEqual([
      "recording",
      "recording",
      "recording",
      "recording",
      "recording",
      "recording",
      "source",
    ]);
  });
});
