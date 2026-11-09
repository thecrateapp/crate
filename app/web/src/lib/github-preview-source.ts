import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import type { BlogEntry } from "./blog";
import { publishedPosts, sourceUrl } from "./blog";
import { canonicalGitHubFileUrl, parseGitHubFileUrl, type GitHubFileReference } from "./github-preview";
import { createLimiter, RemoteRequestError, requestWithRetry } from "./github-preview-fetch";
import { renderPreviewSource } from "./github-preview-render";

const exec = promisify(execFile);
// Git discovers the worktree from Astro's working directory, including bundled builds.
const repositoryRoot = process.cwd();
const FULL_COMMIT = /^[0-9a-f]{40}$/i;
const ABBREVIATED_COMMIT = /^[0-9a-f]{7,39}$/i;
const MAX_SOURCE_BYTES = 1_000_000;
const TOO_LARGE = "This file is too large for the preview.";
const BINARY = "Binary files cannot be displayed as source code.";
// A build reads hundreds of files: a few at a time from GitHub, more from local Git.
const remote = createLimiter(6);
const local = createLimiter(12);
const files = new Map<string, Promise<SourceFile>>();
const snapshots = new Map<string, Promise<GitHubSourceSnapshot>>();
const commits = new Map<string, Promise<string>>();
const repositories = new Map<string, Promise<string | undefined>>();
// Rendered body digest -> key of the snapshot that carries it.
const bodies = new Map<string, string>();

export interface GitHubPreviewLink extends GitHubFileReference {
  url: string;
  href: string;
}

/** The JSON served at `/blog/source/<key>.json`; highlighting is decoded by `sourceCodeHtml`. */
export interface GitHubSourceSnapshot {
  owner: string;
  repo: string;
  path: string;
  requestedRef: string;
  commit: string;
  githubUrl: string;
  source: string;
  language?: string;
  styles?: string[];
  runs?: string[];
  markdownHtml?: string;
  /** Only for the explicit GitHub-only fallbacks: binary files and files over 1 MB. */
  error?: string;
  /**
   * Another snapshot with an identical rendered body (typically a footer's
   * `main` link to a file unchanged since a pinned link). This one keeps its own
   * commit and URL; the viewer reads the text and highlighting from there.
   */
  sameAs?: string;
}

export const snapshotHref = (key: string) => `/blog/source/${key}.json`;

type SourceFile = { commit: string } & ({ source: string } | { fallback: string });

