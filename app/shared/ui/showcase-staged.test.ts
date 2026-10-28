import { expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
it("validates staged source, not an unstaged repair in the working tree", () => {
  const root = mkdtempSync(join(tmpdir(), "crate-showcase-"));
  try {
    const source = "app/shared/ui/primitives/Example.tsx",
      story = "tools/crate-ui-showcase/stories/Example.stories.tsx",
      docs = "tools/crate-ui-showcase/docs/Example.mdx";
    const data = { [source]: "original", [story]: "story", [docs]: "docs" };
    const write = (p: string, s: string) => {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), s);
    };
    for (const [p, s] of Object.entries(data)) write(p, s);
    write(
      "tools/crate-ui-showcase/catalogue.json",
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "example",
            name: "Example",
            purpose: "A component",
            category: "Data Display",
            adoption: "Pending consumer review",
            knownIssues: [],
            storyId: "componentes-example",
            coverage: "documented",
            sources: [source],
            story,
            docs,
            fingerprints: Object.fromEntries(
              Object.entries(data).map(([p, s]) => [
                p,
                createHash("sha256").update(s).digest("hex"),
              ]),
            ),
          },
        ],
      }),
    );
    const git = (...a: string[]) =>
      execFileSync("git", a, { cwd: root, stdio: "pipe" });
    git("init", "--quiet");
    git("add", ".");
    const cli = resolve(
      import.meta.dirname,
      "../../../scripts/design-system/check-showcase.mjs",
    );
    const check = () =>
      execFileSync(process.execPath, [cli, "--root", root, "--staged"], {
        stdio: "pipe",
      });
    write(source, "unstaged edit");
    expect(() => check()).not.toThrow();
    git("add", source);
    expect(() => check()).toThrow();
    write(source, "original");
    expect(() => check()).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("compares a committed catalogue against an explicit CI base revision", () => {
  const root = mkdtempSync(join(tmpdir(), "crate-showcase-history-"));
  try {
    const source = "app/shared/ui/primitives/Legacy.tsx";
    const registry = "tools/crate-ui-showcase/catalogue.json";
    const write = (p: string, s: string) => {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), s);
    };
    const hash = (s: string) => createHash("sha256").update(s).digest("hex");
    const legacyFingerprints: Record<string, string> = {
      [source]: hash("original"),
    };
    const legacy = {
      id: "legacy",
      name: "Legacy",
      purpose: "Historical debt",
      category: "Data Display",
      adoption: "Pending",
      knownIssues: [],
      storyId: null,
      coverage: "pending",
      sources: [source],
      story: null,
      docs: null,
      fingerprints: legacyFingerprints,
    };
    const catalogue = { version: 1, entries: [legacy] };
    write(source, "original");
    write(registry, JSON.stringify(catalogue));
    const git = (...a: string[]) =>
      execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: "pipe" });
    const commit = () => {
      git("add", ".");
      git(
        "-c",
        "user.name=Showcase test",
        "-c",
        "user.email=showcase@example.invalid",
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "--quiet",
        "-m",
        "test fixture",
      );
    };
    git("init", "--quiet");
    commit();
    const base = git("rev-parse", "HEAD").trim();
    const cli = resolve(
      import.meta.dirname,
      "../../../scripts/design-system/check-showcase.mjs",
    );
    const check = (ref = base) =>
      execFileSync(process.execPath, [cli, "--root", root, "--base", ref], {
        encoding: "utf8",
        stdio: "pipe",
      });
    expect(check()).toContain("catalogue OK");
    write(source, "changed");
    legacy.fingerprints[source] = hash("changed");
    write(registry, JSON.stringify(catalogue));
    commit();
    expect(() => check()).toThrow(/Pending entry legacy changed/);
    write(source, "original");
    legacy.fingerprints[source] = hash("original");
    const extra = "app/shared/ui/primitives/Added.tsx";
    write(extra, "new");
    catalogue.entries.push({
      ...legacy,
      id: "added",
      sources: [extra],
      fingerprints: { [extra]: hash("new") },
    });
    write(registry, JSON.stringify(catalogue));
    commit();
    expect(() => check()).toThrow(/New entry added cannot be pending/);
    expect(() => check("missing-base")).toThrow(/Cannot resolve showcase base/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
