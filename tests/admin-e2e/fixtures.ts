import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test as base, type Route } from "@playwright/test";

const fixtureDir = join(__dirname, "fixtures");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), "utf8"));
}

const JSON_FIXTURES: Record<string, string> = {
  "/api/auth/me": "auth-me",
  "/api/auth/roles": "auth-roles",
  "/api/admin/llm/status": "llm-status",
  "/api/admin/ops-snapshot": "ops-snapshot",
  "/api/admin/tasks-snapshot": "tasks-snapshot",
  "/api/admin/playback-delivery": "playback-delivery",
  "/api/admin/task-catalog": "task-catalog",
  "/api/settings": "settings",
};

export interface ApiCall {
  method: string;
  path: string;
  body: unknown;
}

export interface AdminApi {
  calls: ApiCall[];
  respondTo: (path: string, body: unknown) => void;
}

interface AdminFixtures {
  failOnConsoleErrors: void;
  adminApi: AdminApi;
  openAdminPage: (path: string) => Promise<void>;
}

export const test = base.extend<AdminFixtures>({
  failOnConsoleErrors: [
    async ({ page }, provide) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await provide();
      expect(errors, "Admin emitted browser errors").toEqual([]);
    },
    { auto: true },
  ],
  adminApi: async ({}, provide) => {
    const responses = new Map<string, unknown>();
    const api: AdminApi & { responses: Map<string, unknown> } = {
      calls: [],
      responses,
      respondTo: (path, body) => responses.set(path, body),
    };
    await provide(api);
  },
  openAdminPage: async ({ page, adminApi }, provide) => {
    const responses = (
      adminApi as AdminApi & { responses: Map<string, unknown> }
    ).responses;
    await page.addInitScript(() => {
      class StableEventSource {
        readonly readyState = 1;
        readonly url: string;
        onerror: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onopen: ((event: Event) => void) | null = null;

        constructor(url: string | URL) {
          this.url = String(url);
          queueMicrotask(() => this.onopen?.(new Event("open")));
        }

        addEventListener() {}
        close() {}
        dispatchEvent() {
          return true;
        }
        removeEventListener() {}
      }
      Object.defineProperty(window, "EventSource", {
        configurable: true,
        value: StableEventSource,
      });
    });
    await page.route("**/api/**", async (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() !== "GET") {
        adminApi.calls.push({
          method: request.method(),
          path: url.pathname,
          body: request.postData() ? request.postDataJSON() : null,
        });
        await route.fulfill({
          json: responses.get(url.pathname) ?? { task_id: "task-e2e" },
        });
        return;
      }
      const name = JSON_FIXTURES[url.pathname];
      if (name) {
        await route.fulfill({ json: fixture(name) });
        return;
      }
      if (url.pathname === "/api/setup/status") {
        await route.fulfill({ json: { needs_setup: false } });
        return;
      }
      await route.fulfill({ json: {} });
    });

    await provide(async (path) => {
      await page.goto(path);
      await page.waitForFunction(() => document.fonts.status === "loaded");
      await expect(
        page.getByRole("button", { name: "Collapse sidebar" }),
      ).toBeVisible();
    });
  },
});

export { expect };