/** Gather exactly the references the article renderer can expose. */
export function manifestForPost(post: Pick<BlogEntry, "body" | "data">): GitHubPreviewLink[] {
  const urls = new Set<string>();
  const body = post.body ?? "";
  for (const match of body.matchAll(/https:\/\/(?:www\.)?github\.com\/[^\s)<>\]"']+/g)) urls.add(match[0]);
  for (const match of body.matchAll(/^```[^\n]+/gm)) {
    const source = /\bsource="([^"]+)"/.exec(match[0])?.[1];
    const commit = /\bcommit="([^"]+)"/.exec(match[0])?.[1];
    if (source && commit) urls.add(`https://github.com/thecrateapp/crate/blob/${commit}/${source}`);
  }
  for (const path of post.data.sources) urls.add(sourceUrl(path));
  return [...urls].flatMap((url) => {
    const reference = parseGitHubFileUrl(url);
    return reference ? [{ ...reference, url, href: snapshotHref(reference.key) }] : [];
  });
}

export function previewSourcesForPosts(posts: BlogEntry[], includeDrafts = false): GitHubPreviewLink[] {
  const sources = new Map<string, GitHubPreviewLink>();
  for (const post of publishedPosts(posts, { includeDrafts })) {
    for (const link of manifestForPost(post)) {
      const existing = sources.get(link.key);
      if (existing && canonicalGitHubFileUrl(existing, existing.ref) !== canonicalGitHubFileUrl(link, link.ref)) {
        throw new Error("GitHub preview reference key collision");
      }
      sources.set(link.key, link);
    }
  }
  return [...sources.values()];
}

/** A dev server keeps successes but must be able to retry after a failure. */
function remember<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let promise = cache.get(key);
  if (!promise) {
    const loading = load();
    cache.set(key, loading);
    loading.catch(() => { if (cache.get(key) === loading) cache.delete(key); });
    promise = loading;
  }
  return promise;
}

/** `BLOG_SOURCE_NO_GIT=1` reproduces the Docker build, which has neither Git nor history. */
const gitEnabled = () => !/^(1|true|yes)$/i.test(process.env.BLOG_SOURCE_NO_GIT?.trim() ?? "");
const githubToken = () => process.env.BLOG_SOURCE_GITHUB_TOKEN?.trim() || undefined;

function git(args: string[], cwd = repositoryRoot): Promise<string> {
  return local(async () => (await exec("git", args, { cwd, maxBuffer: MAX_SOURCE_BYTES + 1024, timeout: 8_000 })).stdout);
}

async function localRepository(reference: GitHubFileReference): Promise<string | undefined> {
  if (!gitEnabled()) return undefined;
  const name = `${reference.owner}/${reference.repo}`;
  if (name === "thecrateapp/crate") return repositoryRoot;
  return remember(repositories, name, async () => {
    try {
      // Optional development/build map. Never search unrelated local checkouts.
      const configured = JSON.parse(process.env.BLOG_SOURCE_REPOSITORIES || "{}") as Record<string, unknown>;
      const directory = configured[name];
      if (typeof directory !== "string" || !isAbsolute(directory)) return undefined;
      const origin = (await git(["remote", "get-url", "origin"], directory)).trim();
      const ssh = /^git@github\.com:([^\s]+)$/.exec(origin);
      const url = ssh ? undefined : new URL(origin);
      const remote = ssh?.[1] ?? (url?.hostname === "github.com" ? url.pathname.slice(1) : "");
      if (remote.replace(/\.git$/, "").replace(/\/$/, "").toLowerCase() !== name) return undefined;
      return directory;
    } catch { return undefined; }
  });
}

const pktLine = (line: string) => `${(Buffer.byteLength(line) + 4).toString(16).padStart(4, "0")}${line}`;

function pktLines(buffer: Buffer): string[] {
  const lines: string[] = [];
  for (let offset = 0; offset + 4 <= buffer.length;) {
    const length = Number.parseInt(buffer.toString("latin1", offset, offset + 4), 16);
    if (Number.isNaN(length)) throw new Error("GitHub returned an unreadable reference list.");
    if (length < 4) { offset += 4; continue; } // flush, delimiter or response end
    lines.push(buffer.toString("utf8", offset + 4, offset + length).replace(/\n$/, ""));
    offset += length;
  }
  return lines;
}

/**
 * Resolves a branch or tag with Git's own HTTP protocol (v2 `ls-refs`), the
 * request `git ls-remote` makes. Unlike the REST API it is not limited to 60
 * unauthenticated requests an hour, and it only returns the requested names.
 */
async function remoteNamedRef(reference: GitHubFileReference): Promise<string | undefined> {
  const wanted = [`refs/heads/${reference.ref}`, `refs/tags/${reference.ref}`];
  const body = pktLine("command=ls-refs\n") + "0001" + pktLine("peel\n")
    + wanted.map((name) => pktLine(`ref-prefix ${name}\n`)).join("") + "0000";
  const token = githubToken();
  const lines = await remote(() => requestWithRetry(`https://github.com/${reference.owner}/${reference.repo}.git/git-upload-pack`, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/x-git-upload-pack-request",
      Accept: "application/x-git-upload-pack-result",
      "Git-Protocol": "version=2",
      ...(token ? { Authorization: `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}` } : {}),
    },
  }, async (response) => pktLines(Buffer.from(await response.arrayBuffer()))));
  const found = new Map<string, string>();
  for (const line of lines) {
    const [oid, name, ...attributes] = line.split(" ");
    const commit = attributes.find((attribute) => attribute.startsWith("peeled:"))?.slice(7) ?? oid;
    if (wanted.includes(name) && FULL_COMMIT.test(commit)) found.set(name, commit.toLowerCase());
  }
  const [branch, tag] = wanted.map((name) => found.get(name));
  if (branch && tag && branch !== tag) throw new Error(`"${reference.ref}" is both a branch and a tag; link a commit instead.`);
  return branch ?? tag;
}

