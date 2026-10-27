import { copyFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function stableName(file, version) {
  const marker = `-${version}.`;
  const index = file.indexOf(marker);
  if (index === -1) return null;
  return file.slice(0, index) + file.slice(index + marker.length - 1);
}

export function addStableNames(directory, version) {
  const created = [];
  for (const file of readdirSync(directory)) {
    const stable = stableName(file, version);
    if (!stable) continue;
    copyFileSync(path.join(directory, file), path.join(directory, stable));
    created.push(stable);
  }
  if (created.length === 0) {
    throw new Error(`No artifacts in ${directory} carry version ${version}`);
  }
  return created.sort();
}

function runCli() {
  const scriptPath = fileURLToPath(import.meta.url);
  if (
    pathToFileURL(path.resolve(process.argv[1] ?? "")).href !==
    pathToFileURL(scriptPath).href
  ) {
    return;
  }

  const [directory, version = process.env.CRATE_DESKTOP_VERSION] =
    process.argv.slice(2);
  if (!directory || !version) {
    throw new Error("Usage: stable-artifact-names.mjs <directory> [version]");
  }
  for (const name of addStableNames(directory, version)) {
    process.stdout.write(`${name}\n`);
  }
}

runCli();
