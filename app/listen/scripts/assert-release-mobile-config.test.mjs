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

test("validates matching registered Cast IDs when tagged builds enable custom Cast", () => {
  assert.throws(
    () =>
      validateReleaseMobileConfig({
        CRATE_REQUIRE_CUSTOM_CAST_RECEIVER: "true",
        VITE_CAST_CUSTOM_RECEIVER_ENABLED: "true",
      }),
    /registered Cast receiver/i,
  );
  assert.throws(
    () =>
      validateReleaseMobileConfig({
        CRATE_REQUIRE_CUSTOM_CAST_RECEIVER: "true",
        CRATE_CAST_RECEIVER_APP_ID: "CC1AD845",
        VITE_CAST_RECEIVER_APP_ID: "CC1AD845",
        VITE_CAST_CUSTOM_RECEIVER_ENABLED: "true",
      }),
    /registered Cast receiver/i,
  );
  assert.throws(
    () =>
      validateReleaseMobileConfig({
        CRATE_REQUIRE_CUSTOM_CAST_RECEIVER: "true",
        CRATE_CAST_RECEIVER_APP_ID: "ABCD1234",
        VITE_CAST_RECEIVER_APP_ID: "WXYZ5678",
        VITE_CAST_CUSTOM_RECEIVER_ENABLED: "true",
      }),
    /must match/i,
  );
  assert.doesNotThrow(() =>
    validateReleaseMobileConfig({
      CRATE_REQUIRE_CUSTOM_CAST_RECEIVER: "true",
      CRATE_CAST_RECEIVER_APP_ID: "ABCD1234",
      VITE_CAST_RECEIVER_APP_ID: "ABCD1234",
      VITE_CAST_CUSTOM_RECEIVER_ENABLED: "false",
    }),
  );

  assert.doesNotThrow(() =>
    validateReleaseMobileConfig({
      CRATE_REQUIRE_CUSTOM_CAST_RECEIVER: "true",
      CRATE_CAST_RECEIVER_APP_ID: "ABCD1234",
      VITE_CAST_RECEIVER_APP_ID: "ABCD1234",
      VITE_CAST_CUSTOM_RECEIVER_ENABLED: "true",
    }),
  );
});

test("allows tagged releases to use Google's default receiver when custom Cast is off", () => {
  assert.doesNotThrow(() =>
    validateReleaseMobileConfig({
      CRATE_REQUIRE_CUSTOM_CAST_RECEIVER: "true",
      CRATE_CAST_RECEIVER_APP_ID: "CC1AD845",
      VITE_CAST_RECEIVER_APP_ID: "CC1AD845",
      VITE_CAST_CUSTOM_RECEIVER_ENABLED: "false",
    }),
  );
});
