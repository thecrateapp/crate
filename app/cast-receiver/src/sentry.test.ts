import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureException, init, metricsCount } = vi.hoisted(() => ({
  captureException: vi.fn(),
  init: vi.fn(),
  metricsCount: vi.fn(),
}));

vi.mock("@sentry/react", () => ({
  captureException,
  init,
  metrics: { count: metricsCount },
}));

import {
  captureReceiverError,
  initReceiverSentry,
  recordReceiverMetric,
  sanitizeReceiverUrl,
  scrubReceiverSentryEvent,
} from "./sentry";

describe("Cast receiver Sentry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.test/7");
    vi.stubEnv("VITE_SENTRY_ENVIRONMENT", "test");
    vi.stubEnv("VITE_SENTRY_RELEASE", "cast-receiver-test");
  });

  it("removes session leases, signatures, query strings, and listening metadata", () => {
    const event = scrubReceiverSentryEvent({
      request: {
        url: "https://api.test/api/cast/sessions/private-lease/items/one/stream?sig=secret",
        query_string: "sig=secret",
        data: { title: "Private song" },
      },
      breadcrumbs: [
        {
          message:
            "GET https://api.test/api/cast/sessions/private-lease/items/one?token=secret",
          data: {
            bootstrapUrl:
              "https://api.test/api/cast/sessions/private-lease?token=secret",
            artist: "Private artist",
            outcome: "retry",
          },
        },
      ],
      extra: {
        lease: "private-lease",
        streamUrl:
          "https://api.test/api/cast/sessions/private-lease/items/one/stream?sig=secret",
        queue: [{ title: "Private song" }],
      },
    });

    expect(event.request).toMatchObject({
      url: "/api/cast/sessions/[Filtered]/items/one/stream",
      data: undefined,
      query_string: undefined,
    });
    expect(JSON.stringify(event)).not.toContain("private-lease");
    expect(JSON.stringify(event)).not.toContain("secret");
    expect(JSON.stringify(event)).not.toContain("Private song");
    expect(JSON.stringify(event)).not.toContain("Private artist");
    expect(event.breadcrumbs?.[0]?.data).toEqual({
      bootstrapUrl: "[Filtered]",
      artist: "[Filtered]",
      outcome: "retry",
    });
  });

  it("keeps only a redacted path for receiver URLs", () => {
    expect(
      sanitizeReceiverUrl(
        "https://api.test/api/cast/sessions/lease-value/items/item-1?X-Amz-Signature=secret#fragment",
      ),
    ).toBe("/api/cast/sessions/[Filtered]/items/item-1");
  });

  it("initializes lazily and emits only bounded operational attributes", async () => {
    await initReceiverSentry();
    recordReceiverMetric("receiver.media_retry", {
      attempt: 2,
      outcome: "retry",
    });
    captureReceiverError(new Error("load failed"), "session_load");

    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://public@example.test/7",
        environment: "test",
        release: "cast-receiver-test",
        sendDefaultPii: false,
        enableMetrics: true,
        beforeSend: scrubReceiverSentryEvent,
      }),
    );
    expect(metricsCount).toHaveBeenCalledWith("receiver.media_retry", 1, {
      attributes: { attempt: 2, outcome: "retry" },
    });
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { stage: "session_load" } }),
    );
  });
});
