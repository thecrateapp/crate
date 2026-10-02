import assert from "node:assert/strict";
import test from "node:test";

import {
  assertGlibcCompatibility,
  highestRequiredGlibcVersion,
} from "./verify-linux-glibc.mjs";

test("finds the highest GLIBC requirement and ignores other version families", () => {
  const output = `
    Name: GLIBC_2.2.5
    Name: GLIBC_2.9
    Name: GLIBC_2.36
    Name: GLIBCXX_3.4.29
  `;

  assert.equal(highestRequiredGlibcVersion(output), "2.36");
});

test("allows binaries at the Debian 12 GLIBC floor", () => {
  assert.equal(
    assertGlibcCompatibility("Name: GLIBC_2.2.5\nName: GLIBC_2.36", "2.36"),
    "2.36",
  );
});

test("rejects binaries newer than the supported GLIBC floor", () => {
  assert.throws(
    () =>
      assertGlibcCompatibility("Name: GLIBC_2.36\nName: GLIBC_2.39", "2.36"),
    /requires GLIBC_2\.39; maximum supported is GLIBC_2\.36/,
  );
});

test("rejects malformed floors and missing GLIBC metadata", () => {
  assert.throws(
    () => assertGlibcCompatibility("Name: GLIBC_2.36", "2.36-beta"),
    /Invalid GLIBC version/,
  );
  assert.throws(
    () => highestRequiredGlibcVersion("Name: GLIBCXX_3.4.29"),
    /No GLIBC version requirements/,
  );
});
