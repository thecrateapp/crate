import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const SOURCE_DIRECTORIES = ["app/listen/src", "app/ui/src"];
const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", "coverage"]);
const SHARED_SOURCE = /^@crate\/ui\/(?!icons(?:\/|$))/;
const CLASS_PROP = /^(?:className|[a-z][A-Za-z]*ClassName)$/;

const TEXT_SIZE =
  /^text-(?:xs|sm|base|lg|\d?xl|\[[^\]]*\]|label|eyebrow|meta|caption|body|micro|2xs|numeral-[a-z]+|info-badge|filter-chip|badge|counter)$/;
const TEXT_LAYOUT =
  /^text-(?:left|center|right|start|end|justify|balance|pretty|wrap|nowrap|ellipsis|clip)$/;

// Caller-owned layout (position, width, flow) and product recipe hooks are not
// counted: the budget tracks only geometry, colour and type a component should own.
const CATEGORIES = [
  ["radius", (base) => /^rounded/.test(base)],
  ["height", (base) => /^(?:h|min-h|max-h|size)-/.test(base)],
  ["padding", (base) => /^p[xytrblse]?-/.test(base)],
  ["margin", (base) => /^-?m[xytrblse]?-/.test(base)],
  ["background", (base) => /^bg-/.test(base)],
  ["border", (base) => /^border/.test(base)],
  ["textSize", (base) => TEXT_SIZE.test(base)],
  [
    "textColor",
    (base) =>
      /^(?:text-|placeholder:)/.test(base) &&
      !TEXT_SIZE.test(base) &&
      !TEXT_LAYOUT.test(base),
  ],
  [
    "typography",
    (base) =>
      /^(?:font-|tracking-|leading-|uppercase$|lowercase$|capitalize$|normal-case$|italic$)/.test(
        base,
      ),
  ],
  ["shadow", (base) => /^(?:shadow|drop-shadow|backdrop-)/.test(base)],
];

// Colons inside arbitrary selectors/values are not variant separators.
export function utilityBase(token) {
  let depth = 0,
    start = 0;
  for (let index = 0; index < token.length; index++) {
    if (token[index] === "[") depth++;
    else if (token[index] === "]") depth--;
    else if (token[index] === ":" && depth === 0) start = index + 1;
  }
  return token.slice(start).replace(/^!/, "");
}

export function overrideCategory(token) {
  const base = utilityBase(token);
  return CATEGORIES.find(([, matches]) => matches(base))?.[0] ?? null;
}

function classTokens(initializer) {
  if (!initializer) return [];
  const strings = [];
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      strings.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      strings.push(
        node.head.text,
        ...node.templateSpans.map((span) => span.literal.text),
      );
      node.templateSpans.forEach((span) => visit(span.expression));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(initializer);
  return strings.join(" ").split(/\s+/).filter(Boolean);
}

export function analyzeSource(path, source) {
  const tree = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const sharedBindings = new Map();
  for (const statement of tree.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !SHARED_SOURCE.test(statement.moduleSpecifier.text)
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      sharedBindings.set(
        element.name.text,
        (element.propertyName ?? element.name).text,
      );
    }
  }

  const sites = [];
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const component = sharedBindings.get(node.tagName.getText(tree));
      if (component) {
        const categories = new Set();
        for (const attribute of node.attributes.properties) {
          if (
            !ts.isJsxAttribute(attribute) ||
            !CLASS_PROP.test(attribute.name.getText(tree))
          )
            continue;
          for (const token of classTokens(attribute.initializer)) {
            const category = overrideCategory(token);
            if (category) categories.add(category);
          }
        }
        if (categories.size > 0) {
          sites.push({
            component,
            line:
              tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
            categories: [...categories].sort(),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return sites;
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory())
      return IGNORED_DIRECTORIES.has(entry.name) ? [] : sourceFiles(path);
    return entry.name.endsWith(".tsx") &&
      !/\.(?:test|spec|stories)\.tsx$/.test(entry.name)
      ? [path]
      : [];
  });
}

export function buildOverrideInventory(repoRoot = process.cwd()) {
  const root = resolve(repoRoot);
  const inventory = {};
  for (const directory of SOURCE_DIRECTORIES) {
    for (const file of sourceFiles(join(root, directory))) {
      const path = relative(root, file);
      for (const site of analyzeSource(path, readFileSync(file, "utf8"))) {
        const counts = (inventory[site.component] ??= {});
        for (const category of site.categories)
          counts[category] = (counts[category] ?? 0) + 1;
      }
    }
  }
  return Object.fromEntries(
    Object.keys(inventory)
      .sort()
      .map((component) => [
        component,
        Object.fromEntries(
          Object.entries(inventory[component]).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        ),
      ]),
  );
}

export function evaluateOverrideBudget(inventory, budget) {
  const metrics = new Set([
    ...Object.entries(budget).flatMap(([component, limits]) =>
      Object.keys(limits).map((category) => `${component}.${category}`),
    ),
    ...Object.entries(inventory).flatMap(([component, counts]) =>
      Object.keys(counts).map((category) => `${component}.${category}`),
    ),
  ]);
  return [...metrics].sort().map((metric) => {
    const [component, category] = metric.split(".");
    return {
      metric,
      actual: inventory[component]?.[category] ?? 0,
      limit: budget[component]?.[category] ?? 0,
    };
  });
}

export function loadOverrideBudget(repoRoot = process.cwd()) {
  return JSON.parse(
    readFileSync(
      join(resolve(repoRoot), "scripts/design-system/override-budget.json"),
      "utf8",
    ),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  const inventory = buildOverrideInventory();
  if (!process.argv.includes("--check")) {
    console.log(JSON.stringify(inventory, null, 2));
  }
  const results = evaluateOverrideBudget(inventory, loadOverrideBudget());
  const exceeded = results.filter(({ actual, limit }) => actual > limit);
  results
    .filter(({ actual, limit }) => actual < limit)
    .forEach(({ metric, actual, limit }) => {
      console.error(
        `override budget: ${metric} dropped to ${actual} (budget ${limit}); lower it in scripts/design-system/override-budget.json`,
      );
    });
  exceeded.forEach(({ metric, actual, limit }) => {
    console.error(
      `override budget exceeded: ${metric} is ${actual}, budget ${limit}. Fix the shared component instead of overriding it.`,
    );
  });
  if (exceeded.length > 0) process.exit(1);
  console.error(`override budget: ${results.length} metrics within budget`);
}
