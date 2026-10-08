import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function parseVersion(value) {
  if (!/^\d+(?:\.\d+)+$/.test(value)) {
    throw new Error(`Invalid GLIBC version: ${value}`);
  }
  return value.split(".").map(Number);
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function highestRequiredGlibcVersion(readelfOutput) {
  const versions = [
    ...readelfOutput.matchAll(/\bGLIBC_(\d+(?:\.\d+)+)\b/g),
  ].map((match) => match[1]);
  if (versions.length === 0) {
    throw new Error("No GLIBC version requirements found in ELF metadata");
  }
  return versions.reduce((highest, version) =>
    compareVersions(version, highest) > 0 ? version : highest,
  );
}

export function assertGlibcCompatibility(readelfOutput, maximumVersion) {
  parseVersion(maximumVersion);
  const requiredVersion = highestRequiredGlibcVersion(readelfOutput);
  if (compareVersions(requiredVersion, maximumVersion) > 0) {
    throw new Error(
      `Binary requires GLIBC_${requiredVersion}; maximum supported is GLIBC_${maximumVersion}`,
    );
  }
  return requiredVersion;
}

export function verifyLinuxBinaryGlibc(binaryPath, maximumVersion) {
  const readelfOutput = execFileSync(
    "readelf",
    ["--version-info", binaryPath],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return assertGlibcCompatibility(readelfOutput, maximumVersion);
}

function runCli() {
  const scriptPath = fileURLToPath(import.meta.url);
  if (
    pathToFileURL(path.resolve(process.argv[1] ?? "")).href !==
    pathToFileURL(scriptPath).href
  ) {
    return;
  }

  const [binaryPath, maximumVersion = "2.36"] = process.argv.slice(2);
  if (!binaryPath) {
    throw new Error(
      "Usage: verify-linux-glibc.mjs <ELF-binary> [maximum-version]",
    );
  }
  const requiredVersion = verifyLinuxBinaryGlibc(binaryPath, maximumVersion);
  process.stdout.write(
    `Verified ${binaryPath}: GLIBC_${requiredVersion} <= GLIBC_${maximumVersion}\n`,
  );
}

runCli();
