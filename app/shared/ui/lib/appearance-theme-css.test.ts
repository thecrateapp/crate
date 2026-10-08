import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { renderDefaultThemeCss } from "./appearance-token-registry";

const themePath = resolve(process.cwd(), "tokens/themes.css");

describe("generated appearance theme CSS", () => {
  it("matches the typed token registry exactly", () => {
    const expected = renderDefaultThemeCss();

    if (process.env.CRATE_UPDATE_THEME_TOKENS === "1") {
      writeFileSync(themePath, expected);
    }

    expect(readFileSync(themePath, "utf8")).toBe(expected);
  });
});
