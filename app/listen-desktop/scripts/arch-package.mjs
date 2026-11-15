// Renders packaging/aur/crate-desktop-bin/PKGBUILD for a release: the
// workflow's arch-package job builds it with makepkg, attaches the package to
// the GitHub release and, once an AUR key is configured, pushes it to the AUR.
//
//   node arch-package.mjs <PKGBUILD> <version> <sha256 of crate-linux-<version>.deb>
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The Arch pkgver for a release version, or null for one not to package. */
export function archPkgver(version) {
  // Prereleases (3.4.0-rc1) sort after 3.4.0 in pacman and their .deb asset
  // keeps the hyphen pkgver cannot carry: only plain releases are packaged.
  return /^\d+\.\d+\.\d+$/.test(version ?? "") ? version : null;
}

function replaceLine(text, pattern, line, name) {
  if (!pattern.test(text)) throw new Error(`PKGBUILD has no ${name} line`);
  return text.replace(pattern, line);
}

export function renderPkgbuild(recipe, { version, sha256 }) {
  const pkgver = archPkgver(version);
  if (!pkgver) throw new Error(`${version} is not a plain release version`);
  if (!/^[0-9a-f]{64}$/.test(sha256 ?? "")) {
    throw new Error(`${sha256} is not a sha256 digest`);
  }
  let text = replaceLine(recipe, /^pkgver=.*$/m, `pkgver=${pkgver}`, "pkgver");
  text = replaceLine(text, /^pkgrel=.*$/m, "pkgrel=1", "pkgrel");
  return replaceLine(
    text,
    /^sha256sums=.*$/m,
    `sha256sums=('${sha256}')`,
    "sha256sums",
  );
}

export function renderPkgbuildFile(file, release) {
  writeFileSync(file, renderPkgbuild(readFileSync(file, "utf8"), release));
}

function runCli() {
  const scriptPath = fileURLToPath(import.meta.url);
  if (
    pathToFileURL(path.resolve(process.argv[1] ?? "")).href !==
    pathToFileURL(scriptPath).href
  ) {
    return;
  }
  const [file, version, sha256] = process.argv.slice(2);
  if (!file || !version || !sha256) {
    throw new Error("Usage: arch-package.mjs <PKGBUILD> <version> <sha256>");
  }
  renderPkgbuildFile(file, { version, sha256 });
  console.log(`Rendered ${file} for ${version}`);
}

runCli();
