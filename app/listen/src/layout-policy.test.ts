import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Listen layout policy", () => {
  it("reserves the desktop scrollbar gutter so route changes do not shift the 1480px viewport", () => {
    const listenStyles = readFileSync(
      resolve(process.cwd(), "src/index.css"),
      "utf8",
    );

    expect(listenStyles).toMatch(
      /@media\s*\(min-width:\s*768px\)\s*\{\s*html\s*\{[^}]*scrollbar-gutter:\s*stable;/s,
    );
  });

  it("derives desktop dock panel clearance from the floating player bar geometry", () => {
    const read = (path: string) =>
      readFileSync(resolve(process.cwd(), path), "utf8");
    const listenStyles = read("src/index.css");
    const playerBar = read("src/components/player/bar/PlayerBarView.tsx");

    expect(listenStyles).toMatch(
      /--listen-desktop-player-clearance:\s*calc\(\s*var\(--listen-desktop-player-height\)\s*\+\s*var\(--listen-desktop-player-bottom-offset\)/s,
    );
    expect(playerBar).toContain("md:h-(--listen-desktop-player-height)");
    expect(playerBar).toContain('"var(--listen-desktop-player-bottom-offset)"');

    for (const panel of [
      "src/components/player/QueuePanel.tsx",
      "src/components/player/LyricsPanel.tsx",
    ]) {
      const source = read(panel);
      expect(source).toContain("bottom-(--listen-desktop-player-clearance)");
      expect(source).not.toMatch(/bottom-\[\d+px\]/);
    }
  });
});
