import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("keeps preview and isolated review controls on the shared form components", () => {
  const roots = [
    resolve(process.cwd(), "../../../tools/design-system-preview"),
    resolve(process.cwd(), "../../../tools/crate-ui-showcase/reviews"),
  ];
  const violations: string[] = [];
  for (const root of roots) {
    for (const name of readdirSync(root).filter(
      (n) => n.endsWith(".tsx") && !n.includes(".spec."),
    )) {
      const file = ts.createSourceFile(
        name,
        readFileSync(resolve(root, name), "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      function visit(node: ts.Node) {
        if (
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          ts.isIdentifier(node.tagName) &&
          ["input", "select", "textarea"].includes(node.tagName.text)
        ) {
          violations.push(
            `${name}:${
              file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
            } <${node.tagName.text}>`,
          );
        }
        ts.forEachChild(node, visit);
      }
      visit(file);
    }
  }
  expect(violations).toEqual([]);
});
