import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  countGoTests,
  countMigrations,
  countPytest,
  countRustTests,
  countTaskTypes,
  countVitest,
  listTaskQueues,
  updateScale,
} from "./scale-numbers.mjs";

describe("counters", () => {
  it("counts pytest functions, including async ones and methods", () => {
    const source = [
      "def test_one():",
      "    pass",
      "async def test_two():",
      "    pass",
      "class TestThing:",
      "    def test_three(self):",
      "        pass",
      "def helper_test_not_counted():",
      "    pass",
    ].join("\n");
    expect(countPytest(source)).toBe(3);
  });

  it("counts Vitest it and test calls but not describe blocks", () => {
    const source = [
      'describe("group", () => {',
      '  it("one", () => {});',
      "  test('two', () => {});",
      "  it.skip(`three`, () => {});",
      '  const result = test_helper("x");',
      "});",
    ].join("\n");
    expect(countVitest(source)).toBe(3);
  });

  it("counts Go test functions only", () => {
    const source = [
      "func TestOne(t *testing.T) {}",
      "func TestTwo(t *testing.T) {}",
      "func helper() {}",
      "func BenchmarkThing(b *testing.B) {}",
    ].join("\n");
    expect(countGoTests(source)).toBe(2);
  });

  it("counts Rust test attributes, including async runtimes", () => {
    const source = [
      "#[test]",
      "fn one() {}",
      "#[tokio::test]",
      "async fn two() {}",
      '#[tokio::test(flavor = "multi_thread")]',
      "async fn three() {}",
      "#[cfg(test)]",
      "mod tests {}",
    ].join("\n");
    expect(countRustTests(source)).toBe(3);
  });

  it("counts task types declared in TASK_POOL_CONFIG", () => {
    const source = [
      "OTHER = {",
      '    "not_a_task": TaskPoolConfig("default", 0, 1, 0),',
      "}",
      "TASK_POOL_CONFIG: dict[str, TaskPoolConfig] = {",
      '    "tidal_download": TaskPoolConfig(',
      '        "default", 0, 14400, 0',
      "    ),",
      '    "delete_album": TaskPoolConfig("default", 0, 300, 0),',
      '    "fetch_cover": TaskPoolConfig("fast", 0, 120, 2),',
      "}",
    ].join("\n");
    expect(countTaskTypes(source)).toBe(3);
  });

  it("groups task types by queue in declaration order", () => {
    const source = [
      "TASK_POOL_CONFIG: dict[str, TaskPoolConfig] = {",
      '    "tidal_download": TaskPoolConfig(',
      '        "default", 0, 14400, 0',
      "    ),",
      '    "fetch_cover": TaskPoolConfig("fast", 0, 120, 2),',
      '    "delete_album": TaskPoolConfig("default", 0, 300, 0),',
      "}",
    ].join("\n");
    expect(listTaskQueues(source)).toEqual({
      default: ["tidal_download", "delete_album"],
      fast: ["fetch_cover"],
    });
  });

  it("counts Alembic revision files", () => {
    const files = [
      "001_baseline.py",
      "002_add_metric_rollups.py",
      "067a_global_catalog_route_aliases.py",
      "__init__.py",
      "__pycache__",
      "notes.md",
    ];
    expect(countMigrations(files)).toBe(3);
  });
});

function write(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

describe("updateScale", () => {
  const existing = {
    tracks: "48,213",
    albums: "4,400",
    pytest: 1,
    vitest: 1,
    goTests: 1,
    rustTests: 1,
    taskTypes: 1,
    migrations: 1,
  };

  it("keeps the existing file when the repository sources are missing", () => {
    const root = mkdtempSync(join(tmpdir(), "scale-"));
    const appDir = join(root, "app");
    const out = join(appDir, "web/src/data/scale.json");
    write(out, JSON.stringify(existing));

    const result = updateScale({ appDir, repoDir: root, out });

    expect(result).toBeNull();
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual(existing);
  });

  it("recounts from the repository and keeps the hand-maintained library figures", () => {
    const root = mkdtempSync(join(tmpdir(), "scale-"));
    const appDir = join(root, "app");
    const out = join(appDir, "web/src/data/scale.json");
    write(out, JSON.stringify(existing));
    write(join(appDir, "tests/test_a.py"), "def test_a():\n    pass\n");
    write(join(appDir, "listen/src/a.test.ts"), 'it("a", () => {});\n');
    write(
      join(appDir, "listen/node_modules/x/b.test.ts"),
      'it("b", () => {});\n',
    );
    write(join(appDir, "readplane/a_test.go"), "func TestA(t *testing.T) {}\n");
    write(join(appDir, "media-worker/src/lib.rs"), "#[test]\nfn a() {}\n");
    write(
      join(appDir, "media-worker/target/debug/gen.rs"),
      "#[test]\nfn b() {}\n",
    );
    write(join(root, "tools/crate-cli/src/main.rs"), "#[test]\nfn c() {}\n");
    write(
      join(appDir, "crate/actors.py"),
      'TASK_POOL_CONFIG = {\n    "a": TaskPoolConfig("default", 0, 1, 0),\n}\n',
    );
    write(join(appDir, "crate/db/migrations/versions/001_baseline.py"), "");

    const result = updateScale({ appDir, repoDir: root, out });

    const expected = {
      tracks: "48,213",
      albums: "4,400",
      pytest: 1,
      vitest: 1,
      goTests: 1,
      rustTests: 2,
      taskTypes: 1,
      migrations: 1,
      taskQueues: { default: ["a"] },
    };
    expect(result).toEqual(expected);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual(expected);
  });
});
