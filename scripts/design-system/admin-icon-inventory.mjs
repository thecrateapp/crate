import {
  readFileSync,
  readdirSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { resolve, dirname, relative, join, extname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const GLYPH = /^(?:lucide-react|@crate\/ui\/icons(?:\/|$)|@solar-icons\/)/;
const EXTERNAL_VISUAL =
  /^(?:@nivo\/|react-leaflet$|leaflet$|react-konva$|react-easy-crop$|react-force-graph-2d$)/;
const ICON_NAME = /icon|glyph/i;
const hash = (source) => createHash("sha256").update(source).digest("hex");
const compact = (text) => text.replace(/\s+/g, " ").trim();
const portable = (path) => path.replaceAll("\\", "/");
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory())
        return ["node_modules", "dist", "test", "coverage"].includes(entry.name)
          ? []
          : sourceFiles(path);
      return /\.(?:tsx?|css)$/.test(entry.name) &&
        !/\.(?:test|spec)\./.test(entry.name)
        ? [path]
        : [];
    })
    .sort(compare);
}
function parse(path, source) {
  const imports = [],
    entries = [],
    bindings = new Map(),
    declarations = new Map(),
    exports = new Map(),
    stars = [];
  const tree = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  function add(kind, name, node, extra = {}) {
    const position = tree.getLineAndCharacterOfPosition(node.getStart(tree));
    let control = "",
      label = "";
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isJsxElement(parent)) {
        const tag = parent.openingElement.tagName.getText(tree);
        if (GLYPH.test(bindings.get(tag)?.source || "")) continue;
        control = tag;
        const text = [];
        const attr = parent.openingElement.attributes.properties.find(
          (attr) =>
            ts.isJsxAttribute(attr) &&
            /^(?:aria-label|label|title|tooltip)$/.test(
              attr.name.getText(tree),
            ),
        );
        if (attr?.initializer) text.push(attr.initializer.getText(tree));
        function words(child) {
          if (ts.isJsxText(child)) text.push(child.text);
          ts.forEachChild(child, words);
        }
        words(parent);
        label = compact(text.join(" ")).slice(0, 140);
        break;
      }
    }
    entries.push({
      id: `${path}:${position.line + 1}:${position.character + 1}:${kind}:${name}`,
      path,
      line: position.line + 1,
      column: position.character + 1,
      kind,
      name,
      control,
      label,
      snippet: compact(node.getText(tree)).slice(0, 200),
      ...extra,
    });
  }
  if (path.endsWith(".css")) {
    for (const match of source.matchAll(
      /data:image\/svg\+xml|url\([^)]*\.svg[^)]*\)/g,
    )) {
      const node = { getStart: () => match.index, getText: () => match[0] };
      add("css-vector", match[0], node);
    }
    return { imports, entries, tree, bindings, declarations, exports, stars };
  }
  for (const statement of tree.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      statement.importClause &&
      !statement.importClause.isTypeOnly
    ) {
      const source = statement.moduleSpecifier.text,
        clause = statement.importClause;
      const values = [];
      if (clause.name) values.push([clause.name.text, "default"]);
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))
        values.push([clause.namedBindings.name.text, "*"]);
      else
        for (const item of clause.namedBindings?.elements || [])
          if (!item.isTypeOnly)
            values.push([
              item.name.text,
              item.propertyName?.text || item.name.text,
            ]);
      for (const [local, imported] of values) {
        const item = {
          local,
          imported,
          source,
          glyph:
            GLYPH.test(source) &&
            !(
              source.startsWith("@crate/ui/icons") &&
              imported === "CRATE_ICON_SIZE"
            ),
        };
        imports.push(item);
        bindings.set(local, item);
      }
    }
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const module = statement.moduleSpecifier?.text;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const item of statement.exportClause.elements)
          if (!item.isTypeOnly)
            exports.set(item.name.text, {
              module,
              local: item.propertyName?.text || item.name.text,
            });
      } else if (!statement.exportClause && module) stars.push(module);
    }
    const exported = statement.modifiers?.some(
      (item) => item.kind === ts.SyntaxKind.ExportKeyword,
    );
    const defaulted = statement.modifiers?.some(
      (item) => item.kind === ts.SyntaxKind.DefaultKeyword,
    );
    if (ts.isFunctionDeclaration(statement)) {
      const name = statement.name?.text || (defaulted ? "default" : "");
      if (name) {
        declarations.set(name, statement);
        if (exported)
          exports.set(defaulted ? "default" : name, { local: name });
      }
    }
    if (ts.isVariableStatement(statement))
      for (const item of statement.declarationList.declarations)
        if (ts.isIdentifier(item.name)) {
          declarations.set(item.name.text, item.initializer || item);
          if (exported) exports.set(item.name.text, { local: item.name.text });
        }
    if (ts.isExportAssignment(statement)) {
      declarations.set("default", statement.expression);
      exports.set("default", { local: "default" });
    }
  }
  // Track simple local aliases, including aliases used as JSX tag names.
  const glyphBindings = new Map(
    imports.filter((item) => item.glyph).map((item) => [item.local, item]),
  );
  for (let pass = 0; pass < 3; pass++)
    for (const [name, node] of declarations)
      if (ts.isIdentifier(node) && glyphBindings.has(node.text))
        glyphBindings.set(name, glyphBindings.get(node.text));
  function isTag(node) {
    let parent = node;
    while (ts.isPropertyAccessExpression(parent.parent)) parent = parent.parent;
    return (
      (ts.isJsxOpeningElement(parent.parent) ||
        ts.isJsxSelfClosingElement(parent.parent) ||
        ts.isJsxClosingElement(parent.parent)) &&
      parent.parent.tagName === parent
    );
  }
  function visit(node) {
    if (
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isTypeNode(node)
    )
      return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(tree),
        root = name.split(".")[0],
        binding = glyphBindings.get(root);
      if (binding)
        add("glyph-jsx", name, node, {
          source: binding.source,
          origin:
            binding.imported === "*"
              ? name.split(".").slice(1).join(".")
              : binding.imported,
        });
      else if (EXTERNAL_VISUAL.test(bindings.get(root)?.source || ""))
        add("external-visual", name, node, {
          source: bindings.get(root).source,
        });
      // This shared compatibility action renders its caller's children verbatim;
      // its static name is not a dynamically selected glyph. Child glyphs and
      // icon props remain independently inventoried. Do not exempt local wrappers.
      else if (
        ICON_NAME.test(name) &&
        !(
          bindings.get(root)?.source ===
            "@crate/ui/primitives/ActionIconButton" &&
          ["ActionIconButton", "ActionIconLink"].includes(
            bindings.get(root)?.imported,
          )
        )
      )
        add("dynamic-glyph", name, node);
      if (["svg", "canvas"].includes(name)) add("native-visual", name, node);
      for (const attr of node.attributes.properties) {
        if (ts.isJsxAttribute(attr) && ICON_NAME.test(attr.name.getText(tree)))
          add("icon-prop", attr.name.getText(tree), attr, { component: name });
        if (ts.isJsxSpreadAttribute(attr) && ICON_NAME.test(name))
          add("spread-icon-slot", name, attr);
      }
    }
    if (
      (ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node)) &&
      ICON_NAME.test(node.name.getText(tree))
    )
      add("icon-property", node.name.getText(tree), node);
    if (ts.isIdentifier(node) && glyphBindings.has(node.text) && !isTag(node))
      add("glyph-reference", node.text, node, {
        source: glyphBindings.get(node.text).source,
      });
    if (
      (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) &&
      /<svg\b|data:image\/svg\+xml/.test(node.getText(tree))
    )
      add("vector-string", "svg", node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return { imports, entries, tree, bindings, declarations, exports, stars };
}
export function analyzeSource(path, source) {
  const result = parse(path, source);
  return { imports: result.imports, entries: result.entries };
}
export function buildInventory(repoRoot = process.cwd()) {
  const root = resolve(repoRoot),
    admin = join(root, "app/ui/src"),
    cache = new Map(),
    memo = new Map();
  function load(file) {
    if (!cache.has(file)) {
      const source = readFileSync(file, "utf8");
      cache.set(file, {
        ...parse(portable(relative(root, file)), source),
        source,
        path: file,
      });
    }
    return cache.get(file);
  }
  function owned(from, module) {
    const base = module.startsWith("@/")
      ? join(admin, module.slice(2))
      : module.startsWith("@crate/ui/")
        ? join(root, "app/shared/ui", module.slice(10))
        : module.startsWith(".")
          ? resolve(dirname(from), module)
          : null;
    if (!base) return null;
    return (
      [
        base,
        ...[".tsx", ".ts", "/index.tsx", "/index.ts"].map((ext) => base + ext),
      ].find(
        (file) => existsSync(file) && [".ts", ".tsx"].includes(extname(file)),
      ) || null
    );
  }
  function symbol(file, name, trail = new Set(), exported = true) {
    const key = file + ":" + name + ":" + exported;
    if (trail.has(key)) return null;
    if (memo.has(key)) return memo.get(key);
    const next = new Set(trail).add(key),
      model = load(file);
    let result = null;
    const entry = exported ? model.exports.get(name) : null;
    if (entry?.module) {
      const target = owned(file, entry.module);
      if (target) result = symbol(target, entry.local, next);
      else if (GLYPH.test(entry.module))
        result = [portable(relative(root, file)), entry.module];
    } else if (entry) result = symbol(file, entry.local, next, false);
    else if (exported) {
      for (const module of model.stars) {
        const target = owned(file, module);
        if (target) result ||= symbol(target, name, next);
      }
    } else if (model.bindings.has(name)) {
      const binding = model.bindings.get(name);
      if (binding.glyph)
        result = [portable(relative(root, file)), binding.source];
      else {
        const target = owned(file, binding.source);
        if (target) result = symbol(target, binding.imported, next);
      }
    } else if (model.declarations.has(name)) {
      const declaration = model.declarations.get(name);
      function refs(node) {
        if (result || ts.isTypeNode(node)) return;
        if (
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          ["svg", "canvas"].includes(node.tagName.getText(model.tree))
        ) {
          result = [
            portable(relative(root, file)),
            "native:" + node.tagName.getText(model.tree),
          ];
          return;
        }
        if (
          ts.isIdentifier(node) &&
          node.text !== name &&
          (model.bindings.has(node.text) || model.declarations.has(node.text))
        )
          result = symbol(file, node.text, next, false);
        ts.forEachChild(node, refs);
      }
      refs(declaration);
    }
    if (result && result[0] !== portable(relative(root, file)))
      result = [portable(relative(root, file)), ...result];
    // A cycle can stop this traversal before another entry point resolves it.
    // Cache evidence only; a partial negative must not hide a later consumer.
    if (result) memo.set(key, result);
    return result;
  }
  const files = [],
    entries = [];
  for (const file of sourceFiles(admin)) {
    const model = load(file),
      path = portable(relative(root, file));
    const inherited = [];
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const name = node.tagName.getText(model.tree),
          parts = name.split("."),
          binding = model.bindings.get(parts[0]);
        if (
          binding &&
          !binding.glyph &&
          !EXTERNAL_VISUAL.test(binding.source)
        ) {
          const target = owned(file, binding.source);
          const via =
            target &&
            symbol(
              target,
              binding.imported === "*" ? parts[1] : binding.imported,
            );
          if (via) {
            const pos = model.tree.getLineAndCharacterOfPosition(
              node.getStart(model.tree),
            );
            const kind = via.at(-1).startsWith("native:")
              ? "owned-vector-consumer"
              : "owned-icon-consumer";
            inherited.push({
              id: `${path}:${pos.line + 1}:${pos.character + 1}:${kind}:${name}`,
              path,
              line: pos.line + 1,
              column: pos.character + 1,
              kind,
              name,
              source: binding.source,
              via,
              control: name,
              label: "",
              snippet: compact(node.getText(model.tree)).slice(0, 200),
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    if (!file.endsWith(".css")) visit(model.tree);
    const current = [...model.entries, ...inherited].sort(
      (a, b) =>
        a.line - b.line || a.column - b.column || compare(a.kind, b.kind),
    );
    const counts = {};
    for (const entry of current)
      counts[entry.kind] = (counts[entry.kind] || 0) + 1;
    files.push({
      path,
      sha256: hash(model.source),
      glyphImports: model.imports.filter((item) => item.glyph),
      counts,
    });
    entries.push(...current);
  }
  const counts = {};
  for (const entry of entries)
    counts[entry.kind] = (counts[entry.kind] || 0) + 1;
  return {
    schema: 1,
    scope:
      "app/ui/src production TS/TSX/CSS; owned export tracing for imported controls",
    reviewStatus:
      "Inventory only; no retained icon exception is approved by this report",
    totals: {
      filesScanned: files.length,
      filesWithEntries: files.filter((file) => Object.keys(file.counts).length)
        .length,
      filesWithGlyphImports: files.filter((file) => file.glyphImports.length)
        .length,
      glyphBindings: files.reduce(
        (sum, file) => sum + file.glyphImports.length,
        0,
      ),
      counts,
    },
    files,
    ownedDependencies: [...cache.values()]
      .filter((model) => !model.path.startsWith(admin + "/"))
      .map((model) => ({
        path: portable(relative(root, model.path)),
        sha256: hash(model.source),
      }))
      .sort((a, b) => compare(a.path, b.path)),
    entries,
  };
}
const output = "docs/plans/crate-v3-analysis/admin-icon-inventory-1v.json";
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report = buildInventory(),
    text = JSON.stringify(report, null, 2) + "\n";
  if (process.argv.includes("--write")) {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, text);
  } else if (process.argv.includes("--check")) {
    if (!existsSync(output) || readFileSync(output, "utf8") !== text) {
      console.error(
        "Admin icon inventory is stale; regenerate and review its changes.",
      );
      process.exitCode = 1;
    }
  } else console.log(text);
  if (process.argv.includes("--check") || process.argv.includes("--write"))
    console.log(JSON.stringify(report.totals));
}
