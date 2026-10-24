import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const sourceRoot = resolve(process.cwd(), "src");

function sourceFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory).flatMap((name) => {
    const absolute = resolve(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    if (statSync(absolute).isDirectory())
      return sourceFiles(absolute, relative);
    return name.endsWith(".tsx") && !name.endsWith(".test.tsx")
      ? [relative]
      : [];
  });
}

// A role can be assigned by a shared MonoLabel, an explicit utility, or a
// concrete CSS class with its own font declaration. Inherited body defaults
// never excuse an unassigned heading. SVG instruments may declare fontFamily.
function typographyViolations(
  file: string,
  source: string,
  cssRoles = new Set<string>(),
) {
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const sharedLabels = new Set<string>();
  for (const statement of tree.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "@crate/ui/primitives/MonoLabel" &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      for (const binding of statement.importClause.namedBindings.elements)
        if ((binding.propertyName?.text ?? binding.name.text) === "MonoLabel")
          sharedLabels.add(binding.name.text);
    }
  }
  const violations: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const attr = (name: string) =>
        attrs
          .find((item) => item.name.getText(tree) === name)
          ?.initializer?.getText(tree) ?? "";
      const classes = attr("className");
      const tokens = new Set(classes.match(/[\w-]+/g) ?? []);
      const hasRole =
        /\bfont-(?:display|mono)\b/.test(classes) ||
        [...cssRoles].some((name) => tokens.has(name));
      const tag = node.tagName.getText(tree);
      const parent = ts.isJsxElement(node.parent) ? node.parent : undefined;
      const children =
        parent?.children.filter(
          (child) => !ts.isJsxText(child) || !!child.text.trim(),
        ) ?? [];
      const sharedCaption =
        children.length > 0 &&
        children.every(
          (child) =>
            ts.isJsxElement(child) &&
            sharedLabels.has(child.openingElement.tagName.getText(tree)),
        );
      const line =
        tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
      if (
        /^(?:h[1-6]|CardTitle|DialogTitle)$/.test(tag) &&
        !hasRole &&
        !sharedCaption
      )
        violations.push(`${file}:${line} heading has no assigned font role`);
      const svgMono =
        tag === "text" && /var\(--font-mono\)/.test(attr("fontFamily"));
      if (
        /\buppercase\b/.test(classes) &&
        !/\bfont-mono\b/.test(classes) &&
        !svgMono
      )
        violations.push(`${file}:${line} uppercase label is not mono`);
      const staticPlaceholder =
        parent &&
        parent.children.length > 0 &&
        parent.children.every(
          (child) => ts.isJsxText(child) && /^[\s—–-]*$/.test(child.text),
        );
      if (
        /\bfont-display\b/.test(classes) &&
        /\btabular-nums\b/.test(classes) &&
        !staticPlaceholder
      )
        violations.push(`${file}:${line} numeric readout uses display`);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return violations;
}

function cssFontRoles(directory: string): Set<string> {
  const roles = new Set<string>();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory())
      for (const role of cssFontRoles(path)) roles.add(role);
    else if (entry.name.endsWith(".css")) {
      for (const match of readFileSync(path, "utf8").matchAll(
        /\.([\w-]+)\s*\{([^{}]*)\}/g,
      ))
        if (
          /font-family:\s*var\(--font-(?:display|mono)\)/.test(match[2] ?? "")
        )
          roles.add(match[1]!);
    }
  }
  return roles;
}

describe("Admin typography roles", () => {
  it("maps the explicit sans utility to Roboto and loads all three approved faces", () => {
    const css = readFileSync(resolve(sourceRoot, "index.css"), "utf8");
    expect(css).toContain(
      '@import "../../shared/fonts/bricolage-grotesque.css";',
    );
    expect(css).toContain('@import "../../shared/fonts/roboto.css";');
    expect(css).toContain('@import "../../shared/fonts/jetbrains-mono.css";');
    expect(css).toMatch(/--font-sans:\s*var\(--font-brand\)/);
  });

  it("uses display for semantic headings and mono for uppercase labels and numeric readouts", () => {
    const roles = cssFontRoles(sourceRoot);
    const violations = sourceFiles(sourceRoot).flatMap((file) =>
      typographyViolations(
        file,
        readFileSync(resolve(sourceRoot, file), "utf8"),
        roles,
      ),
    );

    expect(violations).toEqual([]);
  });
});

it("recognizes explicit shared and instrument font roles without exempting arbitrary headings", () => {
  expect(
    typographyViolations(
      "fixture.tsx",
      'import {MonoLabel as Caption} from "@crate/ui/primitives/MonoLabel"; const view=<><h4><Caption>Parents</Caption></h4><h2 className="genre-title">Genre</h2><svg><text className="uppercase" fontFamily="var(--font-mono)">PUNK</text></svg></>;',
      new Set(["genre-title"]),
    ),
  ).toEqual([]);
  for (const source of [
    "const view=<h2>Missing role</h2>;",
    "const view=<h4><UnknownLabel>Missing role</UnknownLabel></h4>;",
    'import {MonoLabel} from "@crate/ui/primitives/MonoLabel"; const view=<h4>Unstyled text<MonoLabel>Caption</MonoLabel></h4>;',
    'const view=<svg><text className="uppercase">PUNK</text></svg>;',
    'const view=<dd className="font-display tabular-nums">42</dd>;',
  ])
    expect(typographyViolations("fixture.tsx", source).length).toBeGreaterThan(
      0,
    );
});
