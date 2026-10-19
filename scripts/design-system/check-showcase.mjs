import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { execFileSync } from "node:child_process";
import {
  CATALOGUE_PATH,
  VISUAL_ROOTS,
  fingerprint,
  isVisualSource,
  validateCatalogue,
} from "./showcase-policy.mjs";
const args = process.argv.slice(2),
  staged = args.includes("--staged");
const rootArg = args.indexOf("--root");
const root =
  rootArg >= 0
    ? path.resolve(args[rootArg + 1])
    : fileURLToPath(new URL("../../", import.meta.url));
const git = (...a) =>
  execFileSync("git", a, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const read = (p) => {
  try {
    return staged
      ? git("show", `:${p}`)
      : fs.readFileSync(path.join(root, p), "utf8");
  } catch {
    return undefined;
  }
};
let catalogue;
try {
  catalogue = JSON.parse(read(CATALOGUE_PATH));
} catch {
  console.error(
    "Missing or invalid showcase catalogue in " +
      (staged ? "Git index" : "working tree"),
  );
  process.exit(1);
}
let previous;
const baseIndex = args.indexOf("--base");
const base = baseIndex >= 0 ? args[baseIndex + 1] : "HEAD";
let revision;
try {
  revision = git("rev-parse", "--verify", `${base}^{commit}`).trim();
} catch {
  if (
    baseIndex >= 0 ||
    git("rev-parse", "--is-shallow-repository").trim() === "true"
  ) {
    console.error(
      `Cannot resolve showcase base ${base ?? "(missing)"}; fetch the comparison revision.`,
    );
    process.exit(1);
  }
  /* Unborn local test repository: initial baseline has no commit. */
}
if (revision) {
  let oldText;
  try {
    oldText = git("show", `${revision}:${CATALOGUE_PATH}`);
  } catch {
    /* Legitimate initial1AQ baseline: the base commit has no catalogue. */
  }
  if (oldText !== undefined) {
    try {
      previous = JSON.parse(oldText);
    } catch {
      console.error(`Invalid showcase catalogue at comparison base ${base}.`);
      process.exit(1);
    }
  }
}
const files = staged
  ? git("ls-files", "-z").split("\0").filter(isVisualSource)
  : [
      ...VISUAL_ROOTS.map((d) => "app/shared/ui/" + d),
      "app/shared/ui/tokens",
      "app/shared/fonts",
    ].flatMap((dir) =>
      fs.existsSync(path.join(root, dir))
        ? fs
            .readdirSync(path.join(root, dir), { recursive: true })
            .map((p) => dir + "/" + p)
            .filter(isVisualSource)
        : [],
    );
const refreshIndex = args.indexOf("--refresh");
if (refreshIndex >= 0) {
  if (staged) throw Error("Refresh working tree entries before staging.");
  const e = catalogue.entries.find((r) => r.id === args[refreshIndex + 1]);
  if (!e || e.coverage !== "documented")
    throw Error(
      "Refresh requires one documented entry id with docs/story. Pending entries must be documented first.",
    );
  const sourceChanged = e.sources.some(
    (p) => fingerprint(read(p) ?? "") !== e.fingerprints?.[p],
  );
  if (
    sourceChanged &&
    ["docs", "story"].every(
      (role) => fingerprint(read(e[role]) ?? "") === e.fingerprints?.[e[role]],
    )
  )
    throw Error(
      "Update the affected story or documentation before refreshing source fingerprints.",
    );
  e.fingerprints = Object.fromEntries(
    [...e.sources, e.story, e.docs].map((p) => {
      const s = read(p);
      if (typeof s !== "string") throw Error("Missing " + p);
      return [p, fingerprint(s)];
    }),
  );
  fs.writeFileSync(
    path.join(root, CATALOGUE_PATH),
    JSON.stringify(catalogue, null, 2) + "\n",
  );
}
const errors = validateCatalogue({ catalogue, files, read, previous });
if (errors.length) {
  for (const e of errors) console.error(e);
  process.exitCode = 1;
} else
  console.log(
    `Showcase catalogue OK: ${catalogue.entries.filter((e) => e.coverage === "documented").length} documented / ${catalogue.entries.length} entries; ${files.length} source files (${staged ? "staged" : "working tree"}).`,
  );
