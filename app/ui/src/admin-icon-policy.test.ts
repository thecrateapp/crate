import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  analyzeSource,
  buildInventory,
  type IconEntry,
} from "../../../scripts/design-system/admin-icon-inventory.mjs";

const repo = resolve(process.cwd(), "../..");
const scope = ["Sidebar", "CommandPalette", "Shell", "SearchBar"]
  .map((name) => `app/ui/src/components/layout/${name}.tsx`)
  .concat([
    "app/ui/src/components/ui/AIButton.tsx",
    "app/ui/src/components/ui/AdminSelect.tsx",
    "app/ui/src/components/admin/ops-surfaces.tsx",
    "app/ui/src/pages/Logs.tsx",
    "app/ui/src/pages/Stack.tsx",
    "app/ui/src/pages/Analysis.tsx",
    "app/ui/src/pages/Dashboard.tsx",
    "app/ui/src/pages/SystemHealth.tsx",
  ]);
// Reviewed shared Select contract: disclosure, option selection and search glyphs are UX.
// The Admin wrapper itself is checked directly; no arbitrary wrapper or icon prop is exempt.
const approvedControls = new Map([
  [
    "app/ui/src/pages/Dashboard.tsx:@crate/ui/primitives/AppModal",
    { component: "AppModal", limit: 1 },
  ],
  [
    "app/ui/src/pages/Dashboard.tsx:@crate/ui/primitives/ErrorState",
    { component: "ErrorState", limit: 1 },
  ],
  [
    "app/ui/src/pages/Dashboard.tsx:@crate/ui/composites/ConfirmDialog",
    { component: "ConfirmDialog", limit: 2 },
  ],
  [
    "app/ui/src/pages/Analysis.tsx:@crate/ui/primitives/ErrorState",
    { component: "ErrorState", limit: 2 },
  ],
  [
    "app/ui/src/pages/Logs.tsx:@/components/ui/AdminSelect",
    { component: "AdminSelect", limit: 2 },
  ],
  [
    "app/ui/src/pages/Logs.tsx:@crate/ui/primitives/ErrorState",
    { component: "ErrorState", limit: 1 },
  ],
  [
    "app/ui/src/pages/Stack.tsx:@crate/ui/primitives/ErrorState",
    { component: "ErrorState", limit: 1 },
  ],
  [
    "app/ui/src/pages/Stack.tsx:@crate/ui/composites/ConfirmDialog",
    { component: "ConfirmDialog", limit: 1 },
  ],
  [
    "app/ui/src/components/layout/Sidebar.tsx:@/components/ui/AdminSelect",
    { component: "AdminSelect", limit: 1 },
  ],
]);
// Diego's 1W steering explicitly retains UX glyphs. Each concrete site remains bounded.
const approvedUx = new Map([
  ["Dashboard:dashboard-running-task", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-loading", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-fingerprints", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-popularity", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-bliss", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-analysis", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-lyrics", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-portable", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-rehydrate", ["lucide-react", "Loader2"]],
  ["Analysis:analysis-action-richExport", ["lucide-react", "Loader2"]],
  ["Logs:logs-loading", ["lucide-react", "Loader2"]],
  ["Logs:live-pause", ["lucide-react", "Pause"]],
  ["Logs:live-resume", ["lucide-react", "Play"]],
  ["Logs:logs-search", ["lucide-react", "Search"]],
  ["Stack:stack-loading", ["lucide-react", "Loader2"]],
  ["Stack:stack-search", ["lucide-react", "Search"]],
  ["Stack:service-logs-toggle", ["lucide-react", "ChevronDown"]],
  ["Stack:service-state-loading", ["lucide-react", "Loader2"]],
  ["Stack:service-stop", ["lucide-react", "Square"]],
  ["Stack:service-start", ["lucide-react", "Play"]],
  ["Stack:service-external", ["lucide-react", "ExternalLink"]],
  ["Stack:service-logs-loading", ["lucide-react", "Loader2"]],
  ["Shell:history-back", ["lucide-react", "ChevronLeft"]],
  ["Shell:history-forward", ["lucide-react", "ChevronRight"]],
  ["Shell:mobile-navigation", ["lucide-react", "Menu"]],
  ["Shell:help-close", ["@crate/ui/shadcn/dialog", "DialogContent"]],
  ["Sidebar:sidebar-collapse", ["lucide-react", "PanelLeftClose"]],
  ["Sidebar:sidebar-expand", ["lucide-react", "PanelLeftOpen"]],
  [
    "Sidebar:drawer-close",
    ["@crate/ui/shadcn/overlay-close-button", "OverlayCloseButton"],
  ],
  ["CommandPalette:palette-search", ["lucide-react", "Search"]],
  ["SearchBar:search-field", ["lucide-react", "Search"]],
  ["SearchBar:search-loading", ["lucide-react", "Loader2"]],
  ["SearchBar:search-clear", ["lucide-react", "X"]],
  ["AIButton:ai-loading", ["lucide-react", "Loader2"]],
  [
    "CommandPalette:palette-close",
    ["@crate/ui/shadcn/overlay-close-button", "OverlayCloseButton"],
  ],
]);
function violations(sources: Map<string, string>, entries: IconEntry[]) {
  const found: string[] = [];
  const controlUses = new Map<string, number>();
  const usedUx = new Set<string>();
  for (const entry of entries.filter((entry) => sources.has(entry.path))) {
    if (entry.kind === "external-visual") continue;
    if (
      !["glyph-jsx", "owned-icon-consumer", "owned-vector-consumer"].includes(
        entry.kind,
      )
    ) {
      found.push(entry.id);
      continue;
    }

    if (entry.source === "@crate/ui/domain/brand/CrateLogo") continue; // Existing identity asset.
    if (
      entry.path.endsWith("/Shell.tsx") &&
      ["./Sidebar", "./CommandPalette", "./SearchBar"].includes(
        entry.source ?? "",
      )
    )
      continue; // Checked directly in this scope.
    const key = `${entry.path}:${entry.source}`;
    const source = sources.get(entry.path)!;
    const tree = ts.createSourceFile(
      entry.path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let attributes: ts.JsxAttributes | undefined;
    function visit(node: ts.Node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const pos = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        if (pos.line + 1 === entry.line && pos.character + 1 === entry.column)
          attributes = node.attributes;
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
    if (!attributes) {
      found.push(entry.id);
      continue;
    }
    const attrs = attributes.properties;
    const prop = (name: string) =>
      attrs.find(
        (attr) => ts.isJsxAttribute(attr) && attr.name.getText(tree) === name,
      ) as ts.JsxAttribute | undefined;
    const unknownSpread = attrs.some(ts.isJsxSpreadAttribute);
    const reviewedControl = approvedControls.get(key);
    if (
      !unknownSpread &&
      reviewedControl &&
      reviewedControl.component === (entry.origin ?? entry.name)
    ) {
      controlUses.set(key, (controlUses.get(key) ?? 0) + 1);
      continue;
    }
    const marker = prop("data-admin-ux")?.initializer;
    if (marker && ts.isStringLiteral(marker)) {
      const key = `${entry.path.split("/").pop()?.replace(".tsx", "")}:${marker.text}`;
      const approved = approvedUx.get(key);
      if (
        !unknownSpread &&
        approved &&
        approved[0] === entry.source &&
        approved[1] === (entry.origin ?? entry.name) &&
        !usedUx.has(key)
      ) {
        usedUx.add(key);
        continue;
      }
    }
    if (!entry.kind.startsWith("owned-")) {
      found.push(entry.id);
      continue;
    }
    if (
      !unknownSpread &&
      entry.source === "@crate/ui/primitives/CrateBadge" &&
      ["CrateChip", "CratePill"].includes(entry.origin ?? entry.name) &&
      !prop("icon")
    )
      continue; // Shared badges render no glyph without an explicit icon prop.
    if (
      entry.source === "@crate/ui/shadcn/button" &&
      ((!unknownSpread && !prop("loading")) ||
        (prop("loading")?.initializer?.getText(tree) === "{false}" &&
          attrs.indexOf(prop("loading")!) >
            attrs.reduce(
              (last, attr, index) =>
                ts.isJsxSpreadAttribute(attr) ? index : last,
              -1,
            )))
    )
      continue;
    if (
      !unknownSpread &&
      ["@crate/ui/shadcn/dialog", "@crate/ui/shadcn/sheet"].includes(
        entry.source ?? "",
      ) &&
      prop("showCloseButton")?.initializer?.getText(tree) === "{false}"
    )
      continue;
    found.push(entry.id);
  }
  for (const [key, count] of controlUses)
    if (count > approvedControls.get(key)!.limit)
      found.push(`${key}: reviewed control grew`);
  return found;
}

describe("Admin icon retirement policy — migrated Admin surfaces", () => {
  it("rejects direct, passed, mapped, dynamic and wrapped glyphs in the migrated files", () => {
    const inventory = buildInventory(repo);
    const sources = new Map(
      scope.map((path) => [path, readFileSync(join(repo, path), "utf8")]),
    );
    expect(violations(sources, inventory.entries)).toEqual([]);
  });
  it.each([
    'import { Search as Glyph } from "lucide-react"; const view = <Glyph/>;',
    "const view = <Chip icon={someValue}/>;",
    "const map = {icon: value}; const view = <map.icon/>;",
    "const view = <svg><path/></svg>;",
    "const view = <Icon {...props}/>;",
  ])("detects an unapproved entry point: %s", (source) => {
    const path = scope[0]!;
    expect(
      violations(new Map([[path, source]]), analyzeSource(path, source).entries)
        .length,
    ).toBeGreaterThan(0);
  });
  it("rejects a new wrapper that hides an inline vector", () => {
    const root = mkdtempSync(join(tmpdir(), "crate-admin-icon-policy-"));
    try {
      const path = scope[0]!,
        source =
          'import { HiddenMark } from "./HiddenMark"; export const Sidebar = () => <HiddenMark/>;';
      mkdirSync(join(root, "app/ui/src/components/layout"), {
        recursive: true,
      });
      writeFileSync(join(root, path), source);
      writeFileSync(
        join(root, "app/ui/src/components/layout/HiddenMark.tsx"),
        "export const HiddenMark = () => <button><svg><path/></svg></button>;",
      );
      expect(
        violations(new Map([[path, source]]), buildInventory(root).entries),
      ).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("does not let a shared loading prop or implicit overlay close bypass the guard", () => {
    const path = scope[2]!,
      source = "<><Button loading/><DialogContent/></>";
    const entries: IconEntry[] = [
      ...analyzeSource(path, source).entries,
      {
        id: "spinner",
        path,
        line: 1,
        column: 3,
        kind: "owned-icon-consumer",
        name: "Button",
        source: "@crate/ui/shadcn/button",
        control: "Button",
        label: "",
        snippet: "",
      },
      {
        id: "close",
        path,
        line: 1,
        column: 20,
        kind: "owned-icon-consumer",
        name: "DialogContent",
        source: "@crate/ui/shadcn/dialog",
        control: "DialogContent",
        label: "",
        snippet: "",
      },
    ];
    expect(violations(new Map([[path, source]]), entries)).toEqual([
      "spinner",
      "close",
    ]);
  });
  it("only accepts forwarded Button props when built-in loading is explicitly off after every spread", () => {
    const path = scope[4]!;
    for (const [source, count] of [
      ["<Button {...props} loading={false}/>", 0],
      ["<Button loading={false} {...props}/>", 1],
      ["<Button {...props} loading/>", 1],
    ] as const) {
      const entry: IconEntry = {
        id: "forwarded-button",
        path,
        line: 1,
        column: 1,
        kind: "owned-icon-consumer",
        name: "Button",
        source: "@crate/ui/shadcn/button",
        control: "Button",
        label: "",
        snippet: "",
      };
      expect(violations(new Map([[path, source]]), [entry])).toHaveLength(
        count,
      );
    }
  });
});

it("does not extend a UX approval to another glyph or a duplicate callsite", () => {
  const path = scope[2]!;
  for (const source of [
    'import { Trash2 } from "lucide-react"; const view = <Trash2 data-admin-ux="history-back"/>;',
    'import { ChevronLeft } from "lucide-react"; const view = <><ChevronLeft data-admin-ux="history-back"/><ChevronLeft data-admin-ux="history-back"/></>;',
  ])
    expect(
      violations(
        new Map([[path, source]]),
        analyzeSource(path, source).entries,
      ),
    ).toHaveLength(1);
});

function operationalIconViolations(path: string, source: string) {
  const tree = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const surfaces = new Set(["OpsPageHero", "OpsPanel", "OpsStatTile"]);
  const bindings = new Set<string>();
  for (const node of tree.statements) {
    if (
      !ts.isImportDeclaration(node) ||
      !ts.isStringLiteral(node.moduleSpecifier) ||
      node.moduleSpecifier.text !== "@/components/admin/ops-surfaces"
    )
      continue;
    const imports = node.importClause?.namedBindings;
    if (imports && ts.isNamedImports(imports)) {
      for (const entry of imports.elements) {
        if (surfaces.has((entry.propertyName ?? entry.name).text))
          bindings.add(entry.name.text);
      }
    } else if (imports && ts.isNamespaceImport(imports)) {
      for (const surface of surfaces)
        bindings.add(`${imports.name.text}.${surface}`);
    }
  }
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      bindings.has(node.tagName.getText(tree))
    ) {
      for (const attr of node.attributes.properties) {
        if (
          ts.isJsxSpreadAttribute(attr) ||
          (ts.isJsxAttribute(attr) && attr.name.getText(tree) === "icon")
        )
          found.push(
            `${path}:${tree.getLineAndCharacterOfPosition(attr.getStart(tree)).line + 1}`,
          );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}

function productionTsx(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? productionTsx(path)
      : entry.name.endsWith(".tsx") && !entry.name.includes(".test.")
        ? [path]
        : [];
  });
}

describe("Admin operational surface consumer contracts", () => {
  it("does not pass decorative icons or opaque props to retired operational surfaces", () => {
    const found = productionTsx(join(repo, "app/ui/src")).flatMap((path) =>
      operationalIconViolations(path, readFileSync(path, "utf8")),
    );
    expect(found).toEqual([]);
  });
  it.each([
    [
      'import { OpsPanel } from "@/components/admin/ops-surfaces"; const view = <OpsPanel icon={Glyph}/>;',
      1,
    ],
    [
      'import { OpsPageHero as Hero } from "@/components/admin/ops-surfaces"; const view = <Hero icon={Glyph}/>;',
      1,
    ],
    [
      'import * as Ops from "@/components/admin/ops-surfaces"; const view = <Ops.OpsStatTile {...props}/>;',
      1,
    ],
    [
      'import { OpsPanel } from "@/components/admin/ops-surfaces"; const view = <OpsPanel title="Tasks" action={<button>Refresh</button>}>Jobs</OpsPanel>;',
      0,
    ],
  ] as const)(
    "checks aliases and spreads without banning action slots: %s",
    (source, count) => {
      expect(operationalIconViolations("fixture.tsx", source)).toHaveLength(
        count,
      );
    },
  );
});

it("does not let badge icon props or opaque spreads bypass the migrated page guard", () => {
  const path = "app/ui/src/pages/Logs.tsx";
  for (const [source, count] of [
    ["<CratePill>Live</CratePill>", 0],
    ["<CratePill icon={Glyph}>Live</CratePill>", 1],
    ["<CratePill {...props}>Live</CratePill>", 1],
  ] as const) {
    const entry: IconEntry = {
      id: "badge",
      path,
      line: 1,
      column: 1,
      kind: "owned-icon-consumer",
      name: "CratePill",
      source: "@crate/ui/primitives/CrateBadge",
      control: "CratePill",
      label: "",
      snippet: "",
    };
    expect(violations(new Map([[path, source]]), [entry])).toHaveLength(count);
  }
});
