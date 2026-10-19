import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const small = /(?:^|\s)(?:size|h|w)-(?:[1-9]|10|11)(?=\s|$)/;
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(resolve(dir, entry.name))
      : entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
        ? [resolve(dir, entry.name)]
        : [],
  );
}
it("keeps undersized standalone music image frames on the shared 48px minimum, including legacy HTML tooltips", () => {
  const misses = new Set<string>();
  for (const file of [
    ...files(resolve(repo, "app/listen/src")),
    ...files(resolve(repo, "app/ui/src")),
  ]) {
    const source = readFileSync(file, "utf8");
    const ast = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node: ts.Node) {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        /^(img|CrateImage|ArtworkSurface|MediaCover|PlaylistArtwork|ArtistCardArtwork|AlbumCardArtwork)$/.test(
          node.tagName.getText(ast),
        )
      ) {
        const attrs = node.attributes.getText(ast);
        // Person/account avatars and the Crate mark are separate, explicitly reviewed roles.
        const separate =
          /user\.avatar|user_avatar|created_by_avatar|status\.image_url|\/icons\/logo\.svg/.test(
            attrs,
          );
        if (!separate) {
          let current: ts.Node | undefined = node;
          for (
            let depth = 0;
            current && depth < 6;
            current = current.parent, depth++
          ) {
            const opening = ts.isJsxElement(current)
              ? current.openingElement
              : ts.isJsxOpeningElement(current) ||
                  ts.isJsxSelfClosingElement(current)
                ? current
                : undefined;
            if (!opening) continue;
            const classes = opening.attributes.properties.find(
              (prop) =>
                ts.isJsxAttribute(prop) &&
                prop.name.getText(ast) === "className",
            );
            if (!classes) continue;
            const value = classes
              .getText(ast)
              .replace(/className=/, "")
              .replace(/["'`{}]/g, "");
            if (
              (small.test(value) ||
                [
                  ...value.matchAll(
                    /(?:size|h|w)-\[(\d+(?:\.\d+)?)(px|rem)\]/g,
                  ),
                ].some(
                  (match) =>
                    Number(match[1]) * (match[2] === "rem" ? 16 : 1) < 48,
                )) &&
              !value.includes("crate-media-thumbnail") &&
              node.tagName.getText(ast) !== "MediaCover"
            )
              misses.add(
                `${relative(repo, file)}:${ast.getLineAndCharacterOfPosition(opening.getStart()).line + 1}`,
              );
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    // Nivo tooltip HTML is a standalone media header, distinct from graph nodes.
    for (const img of source.matchAll(/<img\s+src="\$\{photoUrl\}"[^>]*>/g)) {
      const sizes = [...img[0].matchAll(/(?:width|height):(\d+)px/g)].map(
        (match) => Number(match[1]),
      );
      if (
        sizes.some((size) => size < 48) &&
        !img[0].includes('class="crate-media-thumbnail"')
      )
        misses.add(`${relative(repo, file)}:HTML tooltip`);
    }
  }
  expect([...misses]).toEqual([]);
});
