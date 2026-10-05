import { beforeEach, describe, expect, it } from "vitest";

import {
  getTauriAuthDiagnostic,
  recordTauriAuthDiagnostic,
  TAURI_AUTH_DIAGNOSTIC_KEY,
} from "./tauri-auth-diagnostic";

beforeEach(() => localStorage.removeItem(TAURI_AUTH_DIAGNOSTIC_KEY));

describe("Tauri auth diagnostics", () => {
  it("drops credential values, URLs, OAuth callbacks, and personal paths", () => {
    recordTauriAuthDiagnostic(
      "OAuth bridge failed",
      "https://api.test/callback?code=secret /Users/diego/private",
    );

    expect(getTauriAuthDiagnostic()).toMatchObject({
      status: "OAuth bridge failed",
      detail: undefined,
    });
    expect(localStorage.getItem(TAURI_AUTH_DIAGNOSTIC_KEY)).not.toContain(
      "secret",
    );
  });

  it("keeps bounded operational detail and sanitizes records when reading", () => {
    recordTauriAuthDiagnostic("OAuth providers request failed", "status=503");
    expect(getTauriAuthDiagnostic()?.detail).toBe("status=503");

    localStorage.setItem(
      TAURI_AUTH_DIAGNOSTIC_KEY,
      JSON.stringify({
        status: "Native OAuth callback",
        detail: "cratemusic://callback?code=old-secret",
        at: "2026-09-30T00:00:00.000Z",
      }),
    );
    expect(getTauriAuthDiagnostic()?.detail).toBeUndefined();
    expect(localStorage.getItem(TAURI_AUTH_DIAGNOSTIC_KEY)).not.toContain(
      "old-secret",
    );
  });

  it("caps diagnostic text lengths", () => {
    recordTauriAuthDiagnostic("ok", "a".repeat(500));
    expect(getTauriAuthDiagnostic()?.detail).toHaveLength(160);
  });

  it("replaces control characters before storing diagnostic text", () => {
    recordTauriAuthDiagnostic("OAuth\nbridge ready", "status=503\nretryable");

    expect(getTauriAuthDiagnostic()).toMatchObject({
      status: "OAuth bridge ready",
      detail: "status=503 retryable",
    });
  });

  it("removes persisted records with an invalid timestamp", () => {
    localStorage.setItem(
      TAURI_AUTH_DIAGNOSTIC_KEY,
      JSON.stringify({
        status: "OAuth bridge failed",
        detail: "status=503",
        at: "https://example.test/?token=secret",
      }),
    );

    expect(getTauriAuthDiagnostic()).toBeNull();
    expect(localStorage.getItem(TAURI_AUTH_DIAGNOSTIC_KEY)).toBeNull();
  });
});
