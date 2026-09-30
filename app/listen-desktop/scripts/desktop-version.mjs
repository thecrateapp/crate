import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseDesktopVersion(input) {
  if (typeof input !== "string") {
    throw new TypeError("Desktop version must be a string");
  }

  const value = input.trim().replace(/^v/, "");
  const match = SEMVER_RE.exec(value);
  if (!match) throw new Error(`Invalid desktop SemVer version: ${input}`);

  const [, major, minor, patch, prerelease = "", build = ""] = match;
  if (
    prerelease
      .split(".")
      .some(
        (part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"),
      )
  ) {
    throw new Error(`Invalid desktop SemVer version: ${input}`);
  }

  const numericMajor = Number(major);
  const numericMinor = Number(minor);
  const numericPatch = Number(patch);
  const msiCompatible =
    !prerelease &&
    !build &&
    numericMajor <= 255 &&
    numericMinor <= 255 &&
    numericPatch <= 65535;

  return {
    version: `${major}.${minor}.${patch}${prerelease ? `-${prerelease}` : ""}${
      build ? `+${build}` : ""
    }`,
    major: numericMajor,
    minor: numericMinor,
    patch: numericPatch,
    prerelease,
    build,
    msiCompatible,
  };
}

export function resolveDesktopVersion({
  override,
  refType,
  refName,
  localTag,
  defaultVersion,
}) {
  const requested =
    (typeof override === "string" && override.trim()) ||
    (refType === "tag" ? refName : "") ||
    (!refType ? localTag : "") ||
    defaultVersion;
  if (!requested) throw new Error("No desktop version was provided");
  return parseDesktopVersion(requested);
}

export function readDesktopVersionSources(repositoryRoot) {
  const frontend = JSON.parse(
    fs.readFileSync(
      path.join(repositoryRoot, "app/listen-desktop/package.json"),
      "utf8",
    ),
  );
  const tauri = JSON.parse(
    fs.readFileSync(
      path.join(repositoryRoot, "app/listen-desktop/src-tauri/tauri.conf.json"),
      "utf8",
    ),
  );
  const cargoToml = fs.readFileSync(
    path.join(repositoryRoot, "app/listen-desktop/src-tauri/Cargo.toml"),
    "utf8",
  );
  const packageStart = cargoToml.indexOf("[package]");
  const nextSection = cargoToml.indexOf(
    "\n[",
    packageStart + "[package]".length,
  );
  const packageSection =
    packageStart < 0
      ? ""
      : cargoToml.slice(
          packageStart,
          nextSection < 0 ? cargoToml.length : nextSection,
        );
  const cargoVersion = packageSection?.match(
    /^version\s*=\s*"([^"]+)"\s*$/m,
  )?.[1];
  if (!frontend.version || !tauri.version || !cargoVersion) {
    throw new Error("Could not read all desktop package version sources");
  }

  const versions = {
    frontend: frontend.version,
    tauri: tauri.version,
    cargo: cargoVersion,
  };
  const normalized = Object.fromEntries(
    Object.entries(versions).map(([source, value]) => [
      source,
      parseDesktopVersion(value).version,
    ]),
  );
  if (new Set(Object.values(normalized)).size !== 1) {
    throw new Error(
      `Desktop package versions differ: ${JSON.stringify(normalized)}`,
    );
  }
  return normalized;
}

export function writeGitHubEnvironment(version, environmentPath) {
  const parsed = parseDesktopVersion(version);
  fs.appendFileSync(
    environmentPath,
    `CRATE_DESKTOP_VERSION=${parsed.version}\nCRATE_DESKTOP_MSI_COMPATIBLE=${parsed.msiCompatible}\n`,
  );
}

export function withTauriVersionOverride(args, version) {
  if (args[0] !== "build") return args;
  return [...args, "--config", JSON.stringify({ version })];
}

export function windowsBuildRequiresMsi(args, platform) {
  if (args[0] !== "build") return false;
  const targetFlag = args.findIndex((argument) => argument === "--target");
  const target =
    args.find((argument) => argument.startsWith("--target=")) ??
    (targetFlag >= 0 ? args[targetFlag + 1] : "") ??
    "";
  const windowsTarget =
    platform === "win32" || /windows-(?:gnu|msvc)/i.test(target);
  if (!windowsTarget) return false;

  const bundlesFlag = args.findIndex(
    (argument) => argument === "--bundles" || argument === "-b",
  );
  const bundlesArgument = args.find((argument) =>
    argument.startsWith("--bundles="),
  );
  const bundles =
    bundlesArgument?.slice("--bundles=".length) ??
    (bundlesFlag >= 0 ? args[bundlesFlag + 1] : "");
  return !bundles || bundles.split(/[ ,]+/).includes("msi");
}

function runCli() {
  const scriptPath = fileURLToPath(import.meta.url);
  if (
    pathToFileURL(path.resolve(process.argv[1] ?? "")).href !==
    pathToFileURL(scriptPath).href
  ) {
    return;
  }

  const repositoryRoot = path.resolve(path.dirname(scriptPath), "../../..");
  const sources = readDesktopVersionSources(repositoryRoot);
  const localTag = process.env.GITHUB_REF_TYPE
    ? ""
    : detectExactLocalTag(repositoryRoot);
  const resolved = resolveDesktopVersion({
    override:
      process.env.CRATE_DESKTOP_VERSION || process.env.TAURI_RELEASE_VERSION,
    refType: process.env.GITHUB_REF_TYPE,
    refName: process.env.GITHUB_REF_NAME,
    localTag,
    defaultVersion: sources.tauri,
  });
  if (process.env.GITHUB_ENV) {
    writeGitHubEnvironment(resolved.version, process.env.GITHUB_ENV);
  } else {
    process.stdout.write(`${resolved.version}\n`);
  }
}

function detectExactLocalTag(repositoryRoot) {
  const result = spawnSync("git", ["describe", "--tags", "--exact-match"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

runCli();
