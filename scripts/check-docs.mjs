import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "docs/manifest.json");
const sections = new Set([
  "start",
  "architecture",
  "developer",
  "operations",
  "federation",
  "reference",
]);
const requiredFrontmatter = [
  "title",
  "summary",
  "section",
  "audience",
  "status",
  "order",
  "verified",
  "sources",
];
const errors = [];

function report(message) {
  errors.push(message);
}

function parseFrontmatter(sourcePath, markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    report(`${sourcePath}: missing YAML frontmatter`);
    return {};
  }

  const fields = {};
  let multilineKey;
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator !== -1 && !line.startsWith(" ")) {
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (value) {
        fields[key] = value;
        multilineKey = undefined;
      } else {
        multilineKey = key;
      }
      continue;
    }
    if (multilineKey && line.trim()) fields[multilineKey] = "[multiline]";
  }
  return fields;
}

function resolveSourcePath(sourcePath, target) {
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(sourcePath), target),
  );
  return resolved.startsWith("../") ? "" : resolved;
}

function internalMarkdownTargets(markdown) {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, "");
  return [...withoutCode.matchAll(/\[[^\]]*]\(([^)\s]+)(?:\s+[^)]*)?\)/g)]
    .map((match) => match[1]?.replace(/^<|>$/g, "") ?? "")
    .filter(
      (href) =>
        href &&
        !href.startsWith("#") &&
        !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href),
    )
    .map((href) => href.split("#", 1)[0] ?? "")
    .filter((href) => href.endsWith(".md"));
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!Array.isArray(manifest) || manifest.length === 0) {
  report("docs/manifest.json must contain a non-empty array");
}

const sourcePaths = new Set();
const routes = new Set();
const canonicalPaths = new Set();
const canonicalMarkdown = new Map();
for (const entry of manifest) {
  if (!entry || typeof entry !== "object") {
    report("docs/manifest.json contains an invalid entry");
    continue;
  }

  const { sourcePath, route, section, title, summary, keywords, order } = entry;
  if (
    typeof sourcePath !== "string" ||
    !sourcePath.startsWith("docs/") ||
    !sourcePath.endsWith(".md")
  ) {
    report(`invalid sourcePath: ${String(sourcePath)}`);
    continue;
  }
  if (sourcePaths.has(sourcePath))
    report(`duplicate sourcePath: ${sourcePath}`);
  sourcePaths.add(sourcePath);
  canonicalPaths.add(sourcePath);

  if (typeof route !== "string" || !/^\/[a-z\d-]+\/[a-z\d-]+$/.test(route)) {
    report(`${sourcePath}: invalid canonical route ${String(route)}`);
  } else if (routes.has(route)) {
    report(`duplicate route: ${route}`);
  } else {
    routes.add(route);
  }

  if (!sections.has(section))
    report(`${sourcePath}: invalid section ${String(section)}`);
  if (typeof title !== "string" || !title)
    report(`${sourcePath}: missing title`);
  if (typeof summary !== "string" || !summary)
    report(`${sourcePath}: missing summary`);
  if (
    !Array.isArray(keywords) ||
    keywords.some((keyword) => typeof keyword !== "string")
  ) {
    report(`${sourcePath}: keywords must be an array of strings`);
  }
  if (!Number.isInteger(order))
    report(`${sourcePath}: order must be an integer`);

  try {
    await access(path.join(root, sourcePath));
  } catch {
    report(`${sourcePath}: file does not exist`);
    continue;
  }

  const markdown = await readFile(path.join(root, sourcePath), "utf8");
  canonicalMarkdown.set(sourcePath, markdown);
  const frontmatter = parseFrontmatter(sourcePath, markdown);
  for (const field of requiredFrontmatter) {
    if (!frontmatter[field])
      report(`${sourcePath}: frontmatter is missing ${field}`);
  }
  if (frontmatter.title !== title)
    report(`${sourcePath}: title differs from manifest`);
  if (frontmatter.summary !== summary)
    report(`${sourcePath}: summary differs from manifest`);
  if (frontmatter.section !== section)
    report(`${sourcePath}: section differs from manifest`);
  if (frontmatter.status !== "canonical")
    report(`${sourcePath}: status must be canonical`);
  if (frontmatter.order !== String(order))
    report(`${sourcePath}: order differs from manifest`);
}

for (const [sourcePath, markdown] of canonicalMarkdown) {
  for (const target of internalMarkdownTargets(markdown)) {
    const targetPath = resolveSourcePath(sourcePath, target);
    if (!canonicalPaths.has(targetPath)) {
      report(`${sourcePath}: internal link is not canonical: ${target}`);
    }
  }
}

const portalSource = await readFile(
  path.join(root, "app/docs/src/content.ts"),
  "utf8",
);
if (!portalSource.includes("docs/manifest.json")) {
  report("app/docs/src/content.ts must import docs/manifest.json");
}
if (portalSource.includes("import.meta.glob")) {
  report("app/docs/src/content.ts must not glob-import documentation");
}
for (const sourcePath of canonicalPaths) {
  if (!portalSource.includes(`\"${sourcePath}\"`)) {
    report(`app/docs/src/content.ts has no lazy loader for ${sourcePath}`);
  }
}

if (errors.length) {
  console.error("Documentation integrity check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `Documentation integrity check passed (${manifest.length} canonical documents).`,
  );
}
