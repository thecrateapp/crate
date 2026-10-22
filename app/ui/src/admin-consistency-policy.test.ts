import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeAdminConsistency,
  buildAdminConsistencyInventory,
} from "../../../scripts/design-system/admin-consistency-policy.mjs";

const repo = resolve(process.cwd(), "../..");
const path = "app/ui/src/pages/Users.tsx";

describe("Admin consistency prevention", () => {
  it.each([
    [
      'import { Badge as Tag } from "@crate/ui/shadcn/badge"; const view=<Tag className="py-0 text-[10px]"/>;',
      "static-tag-geometry",
    ],
    [
      'import { InfoBadge as Tag } from "@crate/ui/primitives/InfoBadge"; const view=<Tag className="py-0 text-[10px]"/>;',
      "static-tag-geometry",
    ],
    [
      'import { CrateChip } from "@crate/ui/primitives/CrateBadge"; const view=<CrateChip className="md:text-xs"/>;',
      "static-tag-geometry",
    ],
    ['<span className="font-mono font-semibold"/>', "mono-weight"],
    [
      '<span className={cn("font-mono", active && "font-bold")}/>',
      "mono-weight",
    ],
    ['<span className="font-display text-sm"/>', "compact-display"],
    [
      'import { Badge as Tag } from "@crate/ui/shadcn/badge"; const view=<Tag className="font-mono"/>;',
      "mono-badge-weight",
    ],
    [
      'import { CrateChip as Tag } from "@crate/ui/primitives/CrateBadge"; const view=<Tag className={cn("text-white/60", dense ? "text-[11px]" : "text-xs")}/>;',
      "static-tag-geometry",
    ],
    [
      'import { CrateChip } from "@crate/ui/primitives/CrateBadge"; const size="py-1"; const view=<CrateChip className={size}/>;',
      "static-tag-geometry",
    ],
  ])("rejects %s", (source, rule) => {
    expect(
      analyzeAdminConsistency(path, source).map((issue) => issue.rule),
    ).toContain(rule);
  });

  it.each([
    '<h2 className="font-display text-xl"/>',
    '<h3 className="font-display text-sm"/>',
    '<CardTitle className="font-display"/>',
    '<span data-slot="entity-title" className="font-display text-lg"/>',
    '<div className="font-display text-base tabular-nums">12</div>',
    '<h3 className="font-sans text-base font-semibold"/>',
    'import { Badge } from "@crate/ui/shadcn/badge"; const view=<Badge className="text-state-warning-text"/>;',
    'import { CrateChip } from "@crate/ui/primitives/CrateBadge"; const view=<CrateChip className="text-state-warning-text"/>;',
  ])("retains legitimate roles: %s", (source) => {
    expect(analyzeAdminConsistency(path, source)).toEqual([]);
  });

  it("rejects new translucent/shadowed surfaces without a declared migration owner", () => {
    expect(
      analyzeAdminConsistency(
        path,
        '<div className="bg-panel-surface/95 backdrop-blur-xl shadow-[0_2px_4px_black]"/>',
      ).map((issue) => issue.rule),
    ).toContain("unowned-surface");
  });

  it("checks responsive and arbitrary-selector surface variants without borrowing a base exemption", () => {
    for (const token of [
      "md:bg-panel-surface/95",
      "[&:hover]:lg:backdrop-blur-xl",
      "md:shadow-[0_2px_4px_black]",
    ]) {
      const debt = [
        {
          path,
          owner: "Admin",
          phase: "6.6",
          reason: "Inherited panel",
          tokens: { "bg-panel-surface/95": 1 },
        },
      ];
      expect(
        analyzeAdminConsistency(path, `<div className="${token}"/>`, debt).map(
          (issue) => issue.rule,
        ),
      ).toContain("unowned-surface");
    }
  });

  it("resolves same-named constants in their nearest lexical component scope", () => {
    const source = `
      function First() { const classes = "font-mono font-bold"; return <span className={classes}/>; }
      function Second() { const classes = "font-sans"; return <span className={classes}/>; }
    `;
    expect(
      analyzeAdminConsistency(path, source).map((issue) => issue.rule),
    ).toEqual(["mono-weight"]);
  });

  it("does not resolve runtime parameters through an unrelated outer constant", () => {
    const source = `
      const classes = "font-mono font-bold";
      function View(classes) { return <span className={classes}/>; }
      function Other({ classes }) { return <span className={classes}/>; }
    `;
    expect(analyzeAdminConsistency(path, source)).toEqual([]);
  });

  it("requires exact pending surface tokens and does not let an owner excuse new styles", () => {
    const debt = [
      {
        path,
        owner: "Admin",
        phase: "6.6",
        reason: "Inherited panel",
        tokens: { "bg-panel-surface/95": 1 },
      },
    ];
    expect(
      analyzeAdminConsistency(
        path,
        '<div className="bg-panel-surface/95"/>',
        debt,
      ),
    ).toEqual([]);
    expect(
      analyzeAdminConsistency(
        path,
        '<><div className="bg-panel-surface/95"/><div className="bg-panel-surface/95"/></>',
        debt,
      ).map((issue) => issue.rule),
    ).toContain("unowned-surface");
    expect(
      analyzeAdminConsistency(
        path,
        '<div className="bg-panel-surface/90"/>',
        debt,
      ).map((issue) => issue.rule),
    ).toContain("unowned-surface");
    expect(
      analyzeAdminConsistency(path, '<div className="bg-panel-surface/95"/>', [
        { ...debt[0]!, owner: "" },
      ]).map((issue) => issue.rule),
    ).toContain("unowned-surface");
  });

  it("checks reconciled consumers and matches the registered adoption debt", () => {
    const inventory = buildAdminConsistencyInventory(repo);
    expect(inventory.filesScanned).toBeGreaterThanOrEqual(10);
    expect(inventory.violations).toEqual([]);
    expect(inventory.pending).toEqual(
      JSON.parse(
        readFileSync(
          resolve(repo, "scripts/design-system/admin-adoption-debt.json"),
          "utf8",
        ),
      ).pending,
    );
    for (const item of inventory.pending) {
      expect(item.owner).toBeTruthy();
      expect(item.phase).toBeTruthy();
      expect(item.reason).toBeTruthy();
      expect(readFileSync(resolve(repo, item.path), "utf8")).toBeTruthy();
    }
  });
});
