import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { analyzeSource, buildInventory } from "./admin-icon-inventory.mjs";

const entries = (source) =>
  analyzeSource("app/ui/src/Example.tsx", source).entries;
test("records runtime aliases and namespace glyphs without type-only imports", () => {
  const result = analyzeSource(
    "app/ui/src/Example.tsx",
    'import { Trash2 as DeleteGlyph, type LucideIcon } from "lucide-react"; import * as Icons from "lucide-react"; const view = <><DeleteGlyph/><Icons.Search/></>;',
  );
  assert.deepEqual(
    result.imports.filter((item) => item.glyph).map((item) => item.local),
    ["DeleteGlyph", "Icons"],
  );
  assert.deepEqual(
    result.entries
      .filter((item) => item.kind === "glyph-jsx")
      .map((item) => item.name),
    ["DeleteGlyph", "Icons.Search"],
  );
});
test("finds icon props and registry values even without direct JSX glyphs", () => {
  const result = entries(
    'import { Check } from "lucide-react"; const states = { ready: { icon: Check } }; const view = <Chip icon={Check}/>;',
  );
  assert.equal(result.filter((item) => item.kind === "icon-prop").length, 1);
  assert.equal(
    result.filter((item) => item.kind === "icon-property").length,
    1,
  );
  assert.equal(
    result.filter((item) => item.kind === "glyph-reference").length,
    2,
  );
});
test("records dynamic icon slots and literal vectors separately", () => {
  const result = entries(
    "function Badge({icon: Icon}) { return <><Icon/><meta.icon/><svg><path/></svg><canvas/></>; }",
  );
  assert.equal(
    result.filter((item) => item.kind === "dynamic-glyph").length,
    2,
  );
  assert.deepEqual(
    result
      .filter((item) => item.kind === "native-visual")
      .map((item) => item.name),
    ["svg", "canvas"],
  );
});
test("captures inline SVG strings and CSS assets without treating them as glyph imports", () => {
  assert.equal(
    entries("const marker = `<svg><path/></svg>`;").filter(
      (item) => item.kind === "vector-string",
    ).length,
    1,
  );
  assert.equal(
    analyzeSource(
      "app/ui/src/index.css",
      '.marker { background: url("data:image/svg+xml,<svg/>"); }',
    ).entries[0].kind,
    "css-vector",
  );
});
test("keeps external statistical/map surfaces distinct from icon slots", () => {
  const result = entries(
    'import { ResponsiveLine } from "@nivo/line"; import { MapContainer } from "react-leaflet"; const view = <><ResponsiveLine/><MapContainer/></>;',
  );
  assert.deepEqual(
    result
      .filter((item) => item.kind === "external-visual")
      .map((item) => item.name),
    ["ResponsiveLine", "MapContainer"],
  );
});
test("traces owned aliases/reexports by symbol without attributing a sibling export's icon", () => {
  const root = mkdtempSync(join(tmpdir(), "crate-icon-inventory-"));
  const files = {
    "app/ui/src/Example.tsx":
      'import { Container, Closer } from "@/components/ui"; export function Page() { return <><Container/><Closer/></>; }',
    "app/ui/src/components/ui/index.ts":
      'export { Container, Closer } from "@crate/ui/primitives/Layer";',
    "app/shared/ui/primitives/Layer.tsx":
      'import { X } from "lucide-react"; export function Container() { return <section/>; } export function Closer() { return <button aria-label="Close"><X/></button>; }',
    "app/ui/src/ignored.test.tsx":
      'import { Star } from "lucide-react"; const view = <Star/>;',
  };
  try {
    for (const [file, source] of Object.entries(files)) {
      const target = join(root, file);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, source);
    }
    const result = buildInventory(root);
    const inherited = result.entries.filter(
      (item) => item.kind === "owned-icon-consumer",
    );
    assert.deepEqual(
      inherited.map((item) => item.name),
      ["Closer"],
    );
    assert.ok(inherited[0].via.some((path) => path.includes("Layer.tsx")));
    assert.equal(result.files.length, 2);
    assert.equal(
      result.files.some((file) => file.path.includes("ignored.test")),
      false,
    );
    assert.deepEqual(buildInventory(root), result);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("follows glyph aliases and preserves accessible control context", () => {
  const result = entries(
    'import { Trash2 } from "lucide-react"; const Glyph = Trash2; function Toolbar() { return <button aria-label="Delete item"><Glyph/></button>; }',
  );
  const glyph = result.find((item) => item.kind === "glyph-jsx");
  assert.equal(glyph.name, "Glyph");
  assert.equal(glyph.control, "button");
  assert.match(glyph.label, /Delete item/);
  assert.equal(glyph.line, 1);
});

test("traces both entry points of star reexport cycles", () => {
  const root = mkdtempSync(join(tmpdir(), "crate-icon-inventory-"));
  const files = {
    "app/ui/src/Page.tsx":
      'import { Closer } from "./barrel"; import { Closer as ThroughCycle } from "./cycle"; export const Page = () => <><Closer/><ThroughCycle/></>;',
    "app/ui/src/barrel.ts":
      'export * from "./cycle"; export * from "@crate/ui/primitives/Layer";',
    "app/ui/src/cycle.ts": 'export * from "./barrel";',
    "app/shared/ui/primitives/Layer.tsx":
      'import { X } from "lucide-react"; export const Closer = () => <button><X/></button>;',
  };
  try {
    for (const [file, source] of Object.entries(files)) {
      const target = join(root, file);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, source);
    }
    assert.deepEqual(
      buildInventory(root)
        .entries.filter((item) => item.kind === "owned-icon-consumer")
        .map((item) => item.name),
      ["Closer", "ThroughCycle"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI detects stale Admin sources and records traced shared dependency hashes", () => {
  const root = mkdtempSync(join(tmpdir(), "crate-icon-inventory-"));
  const script = resolve("scripts/design-system/admin-icon-inventory.mjs");
  const admin = join(root, "app/ui/src/Page.tsx");
  const shared = join(root, "app/shared/ui/primitives/Closer.tsx");
  const run = (flag) =>
    spawnSync(process.execPath, [script, flag], {
      cwd: root,
      encoding: "utf8",
    });
  try {
    mkdirSync(join(admin, ".."), { recursive: true });
    mkdirSync(join(shared, ".."), { recursive: true });
    writeFileSync(
      admin,
      'import { Closer } from "@crate/ui/primitives/Closer"; export const Page = () => <Closer/>;',
    );
    writeFileSync(
      shared,
      'import { X } from "lucide-react"; export const Closer = () => <X/>;',
    );
    assert.equal(run("--write").status, 0);
    assert.equal(run("--check").status, 0);
    const before = buildInventory(root).ownedDependencies;
    writeFileSync(
      shared,
      readFileSync(shared, "utf8") + "\n// shared implementation changed\n",
    );
    assert.notDeepEqual(buildInventory(root).ownedDependencies, before);
    assert.equal(run("--check").status, 1);
    assert.equal(run("--write").status, 0);
    writeFileSync(
      admin,
      readFileSync(admin, "utf8") + "\n// Admin source changed\n",
    );
    assert.equal(run("--check").status, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("review proposals reference the published source and approve no action exception", () => {
  const review = JSON.parse(
    readFileSync(
      "docs/plans/crate-v3-analysis/admin-icon-review-1v.json",
      "utf8",
    ),
  );
  // 1V is a historical 1U source snapshot; later groups keep it intact.
  const sourceRevision = "afed5a3c2174b7ebe39c2f6a6e7fbdbd7212469a";
  assert.equal(review.proposedRetainedActionGlyphs, 0);
  assert.equal(
    new Set(review.cases.map((item) => item.id)).size,
    review.cases.length,
  );
  for (const item of review.cases) {
    assert.equal(
      execFileSync("git", ["show", `${sourceRevision}:${item.path}`], {
        encoding: "utf8",
      })
        .split("\n")
        [item.line - 1].trim(),
      item.sourceLine,
      item.id,
    );
    assert.ok(item.proposal && item.why && item.sourceLine, item.id);
  }
});

test("traces inline vector wrappers as content candidates, separate from glyph-library routes", () => {
  const root = mkdtempSync(join(tmpdir(), "crate-icon-inventory-"));
  try {
    mkdirSync(join(root, "app/ui/src"), { recursive: true });
    mkdirSync(join(root, "app/shared/ui/primitives"), { recursive: true });
    writeFileSync(
      join(root, "app/ui/src/Page.tsx"),
      'import { VectorButton } from "@crate/ui/primitives/VectorButton"; export const Page = () => <VectorButton/>;',
    );
    writeFileSync(
      join(root, "app/shared/ui/primitives/VectorButton.tsx"),
      "export const VectorButton = () => <button><svg><path/></svg></button>;",
    );
    const wrapped = buildInventory(root).entries.find(
      (item) => item.name === "VectorButton",
    );
    assert.equal(wrapped?.kind, "owned-vector-consumer");
    assert.ok(wrapped.via.includes("native:svg"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
