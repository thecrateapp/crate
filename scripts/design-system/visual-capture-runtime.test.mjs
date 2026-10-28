import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPTURE_IMAGE,
  assertBaselineUpdateAllowed,
  canRecordBaselines,
} from "./visual-capture-runtime.mjs";

const canonicalRuntime = {
  platform: "linux",
  arch: "x64",
  image: CAPTURE_IMAGE,
  ci: true,
};
const nonCanonicalRuntimes = [
  ["macOS", { platform: "darwin" }],
  ["Windows", { platform: "win32" }],
  ["Linux ARM64", { arch: "arm64" }],
  [
    "a different capture image",
    { image: "mcr.microsoft.com/playwright:v1.62.0-noble" },
  ],
  ["an unspecified capture image", { image: undefined }],
];
const updateModes = ["all", "changed", "missing"];

test("records baselines in the canonical Linux amd64 CI image", () => {
  assert.equal(canRecordBaselines(canonicalRuntime), true);
});

for (const [name, overrides] of nonCanonicalRuntimes) {
  const runtime = { ...canonicalRuntime, ...overrides };

  test(`does not record baselines on ${name}`, () => {
    assert.equal(canRecordBaselines(runtime), false);
  });

  test(`allows local comparisons on ${name}`, () => {
    assert.doesNotThrow(() =>
      assertBaselineUpdateAllowed("none", { ...runtime, ci: false }),
    );
  });

  test(`blocks every local baseline creation mode on ${name}`, () => {
    for (const mode of updateModes) {
      assert.throws(
        () => assertBaselineUpdateAllowed(mode, { ...runtime, ci: false }),
        Error,
        `Local ${mode} updates must not create baselines on ${name}`,
      );
    }
  });

  test(`rejects CI on ${name}, including comparison-only runs`, () => {
    for (const mode of ["none", ...updateModes]) {
      assert.throws(
        () => assertBaselineUpdateAllowed(mode, runtime),
        Error,
        `CI ${mode} must reject ${name}`,
      );
    }
  });
}

test("does not record baselines outside CI even in the canonical image", () => {
  assert.equal(canRecordBaselines({ ...canonicalRuntime, ci: false }), false);
});

test("allows local comparisons but blocks updates in the canonical image outside CI", () => {
  const runtime = { ...canonicalRuntime, ci: false };

  assert.doesNotThrow(() => assertBaselineUpdateAllowed("none", runtime));
  for (const mode of updateModes) {
    assert.throws(
      () => assertBaselineUpdateAllowed(mode, runtime),
      Error,
      `Local ${mode} updates must not create baselines outside CI`,
    );
  }
});

for (const mode of ["none", ...updateModes]) {
  test(`allows ${mode} in the canonical Linux amd64 CI image`, () => {
    assert.doesNotThrow(() =>
      assertBaselineUpdateAllowed(mode, canonicalRuntime),
    );
  });
}
