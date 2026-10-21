import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (["node_modules", "dist"].includes(entry.name)) return [];
    return entry.isDirectory()
      ? sourceFiles(file)
      : file.endsWith(".tsx") && !/\.(test|spec)\./.test(file)
        ? [file]
        : [];
  });
}

it("keeps browser tooltip attributes out of Listen and its shared controls", () => {
  const violations: string[] = [];
  for (const file of [
    ...sourceFiles(import.meta.dirname),
    ...sourceFiles(path.resolve(import.meta.dirname, "../../listen/src")),
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
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(ast);
        if (
          /^[a-z]/.test(tag) &&
          (tag === "title" ||
            node.attributes.properties.some(
              (attribute) =>
                ts.isJsxAttribute(attribute) &&
                attribute.name.getText(ast) === "title",
            ))
        )
          violations.push(
            file +
              ":" +
              (ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1),
          );
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    if (/\.title\s*=|setAttribute\(["']title["']/.test(source))
      violations.push(file + ": imperative title");
  }
  expect(violations).toEqual([]);
});
