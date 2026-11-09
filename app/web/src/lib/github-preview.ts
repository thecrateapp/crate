/** A GitHub blob link identifies a file, not a repository, diff or directory. */
export interface GitHubFileReference {
  owner: string;
  repo: string;
  ref: string;
  path: string;
  lineStart?: number;
  lineEnd?: number;
  anchor?: string;
  key: string;
}

function referenceKey(value: string): string {
  // Stable across browser and server. The manifest also checks for collisions.
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function parseGitHubFileUrl(href: string): GitHubFileReference | undefined {
  let url: URL;
  try { url = new URL(href); } catch { return undefined; }
  if (url.protocol !== "https:" || !["github.com", "www.github.com"].includes(url.hostname)
    || url.username || url.password || url.port) return undefined;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 5 || parts[2] !== "blob") return undefined;
  let owner: string, repo: string, ref: string, path: string, anchor: string;
  try {
    owner = decodeURIComponent(parts[0]).toLowerCase();
    repo = decodeURIComponent(parts[1]).toLowerCase();
    ref = decodeURIComponent(parts[3]);
    path = parts.slice(4).map(decodeURIComponent).join("/");
    anchor = decodeURIComponent(url.hash.slice(1));
  } catch { return undefined; }
  if (![owner, repo].every((part) => /^[\w.-]+$/.test(part) && ![".", ".."].includes(part))) return undefined;
  if (!ref || ref.startsWith("-") || !/^[\w./-]+$/.test(ref)
    || /[\x00-\x1f\\]/.test(path)
    || path.split("/").some((part) => !part || part === "." || part === "..")) return undefined;
  const lines = /^L(\d+)(?:-L(\d+))?$/.exec(anchor);
  const lineStart = lines ? Number(lines[1]) : undefined;
  const lineEnd = lines ? Number(lines[2] ?? lines[1]) : undefined;
  if (lines && (!Number.isSafeInteger(lineStart) || !Number.isSafeInteger(lineEnd)
    || lineStart! < 1 || lineEnd! < lineStart!)) return undefined;
  return {
    owner, repo, ref, path,
    ...(lineStart === undefined ? {} : { lineStart, lineEnd }),
    ...(anchor ? { anchor } : {}),
    key: referenceKey(`${owner}/${repo}/${ref}/${path}`),
  };
}

export function canonicalGitHubFileUrl(reference: Pick<GitHubFileReference, "owner" | "repo" | "path">, commit: string): string {
  return `https://github.com/${reference.owner}/${reference.repo}/blob/${encodeURIComponent(commit)}/${reference.path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Run letters of the compact highlighting format, indexing a snapshot's `styles`. */
export const TOKEN_STYLE_LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const RUN = /([a-zA-Z])(\d*)/g;
const SAFE_CLASSES = /^[\w -]*$/;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]!);

export interface HighlightedSource {
  path: string;
  source: string;
  styles?: string[];
  runs?: string[];
}

/**
 * Numbered, highlighted markup for the viewer's source mode, rebuilt from the
 * snapshot's text and its compact runs (see `renderPreviewSource`). All text is
 * escaped here; class names outside the expected alphabet are ignored.
 */
export function sourceCodeHtml({ path, source, styles = [], runs = [] }: HighlightedSource): string {
  const classes = styles.map((value) => SAFE_CLASSES.test(value) ? value.trim() : "");
  const lines = source === "" ? [] : source.replace(/\r?\n$/, "").split(/\r?\n/);
  const rows = lines.map((line, index) => {
    let offset = 0;
    let html = "";
    for (const [, letter, length] of (runs[index] ?? "").matchAll(RUN)) {
      const end = length ? Math.min(line.length, offset + Number(length)) : line.length;
      const text = escapeHtml(line.slice(offset, end));
      const name = classes[TOKEN_STYLE_LETTERS.indexOf(letter)];
      html += name && text ? `<span class="${name}">${text}</span>` : text;
      offset = end;
    }
    html += escapeHtml(line.slice(offset));
    const number = index + 1;
    return `<span class="gfp-code-line" data-source-line="${number}"><span class="gfp-line-number" aria-hidden="true">${number}</span><span class="gfp-line-code">${html || " "}</span></span>`;
  }).join("");
  return `<pre class="gfp-code" tabindex="0" aria-label="${escapeHtml(path)} source"><code>${rows}</code></pre>`;
}
