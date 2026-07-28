import assert from "node:assert/strict";
import test from "node:test";

import { validateReleaseMobileConfig } from "./assert-release-mobile-config.mjs";

test("accepts the secure release defaults", () => {
  assert.doesNotThrow(() =>
    validateReleaseMobileConfig({
      CRATE_ALLOW_MIXED_CONTENT: "false",
    }),
  );
});

test("rejects mixed content in a release build", () => {
  assert.throws(
    () =>
      validateReleaseMobileConfig({
        CRATE_ALLOW_MIXED_CONTENT: "true",
      }),
    /mixed content/i,
  );
});

test("rejects release server URLs that use HTTP", () => {
  assert.throws(
    () =>
      validateReleaseMobileConfig({
        VITE_API_URL: "http://localhost:8585",
      }),
    /HTTPS/i,
  );
});
