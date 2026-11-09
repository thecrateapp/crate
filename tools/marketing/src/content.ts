import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export const CONTENT_ROOT = fileURLToPath(
  new URL("../../../content/", import.meta.url),
);

const STATUSES = ["pending_review", "reviewed"] as const;
const PROMOTION = ["yes", "no", "conditional", "unknown"] as const;
const PIRACY = ["allowed", "forbidden", "unknown"] as const;
const LINKS = ["yes", "no", "conditional", "unknown"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TAG = /^[a-z0-9]+$/;

type Doc = Record<string, unknown>;

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function oneOf(
  errors: string[],
  where: string,
  field: string,
  value: unknown,
  allowed: readonly string[],
) {
  if (!allowed.includes(value as string)) {
    errors.push(`${where}: ${field} must be one of ${allowed.join(", ")}`);
  }
}

export function validateSubreddits(doc: Doc): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const raw of list(doc.subreddits)) {
    const entry = raw as Doc;
    const name = String(entry.name ?? "");
    if (!name.startsWith("r/"))
      errors.push(`${name || "(unnamed)"}: name must start with r/`);
    if (seen.has(name)) errors.push(`${name}: duplicate subreddit`);
    seen.add(name);
    oneOf(errors, name, "status", entry.status, STATUSES);
    oneOf(
      errors,
      name,
      "self_promotion.allowed",
      (entry.self_promotion as Doc | undefined)?.allowed,
      PROMOTION,
    );
    oneOf(errors, name, "piracy_discussion", entry.piracy_discussion, PIRACY);
    oneOf(errors, name, "links_to_blog", entry.links_to_blog, LINKS);
    const rules = list(entry.rules);
    if (entry.status === "reviewed") {
      if (rules.length === 0)
        errors.push(`${name}: reviewed entries need at least one rule`);
      if (
        typeof entry.reviewed_on !== "string" ||
        !ISO_DATE.test(entry.reviewed_on)
      ) {
        errors.push(`${name}: reviewed_on must be a YYYY-MM-DD date`);
      }
    }
    if (entry.status === "pending_review" && rules.length > 0) {
      errors.push(`${name}: pending_review entries must not record rules`);
    }
  }
  return errors;
}

export function validateGlossary(doc: Doc): string[] {
  const errors: string[] = [];
  const terms = list(doc.terms) as Doc[];
  const canonical = new Map(
    terms.map((term) => [
      String(term.canonical).toLowerCase(),
      String(term.canonical),
    ]),
  );
  for (const banned of list(doc.banned) as Doc[]) {
    const name = canonical.get(String(banned.term).toLowerCase());
    if (name) errors.push(`"${name}" is both canonical and banned`);
  }
  for (const term of terms) {
    for (const avoided of list(term.avoid)) {
      const name = canonical.get(String(avoided).toLowerCase());
      if (name && name !== term.canonical) {
        errors.push(
          `"${avoided}" is avoided by "${term.canonical}" but is the canonical name "${name}"`,
        );
      }
    }
  }
  return errors;
}

export function validateHashtags(doc: Doc): string[] {
  const errors: string[] = [];
  const approved = list(doc.approved).map(String);
  const proposed = (list(doc.proposed) as Doc[]).map((entry) =>
    String(entry.tag),
  );
  for (const tag of [...approved, ...proposed]) {
    if (!TAG.test(tag))
      errors.push(`"${tag}" must be lowercase letters and digits without "#"`);
  }
  for (const tag of approved) {
    if (proposed.includes(tag))
      errors.push(`"${tag}" is both approved and proposed`);
  }
  return errors;
}

async function readYaml(path: string): Promise<Doc> {
  return (parse(await readFile(path, "utf8")) ?? {}) as Doc;
}

export async function loadContent(root = CONTENT_ROOT) {
  const [glossary, hashtags, subreddits] = await Promise.all([
    readYaml(`${root}voice/glossary.yaml`),
    readYaml(`${root}voice/hashtags.yaml`),
    readYaml(`${root}reddit/subreddits.yaml`),
  ]);
  const errors = [
    ...validateGlossary(glossary).map((error) => `glossary.yaml: ${error}`),
    ...validateHashtags(hashtags).map((error) => `hashtags.yaml: ${error}`),
    ...validateSubreddits(subreddits).map(
      (error) => `subreddits.yaml: ${error}`,
    ),
  ];
  return { glossary, hashtags, subreddits, errors };
}
