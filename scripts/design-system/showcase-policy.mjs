import { createHash } from "node:crypto";
export const fingerprint = (text) =>
  createHash("sha256").update(text).digest("hex");
export const CATALOGUE_PATH = "tools/crate-ui-showcase/catalogue.json";
export const CATALOGUE_CATEGORIES = [
  "Foundations",
  "Forms",
  "Feedback",
  "Data Display",
  "Navigation",
  "Actions",
  "Overlays",
  "Media",
  "Layout",
  "Compatibility",
];
export const VISUAL_ROOTS = [
  "primitives",
  "composites",
  "domain",
  "shadcn",
  "icons",
];
export function isVisualSource(path) {
  return (
    !path.includes(".test.") &&
    (VISUAL_ROOTS.some(
      (root) =>
        path.startsWith(`app/shared/ui/${root}/`) && path.endsWith(".tsx"),
    ) ||
      (path.startsWith("app/shared/ui/tokens/") && path.endsWith(".css")) ||
      (path.startsWith("app/shared/fonts/") && path.endsWith(".css")))
  );
}
/** Same checks for working tree, CI and the Git index. File content is injected for staged safety. */
export function validateCatalogue({ catalogue, files, read, previous }) {
  const errors = [],
    ownership = new Map(),
    ids = new Set(),
    current = new Set(files);
  if (catalogue?.version !== 1 || !Array.isArray(catalogue?.entries))
    return ["Invalid showcase catalogue schema (version1/entries required)."];
  if (
    previous !== undefined &&
    (previous?.version !== 1 || !Array.isArray(previous?.entries))
  )
    return ["Invalid previous showcase catalogue schema."];
  const nonempty = (value) =>
    typeof value === "string" && value.trim().length > 0;
  const record = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  for (const e of catalogue.entries) {
    if (!record(e)) {
      errors.push("Invalid catalogue entry: expected an object.");
      continue;
    }
    if (!nonempty(e.id) || ids.has(e.id))
      errors.push(`Duplicate or missing catalogue id: ${e.id}`);
    ids.add(e.id);
    if (
      !["pending", "documented"].includes(e.coverage) ||
      !nonempty(e.name) ||
      !Array.isArray(e.sources) ||
      !e.sources.length ||
      !e.sources.every((p) => typeof p === "string" && isVisualSource(p))
    ) {
      errors.push(`Invalid catalogue entry ${e.id}`);
      continue;
    }
    for (const field of ["purpose", "adoption"])
      if (!nonempty(e[field]))
        errors.push(`Invalid entry ${e.id}: ${field} must be nonempty text.`);
    if (!CATALOGUE_CATEGORIES.includes(e.category))
      errors.push(
        `Invalid entry ${e.id}: category must use the functional taxonomy (${CATALOGUE_CATEGORIES.join(", ")}).`,
      );
    if (!Array.isArray(e.knownIssues) || !e.knownIssues.every(nonempty))
      errors.push(
        `Invalid entry ${e.id}: knownIssues must be an array of nonempty strings.`,
      );
    if (!record(e.fingerprints))
      errors.push(`Invalid entry ${e.id}: fingerprints must be an object.`);
    for (const p of e.sources) {
      if (ownership.has(p))
        errors.push(`Source ${p} has multiple entry owners.`);
      ownership.set(p, e.id);
      if (!current.has(p))
        errors.push(`Source removed or renamed: ${p}; update entry ${e.id}.`);
    }
    const paths = [...e.sources];
    if (e.coverage === "documented") {
      if (!nonempty(e.storyId) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(e.storyId))
        errors.push(
          `Invalid entry ${e.id}: storyId must be a Storybook component id.`,
        );
      for (const role of ["story", "docs"])
        if (
          typeof e[role] !== "string" ||
          !e[role].startsWith("tools/crate-ui-showcase/") ||
          !e[role].endsWith(role === "story" ? ".stories.tsx" : ".mdx")
        )
          errors.push(`Entry ${e.id} needs its ${role} file.`);
        else paths.push(e[role]);
    }
    for (const p of paths) {
      const content = read(p);
      if (typeof content !== "string") {
        errors.push(`Missing file ${p} for ${e.id}`);
        continue;
      }
      if (e.fingerprints?.[p] !== fingerprint(content))
        errors.push(
          `Stale entry ${e.id}: ${p}; update docs/story and run npm run design-system:showcase:refresh -- ${e.id}.`,
        );
    }
    const old = previous?.entries?.find(
      (r) =>
        r &&
        (r.id === e.id ||
          (Array.isArray(r.sources) &&
            r.sources.some((p) => e.sources.includes(p)))),
    );
    if (old) {
      const changed = e.sources.some(
        (p) => old.fingerprints?.[p] !== e.fingerprints?.[p],
      );
      if (changed && e.coverage === "pending")
        errors.push(
          `Pending entry ${e.id} changed: document it with a story and docs before refreshing.`,
        );
      if (
        changed &&
        e.coverage === "documented" &&
        old.coverage === "documented" &&
        ["story", "docs"].every(
          (role) =>
            old[role] === e[role] &&
            old.fingerprints?.[old[role]] === e.fingerprints?.[e[role]],
        )
      )
        errors.push(
          `Entry ${e.id}: source changed; a story or doc update is required, not only a fingerprint.`,
        );
    }
  }
  for (const p of current)
    if (!ownership.has(p))
      errors.push(
        `Visual module ${p} needs a catalogue entry (documented for new components).`,
      );
  if (previous)
    for (const e of catalogue.entries)
      if (
        e?.coverage === "pending" &&
        !previous.entries?.some(
          (old) =>
            old?.id === e.id &&
            old.coverage === "pending" &&
            Array.isArray(e.sources) &&
            Array.isArray(old.sources) &&
            e.sources.every((p) => old.sources.includes(p)),
        )
      )
        errors.push(
          `New entry ${e.id} cannot be pending: it must have been previously pending in the baseline; document the component.`,
        );
  return errors;
}
