import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  archPkgver,
  renderPkgbuild,
  renderPkgbuildFile,
} from "./arch-package.mjs";

const SHA = "a".repeat(64);
const recipe = readFileSync(
  fileURLToPath(
    new URL(
      "../../../packaging/aur/crate-desktop-bin/PKGBUILD",
      import.meta.url,
    ),
  ),
  "utf8",
);

test("packages plain release versions only", () => {
  assert.equal(archPkgver("3.4.0"), "3.4.0");
  assert.equal(archPkgver("12.0.10"), "12.0.10");
  // pacman orders 3.4.0-rc1 and 3.4.0 wrongly, and the .deb asset keeps the hyphen
  assert.equal(archPkgver("3.4.0-rc1"), null);
  assert.equal(archPkgver("3.3.1-144-g18dbc8f11"), null);
  assert.equal(archPkgver(""), null);
});

test("sets the version, resets pkgrel and pins the .deb checksum", () => {
  const rendered = renderPkgbuild(recipe, { version: "3.4.0", sha256: SHA });
  assert.match(rendered, /^pkgver=3\.4\.0$/m);
  assert.match(rendered, /^pkgrel=1$/m);
  assert.match(rendered, new RegExp(`^sha256sums=\\('${SHA}'\\)$`, "m"));
  // the source keeps deriving the asset name from pkgver
  assert.match(rendered, /crate-linux-\$\{pkgver\}\.deb/);
  assert.equal(rendered.split("\n").length, recipe.split("\n").length);
});

test("ships Crate's release binary as is, in a single package", () => {
  // makepkg's default `debug` option splits off a -debug package, and `strip`
  // rewrites the binary the .deb carries
  assert.match(recipe, /^options=\(.*'!strip'.*\)$/m);
  assert.match(recipe, /^options=\(.*'!debug'.*\)$/m);
});

test("refuses a prerelease, a bad checksum or a recipe it cannot rewrite", () => {
  assert.throws(
    () => renderPkgbuild(recipe, { version: "3.4.0-rc1", sha256: SHA }),
    /plain release/,
  );
  assert.throws(
    () => renderPkgbuild(recipe, { version: "3.4.0", sha256: "abc" }),
    /sha256/,
  );
  assert.throws(
    () =>
      renderPkgbuild(recipe.replace(/^sha256sums=.*$/m, ""), {
        version: "3.4.0",
        sha256: SHA,
      }),
    /sha256sums/,
  );
});

test("rewrites a PKGBUILD file in place", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "crate-arch-"));
  const file = path.join(directory, "PKGBUILD");
  writeFileSync(file, recipe);
  renderPkgbuildFile(file, { version: "3.4.0", sha256: SHA });
  assert.match(readFileSync(file, "utf8"), /^pkgver=3\.4\.0$/m);
});
