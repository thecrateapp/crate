// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountGitHubPreview } from "./github-preview";
const sha = "0123456789abcdef0123456789abcdef01234567";
const href = `https://github.com/thecrateapp/crate/blob/${sha}/docs/guide.md`;
const result = {
  owner: "thecrateapp", repo: "crate", path: "docs/guide.md", requestedRef: sha, commit: sha,
  githubUrl: href, source: "# Heading\nparagraph\nlast line", language: "markdown",
  styles: ["", "gfp-c-67e8f9 gfp-b"], runs: ["b", "", ""],
  markdownHtml: '<h1 data-source-heading="heading" data-source-start="1" data-source-end="1">Heading</h1><p data-source-start="2" data-source-end="3">paragraph last line</p>',
};
let cleanup: (() => void) | undefined;
let fetchMock: ReturnType<typeof vi.fn>;
function fixture() {
  document.body.innerHTML = `<article><a id="trigger" href="${href}#L2-L3">Code reference</a><a id="doc" href="${href}#heading">Document</a><a id="commit" href="https://github.com/thecrateapp/crate/commit/${sha}">Commit</a></article>
    <div data-github-preview><script type="application/json" data-github-preview-manifest>${JSON.stringify([{ owner: "thecrateapp", repo: "crate", ref: sha, path: "docs/guide.md", key: "test", url: href, href: "/blog/source/test.json" }])}</script>
    <dialog data-github-preview-dialog><button data-github-preview-close>Close</button><h2 data-github-preview-title></h2><span data-github-preview-revision></span><span data-github-preview-commit></span><a data-github-preview-open>GitHub</a><div data-github-preview-views><button data-github-preview-mode="rendered">Document</button><button data-github-preview-mode="source">Source</button></div><button data-github-preview-selection></button><span data-github-preview-meta></span><div data-github-preview-body><div data-github-preview-content></div></div><p data-github-preview-status></p><button data-github-preview-copy>Copy</button></dialog></div>`;
  const root = document.querySelector<HTMLElement>("[data-github-preview]")!;
  const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new Event("close")); };
  return { root, dialog, trigger: document.getElementById("trigger")! };
}
const click = (selector: string) => document.querySelector<HTMLElement>(selector)!.click();
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => result });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  document.documentElement.style.overflow = "";
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.unstubAllGlobals(); });

