import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
it("retires the unused spectrum ribbon while keeping the player renderer lazy", () => {
  const player = resolve(process.cwd(), "src/components/player");
  expect(existsSync(resolve(player, "SpectrumRibbonCanvas.tsx"))).toBe(false);
  expect(existsSync(resolve(player, "spectrum-ribbon-drawing.ts"))).toBe(false);
  const lazy = readFileSync(
    resolve(player, "lazy-player-surfaces.tsx"),
    "utf8",
  );
  expect(lazy).toContain('import("@/components/player/ExtendedPlayer")');
  const bar = readFileSync(resolve(player, "PlayerBar.tsx"), "utf8");
  expect(bar).not.toMatch(/from ["'][^"']*visualizer\//);
});
