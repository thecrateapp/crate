import {
  BrowserClient,
  createTransport,
  defaultStackParser,
  rewriteFramesIntegration,
} from "@sentry/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  createSentryBeforeSend,
  createSentryFrameNormalizer,
  type SentryEventLike,
} from "./sentry";

// Runs the real SDK pipeline: RewriteFrames must run before the SDK writes
// debug_meta, or the debug-ID source-map lookup stops matching the frames.

const BUNDLE = "https://listen.lespedants.org/assets/index-Bi8pQL.js";
const DEBUG_ID = "c0ffee00-1234-4abc-8def-000000000001";

type DebugIdGlobal = typeof globalThis & {
  _sentryDebugIds?: Record<string, string>;
};

function captureWithClient(
  error: Error,
  beforeSend = createSentryBeforeSend(),
): Promise<SentryEventLike | null> {
  return new Promise((resolve) => {
    const client = new BrowserClient({
      dsn: "https://public@example.test/1",
      stackParser: defaultStackParser,
      integrations: [
        rewriteFramesIntegration({
          iteratee: createSentryFrameNormalizer(
            "https://listen.lespedants.org",
          ),
        }),
      ],
      transport: (options) =>
        createTransport(options, () => Promise.resolve({ statusCode: 200 })),
      beforeSend: (event, hint) => {
        const kept = beforeSend(event, hint);
        resolve(kept as SentryEventLike | null);
        return null;
      },
    });
    client.init();
    client.captureException(error);
    // Dropped events never reach the resolve above.
    setTimeout(() => resolve(null), 200);
  });
}

function bundleError(message: string, name = "Error"): Error {
  const error = new Error(message);
  error.name = name;
  error.stack = `${name}: ${message}\n    at execute (${BUNDLE}:12:345)\n    at run (${BUNDLE}:3:21)`;
  return error;
}

afterEach(() => {
  delete (globalThis as DebugIdGlobal)._sentryDebugIds;
});

describe("Sentry SDK pipeline", () => {
  it("rewrites bundle frames and keeps them linked to their debug ID", async () => {
    (globalThis as DebugIdGlobal)._sentryDebugIds = {
      [`Error\n    at injected (${BUNDLE}:1:1)`]: DEBUG_ID,
    };

    const event = (await captureWithClient(
      bundleError("API request failed with HTTP 500"),
    )) as SentryEventLike & {
      debug_meta?: { images?: Array<Record<string, string>> };
    };

    const frames = event.exception?.values?.[0]?.stacktrace?.frames ?? [];
    expect(frames.map((frame) => frame.filename)).toEqual([
      "app:///assets/index-Bi8pQL.js",
      "app:///assets/index-Bi8pQL.js",
    ]);
    expect(event.debug_meta?.images).toEqual([
      {
        type: "sourcemap",
        code_file: "app:///assets/index-Bi8pQL.js",
        debug_id: DEBUG_ID,
      },
    ]);
  });

  it("drops network failures before they are sent", async () => {
    await expect(
      captureWithClient(bundleError("Failed to fetch", "TypeError")),
    ).resolves.toBeNull();
  });
});
