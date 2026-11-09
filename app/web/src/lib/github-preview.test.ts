// @vitest-environment node
import { describe, expect, it } from "vitest";
import { canonicalGitHubFileUrl, parseGitHubFileUrl } from "./github-preview";

const commit = "e08714d4a7b51ecdcf72fe196f6730d567c7a22f";
const file = `https://github.com/thecrateapp/crate/blob/${commit}/app/listen/Processor.java`;

describe("GitHub file references", () => {
  it("retains the exact revision, file and highlighted line interval", () => {
    expect(parseGitHubFileUrl(`${file}#L212-L224`)).toMatchObject({
      owner: "thecrateapp", repo: "crate", ref: commit,
      path: "app/listen/Processor.java", lineStart: 212, lineEnd: 224, anchor: "L212-L224",
    });
    expect(parseGitHubFileUrl(`${file}#L212`)).toMatchObject({ lineStart: 212, lineEnd: 212 });
  });

  it("shares one file asset between line ranges but preserves Markdown anchors", () => {
    const first = parseGitHubFileUrl(`${file}#L10`)!;
    const second = parseGitHubFileUrl(`${file}#L20-L30`)!;
    expect(first.key).toBe(second.key);
    expect(parseGitHubFileUrl(file.replace("thecrateapp", "TheCrateApp"))?.key).toBe(first.key);
    expect(parseGitHubFileUrl(`${file}#the-output-clock`)).toMatchObject({ anchor: "the-output-clock" });
    expect(parseGitHubFileUrl(file.replace(commit, "main"))?.key).not.toBe(first.key);
  });

  it("leaves commits, trees, repositories and other sites as ordinary links", () => {
    for (const href of [
      "https://github.com/thecrateapp/crate",
      `https://github.com/thecrateapp/crate/commit/${commit}`,
      `https://github.com/thecrateapp/crate/tree/${commit}/app`,
      "https://github.com.evil.test/thecrateapp/crate/blob/main/a.ts",
      "javascript:alert(1)",
      "http://github.com/thecrateapp/crate/blob/main/a.ts",
      "https://token@github.com/thecrateapp/crate/blob/main/a.ts",
      `${file}#L0`, `${file}#L20-L10`,
      "https://github.com/thecrateapp/crate/blob/main/path%00.ts",
      "https://github.com/thecrateapp/crate/blob/main/%2e%2e%2fsecret",
    ]) expect(parseGitHubFileUrl(href)).toBeUndefined();
  });

  it("encodes file names without changing the canonical immutable commit", () => {
    const parsed = parseGitHubFileUrl("https://github.com/Org/Repo/blob/feature%2Fplayer/docs/My%20notes.md#introduction")!;
    expect(parsed).toMatchObject({ owner: "org", repo: "repo", ref: "feature/player", path: "docs/My notes.md" });
    expect(canonicalGitHubFileUrl(parsed, commit)).toBe(`https://github.com/org/repo/blob/${commit}/docs/My%20notes.md`);
  });
});
