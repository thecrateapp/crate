import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const policyPath = resolve(
  import.meta.dirname,
  "../../../scripts/design-system/showcase-policy.mjs",
);
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const source = "app/shared/ui/primitives/Example.tsx";
const story = "tools/crate-ui-showcase/stories/Example.stories.tsx";
const docs = "tools/crate-ui-showcase/docs/Example.mdx";
const data = {
  [source]: "export function Example() {}",
  [story]: "story",
  [docs]: "contract",
};
function entry(coverage = "documented") {
  return {
    id: "example",
    name: "Example",
    purpose: "A real component contract",
    category: "Data Display",
    adoption: "Pending consumer review",
    knownIssues: [],
    storyId: coverage === "documented" ? "componentes-example" : null,
    coverage,
    sources: [source],
    story: coverage === "documented" ? story : null,
    docs: coverage === "documented" ? docs : null,
    fingerprints: Object.fromEntries(
      Object.entries(data)
        .filter(([p]) => coverage === "documented" || p === source)
        .map(([p, s]) => [p, digest(s)]),
    ),
  };
}
async function run(
  entries: unknown[],
  contents = data,
  previous?: unknown,
  files = [source],
) {
  expect(existsSync(policyPath), "showcase maintenance policy must exist").toBe(
    true,
  );
  const { validateCatalogue } = await import(policyPath);
  return validateCatalogue({
    catalogue: { version: 1, entries },
    files,
    read: (p: string) => contents[p as keyof typeof contents],
    previous,
  });
}
describe("showcase maintenance contract", () => {
  it("accepts a documented component with current source/story/docs", async () => {
    expect(await run([entry()])).toEqual([]);
  });
  it("rejects an added visual module without its inventory entry", async () => {
    expect((await run([])).join(" ")).toMatch(/Example.*entry/i);
  });
  it("rejects changed source until its entry and examples are updated", async () => {
    expect(
      (await run([entry()], { ...data, [source]: "changed" })).join(" "),
    ).toMatch(/stale.*Example/i);
  });
  it("does not let an old pending module hide a change by refreshing its hash", async () => {
    const old = entry("pending"),
      changed = structuredClone(old);
    changed.fingerprints[source] = digest("changed");
    expect(
      (
        await run(
          [changed],
          { ...data, [source]: "changed" },
          { version: 1, entries: [old] },
        )
      ).join(" "),
    ).toMatch(/pending.*document/i);
  });
  it("requires a real story or doc update when a documented source changes", async () => {
    const old = entry(),
      changed = structuredClone(old);
    changed.fingerprints[source] = digest("changed");
    expect(
      (
        await run(
          [changed],
          { ...data, [source]: "changed" },
          { version: 1, entries: [old] },
        )
      ).join(" "),
    ).toMatch(/story.*doc.*update/i);
  });
  it("rejects missing documentation and duplicate source ownership", async () => {
    expect(
      (
        await run([entry()], {
          ...data,
          [docs]: undefined,
        } as unknown as typeof data)
      ).join(" "),
    ).toMatch(/missing.*Example.mdx/i);
    expect(
      (await run([entry(), { ...entry(), id: "other" }])).join(" "),
    ).toMatch(/multiple/i);
  });
  it("reports deleted or renamed source anchors", async () => {
    expect((await run([entry()], data, undefined, [])).join(" ")).toMatch(
      /source.*removed/i,
    );
  });
  it("keeps historical pending coverage explicit without claiming validation", async () => {
    expect(await run([entry("pending")])).toEqual([]);
  });
  it("cannot downgrade documented coverage to pending and delete its docs", async () => {
    expect(
      (
        await run([entry("pending")], data, { version: 1, entries: [entry()] })
      ).join(" "),
    ).toMatch(/pending.*previously pending/i);
  });
  it.each([
    "storyId",
    "knownIssues",
    "adoption",
    "purpose",
    "fingerprints",
    "category",
  ])("rejects missing rendered metadata: %s", async (field) => {
    const invalid = { ...entry() } as Record<string, unknown>;
    delete invalid[field];
    expect((await run([invalid])).join(" ")).toMatch(new RegExp(field, "i"));
  });
  it("rejects categories outside the functional taxonomy", async () => {
    expect(
      (await run([{ ...entry(), category: "Everything" }])).join(" "),
    ).toMatch(/category/i);
  });
  it.each([
    null,
    "entry",
    { ...entry(), sources: [null] },
    { ...entry(), knownIssues: "issue" },
  ])("reports malformed entries without throwing: %j", async (invalid) => {
    expect((await run([invalid])).join(" ")).toMatch(/invalid.*entry/i);
  });
  it("requires real story/MDX filenames and a usable Storybook id", async () => {
    const invalid = { ...entry(), storyId: "", story: docs, docs: story };
    expect((await run([invalid])).join(" ")).toMatch(/storyId|story|docs/i);
  });
});

it("keeps the actual repository catalogue in sync", () => {
  const root = resolve(import.meta.dirname, "../../..");
  const script = resolve(root, "scripts/design-system/check-showcase.mjs");
  const result = execFileSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
  });
  expect(result).toContain("Showcase catalogue OK:");
});
