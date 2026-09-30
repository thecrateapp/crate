import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  readDesktopVersionSources,
  resolveDesktopVersion,
  windowsBuildRequiresMsi,
  withTauriVersionOverride,
} from "./desktop-version.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), "../../..");
const sources = readDesktopVersionSources(repositoryRoot);
const version = resolveDesktopVersion({
  override:
    process.env.CRATE_DESKTOP_VERSION || process.env.TAURI_RELEASE_VERSION,
  refType: process.env.GITHUB_REF_TYPE,
  refName: process.env.GITHUB_REF_NAME,
  defaultVersion: sources.tauri,
});
const args = withTauriVersionOverride(process.argv.slice(2), version.version);
if (windowsBuildRequiresMsi(args, process.platform) && !version.msiCompatible) {
  throw new Error(
    `Windows MSI cannot represent ${version.version} unambiguously; build the NSIS bundle instead`,
  );
}

const require = createRequire(path.join(repositoryRoot, "package.json"));
const tauriCli = require.resolve("@tauri-apps/cli/tauri.js");
const result = spawnSync(process.execPath, [tauriCli, ...args], {
  cwd: path.join(repositoryRoot, "app/listen-desktop"),
  env: process.env,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
