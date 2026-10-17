import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "src");
const hues =
  "emerald|green|red|rose|amber|yellow|orange|violet|fuchsia|blue|sky|indigo|purple|cyan|teal|lime|pink";
const forbidden = new RegExp(
  `\\b(?:text|bg|border(?:-[trblxyse])?|ring|stroke|fill|from|via|to|decoration|accent|outline|shadow|divide)-(?:(${hues})-\\d+|state-(?:success|danger)(?:-[a-z]+)?|destructive)\\b`,
  "g",
);
function violations(source: string) {
  const found = [...source.matchAll(forbidden)].map((match) => match[0]);
  const tree = ts.createSourceFile(
    "source.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const checker = ts
    .createProgram(
      ["source.tsx"],
      { noLib: true, noResolve: true },
      {
        ...ts.createCompilerHost({}),
        getSourceFile: (file) => (file === "source.tsx" ? tree : undefined),
      },
    )
    .getTypeChecker();
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const component = node.tagName.getText(tree);
      if (component !== "ConfirmDialog") {
        for (const attr of node.attributes.properties) {
          if (
            !ts.isJsxAttribute(attr) ||
            !["variant", "tone"].includes(attr.name.getText(tree)) ||
            !attr.initializer
          )
            continue;
          const values: string[] = [];
          const seen = new Set<ts.Node>();
          function collect(child: ts.Node) {
            if (seen.has(child)) return;
            seen.add(child);
            if (ts.isStringLiteralLike(child)) values.push(child.text);
            if (ts.isIdentifier(child)) {
              for (const declaration of checker.getSymbolAtLocation(child)
                ?.declarations ?? []) {
                if (
                  ts.isVariableDeclaration(declaration) &&
                  declaration.initializer
                )
                  collect(declaration.initializer);
              }
            }
            ts.forEachChild(child, collect);
          }
          collect(attr.initializer);
          if (
            values.some(
              (value) =>
                ["destructive", "danger-soft"].includes(value) ||
                (value === "danger" &&
                  /(?:IconButton|IconLink)$/.test(component)),
            )
          )
            found.push(
              `${component}: ${attr.name.getText(tree)} outside ConfirmDialog`,
            );
        }
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(tree) === "variant" &&
      /["'](?:destructive|danger-soft)["']/.test(node.initializer.getText(tree))
    )
      found.push("indirect destructive variant");
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : files(path);
    return /\.(?:tsx?|css)$/.test(entry.name) && !entry.name.includes(".test.")
      ? [path]
      : [];
  });
}

describe("Admin status colour contract", () => {
  it.each([
    "hover:text-green-300",
    "bg-red-500/10",
    "border-l-amber-400",
    "text-state-success-text",
    "bg-state-danger/10",
    "text-destructive",
    '<Button variant="destructive" />',
    '<IconButton tone="danger" />',
    '<Button variant={failed ? "danger-soft" : "outline"} />',
    'const actions = [{ variant: "destructive" as const }];',
    'const variant = "destructive"; const action = <Button variant={variant} />;',
    'const tone = "danger"; const action = <ActionIconButton tone={tone} />;',
  ])("rejects colour escaping the contract: %s", (source) =>
    expect(violations(source).length).toBeGreaterThan(0),
  );
  it.each([
    "text-accent-action-hi bg-accent-action/10",
    "text-state-warning-text",
    '<ConfirmDialog variant="destructive" />',
    '<ConfirmDialog tone="danger" />',
    '<OpsStatTile tone="danger" />',
    'const variant = "destructive"; function Neutral() { const variant = "outline"; return <Button variant={variant} />; }',
    'const tone = "danger"; const action = <ConfirmDialog tone={tone} />;',
  ])("preserves approved semantics: %s", (source) =>
    expect(violations(source)).toEqual([]),
  );
  it("keeps all Admin source on accent/warning/neutral, with danger confined to ConfirmDialog", () => {
    const found = files(root).flatMap((file) =>
      violations(readFileSync(file, "utf8")).map(
        (value) => `${relative(root, file)}: ${value}`,
      ),
    );
    expect(found).toEqual([]);
  });
});
