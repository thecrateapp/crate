import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const SURFACE_UTILITY = /^(?:bg-panel-surface\/|backdrop-blur|shadow-\[)/;

// Colons inside arbitrary selectors/values are not variant separators.
function utilityBase(token) {
  let depth = 0,
    start = 0;
  for (let index = 0; index < token.length; index++) {
    if (token[index] === "[") depth++;
    else if (token[index] === "]") depth--;
    else if (token[index] === ":" && depth === 0) start = index + 1;
  }
  return token.slice(start).replace(/^!/, "");
}

export function analyzeAdminConsistency(path, source, debt = [], roles = true) {
  const tree = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const issues = [],
    bindings = new Map(),
    chips = new Set(),
    badges = new Set();
  const surfaceCounts = new Map();
  function issue(node, rule, detail) {
    const line =
      tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
    if (
      !issues.some(
        (item) =>
          item.line === line && item.rule === rule && item.detail === detail,
      )
    )
      issues.push({ path, line, rule, detail });
  }
  function scopeFor(node, blockScoped = true) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (
        ts.isSourceFile(parent) ||
        ts.isFunctionLike(parent) ||
        (blockScoped &&
          (ts.isBlock(parent) ||
            ts.isCatchClause(parent) ||
            ts.isForStatement(parent) ||
            ts.isForOfStatement(parent) ||
            ts.isForInStatement(parent)))
      )
        return parent;
    }
    return tree;
  }
  function bind(scope, name, initializer) {
    if (ts.isIdentifier(name)) {
      if (!bindings.has(scope)) bindings.set(scope, new Map());
      bindings.get(scope).set(name.text, initializer);
    } else if (
      ts.isObjectBindingPattern(name) ||
      ts.isArrayBindingPattern(name)
    ) {
      for (const item of name.elements)
        if (ts.isBindingElement(item)) bind(scope, item.name, undefined);
    }
  }
  function collect(node) {
    if (ts.isVariableDeclaration(node))
      bind(
        scopeFor(node, Boolean(node.parent.flags & ts.NodeFlags.BlockScoped)),
        node.name,
        node.initializer,
      );
    if (ts.isParameter(node)) bind(node.parent, node.name, undefined);
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const imports = node.importClause?.namedBindings;
      if (imports && ts.isNamedImports(imports))
        for (const item of imports.elements) {
          const name = (item.propertyName ?? item.name).text;
          if (
            node.moduleSpecifier.text === "@crate/ui/primitives/CrateBadge" &&
            name === "CrateChip"
          )
            chips.add(item.name.text);
          if (
            node.moduleSpecifier.text === "@crate/ui/shadcn/badge" &&
            name === "Badge"
          )
            badges.add(item.name.text);
        }
    }
    ts.forEachChild(node, collect);
  }
  collect(tree);
  const product = (left, right) =>
    left.flatMap((a) => right.map((b) => `${a} ${b}`));
  function variants(node, seen = new Set()) {
    if (!node) return [""];
    if (ts.isStringLiteralLike(node)) return [node.text];
    if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node))
      return variants(node.expression, seen);
    if (ts.isIdentifier(node)) {
      for (let scope = node.parent; scope; scope = scope.parent) {
        const local = bindings.get(scope);
        if (local?.has(node.text)) {
          const initializer = local.get(node.text);
          return initializer && !seen.has(initializer)
            ? variants(initializer, new Set([...seen, initializer]))
            : [""];
        }
      }
    }
    if (ts.isConditionalExpression(node))
      return [
        ...variants(node.whenTrue, seen),
        ...variants(node.whenFalse, seen),
      ];
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    )
      return ["", ...variants(node.right, seen)];
    if (ts.isCallExpression(node))
      return node.arguments.reduce(
        (all, argument) => product(all, variants(argument, seen)),
        [""],
      );
    if (ts.isArrayLiteralExpression(node))
      return node.elements.reduce(
        (all, element) => product(all, variants(element, seen)),
        [""],
      );
    if (ts.isTemplateExpression(node))
      return node.templateSpans.reduce(
        (all, span) =>
          product(all, variants(span.expression, seen)).map(
            (value) => value + span.literal.text,
          ),
        [node.head.text],
      );
    return [""];
  }
  function visit(node) {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      for (const token of node.text
        .split(/\s+/)
        .filter((token) => SURFACE_UTILITY.test(utilityBase(token)))) {
        const count = (surfaceCounts.get(token) ?? 0) + 1;
        surfaceCounts.set(token, count);
        const entry = debt.find(
          (item) =>
            item.path === path && item.owner && item.phase && item.reason,
        );
        if (count > (entry?.tokens[token] ?? 0))
          issue(node, "unowned-surface", token);
      }
    }
    if (
      roles &&
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
    ) {
      const name = node.tagName.getText(tree);
      const attribute = node.attributes.properties.find(
        (item) =>
          ts.isJsxAttribute(item) && item.name.getText(tree) === "className",
      );
      for (const original of variants(attribute?.initializer)) {
        const classes = original.split(/\s+/).map(utilityBase).join(" ");
        if (
          /\bfont-mono\b/.test(classes) &&
          /\bfont-(?:medium|semibold|bold|extrabold|black|\[(?:[5-9]\d\d)\])/.test(
            classes,
          )
        )
          issue(node, "mono-weight", classes);
        if (
          badges.has(name) &&
          /\bfont-mono\b/.test(classes) &&
          !/\bfont-normal\b/.test(classes)
        )
          issue(node, "mono-badge-weight", classes);
        if (/\bfont-display\b/.test(classes)) {
          const sizeClass = classes.match(
            /\btext-(xs|sm|base|lg)\b|\btext-\[(\d+(?:\.\d+)?)px\]/,
          );
          const size = sizeClass
            ? ({ xs: 12, sm: 14, base: 16, lg: 18 }[sizeClass[1]] ??
              Number(sizeClass[2]))
            : name === "CardTitle"
              ? 16
              : null;
          if (
            size !== null &&
            size < (/\btabular-nums\b/.test(classes) ? 16 : 20)
          )
            issue(node, "compact-display", classes);
        }
        if (
          chips.has(name) &&
          /(?:^|\s)(?:text-(?:\[(?:\d|var\(--text)[^\]]*\]|xs|sm|base|lg|badge|label|micro)|(?:p[xytrbl]?|h|min-h|max-h|leading|rounded|font)-)/.test(
            classes,
          )
        )
          issue(node, "static-tag-geometry", classes);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return issues;
}

export function buildAdminConsistencyInventory(root = process.cwd()) {
  const registry = JSON.parse(
    readFileSync(
      resolve(root, "scripts/design-system/admin-adoption-debt.json"),
      "utf8",
    ),
  );
  const paths = [
    ...new Set([
      ...registry.scope,
      ...registry.pending.map((item) => item.path),
    ]),
  ];
  return {
    filesScanned: paths.length,
    violations: paths.flatMap((path) =>
      analyzeAdminConsistency(
        path,
        readFileSync(resolve(root, path), "utf8"),
        registry.pending,
        registry.scope.includes(path),
      ),
    ),
    pending: registry.pending,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  const inventory = buildAdminConsistencyInventory();
  console.log(JSON.stringify(inventory, null, 2));
  if (inventory.violations.length) process.exitCode = 1;
}
