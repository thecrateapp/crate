import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import scope from "../../../scripts/design-system/row-hover-scope.json";
const root = resolve(process.cwd(), "../../..");
const fill = /(?:^|\s)(?:\S*:)?hover:bg-[^\s]+/;

function classFragments(
  opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
) {
  const fragments: string[] = [];
  for (const attribute of opening.attributes.properties) {
    if (
      !ts.isJsxAttribute(attribute) ||
      attribute.name.getText() !== "className"
    )
      continue;
    function visit(node: ts.Node) {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node)
      )
        fragments.push(node.text);
      ts.forEachChild(node, visit);
    }
    visit(attribute);
  }
  return fragments;
}

function isWithinLabel(node: ts.Node, label: string) {
  let parent: ts.Node | undefined = node.parent;
  while (parent) {
    const opening = ts.isJsxElement(parent)
      ? parent.openingElement
      : ts.isJsxSelfClosingElement(parent)
        ? parent
        : null;
    if (
      opening &&
      opening.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText() === "label" &&
          attribute.initializer &&
          ts.isStringLiteral(attribute.initializer) &&
          attribute.initializer.text === label,
      )
    )
      return true;
    parent = parent.parent;
  }
  return false;
}
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
      let owners = 0;
      function visit(node: ts.Node) {
        if ("component" in entry) {
          if (
            (ts.isJsxOpeningElement(node) ||
              ts.isJsxSelfClosingElement(node)) &&
            node.tagName.getText() === entry.component &&
            (typeof entry.ownerLabel !== "string" ||
              isWithinLabel(node, entry.ownerLabel))
          ) {
            owners++;
            fragments.push(...classFragments(node));
            if (ts.isJsxElement(node.parent)) {
              for (const child of node.parent.children) {
                const opening = ts.isJsxElement(child)
                  ? child.openingElement
                  : ts.isJsxSelfClosingElement(child)
                    ? child
                    : null;
                if (
                  opening &&
                  ["Link", "a", "button"].includes(opening.tagName.getText())
                )
                  fragments.push(...classFragments(opening));
              }
            }
          }
          ts.forEachChild(node, visit);
          return;
        }
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
      if ("component" in entry) {
        expect(source, entry.path).toMatch(
          new RegExp(
            `import\\s*\\{[^}]*\\b${entry.component}\\b[^}]*\\}\\s*from\\s*["']@crate/ui/`,
          ),
        );
      }
      expect(
        "component" in entry ? owners : fragments.length,
        entry.path +
          ":" +
          ("component" in entry ? entry.component : entry.prefix),
      ).toBeGreaterThan(0);
      for (const fragment of fragments)
        expect(fragment, entry.path).not.toMatch(
          entry.kind === "row" ? fill : /group-hover:opacity-/,
        );
    }
  });
  it("keeps migrated Paths, setlist and Home rows on their governed owners", () => {
    for (const [path, component] of [
      ["app/listen/src/pages/PathsParts.tsx", "PathEndpointPanelView"],
      ["app/listen/src/pages/PathEndpointPanelView.tsx", "CatalogSearchView"],
      [
        "app/listen/src/components/artist/ArtistSetlistSection.tsx",
        "ArtistSetlistView",
      ],
      ["app/listen/src/components/artist/ArtistSetlistView.tsx", "HairlineRow"],
      ["app/listen/src/components/home/HomeSectionCards.tsx", "HairlineRow"],
    ]) {
      const source = readFileSync(resolve(root, path!), "utf8");
      expect(source).toContain(`<${component}`);
      expect(source).not.toMatch(/hover:bg-|group-hover:opacity-/);
    }
  });
  it("keeps non-track row recipes without pointer illumination", () => {
    for (const [path, selector] of [
      ["tokens/interactive.css", ".interactive-row:hover"],
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
  it("keeps Diego's collection playlist hover amendment scoped to its domain row, including offline states", () => {
    const source = readFileSync(
      resolve(
        root,
        "app/listen/src/components/playlists/PlaylistListRowView.tsx",
      ),
      "utf8",
    );
    expect(source).toContain("pointer-fine:hover:bg-accent-action/[0.04]");
    expect(source).toContain("focus-within:bg-");
    expect(source).toContain("bg-state-warning/");
  });
  it("delegates playlist search result rows to the canonical non-hover EntityRow", () => {
    const source = readFileSync(
      resolve(
        root,
        "app/listen/src/components/playlists/PlaylistTrackSearch.tsx",
      ),
      "utf8",
    );
    expect(source).toContain("<CatalogSearch");
    const view = readFileSync(
      resolve(root, "app/listen/src/components/search/CatalogSearchView.tsx"),
      "utf8",
    );
    expect(view).toContain("<EntityRow");
    expect(view).not.toMatch(/hover:bg-/);
    expect(source).not.toMatch(/<button\b/);
  });
  it("records Diego's track-row exception while preserving disabled and selection states", () => {
    const recipes = readFileSync(
      resolve(process.cwd(), "tokens/recipes.css"),
      "utf8",
    );
    expect(recipes).toContain("@media (hover: hover) and (pointer: fine)");
    expect(recipes).toContain('.track-row:not([data-disabled="true"]):hover');
    expect(recipes).toContain(
      "background-color: color-mix(in srgb, var(--accent-action) 4%, transparent)",
    );
    expect(recipes).toContain('.track-row[data-selected="true"]::before');
    expect(recipes).toContain(".crate-row-highlight");
  });
});

// Menu feedback is exercised on actual canonical buttons in album-access-review.spec.ts.
