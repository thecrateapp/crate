import { sourceCodeHtml } from "../lib/github-preview";

interface PreviewReference {
  owner: string; repo: string; ref: string; path: string; key: string;
  url: string; href: string;
}
interface PreviewSnapshot {
  owner: string; repo: string; path: string; requestedRef: string; commit?: string;
  githubUrl: string; language?: string; source?: string; styles?: string[]; runs?: string[];
  markdownHtml?: string; error?: string; sameAs?: string;
}
interface Selection { start?: number; end?: number; heading?: string; hash: string }

function selectionFor(url: URL): Selection {
  const range = /^#L(\d+)(?:-L(\d+))?$/.exec(url.hash);
  if (range) {
    const start = Number(range[1]); const end = Number(range[2] ?? start);
    if (start > 0 && end >= start) return { start, end, hash: url.hash };
  }
  let heading = "";
  try { heading = decodeURIComponent(url.hash.slice(1)); } catch { /* malformed anchor stays unselected */ }
  return { heading, hash: url.hash };
}
const fileKey = (url: URL) => `${url.origin}${url.pathname}`;

export function mountGitHubPreview(root: HTMLElement): () => void {
  const dialog = root.querySelector<HTMLDialogElement>("[data-github-preview-dialog]")!;
  if (!dialog.showModal) return () => {};
  const manifest = JSON.parse(root.querySelector("[data-github-preview-manifest]")!.textContent ?? "[]") as PreviewReference[];
  const files = new Map(manifest.map((item) => [fileKey(new URL(item.url)), item]));
  const query = <T extends Element = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const content = query<HTMLElement>("[data-github-preview-content]");
  const body = query<HTMLElement>("[data-github-preview-body]");
  const status = query<HTMLElement>("[data-github-preview-status]");
  const closeButton = query<HTMLButtonElement>("[data-github-preview-close]");
  const openLink = query<HTMLAnchorElement>("[data-github-preview-open]");
  const copyButton = query<HTMLButtonElement>("[data-github-preview-copy]");
  const selectionButton = query<HTMLButtonElement>("[data-github-preview-selection]");
  const abort = new AbortController();
  const options = { signal: abort.signal };
  const cache = new Map<string, PreviewSnapshot>();
  // Source markup is rebuilt from the compact snapshot once per opened file.
  const sourceHtml = new WeakMap<PreviewSnapshot, string>();
  const codeHtml = (value: PreviewSnapshot & { source: string }) => {
    let html = sourceHtml.get(value);
    if (html === undefined) { html = sourceCodeHtml(value); sourceHtml.set(value, html); }
    return html;
  };
  let pending: AbortController | undefined;
  let opener: HTMLElement | undefined;
  let snapshot: PreviewSnapshot | undefined;
  let selection: Selection = { hash: "" };
  let mode: "rendered" | "source" = "source";
  let disposed = false;
  let generation = 0;
  let resolved = false;
  let oldOverflow: string | undefined;
  let scrollFrame: number | undefined;

  const unlock = () => {
    if (oldOverflow !== undefined) document.documentElement.style.overflow = oldOverflow;
    oldOverflow = undefined;
  };
  const close = (restore = true) => {
    generation++; pending?.abort(); pending = undefined;
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    if (dialog.open) dialog.close();
    unlock();
    if (restore && opener?.isConnected) opener.focus({ preventScroll: true });
    opener = undefined;
  };
  const scrollToSelection = () => {
    if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      if (!dialog.open || disposed) return;
      const target = content.querySelector<HTMLElement>('[data-highlighted="true"]');
      if (target) body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top - 56;
      else body.scrollTop = 0;
      body.scrollLeft = 0;
    });
  };
  const render = () => {
    if (typeof snapshot?.source !== "string") return;
    dialog.dataset.mode = mode;
    // Source markup escapes every character of the text; Markdown HTML comes from
    // an AST with raw HTML disabled. Only same-origin, manifest-selected snapshots are read.
    content.innerHTML = mode === "rendered" ? `<div class="gfp-markdown">${snapshot.markdownHtml ?? ""}</div>` : codeHtml(snapshot as PreviewSnapshot & { source: string });
    root.querySelectorAll<HTMLButtonElement>("[data-github-preview-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.githubPreviewMode === mode)));
    query<HTMLElement>("[data-github-preview-views]").hidden = !snapshot.markdownHtml;
    if (selection.start) {
      if (mode === "source") {
        content.querySelectorAll<HTMLElement>("[data-source-line]").forEach((row) => {
          const line = Number(row.dataset.sourceLine);
          if (line >= selection.start! && line <= selection.end!) row.dataset.highlighted = "true";
        });
      } else {
        // Highlight the smallest rendered blocks overlapping the source range.
        const matches = [...content.querySelectorAll<HTMLElement>("[data-source-start]")].filter((element) => Number(element.dataset.sourceStart) <= selection.end! && Number(element.dataset.sourceEnd) >= selection.start!);
        matches.filter((element) => !matches.some((other) => other !== element && element.contains(other))).forEach((element) => element.dataset.highlighted = "true");
      }
    } else if (selection.heading && mode === "rendered") {
      const heading = [...content.querySelectorAll<HTMLElement>("[data-source-heading]")].find((element) => element.dataset.sourceHeading === selection.heading?.replace(/^user-content-/, ""));
      if (heading) heading.dataset.highlighted = "true";
    }
    const count = snapshot.source ? snapshot.source.replace(/\r?\n$/, "").split(/\r?\n/).length : 0;
    const hasRange = Boolean(selection.start && content.querySelector('[data-highlighted="true"]'));
    selectionButton.hidden = !hasRange && !(selection.heading && mode === "rendered");
    selectionButton.textContent = selection.start ? `Lines ${selection.start}${selection.end !== selection.start ? `–${selection.end}` : ""}` : "Referenced section";
    copyButton.textContent = selection.start ? "Copy lines" : "Copy source";
    copyButton.disabled = false;
    query("[data-github-preview-meta]").textContent = `${snapshot.language ?? "text"} · ${count.toLocaleString("en-US")} lines`;
    status.textContent = selection.start
      ? hasRange ? `Lines ${selection.start}${selection.end !== selection.start ? `–${selection.end}` : ""} highlighted · complete file` : "The referenced lines are outside this file."
      : selection.heading ? "Referenced section · complete document" : "Complete file at the displayed commit";
    scrollToSelection();
  };
  const showError = (message: string) => {
    dialog.dataset.state = "error";
    if (!resolved) query("[data-github-preview-revision]").textContent = "Original GitHub reference · preview unavailable";
    content.replaceChildren();
    const paragraph = document.createElement("p"); paragraph.className = "gfp-error";
    const title = document.createElement("strong"); title.textContent = "This file preview is unavailable.";
    paragraph.append(title, document.createTextNode(message)); content.append(paragraph);
    status.textContent = "You can still open the original reference on GitHub.";
  };
  const open = async (reference: PreviewReference, anchor: HTMLAnchorElement) => {
    pending?.abort(); pending = new AbortController();
    const request = pending;
    const currentGeneration = ++generation;
    opener ??= anchor;
    snapshot = undefined; resolved = false; selection = selectionFor(new URL(anchor.href));
    query("[data-github-preview-title]").textContent = reference.path;
    query("[data-github-preview-revision]").textContent = `${reference.owner}/${reference.repo} · resolving revision`;
    query("[data-github-preview-commit]").textContent = reference.ref;
    query("[data-github-preview-commit]").removeAttribute("title");
    openLink.href = anchor.href;
    copyButton.disabled = true; selectionButton.hidden = true;
    query<HTMLElement>("[data-github-preview-views]").hidden = true;
    query("[data-github-preview-meta]").textContent = "";
    content.innerHTML = '<p class="gfp-loading">Loading the file at the referenced commit…</p>';
    status.textContent = "Loading source"; dialog.dataset.state = "loading";
    if (!dialog.open) {
      oldOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";
      dialog.showModal(); closeButton.focus({ preventScroll: true });
    }
    body.scrollTop = 0;
    try {
      let result = cache.get(reference.href);
      if (!result) {
        const load = async (href: string) => {
          const response = await fetch(href, { signal: request.signal, credentials: "same-origin" });
          if (!response.ok) throw new Error("The saved source could not be loaded. Please try again or open it on GitHub.");
          return await response.json() as PreviewSnapshot;
        };
        result = await load(reference.href);
        // Identical files share one body; this snapshot keeps its own revision.
        if (result.sameAs && /^\/blog\/source\/[\da-f]{16}\.json$/.test(result.sameAs)) {
          const { source, language, styles, runs, markdownHtml } = await load(result.sameAs);
          result = { ...result, source, language, styles, runs, markdownHtml, sameAs: undefined };
        }
        if (!result.error) {
          if (cache.size >= 6) cache.delete(cache.keys().next().value!);
          cache.set(reference.href, result);
        }
      }
      if (disposed || currentGeneration !== generation || !dialog.open) return;
      if (result.commit && /^[a-f\d]{40}$/i.test(result.commit)) {
        resolved = true;
        query("[data-github-preview-commit]").textContent = result.commit.slice(0, 12);
        query("[data-github-preview-commit]").setAttribute("title", result.commit);
        query("[data-github-preview-revision]").textContent = `${result.owner}/${result.repo} · ${result.requestedRef === result.commit ? "commit" : `${result.requestedRef} resolved to`}`;
        openLink.href = result.githubUrl + selection.hash;
      }
      if (result.error) { showError(result.error); return; }
      if (!resolved || typeof result.source !== "string" || !Array.isArray(result.runs)) throw new Error("This snapshot does not identify an exact commit. Open the original reference on GitHub.");
      snapshot = result;
      mode = result.markdownHtml && !selection.start ? "rendered" : "source";
      dialog.dataset.state = "ready"; render();
    } catch (error) {
      if (disposed || currentGeneration !== generation || request.signal.aborted) return;
      showError(error instanceof Error ? error.message : "The saved source could not be loaded.");
    }
  };

  // Preserve link semantics: only unmodified primary clicks on file references
  // known to this article open the preview. New tabs and no-JS keep GitHub links.
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor === openLink || anchor.hasAttribute("download")) return;
    const reference = files.get(fileKey(new URL(anchor.href)));
    if (!reference) return;
    event.preventDefault(); void open(reference, anchor);
  }, { ...options, capture: true });
  const decorated = [...document.querySelectorAll<HTMLAnchorElement>("article a[href]")].filter((anchor) => files.has(fileKey(new URL(anchor.href))));
  decorated.forEach((anchor) => { anchor.setAttribute("aria-haspopup", "dialog"); anchor.dataset.githubFilePreview = "true"; });
  closeButton.addEventListener("click", () => close(), options);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); }, options);
  dialog.addEventListener("close", () => { unlock(); }, options);
  let backdropDown = false;
  dialog.addEventListener("pointerdown", (event) => { backdropDown = event.target === dialog; }, options);
  dialog.addEventListener("click", (event) => { if (backdropDown && event.target === dialog) close(); backdropDown = false; }, options);
  selectionButton.addEventListener("click", scrollToSelection, options);
  root.querySelectorAll<HTMLButtonElement>("[data-github-preview-mode]").forEach((button) => button.addEventListener("click", () => { mode = button.dataset.githubPreviewMode as "source" | "rendered"; render(); }, options));
  copyButton.addEventListener("click", async () => {
    if (snapshot?.source === undefined) return;
    const source = selection.start ? snapshot.source.split("\n").slice(selection.start - 1, selection.end).join("\n") : snapshot.source;
    try { await navigator.clipboard.writeText(source); status.textContent = selection.start ? "Referenced lines copied" : "Source copied"; }
    catch { status.textContent = "Copy is unavailable here. Select the source text to copy it."; }
  }, options);
  return () => {
    disposed = true; close(false); abort.abort(); cache.clear();
    decorated.forEach((anchor) => { anchor.removeAttribute("aria-haspopup"); delete anchor.dataset.githubFilePreview; });
  };
}
