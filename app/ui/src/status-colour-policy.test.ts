import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "src");
// Diego, 2026-10-26: severity and log levels use a colour scale where error
// and critical are red. Only the shared severity indicator may use it.
const SEVERITY_SCALE = "components/admin/status-indicators.tsx";
const hues =
  "emerald|green|red|rose|amber|yellow|orange|violet|fuchsia|blue|sky|indigo|purple|cyan|teal|lime|pink";
const forbidden = new RegExp(
  `\\b(?:text|bg|border(?:-[trblxyse])?|ring|stroke|fill|from|via|to|decoration|accent|outline|shadow|divide)-(?:(${hues})-\\d+|state-(?:success|danger)(?:-[a-z]+)?|destructive)\\b`,
  "g",
);
function violations(
  source: string,
  tree?: ts.SourceFile,
  sharedChecker?: ts.TypeChecker,
) {
  const found = [...source.matchAll(forbidden)].map((match) => match[0]);
  const sourceTree =
    tree ??
    ts.createSourceFile(
      "source.tsx",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
  const program = sharedChecker
    ? undefined
    : ts.createProgram(
        [sourceTree.fileName],
        { noLib: true, noResolve: true },
        {
          ...ts.createCompilerHost({}),
          getSourceFile: (file) =>
            file === sourceTree.fileName ? sourceTree : undefined,
        },
      );
  const checker = sharedChecker ?? program!.getTypeChecker();
  // Diego explicitly retained these three genre delete controls as icon-only
  // danger actions. Keep approval tied to the original file, shared import,
  // row variant and exact contextual title; it does not allow arbitrary danger.
  const reviewedDeletes = new Set([
    'components/genres/GenreTaxonomyTree.tsx:"Delete genre"',
    "pages/Genres.tsx:{`Delete ${genre.name}`}",
    "pages/Genres.tsx:{`Delete ${g.name}`}",
  ]);
  const usedDeletes = new Set<string>();
  function reviewedDelete(
    node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  ) {
    if (
      node.tagName.getText(sourceTree) !== "ActionIconButton" ||
      node.attributes.properties.some(ts.isJsxSpreadAttribute)
    )
      return false;
    const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
    const prop = (name: string) =>
      attributes
        .find((attr) => attr.name.getText(sourceTree) === name)
        ?.initializer?.getText(sourceTree);
    const key = `${relative(root, sourceTree.fileName)}:${prop("title")}`;
    const sharedImport = sourceTree.statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text ===
          "@crate/ui/primitives/ActionIconButton" &&
        statement.importClause?.namedBindings &&
        ts.isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.some(
          (binding) =>
            binding.name.text === "ActionIconButton" &&
            (binding.propertyName?.text ?? binding.name.text) ===
              "ActionIconButton",
        ),
    );
    if (
      !sharedImport ||
      prop("variant") !== '"row"' ||
      !reviewedDeletes.has(key) ||
      usedDeletes.has(key)
    )
      return false;
    usedDeletes.add(key);
    return true;
  }
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const component = node.tagName.getText(sourceTree);
      if (component !== "ConfirmDialog") {
        for (const attr of node.attributes.properties) {
          if (
            !ts.isJsxAttribute(attr) ||
            !["variant", "tone"].includes(attr.name.getText(sourceTree)) ||
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
            if (!(
              attr.name.getText(sourceTree) === "tone" &&
              values.includes("danger") &&
              reviewedDelete(node)
            ))
              found.push(
                `${component}: ${attr.name.getText(sourceTree)} outside ConfirmDialog`,
              );
        }
      }
    }
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(sourceTree) === "variant" &&
      /["'](?:destructive|danger-soft)["']/.test(
        node.initializer.getText(sourceTree),
      )
    )
      found.push("indirect destructive variant");
    ts.forEachChild(node, visit);
  }
  visit(sourceTree);
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
    '<ConfirmDialog tone="danger" />',
    '<OpsStatTile tone="danger" />',
    'const variant = "destructive"; function Neutral() { const variant = "outline"; return <Button variant={variant} />; }',
    'const tone = "danger"; const action = <ConfirmDialog tone={tone} />;',
  ])("preserves approved semantics: %s", (source) =>
    expect(violations(source)).toEqual([]),
  );
  it("keeps all Admin source on accent/warning/neutral, with danger confined to ConfirmDialog", () => {
    const allFiles = files(root);
    const tsFiles = allFiles.filter((file) => /\.tsx?$/.test(file));
    const program = ts.createProgram(tsFiles, {
      noLib: true,
      noResolve: true,
    });
    const checker = program.getTypeChecker();
    const found = allFiles.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const tree =
        program.getSourceFile(file) ??
        ts.createSourceFile(
          file,
          source,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX,
        );
      const path = relative(root, file);
      return violations(source, tree, checker)
        .filter(
          (value) =>
            !(path === SEVERITY_SCALE && value === "text-state-danger-text"),
        )
        .map((value) => `${path}: ${value}`);
    });
    expect(found).toEqual([]);
  });
});

it("bounds the explicitly approved genre delete actions without allowing other danger controls", () => {
  const path = resolve(root, "components/genres/GenreTaxonomyTree.tsx");
  const source =
    'import {ActionIconButton} from "@crate/ui/primitives/ActionIconButton"; const view=<ActionIconButton variant="row" tone="danger" title="Delete genre"/>;';
  const check = (value: string) =>
    violations(
      value,
      ts.createSourceFile(
        path,
        value,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      ),
    );
  expect(check(source)).toEqual([]);
  expect(
    check(
      source.replace('title="Delete genre"', 'title="Delete something else"'),
    ),
  ).toHaveLength(1);
  expect(
    check(
      source.replace(
        "@crate/ui/primitives/ActionIconButton",
        "./LocalIconButton",
      ),
    ),
  ).toHaveLength(1);
  expect(
    check(
      source.replace(
        "/>;",
        '/>; const duplicate=<ActionIconButton variant="row" tone="danger" title="Delete genre"/>;',
      ),
    ),
  ).toHaveLength(1);
});
