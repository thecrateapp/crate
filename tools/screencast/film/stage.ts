import type { Page } from "@playwright/test";

export type Transform = (real: unknown, url: URL) => unknown;

// Serves a production read through a transform, so staged data always has the real shape.
export async function stageJson(
  page: Page,
  pattern: RegExp,
  transform: Transform,
): Promise<void> {
  await page.route(pattern, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const real = await response.json().catch(() => undefined);
    if (real === undefined) return route.fulfill({ response });
    await route.fulfill({
      response,
      json: transform(real, new URL(route.request().url())),
    });
  });
}

// Live streams never end, so the first real event is read once and then replayed through the
// transform as a one-event stream; a short retry makes the browser reconnect and get the next state.
export async function stageStream(
  page: Page,
  pattern: RegExp,
  transform: Transform,
  retryMs = 500,
): Promise<void> {
  let base: Promise<unknown> | undefined;
  await page.route(pattern, async (route) => {
    const url = new URL(route.request().url());
    base ??= firstEvent(url, await page.context().cookies(url.origin));
    const real = await base;
    const body = `retry: ${retryMs}\ndata: ${JSON.stringify(
      transform(real, url),
    )}\n\n`;
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
      body,
    });
  });
}

async function firstEvent(
  url: URL,
  cookies: { name: string; value: string }[],
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/event-stream",
        cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
      },
      signal: controller.signal,
    });
    if (!response.ok || !response.body)
      throw new Error(`${url.pathname} answered ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done)
        throw new Error(`${url.pathname} closed before its first event`);
      buffer += decoder.decode(value, { stream: true });
      const end = buffer.indexOf("\n\n");
      if (end === -1) continue;
      const data = buffer
        .slice(0, end)
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) {
        buffer = buffer.slice(end + 2);
        continue;
      }
      return JSON.parse(data);
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

export function withoutEntries(
  value: unknown,
  drop: (entry: Record<string, unknown>) => boolean,
): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => !(isRecord(entry) && drop(entry)))
      .map((entry) => withoutEntries(entry, drop));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        withoutEntries(entry, drop),
      ]),
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
