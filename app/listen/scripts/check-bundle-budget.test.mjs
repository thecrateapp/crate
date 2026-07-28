import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { checkBundleBudget } from "./check-bundle-budget.mjs";

test("counts initial module scripts and preloads against the gzip budget", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "crate-bundle-"));
  await mkdir(path.join(directory, "assets"));
  await writeFile(
    path.join(directory, "index.html"),
    '<script type="module" src="/assets/index.js"></script>' +
      '<link rel="modulepreload" href="/assets/vendor.js">',
  );
  await writeFile(path.join(directory, "assets/index.js"), "a".repeat(4_000));
  await writeFile(path.join(directory, "assets/vendor.js"), "b".repeat(4_000));

  await assert.doesNotReject(() => checkBundleBudget(directory, 1_000));
  await assert.rejects(() => checkBundleBudget(directory, 10), /budget/i);
});
