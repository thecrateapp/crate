import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
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
const scope = ["Sidebar", "CommandPalette", "Shell"].map(
  (name) => `app/ui/src/components/layout/${name}.tsx`,
);
// These are unmigrated nested surfaces from the approved 1V inventory, not permanent
// action-icon exceptions. Their one callsite each must not grow; group 2 reviews their
// redundant glyphs while retaining the functional UX glyphs.
const pending = new Map([
  ["app/ui/src/components/layout/Sidebar.tsx:@/components/ui/AdminSelect", 1],
  ["app/ui/src/components/layout/Shell.tsx:./SearchBar", 1],
]);
// Diego's 1W steering explicitly retains UX glyphs. Each concrete site remains bounded.
const approvedUx = new Map([
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
  [
    "CommandPalette:palette-close",
    ["@crate/ui/shadcn/overlay-close-button", "OverlayCloseButton"],
  ],
]);
function violations(sources: Map<string, string>, entries: IconEntry[]) {
  const found: string[] = [];
  const deferred = new Map<string, number>();
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
      ["./Sidebar", "./CommandPalette"].includes(entry.source ?? "")
    )
      continue; // Checked directly in this scope.
    const key = `${entry.path}:${entry.source}`;
    if (pending.has(key)) {
      deferred.set(key, (deferred.get(key) ?? 0) + 1);
      continue;
    }
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
      entry.source === "@crate/ui/shadcn/button" &&
      !prop("loading")
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
  for (const [key, count] of deferred)
    if (count > pending.get(key)!) found.push(`${key}: nested surface grew`);
  return found;
}

describe("Admin icon retirement policy — migrated navigation scope", () => {
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
