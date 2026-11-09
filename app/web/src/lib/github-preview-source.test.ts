// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseGitHubFileUrl } from "./github-preview";
import type { BlogEntry } from "./blog";

const { execute, render } = vi.hoisted(() => ({ execute: vi.fn(), render: vi.fn() }));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: execute }) };
});
vi.mock("./github-preview-render", () => ({ renderPreviewSource: render }));

const oldCommit = "e08714d4a7b51ecdcf72fe196f6730d567c7a22f";
const buildCommit = "224d3378d52d2047eb522645166efe5b7e1c0b5d";
const reference = (ref = oldCommit, path = "app/processor.java") => parseGitHubFileUrl(`https://github.com/thecrateapp/crate/blob/${ref}/${path}#L2-L4`)!;
const link = (ref = oldCommit, path = "app/processor.java") => ({ ...reference(ref, path), url: `https://github.com/thecrateapp/crate/blob/${ref}/${path}`, href: "" });
const rawUrl = (commit = oldCommit, path = "app/processor.java", repo = "thecrateapp/crate") => `https://raw.githubusercontent.com/${repo}/${commit}/${path}`;
const entry = (id: string, body: string, sources: string[] = [], draft = false): BlogEntry => ({
  id, body, data: { title: id, description: "", date: new Date("2026-01-01"), sources, draft, tags: [] },
});
/** A Git protocol v2 `ls-refs` answer, as github.com returns it. */
const refList = (...lines: string[]) => new Response([...lines.map((line) => `${(line.length + 5).toString(16).padStart(4, "0")}${line}\n`), "0000"].join(""), {
  headers: { "Content-Type": "application/x-git-upload-pack-result" },
});
const requested = () => vi.mocked(fetch).mock.calls.map((call) => String(call[0]));
const noGit = () => execute.mockRejectedValue(Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }));
const gitObject = (source: string, size = source.length) => async (_file: string, args: string[]) =>
  ({ stdout: args[0] === "show" ? source : args[1] === "-t" ? "blob\n" : `${size}\n` });

