import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test as base, type Page, type Route } from "@playwright/test";

const fixtureDir = join(__dirname, "fixtures");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), "utf8"));
}

const JSON_FIXTURES: Record<string, string> = {
  "/api/search": "search",
  "/api/auth/me": "auth-me",
  "/api/auth/roles": "auth-roles",
  "/api/admin/llm/status": "llm-status",
  "/api/admin/ops-snapshot": "ops-snapshot",
  "/api/admin/tasks-snapshot": "tasks-snapshot",
  "/api/admin/logs-snapshot": "logs-snapshot",
  "/api/admin/stack-snapshot": "stack-snapshot",
  "/api/admin/playback-delivery": "playback-delivery",
  "/api/admin/task-catalog": "task-catalog",
  "/api/settings": "settings",
  "/api/admin/health-snapshot": "health-snapshot",
  "/api/manage/repair-catalog": "repair-catalog",
  "/api/genres": "genres",
  "/api/genres/sound-intelligence/health": "genre-sound-health",
  "/api/genres/taxonomy/tree": "genre-taxonomy-tree",
  "/api/artist-slugs/quicksand/albums/crystallize": "album",
  "/api/admin/metrics/dashboard": "metrics-dashboard",
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
      if (responses.has(url.pathname)) {
        await route.fulfill({ json: responses.get(url.pathname) });
        return;
      }
      if (name) {
        await route.fulfill({ json: fixture(name) });
        return;
      }
      if (url.pathname === "/api/setup/status") {
        await route.fulfill({ json: { needs_setup: false } });
        return;
      }
      if (
        url.pathname === "/api/genres/unmapped" ||
        url.pathname === "/api/albums/68/related"
      ) {
        await route.fulfill({ json: [] });
        return;
      }
      if (url.pathname === "/api/genres/taxonomy/invalid") {
        await route.fulfill({
          json: { invalid_count: 0, alias_count: 0, edge_count: 0, items: [] },
        });
        return;
      }
      if (url.pathname === "/api/artists/23/analysis-data") {
        await route.fulfill({ json: {} });
        return;
      }
      const taskDetail = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskDetail) {
        await route.fulfill({
          json: {
            id: decodeURIComponent(taskDetail[1]),
            type: "e2e_task",
            status: "completed",
            progress: null,
            error: null,
            result: {},
            params: {},
            created_at: "2026-10-10T20:00:00Z",
            started_at: "2026-10-10T20:00:01Z",
            updated_at: "2026-10-10T20:00:02Z",
          },
        });
        return;
      }
      if (url.pathname === "/api/admin/agent-plans/summary") {
        await route.fulfill({ json: { awaiting_approval: 0 } });
        return;
      }
      if (url.pathname === "/api/admin/governor") {
        await route.fulfill({ json: { available: false, stale: false } });
        return;
      }
      if (url.pathname === "/api/admin/smart-mix/status") {
        await route.fulfill({
          json: {
            profileVersion: 2,
            analyzerVersion: "smart-mix-v2",
            totalTracks: 1200,
            currentProfiles: 900,
            staleProfiles: 0,
            outdatedProfiles: 60,
            sourceChangedProfiles: 0,
            missingProfiles: 240,
            coveragePercent: 75,
            quality: { full: 820, partial: 70, legacy: 60, unavailable: 10 },
            currentQuality: { full: 820, partial: 70, legacy: 10 },
            processing: {
              pending: 0,
              active: 0,
              failed: 0,
              exhausted: 0,
              completed: 960,
            },
            versions: [
              { analyzerVersion: "smart-mix-v2", profiles: 900, current: true },
              { analyzerVersion: "smart-mix-v1", profiles: 60, current: false },
            ],
            refreshedAt: "2026-10-24T12:00:00Z",
            controlState: "idle",
            campaign: null,
            activeTask: null,
          },
        });
        return;
      }
      if (url.pathname === "/api/admin/smart-mix/activity") {
        await route.fulfill({
          json: {
            queued: 0,
            running: [],
            recent: [],
            tracksPerMinute: 0,
            rateWindowMinutes: 10,
          },
        });
        return;
      }
      if (url.pathname === "/api/admin/smart-mix/tracks") {
        await route.fulfill({
          json: {
            tracks: [
              {
                trackId: 901,
                trackEntityUid: null,
                title: "Litoral",
                artist: "Arrecife",
                album: "Bajamar",
                status: "current",
                analyzerVersion: "smart-mix-v2",
                profileVersion: 2,
                quality: "full",
                bpm: 122,
                introBpm: 122,
                outroBpm: 122,
                analyzedAt: "2026-10-24T11:40:00Z",
                sourceStaleAt: null,
                processingState: "completed",
                processingAttempts: 1,
                processingError: null,
              },
              {
                trackId: 902,
                trackEntityUid: null,
                title: "Resaca",
                artist: "Arrecife",
                album: "Bajamar",
                status: "missing",
                analyzerVersion: null,
                profileVersion: null,
                quality: null,
                bpm: null,
                introBpm: null,
                outroBpm: null,
                analyzedAt: null,
                sourceStaleAt: null,
                processingState: null,
                processingAttempts: null,
                processingError: null,
              },
            ],
            nextBefore: null,
          },
        });
        return;
      }
      if (url.pathname === "/api/capabilities") {
        await route.fulfill({
          json: {
            smart_mix: {
              available: false,
              planner_version: null,
              android_native_crossfade: false,
              android_beatmatch: false,
              android_bass_handoff: false,
            },
            vdj: {
              available: false,
              min_plugin_version: "1.0.0",
              max_plugin_version: "1.x",
              contract_version: "2026-08",
              profile_schema_version: 1,
              planner_version: "smart-mix-v2",
              online_source: false,
              smart_mix_assistant: false,
              automation: false,
            },
          },
        });
        return;
      }
      const aiAction = url.pathname.match(
        /^\/api\/admin\/ai\/actions\/([^/]+)\/availability$/,
      );
      if (aiAction) {
        await route.fulfill({
          json: {
            action_id: decodeURIComponent(aiAction[1]),
            available: true,
            status: "configured",
            provider: "gemini",
            model_id: "gemini/gemini-2.5-flash",
            fingerprint: null,
            error_code: null,
          },
        });
        return;
      }
      if (
        /^\/api\/albums\/(68|69|71)\/cover$/.test(url.pathname) ||
        url.pathname === "/api/artists/23/background"
      ) {
        await route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><defs><linearGradient id="a"><stop stop-color="#13343d"/><stop offset="1" stop-color="#0a0a0f"/></linearGradient></defs><path fill="url(#a)" d="M0 0h1200v800H0z"/><circle cx="850" cy="300" r="230" fill="#06b6d4" opacity=".2"/><text x="70" y="710" fill="#f1f5f9" font-size="72" font-family="sans-serif">Crystallize</text></svg>',
        });
        return;
      }
      throw new Error(`Unhandled Admin API fixture: ${url.pathname}`);
    });

    await provide(async (path) => {
      await page.goto(path);
      await page.waitForFunction(() => document.fonts.status === "loaded");
      const desktopNavigation = await page.evaluate(
        () => window.matchMedia("(min-width: 768px)").matches,
      );
      await expect(
        page.getByRole("button", {
          name: desktopNavigation ? "Collapse sidebar" : "Open navigation",
          exact: true,
        }),
      ).toBeVisible();
    });
  },
});

export async function emulateCoarsePointer(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  await expect
    .poll(() => page.evaluate(() => matchMedia("(pointer: coarse)").matches))
    .toBe(true);
}

export { expect };
