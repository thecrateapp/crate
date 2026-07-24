import fs from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const IMAGE_BUILDERS = new Set([
  "albumCoverApiUrl",
  "artistBackgroundApiUrl",
  "artistPhotoApiUrl",
  "genreCoverApiUrl",
]);

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    if (!/[.]tsx?$/.test(entry.name) || entry.name.includes(".test."))
      return [];
    return [entryPath];
  });
}

describe("Listen image delivery contract", () => {
  it("bounds every generated library image by an explicit size", () => {
    const unbounded: string[] = [];

    for (const filename of sourceFiles(path.resolve("src"))) {
      const source = fs.readFileSync(filename, "utf8");
      const sourceFile = ts.createSourceFile(
        filename,
        source,
        ts.ScriptTarget.Latest,
        true,
        filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );

      function visit(node: ts.Node): void {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          IMAGE_BUILDERS.has(node.expression.text)
        ) {
          const options = node.arguments[1];
          const hasExplicitSize =
            options &&
            ts.isObjectLiteralExpression(options) &&
            options.properties.some(
              (property) =>
                (ts.isPropertyAssignment(property) ||
                  ts.isShorthandPropertyAssignment(property)) &&
                property.name.getText(sourceFile) === "size",
            );
          if (!hasExplicitSize) {
            const position = sourceFile.getLineAndCharacterOfPosition(
              node.getStart(sourceFile),
            );
            unbounded.push(
              `${path.relative(process.cwd(), filename)}:${position.line + 1}`,
            );
          }
        }
        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
    }

    expect(unbounded).toEqual([]);
  });
});
