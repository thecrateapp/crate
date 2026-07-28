import assert from "node:assert/strict";
import test from "node:test";

import { parseAndroidReleaseVersion } from "./android-release-version.mjs";

test("stable builds sort after prereleases of the same version", () => {
  const beta = parseAndroidReleaseVersion("v2.3.2-beta");
  const beta2 = parseAndroidReleaseVersion("v2.3.2-beta.2");
  const rc = parseAndroidReleaseVersion("v2.3.2-rc1");
  const stable = parseAndroidReleaseVersion("v2.3.2");

  assert.equal(beta.versionName, "2.3.2-beta");
  assert.ok(beta.versionCode < beta2.versionCode);
  assert.ok(beta2.versionCode < rc.versionCode);
  assert.ok(rc.versionCode < stable.versionCode);
});

test("the next patch is newer than every prior channel", () => {
  const previous = parseAndroidReleaseVersion("v2.3.2");
  const next = parseAndroidReleaseVersion("v2.3.3-alpha");

  assert.ok(previous.versionCode < next.versionCode);
});

test("invalid or overflowing tags fail closed", () => {
  assert.throws(() => parseAndroidReleaseVersion("latest"));
  assert.throws(() => parseAndroidReleaseVersion("v21.0.0"));
  assert.throws(() => parseAndroidReleaseVersion("v2.3.2-beta.20"));
});
