import type { BrowserContext } from "@playwright/test";

// Takes record against production. Reads pass; writes never leave the browser, so recording
// creates no play events, scrobbles, tasks or edits.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_WRITES = ["/api/auth/refresh", "/api/auth/media-access"];

export function reachesProduction(method: string, url: string): boolean {
  const { pathname } = new URL(url);
  if (!pathname.startsWith("/api/")) return true;
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  return ALLOWED_WRITES.includes(pathname);
}

export async function guardWrites(context: BrowserContext): Promise<string[]> {
  const blocked: string[] = [];
  await context.route(/\/api\//, async (route) => {
    const request = route.request();
    if (reachesProduction(request.method(), request.url())) {
      await route.continue();
      return;
    }
    blocked.push(`${request.method()} ${new URL(request.url()).pathname}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
  return blocked;
}