beforeEach(() => {
  vi.resetModules();
  execute.mockReset(); render.mockReset();
  render.mockResolvedValue({ language: "java", styles: [""], runs: [""] });
  vi.stubGlobal("fetch", vi.fn());
  vi.stubEnv("BLOG_SOURCE_COMMIT", "");
  vi.stubEnv("BLOG_SOURCE_REPOSITORIES", "");
  vi.stubEnv("BLOG_SOURCE_NO_GIT", "");
  vi.stubEnv("BLOG_SOURCE_GITHUB_TOKEN", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("GitHub source manifests", () => {
  it("includes prose, source headers and file footers while leaving directories alone", async () => {
    const { manifestForPost } = await import("./github-preview-source");
    const post = entry("chapter", `[Source](https://github.com/thecrateapp/crate/blob/${oldCommit}/app/processor.java#L2-L4)\n\n\`\`\`java source="app/processor.java#L2-L4" commit="${oldCommit}"\ncode\n\`\`\``, ["docs/plan.md", "app/listen"]);
    const manifest = manifestForPost(post);
    expect(manifest).toHaveLength(2);
    expect(manifest[0]).toMatchObject({ ref: oldCommit, lineStart: 2, lineEnd: 4 });
    expect(manifest[0].href).toBe(`/blog/source/${manifest[0].key}.json`);
    expect(manifest[1]).toMatchObject({ ref: "main", path: "docs/plan.md" });
  });

  it("only emits assets for visible articles and deduplicates shared files", async () => {
    const { previewSourcesForPosts } = await import("./github-preview-source");
    const posts = [entry("public", "", ["docs/public.md"]), entry("also-public", "", ["docs/public.md"]), entry("draft", "", ["docs/private.md"], true)];
    expect(previewSourcesForPosts(posts).map((item) => item.path)).toEqual(["docs/public.md"]);
    expect(previewSourcesForPosts(posts, true).map((item) => item.path).sort()).toEqual(["docs/private.md", "docs/public.md"]);
  });
});

describe("immutable source loading", () => {
  it("reads the exact historical blob, caches it and preserves its pinned GitHub URL", async () => {
    execute.mockImplementation(gitObject("historical source\n"));
    const { loadGitHubSource } = await import("./github-preview-source");
    const first = await loadGitHubSource(reference());
    expect(first).toMatchObject({ source: "historical source\n", commit: oldCommit, requestedRef: oldCommit, styles: [""], runs: [""] });
    expect(first.githubUrl).toContain(`/blob/${oldCommit}/app/processor.java`);
    expect(first).not.toHaveProperty("error");
    expect(execute).toHaveBeenCalledWith("git", ["show", `${oldCommit}:app/processor.java`], expect.anything());
    expect(fetch).not.toHaveBeenCalled();
    await loadGitHubSource(reference());
    expect(render).toHaveBeenCalledOnce();
  });

  it("pins moving main links to the explicit build revision rather than a stale local branch", async () => {
    vi.stubEnv("BLOG_SOURCE_COMMIT", buildCommit);
    execute.mockImplementation(gitObject("build source"));
    const { loadGitHubSource } = await import("./github-preview-source");
    expect(await loadGitHubSource(reference("main"))).toMatchObject({ commit: buildCommit, requestedRef: "main", source: "build source" });
    expect(execute.mock.calls.some((call) => call[1].includes("main"))).toBe(false);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("supports a source-only Docker build by fetching only the exact immutable object", async () => {
    noGit();
    vi.mocked(fetch).mockResolvedValue(new Response("remote historical source"));
    const { loadGitHubSource } = await import("./github-preview-source");
    expect(await loadGitHubSource(reference())).toMatchObject({ commit: oldCommit, source: "remote historical source" });
    expect(fetch).toHaveBeenCalledWith(rawUrl(), expect.objectContaining({ headers: {} }));
  });

  it("fails loudly for a missing historical file instead of baking an error or substituting main", async () => {
    noGit();
    vi.mocked(fetch).mockResolvedValue(new Response("Not found", { status: 404 }));
    const { loadGitHubSource } = await import("./github-preview-source");
    await expect(loadGitHubSource(reference())).rejects.toThrow(
      `Source preview for thecrateapp/crate@${oldCommit}:app/processor.java failed: The file does not exist at ${oldCommit} on GitHub`);
    expect(requested()).toEqual([rawUrl()]);
    expect(render).not.toHaveBeenCalled();
  });

  it("retries a transient GitHub failure before giving the file to the renderer", async () => {
    vi.useFakeTimers();
    noGit();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("unicorn", { status: 503 }))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response("recovered source"));
    const { loadGitHubSource } = await import("./github-preview-source");
    const loading = loadGitHubSource(reference());
    await vi.runAllTimersAsync();
    expect(await loading).toMatchObject({ source: "recovered source" });
    expect(requested()).toEqual([rawUrl(), rawUrl(), rawUrl()]);
  });

  it("surfaces a persistent outage after its retries and can load again later", async () => {
    vi.useFakeTimers();
    noGit();
    vi.mocked(fetch).mockImplementation(async () => new Response("down", { status: 502 }));
    const { loadGitHubSource } = await import("./github-preview-source");
    const failing = loadGitHubSource(reference());
    const assertion = expect(failing).rejects.toThrow(`GET ${rawUrl()} failed after 4 attempts: HTTP 502`);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(4);
    // A dev server must not cache the failure forever.
    vi.mocked(fetch).mockResolvedValue(new Response("back"));
    expect(await loadGitHubSource(reference())).toMatchObject({ source: "back" });
  });

  it("keeps the explicit GitHub fallbacks for binary and oversized files", async () => {
    noGit();
    vi.mocked(fetch).mockResolvedValueOnce(new Response("binary\0bytes"))
      .mockResolvedValueOnce(new Response("x", { headers: { "Content-Length": "1000001" } }));
    const { loadGitHubSource } = await import("./github-preview-source");
    expect(await loadGitHubSource(reference())).toMatchObject({ commit: oldCommit, source: "", error: expect.stringContaining("Binary files") });
    expect(await loadGitHubSource(reference(oldCommit, "app/big.json"))).toMatchObject({ error: expect.stringContaining("too large") });
    expect(render).not.toHaveBeenCalled();
  });

  it("recognises an oversized local blob without reading it or asking GitHub", async () => {
    execute.mockImplementation(gitObject("", 2_000_000));
    const { loadGitHubSource } = await import("./github-preview-source");
    expect((await loadGitHubSource(reference())).error).toContain("too large");
    expect(execute.mock.calls.some((call) => call[1][0] === "show")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resolves an external branch through Git's ref protocol, never the rate-limited REST API", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(refList(`${buildCommit} refs/heads/master`))
      .mockResolvedValueOnce(new Response("# Provider docs"));
    const external = parseGitHubFileUrl("https://github.com/tensorflow/models/blob/master/research/audioset/yamnet/README.md")!;
    const { loadGitHubSource } = await import("./github-preview-source");
    expect(await loadGitHubSource(external)).toMatchObject({ commit: buildCommit, requestedRef: "master", source: "# Provider docs" });
    expect(requested()).toEqual(["https://github.com/tensorflow/models.git/git-upload-pack", rawUrl(buildCommit, "research/audioset/yamnet/README.md", "tensorflow/models")]);
    const init = vi.mocked(fetch).mock.calls[0][1]!;
    expect(init).toMatchObject({ method: "POST", headers: expect.objectContaining({ "Git-Protocol": "version=2" }) });
    expect(String(init.body)).toContain("ref-prefix refs/heads/master\n");
    expect(execute).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("tensorflow/models@master is a moving reference"));
  });

  it("peels annotated tags and rejects names that are neither branch nor tag", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(refList(`${"a".repeat(40)} refs/tags/v1.0 peeled:${buildCommit}`, `${"b".repeat(40)} refs/tags/v1.0-rc1 peeled:${oldCommit}`))
      .mockResolvedValueOnce(new Response("tagged"))
      .mockResolvedValueOnce(refList());
    const { loadGitHubSource } = await import("./github-preview-source");
    const tagged = parseGitHubFileUrl("https://github.com/other/project/blob/v1.0/README.md")!;
    expect(await loadGitHubSource(tagged)).toMatchObject({ commit: buildCommit });
    const missing = parseGitHubFileUrl("https://github.com/other/project/blob/gone/README.md")!;
    await expect(loadGitHubSource(missing)).rejects.toThrow('"gone" is not a branch or tag of other/project');
    expect(requested().some((url) => url.includes("api.github.com"))).toBe(false);
  });

  it("requires Git, a full SHA or a token for an abbreviated commit, and authenticates the API call", async () => {
    noGit();
    vi.mocked(fetch).mockImplementation(async (url) => String(url).endsWith("git-upload-pack") ? refList() : new Response("unexpected", { status: 500 }));
    const short = parseGitHubFileUrl("https://github.com/other/project/blob/0cc07d08/docs/plan.md")!;
    let loader = await import("./github-preview-source");
    await expect(loader.loadGitHubSource(short)).rejects.toThrow("Link the full 40-character SHA");
    expect(requested().some((url) => url.includes("api.github.com"))).toBe(false);

    vi.resetModules();
    vi.mocked(fetch).mockReset();
    vi.stubEnv("BLOG_SOURCE_GITHUB_TOKEN", "test-token");
    vi.mocked(fetch)
      .mockResolvedValueOnce(refList())
      .mockResolvedValueOnce(Response.json({ sha: buildCommit }))
      .mockResolvedValueOnce(new Response("# Plan"));
    loader = await import("./github-preview-source");
    expect(await loader.loadGitHubSource(short)).toMatchObject({ commit: buildCommit, source: "# Plan" });
    expect(requested()[1]).toBe("https://api.github.com/repos/other/project/commits/0cc07d08");
    for (const call of vi.mocked(fetch).mock.calls.slice(1)) {
      expect(call[1]!.headers).toMatchObject({ Authorization: "token test-token" });
    }
  });

  it("BLOG_SOURCE_NO_GIT reproduces the Docker build without running Git", async () => {
    vi.stubEnv("BLOG_SOURCE_NO_GIT", "1");
    vi.stubEnv("BLOG_SOURCE_COMMIT", buildCommit);
    execute.mockImplementation(gitObject("local source"));
    vi.mocked(fetch).mockImplementation(async (url) => new Response(`remote ${String(url).split("/").pop()}`));
    const { loadGitHubSource } = await import("./github-preview-source");
    expect(await loadGitHubSource(reference())).toMatchObject({ source: "remote processor.java" });
    expect(await loadGitHubSource(reference("main", "docs/plan.md"))).toMatchObject({ commit: buildCommit, source: "remote plan.md" });
    expect(execute).not.toHaveBeenCalled();
    expect(requested()).toEqual([rawUrl(), rawUrl(buildCommit, "docs/plan.md")]);
  });

  it("without BLOG_SOURCE_COMMIT or Git, main resolves remotely and says so", async () => {
    vi.stubEnv("BLOG_SOURCE_NO_GIT", "true");
    vi.mocked(fetch).mockResolvedValueOnce(refList(`${buildCommit} refs/heads/main`)).mockResolvedValueOnce(new Response("main source"));
    const { loadGitHubSource } = await import("./github-preview-source");
    expect(await loadGitHubSource(reference("main"))).toMatchObject({ commit: buildCommit, requestedRef: "main" });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Set BLOG_SOURCE_COMMIT"));
  });

  it("preloads every reference and fails the build with the complete list of broken links", async () => {
    noGit();
    vi.mocked(fetch).mockImplementation(async (url) => String(url).includes("missing")
      ? new Response("Not found", { status: 404 }) : new Response("source"));
    const { preloadGitHubSources, loadGitHubSource } = await import("./github-preview-source");
    const good = link(oldCommit, "app/good.py");
    const broken = [link(oldCommit, "app/missing-one.py"), link(buildCommit, "docs/missing-two.md")];
    await expect(preloadGitHubSources([good])).resolves.toBeUndefined();
    const failure = await preloadGitHubSources([good, ...broken]).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("2 of 3 GitHub source previews could not be loaded");
    for (const item of broken) expect((failure as Error).message).toContain(item.url);
    // Preloaded files are not fetched a second time when their snapshot is written.
    const before = vi.mocked(fetch).mock.calls.length;
    expect(await loadGitHubSource(good)).toMatchObject({ source: "source" });
    expect(fetch).toHaveBeenCalledTimes(before);
  });

  it("stores an identical rendered file once while each link keeps its own revision", async () => {
    vi.stubEnv("BLOG_SOURCE_COMMIT", buildCommit);
    execute.mockImplementation(gitObject("unchanged since the pinned commit\n"));
    render.mockImplementation(async (_source: string, path: string, githubUrl: string) => ({
      language: "text", styles: [""], runs: [""], ...(path.endsWith(".md") ? { markdownHtml: `<a href="${githubUrl}">relative</a>` } : {}),
    }));
    const { loadGitHubSource, snapshotHref } = await import("./github-preview-source");
    const pinned = await loadGitHubSource(reference());
    const footer = await loadGitHubSource(reference("main"));
    expect(pinned).toMatchObject({ commit: oldCommit, source: "unchanged since the pinned commit\n" });
    expect(footer).toEqual({
      owner: "thecrateapp", repo: "crate", path: "app/processor.java", requestedRef: "main", commit: buildCommit,
      githubUrl: `https://github.com/thecrateapp/crate/blob/${buildCommit}/app/processor.java`, source: "",
      sameAs: snapshotHref(reference().key),
    });
    // Markdown links resolve against each commit, so those documents stay separate.
    await loadGitHubSource(reference(oldCommit, "docs/plan.md"));
    expect(await loadGitHubSource(reference("main", "docs/plan.md"))).not.toHaveProperty("sameAs");
  });

  it("reads an explicitly mapped external checkout only after verifying its GitHub repository", async () => {
    vi.stubEnv("BLOG_SOURCE_REPOSITORIES", JSON.stringify({ "thecrateapp/crate-decks": "/checkouts/crate-decks" }));
    execute.mockImplementation(async (_file, args: string[]) => ({ stdout:
      args[0] === "remote" ? "git@github.com:thecrateapp/crate-decks.git\n" :
      args[0] === "show" ? "# Exact historical plan\n" : args[1] === "-t" ? "blob\n" : "24\n",
    }));
    const linked = parseGitHubFileUrl(`https://github.com/thecrateapp/crate-decks/blob/${oldCommit}/docs/plan.md`)!;
    const { loadGitHubSource } = await import("./github-preview-source");
    expect(await loadGitHubSource(linked)).toMatchObject({ owner: "thecrateapp", repo: "crate-decks", commit: oldCommit, source: "# Exact historical plan\n" });
    expect(execute).toHaveBeenCalledWith("git", ["show", `${oldCommit}:docs/plan.md`], expect.objectContaining({ cwd: "/checkouts/crate-decks" }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not read a mapped checkout whose origin belongs to another repository", async () => {
    vi.stubEnv("BLOG_SOURCE_REPOSITORIES", JSON.stringify({ "thecrateapp/crate-decks": "/checkouts/wrong" }));
    execute.mockResolvedValue({ stdout: "https://github.com/another/project.git\n" });
    vi.mocked(fetch).mockResolvedValue(new Response("not found", { status: 404 }));
    const linked = parseGitHubFileUrl(`https://github.com/thecrateapp/crate-decks/blob/${oldCommit}/docs/plan.md`)!;
    const { loadGitHubSource } = await import("./github-preview-source");
    await expect(loadGitHubSource(linked)).rejects.toThrow("does not exist at");
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][1]).toEqual(["remote", "get-url", "origin"]);
    expect(requested()).toEqual([rawUrl(oldCommit, "docs/plan.md", "thecrateapp/crate-decks")]);
  });

  it("resolves an abbreviated external commit in its verified checkout without a network request", async () => {
    const decksCommit = "0cc07d0825efdf6a7865bddf4888fc754af0ec8a";
    vi.stubEnv("BLOG_SOURCE_REPOSITORIES", JSON.stringify({ "thecrateapp/crate-decks": "/checkouts/crate-decks" }));
    execute.mockImplementation(async (_file, args: string[]) => ({ stdout:
      args[0] === "remote" ? "https://github.com/thecrateapp/crate-decks.git\n" :
      args[0] === "rev-parse" ? `${decksCommit}\n` :
      args[0] === "show" ? "# Historical plan\n" : args[1] === "-t" ? "blob\n" : "18\n",
    }));
    const linked = parseGitHubFileUrl("https://github.com/thecrateapp/crate-decks/blob/0cc07d08/docs/plan.md")!;
    const { loadGitHubSource } = await import("./github-preview-source");
    expect(await loadGitHubSource(linked)).toMatchObject({
      requestedRef: "0cc07d08", commit: decksCommit, source: "# Historical plan\n",
      githubUrl: `https://github.com/thecrateapp/crate-decks/blob/${decksCommit}/docs/plan.md`,
    });
    expect(execute).toHaveBeenCalledWith("git", ["rev-parse", "--verify", "0cc07d08^{commit}"], expect.objectContaining({ cwd: "/checkouts/crate-decks" }));
    expect(fetch).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });
});
