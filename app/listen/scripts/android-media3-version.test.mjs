import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const variablesGradle = readFileSync(
  new URL("../android/variables.gradle", import.meta.url),
  "utf8",
);
const appGradle = readFileSync(
  new URL("../android/app/build.gradle", import.meta.url),
  "utf8",
);

function media3Version(source) {
  const match = source.match(/androidxMedia3Version\s*=\s*['"]([^'"]+)['"]/);
  assert.ok(match, "androidxMedia3Version must be declared");
  return match[1];
}

function versionParts(version) {
  return version.split(".").map((part) => Number.parseInt(part, 10));
}

test("pins Media3 to the Smart Mix baseline or newer", () => {
  const actual = versionParts(media3Version(variablesGradle));
  const minimum = versionParts("1.10.1");

  assert.ok(
    actual[0] > minimum[0] ||
      (actual[0] === minimum[0] && actual[1] > minimum[1]) ||
      (actual[0] === minimum[0] &&
        actual[1] === minimum[1] &&
        actual[2] >= minimum[2]),
    `expected Media3 >= 1.10.1, received ${actual.join(".")}`,
  );
});

test("all Media3 artifacts share the central version", () => {
  const dependencies =
    appGradle.match(
      /implementation "androidx\.media3:media3-[^"]+:\$androidxMedia3Version"/g,
    ) ?? [];

  assert.deepEqual(
    dependencies.sort(),
    [
      'implementation "androidx.media3:media3-common:$androidxMedia3Version"',
      'implementation "androidx.media3:media3-datasource:$androidxMedia3Version"',
      'implementation "androidx.media3:media3-exoplayer:$androidxMedia3Version"',
      'implementation "androidx.media3:media3-session:$androidxMedia3Version"',
    ].sort(),
  );
  assert.doesNotMatch(
    appGradle,
    /androidx\.media3:media3-[^"]+:\d/,
    "Media3 dependencies must not pin independent versions",
  );
});