async function remoteAbbreviatedCommit(reference: GitHubFileReference): Promise<string> {
  const token = githubToken();
  // The anonymous REST API allows 60 requests an hour, shared by every job on a
  // CI runner's address. A release build must not depend on it.
  if (!token) {
    throw new Error(`The abbreviated commit "${reference.ref}" needs Git to resolve. Link the full 40-character SHA,`
      + " map a local checkout with BLOG_SOURCE_REPOSITORIES, or provide BLOG_SOURCE_GITHUB_TOKEN.");
  }
  const sha = await remote(() => requestWithRetry(
    `https://api.github.com/repos/${reference.owner}/${reference.repo}/commits/${encodeURIComponent(reference.ref)}`,
    { headers: { Accept: "application/vnd.github+json", Authorization: `token ${token}` } },
    async (response) => ((await response.json()) as { sha?: string }).sha,
  ));
  if (!sha || !FULL_COMMIT.test(sha)) throw new Error("GitHub did not return an immutable commit.");
  return sha.toLowerCase();
}

function warnMovingRef(reference: GitHubFileReference, commit: string) {
  if (ABBREVIATED_COMMIT.test(reference.ref)) return;
  const buildSource = reference.owner === "thecrateapp" && reference.repo === "crate" && reference.ref === "main";
  console.warn(`[blog source preview] ${reference.owner}/${reference.repo}@${reference.ref} is a moving reference; this build shows ${commit}. `
    + (buildSource ? "Set BLOG_SOURCE_COMMIT to the commit being built." : "Pin the link to a commit."));
}

function resolveCommit(reference: GitHubFileReference): Promise<string> {
  if (FULL_COMMIT.test(reference.ref)) return Promise.resolve(reference.ref.toLowerCase());
  return remember(commits, `${reference.owner}/${reference.repo}/${reference.ref}`, async () => {
    if (reference.owner === "thecrateapp" && reference.repo === "crate" && reference.ref === "main") {
      const buildCommit = process.env.BLOG_SOURCE_COMMIT?.trim();
      if (buildCommit) {
        if (!FULL_COMMIT.test(buildCommit)) throw new Error("BLOG_SOURCE_COMMIT is not a full commit SHA.");
        return buildCommit.toLowerCase();
      }
      // Footer links describe this build's source tree, not a stale local main branch.
      if (gitEnabled()) {
        try { return (await git(["rev-parse", "--verify", "HEAD^{commit}"])).trim().toLowerCase(); } catch { /* exported source tree */ }
      }
    }
    const directory = await localRepository(reference);
    if (directory) {
      try {
        const commit = (await git(["rev-parse", "--verify", `${reference.ref}^{commit}`], directory)).trim();
        if (FULL_COMMIT.test(commit)) { warnMovingRef(reference, commit.toLowerCase()); return commit.toLowerCase(); }
      } catch { /* Ref absent or ambiguous in a verified local checkout. */ }
    }
    const named = await remoteNamedRef(reference);
    if (named) { warnMovingRef(reference, named); return named; }
    if (ABBREVIATED_COMMIT.test(reference.ref)) return remoteAbbreviatedCommit(reference);
    throw new Error(`"${reference.ref}" is not a branch or tag of ${reference.owner}/${reference.repo}.`);
  });
}

