import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "tokens/recipes.css"), "utf8");

function rule(selector: string, source = css) {
  source = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = Array.from(source.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .filter((match) =>
      match[1].split(",").some((entry) => entry.trim() === selector),
    )
    .map((match) => match[2]);
  if (rules.length === 0) throw new Error(`Missing form recipe: ${selector}`);
  return rules.join("\n");
}

describe("Shared form recipes", () => {
  it("gives fields the common desktop height and transparent canvas surface", () => {
    const field = rule(".crate-form-control");
    expect(field).toMatch(/(?:min-)?height:\s*40px/);
    expect(field).toMatch(/border-radius:\s*var\(--radius-lg\)/);
    expect(field).toMatch(/font-size:\s*15px/);
    expect(field).toMatch(/background(?:-color)?:\s*transparent/);
    expect(field).toMatch(/border(?:-color)?:[^;]*var\(--border-quiet\)/);
    expect(
      field.match(/backdrop-filter:\s*([^;]+)/)?.[1].trim() ?? "none",
    ).toBe("none");
    expect(field.match(/box-shadow:\s*([^;]+)/)?.[1].trim() ?? "none").toBe(
      "none",
    );
  });

  it.each([".crate-form-control", ".crate-form-chip"])(
    "gives coarse-pointer %s a 44px target",
    (selector) => {
      const coarse =
        css.match(
          /@media\s*\(pointer:\s*coarse\)\s*\{(?<rules>[\s\S]*?)\n\}/g,
        ) ?? [];
      expect(
        coarse.some((media) => {
          try {
            const declarations = rule(selector, media);
            return (
              /(?:min-)?height:\s*44px/.test(declarations) &&
              (selector !== ".crate-form-chip" ||
                /min-width:\s*44px/.test(declarations))
            );
          } catch {
            return false;
          }
        }),
      ).toBe(true);
    },
  );

  it("keeps the focus border on the high accent without shadows or a danger border", () => {
    const focus = rule(".crate-form-control:focus-visible");
    expect(focus).toMatch(
      /border-color:[^;]*var\(--accent-action-hi\)[^;]*40%/,
    );
    expect(focus.match(/box-shadow:\s*([^;]+)/)?.[1].trim() ?? "none").toBe(
      "none",
    );
    const fieldRules = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
      .filter((match) => match[1].includes(".crate-form-control"))
      .map((match) => match[2])
      .join("\n");
    expect(fieldRules).not.toMatch(/border[^;]*state-danger/);
  });

  it("sets a 32 by 18 switch visual independently of its hit target", () => {
    const track = rule(".crate-form-switch");
    expect(track).toMatch(/(?:^|;)\s*width:\s*32px/);
    expect(track).toMatch(/(?:^|;)\s*height:\s*18px/);
    expect(track).toMatch(/border:\s*1px solid var\(--border-quiet\)/);
  });
});
