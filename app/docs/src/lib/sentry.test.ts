import { beforeEach, describe, expect, it, vi } from "vitest";

const { init, browserTracingIntegration } = vi.hoisted(() => ({
  init: vi.fn(),
  browserTracingIntegration: vi.fn(() => "browser-tracing"),
}));

vi.mock("@sentry/react", () => ({ init, browserTracingIntegration }));

import { initSentry } from "./sentry";

describe("docs Sentry setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stays disabled without a DSN", () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");

    initSentry();

    expect(init).not.toHaveBeenCalled();
  });

  it("initializes privacy-safe tracing", () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.test/docs");
    vi.stubEnv("VITE_SENTRY_ENVIRONMENT", "production");
    vi.stubEnv("VITE_SENTRY_RELEASE", "crate-docs-test");

    initSentry();

    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://public@example.test/docs",
        environment: "production",
        release: "crate-docs-test",
        sendDefaultPii: false,
        integrations: ["browser-tracing"],
      }),
    );
  });
});
