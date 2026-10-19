import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import scope from "../../../scripts/design-system/row-hover-scope.json";
const root = resolve(process.cwd(), "../../..");
const fill = /(?:^|\s)(?:\S*:)?hover:bg-[^\s]+/;
describe("shared row interaction contract", () => {
  it("does not illuminate reviewed list rows on pointer hover", () => {
    for (const entry of scope) {
      const source = readFileSync(resolve(root, entry.path), "utf8");
      const tree = ts.createSourceFile(
        entry.path,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const fragments: string[] = [];
      function visit(node: ts.Node) {
        if (
          (ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node) ||
            ts.isTemplateHead(node)) &&
          node.text.startsWith(entry.prefix)
        )
          fragments.push(node.text);
        ts.forEachChild(node, visit);
      }
      visit(tree);
      expect(fragments.length, entry.path + ":" + entry.prefix).toBeGreaterThan(
        0,
      );
      for (const fragment of fragments)
        expect(fragment, entry.path).not.toMatch(
          entry.kind === "row" ? fill : /group-hover:opacity-/,
        );
    }
  });
  it("retains selection while row recipes add no hover background", () => {
    for (const [path, selector] of [
      ["tokens/interactive.css", ".interactive-row:hover"],
      ["tokens/recipes.css", '.track-row:not([data-disabled="true"]):hover'],
      ["tokens/recipes.css", ".crate-track-table tbody tr:hover"],
      ["tokens/recipes.css", ".user-profile-item:hover"],
    ]) {
      const css = readFileSync(resolve(process.cwd(), path!), "utf8");
      const block = css.split(selector! + " {")[1]?.split("}")[0] ?? "";
      expect(block, selector).not.toMatch(/background(?:-color)?\s*:/);
    }
    const recipes = readFileSync(
      resolve(process.cwd(), "tokens/recipes.css"),
      "utf8",
    );
    expect(recipes).toContain('.track-row[data-selected="true"]');
    expect(recipes).toContain('.track-row[data-active="true"]::before');
  });
  it("retains offline row state and keyboard focus without extra pointer tint", () => {
    const source = readFileSync(
      resolve(root, "app/listen/src/components/playlists/PlaylistCard.tsx"),
      "utf8",
    );
    const fn = source
      .split("function rowSurfaceClass(")[1]!
      .split("function OfflineMeta")[0]!;
    expect(fn).not.toMatch(fill);
    expect(fn).toContain("focus-within:bg-");
    expect(fn).toContain("bg-state-warning/");
  });
});

it("retains pointer feedback on Add-to-playlist menu actions", () => {
  const source = readFileSync(
    resolve(root, "app/listen/src/components/album/AlbumTrackList.tsx"),
    "utf8",
  );
  const menu = source
    .split("{selectionPlaylistPickerOpen ? (")[1]!
    .split("</AppPopover>")[0]!;
  expect(menu.match(/hover:bg-text-primary\/5/g)).toHaveLength(2);
});
