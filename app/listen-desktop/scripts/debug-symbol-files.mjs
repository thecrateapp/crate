import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Debug files of the binary that ships in the desktop packages, and nothing else.
// Cargo's `release/deps` and `release/build` hold host tools (build scripts,
// proc macros) and copies of the same objects under the same debug ID; Sentry
// rejects some of those with "An unknown error occurred", and they never run on
// a user's machine.
const APP_DEBUG_FILES = new Set([
  "crate-desktop",
  "crate-desktop.dSYM",
  "crate-desktop.exe",
  "crate_desktop.exe",
  "crate-desktop.pdb",
  "crate_desktop.pdb",
]);

function releaseDirectories(targetDirectory) {
  const directories = [path.join(targetDirectory, "release")];
  for (const entry of readdirSync(targetDirectory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      directories.push(path.join(targetDirectory, entry.name, "release"));
    }
  }
  return directories.filter((directory) => existsSync(directory));
}

export function debugSymbolFiles(targetDirectory) {
  const files = [];
  for (const directory of releaseDirectories(targetDirectory)) {
    for (const entry of readdirSync(directory)) {
      if (APP_DEBUG_FILES.has(entry)) files.push(path.join(directory, entry));
    }
  }
  if (files.length === 0) {
    throw new Error(
      `No release build of crate-desktop under ${targetDirectory}`,
    );
  }
  return files.sort();
}

function runCli() {
  const scriptPath = fileURLToPath(import.meta.url);
  if (
    pathToFileURL(path.resolve(process.argv[1] ?? "")).href !==
    pathToFileURL(scriptPath).href
  ) {
    return;
  }

  const [targetDirectory] = process.argv.slice(2);
  if (!targetDirectory) {
    throw new Error("Usage: debug-symbol-files.mjs <cargo target directory>");
  }
  for (const file of debugSymbolFiles(targetDirectory)) {
    process.stdout.write(`${file}\n`);
  }
}

runCli();