describe("source preview controls", () => {
  it("lazily opens the immutable file, highlights referenced lines and restores focus on Escape", async () => {
    const { root, dialog, trigger } = fixture(); cleanup = mountGitHubPreview(root);
    expect(fetchMock).not.toHaveBeenCalled();
    trigger.click(); await settle();
    expect(dialog.open).toBe(true);
    expect(dialog.dataset.state).toBe("ready");
    expect(dialog.dataset.mode).toBe("source");
    expect(root.querySelectorAll('[data-highlighted="true"]')).toHaveLength(2);
    expect(root.querySelector("[data-github-preview-commit]")!.textContent).toBe(sha.slice(0, 12));
    expect(document.documentElement.style.overflow).toBe("hidden");
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("opens a Markdown section as a document and keeps the exact source available", async () => {
    const { root, dialog } = fixture(); cleanup = mountGitHubPreview(root);
    click("#doc"); await settle();
    expect(dialog.dataset.mode).toBe("rendered");
    expect(root.querySelector('h1[data-highlighted="true"]')!.textContent).toBe("Heading");
    click('[data-github-preview-mode="source"]');
    expect(dialog.dataset.mode).toBe("source");
    expect(root.querySelectorAll("[data-source-line]")).toHaveLength(3);
    click("[data-github-preview-close]"); click("#trigger"); await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rebuilds numbered, highlighted source from the compact snapshot", async () => {
    const { root, dialog, trigger } = fixture(); cleanup = mountGitHubPreview(root);
    trigger.click(); await settle();
    expect(dialog.dataset.state).toBe("ready");
    const lines = [...root.querySelectorAll<HTMLElement>(".gfp-code [data-source-line]")];
    expect(lines.map((line) => line.querySelector(".gfp-line-code")!.textContent)).toEqual(["# Heading", "paragraph", "last line"]);
    expect(lines.map((line) => line.querySelector(".gfp-line-number")!.textContent)).toEqual(["1", "2", "3"]);
    expect(lines[0].querySelector(".gfp-line-code > span")!.className).toBe("gfp-c-67e8f9 gfp-b");
    expect(root.querySelector(".gfp-code")!.getAttribute("aria-label")).toBe("docs/guide.md source");
    expect(root.querySelector("[style]")).toBeNull();
    expect(root.querySelector("[data-github-preview-meta]")!.textContent).toBe("markdown · 3 lines");
  });

  it("reads a shared body for an identical file but shows the link's own revision", async () => {
    const pinned = "fedcba9876543210fedcba9876543210fedcba98";
    fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () => url === "/blog/source/test.json"
      ? { owner: "thecrateapp", repo: "crate", path: "docs/guide.md", requestedRef: sha, commit: sha, githubUrl: href, source: "", sameAs: "/blog/source/0123456789abcdef.json" }
      : { ...result, commit: pinned, requestedRef: pinned, githubUrl: href.replace(sha, pinned) } }));
    const { root, dialog, trigger } = fixture(); cleanup = mountGitHubPreview(root);
    trigger.click(); await settle(); await settle();
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/blog/source/test.json", "/blog/source/0123456789abcdef.json"]);
    expect(dialog.dataset.state).toBe("ready");
    expect(root.querySelector("[data-github-preview-commit]")!.textContent).toBe(sha.slice(0, 12));
    expect(root.querySelector<HTMLAnchorElement>("[data-github-preview-open]")!.href).toBe(`${href}#L2-L3`);
    expect(root.querySelectorAll(".gfp-code [data-source-line]")).toHaveLength(3);
  });

  it("rejects a snapshot without highlighting runs instead of rendering a blank file", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...result, runs: undefined }) });
    const { root, dialog, trigger } = fixture(); cleanup = mountGitHubPreview(root);
    trigger.click(); await settle();
    expect(dialog.dataset.state).toBe("error");
    expect(root.querySelector("[data-github-preview-open]")!.getAttribute("href")).toBe(`${href}#L2-L3`);
  });

  it("leaves modifier-clicks and non-file references to the browser", () => {
    const { root, dialog, trigger } = fixture(); cleanup = mountGitHubPreview(root);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    let modifiedWasPrevented = true;
    trigger.addEventListener("click", (click) => { modifiedWasPrevented = click.defaultPrevented; click.preventDefault(); }, { once: true });
    trigger.dispatchEvent(event);
    expect(modifiedWasPrevented).toBe(false);
    const commitEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    let commitWasPrevented = true;
    const commit = document.getElementById("commit")!;
    commit.addEventListener("click", (click) => { commitWasPrevented = click.defaultPrevented; click.preventDefault(); }, { once: true });
    commit.dispatchEvent(commitEvent);
    expect(commitWasPrevented).toBe(false);
    expect(dialog.open).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the original GitHub reference available if loading fails", async () => {
    fetchMock.mockResolvedValue({ ok: false });
    const { root, dialog, trigger } = fixture(); cleanup = mountGitHubPreview(root);
    trigger.click(); await settle();
    expect(dialog.dataset.state).toBe("error");
    expect(root.querySelector<HTMLAnchorElement>("[data-github-preview-open]")!.href).toBe(`${href}#L2-L3`);
    expect(root.querySelector("[data-github-preview-content]")!.textContent).toContain("unavailable");
    expect(root.querySelector("[data-github-preview-revision]")!.textContent).not.toContain("resolving");
  });

  it("ignores a late response after teardown and restores the previous scroll lock", async () => {
    let resolve!: (value: unknown) => void;
    fetchMock.mockReturnValue(new Promise((done) => { resolve = done; }));
    document.documentElement.style.overflow = "clip";
    const { root, dialog, trigger } = fixture(); cleanup = mountGitHubPreview(root);
    trigger.click();
    cleanup(); cleanup = undefined;
    resolve({ ok: true, json: async () => result }); await settle();
    expect(dialog.open).toBe(false);
    expect(document.documentElement.style.overflow).toBe("clip");
    expect(root.querySelectorAll("[data-source-line]")).toHaveLength(0);
    expect(trigger.hasAttribute("aria-haspopup")).toBe(false);
  });
});