const checked = (commit: string, source: string): SourceFile =>
  source.includes("\0") ? { commit, fallback: BINARY } : { commit, source };

async function remoteSource(reference: GitHubFileReference, commit: string): Promise<SourceFile> {
  const path = reference.path.split("/").map(encodeURIComponent).join("/");
  const token = githubToken();
  try {
    return await remote(() => requestWithRetry(`https://raw.githubusercontent.com/${reference.owner}/${reference.repo}/${commit}/${path}`, {
      headers: token ? { Authorization: `token ${token}` } : {},
    }, async (response): Promise<SourceFile> => {
      if (Number(response.headers.get("content-length") ?? 0) > MAX_SOURCE_BYTES) {
        await response.body?.cancel().catch(() => {});
        return { commit, fallback: TOO_LARGE };
      }
      const source = await response.text();
      return Buffer.byteLength(source) > MAX_SOURCE_BYTES ? { commit, fallback: TOO_LARGE } : checked(commit, source);
    }));
  } catch (error) {
    if (error instanceof RemoteRequestError && error.status === 404) {
      throw new Error(`The file does not exist at ${commit} on GitHub (${error.message}).`);
    }
    throw error;
  }
}

/** Never substitute a current file when an immutable historical reference fails. */
function loadSourceFile(reference: GitHubFileReference): Promise<SourceFile> {
  return remember(files, reference.key, async () => {
    try {
      const commit = await resolveCommit(reference);
      const directory = await localRepository(reference);
      if (directory) {
        const object = `${commit}:${reference.path}`;
        let type: string | undefined;
        try { type = (await git(["cat-file", "-t", object], directory)).trim(); } catch { /* Not in this (shallow or exported) checkout. */ }
        if (type) {
          if (type !== "blob") throw new Error(`The linked path is a ${type}, not a file, at ${commit}.`);
          if (Number(await git(["cat-file", "-s", object], directory)) > MAX_SOURCE_BYTES) return { commit, fallback: TOO_LARGE };
          return checked(commit, await git(["show", object], directory));
        }
      }
      return await remoteSource(reference, commit);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Source preview for ${reference.owner}/${reference.repo}@${reference.ref}:${reference.path} failed: ${reason}`, { cause: error });
    }
  });
}

/**
 * Load every referenced file before any snapshot is written, a few remote reads
 * at a time, and fail with the complete list of broken references. A release
 * must never bake "preview unavailable" into the image while the build passes.
 */
export async function preloadGitHubSources(references: GitHubPreviewLink[]): Promise<void> {
  const results = await Promise.allSettled(references.map(loadSourceFile));
  const failures = results.flatMap((result, index) => result.status === "rejected"
    ? [`  - ${references[index].url}\n    ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`] : []);
  if (failures.length) {
    throw new Error(`${failures.length} of ${references.length} GitHub source previews could not be loaded:\n${failures.join("\n")}`);
  }
}

/** Rejects when the file cannot be loaded; binary and oversized files keep an explicit fallback. */
export function loadGitHubSource(reference: GitHubFileReference): Promise<GitHubSourceSnapshot> {
  return remember(snapshots, reference.key, async () => {
    const file = await loadSourceFile(reference);
    const githubUrl = canonicalGitHubFileUrl(reference, file.commit);
    const base: GitHubSourceSnapshot = {
      owner: reference.owner, repo: reference.repo, path: reference.path,
      requestedRef: reference.ref, commit: file.commit, githubUrl, source: "",
    };
    if ("fallback" in file) return { ...base, error: file.fallback };
    const body = { source: file.source, ...await renderPreviewSource(file.source, reference.path, githubUrl) };
    // Markdown links resolve against the commit, so only truly identical output is shared.
    const digest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const owner = bodies.get(digest) ?? reference.key;
    bodies.set(digest, owner);
    return owner === reference.key ? { ...base, ...body } : { ...base, sameAs: snapshotHref(owner) };
  });
}
