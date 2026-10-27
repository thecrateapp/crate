import type { Page } from "@playwright/test";
import type { Device, Director } from "../../director";
import { adminScene, type AdminScene } from "../scenes/admin";
import { stageJson, stageStream } from "../stage";
import type { Take, Takes } from "../takes";

type Json = Record<string, any>;

function liveWork(live: Json, scene: AdminScene) {
  const brief = (task: AdminScene["running"][number]) => ({
    id: task.id,
    type: task.type,
    status: task.status,
    pool: task.pool,
    progress: JSON.stringify(task.progress),
    created_at: task.created_at,
    started_at: task.started_at,
    updated_at: task.updated_at,
  });
  live.running_tasks = scene.running.map(brief);
  live.pending_tasks = scene.pending.map(brief);
  live.queue_breakdown = scene.queueBreakdown;
  if (live.worker_slots)
    live.worker_slots = { ...live.worker_slots, active: scene.running.length };
}

export function stageOps(real: unknown, scene: AdminScene): unknown {
  const data = structuredClone(real) as Json;
  if (data.live) liveWork(data.live, scene);
  if (data.status)
    data.status = { ...data.status, running_tasks: scene.running.length };
  if (data.stats)
    data.stats = { ...data.stats, pending_tasks: scene.pending.length };
  if (data.analysis) {
    data.analysis = {
      ...data.analysis,
      analysis_active: scene.analysis.active,
      analysis_pending: scene.analysis.pending,
      bliss_pending: scene.analysis.pending,
    };
  }
  if (Array.isArray(data.history)) {
    const staged = [...scene.running, ...scene.pending].map((task) => ({
      ...task,
      error: null,
      params: {},
      result: null,
      priority: 2,
      cancellation_requested_at: null,
      cancellation_acknowledged_at: null,
    }));
    data.history = [...staged, ...data.history];
  }
  return data;
}

export function stageAcquisition(real: unknown, scene: AdminScene): unknown {
  const data = structuredClone(real) as Json;
  const template =
    (Array.isArray(data.tidal_queue) && data.tidal_queue[0]) || {};
  const created = new Date().toISOString();
  data.tidal_queue = [
    ...scene.tidal.map((item, index) => ({
      ...template,
      id: 900000 + index,
      title: item.title,
      artist: item.artist,
      status: item.status,
      error: null,
      cover_url: null,
      created_at: created,
      completed_at: null,
    })),
    ...(data.tidal_queue ?? []),
  ];
  data.soulseek_queue = scene.soulseek.map((file) => ({
    source: "soulseek",
    username: "crate-peer",
    fullPath: `Music\\Moderat\\MORE D4TA\\${file.filename}`,
    ...file,
  }));
  return data;
}

function staged(page: Page, startedAt: number) {
  const scene = () => adminScene((Date.now() - startedAt) / 1000);
  return Promise.all([
    stageJson(page, /\/api\/admin\/(ops|tasks)-snapshot/, (real) =>
      stageOps(real, scene()),
    ),
    stageStream(page, /\/api\/admin\/(ops|tasks)-stream/, (real) =>
      stageOps(real, scene()),
    ),
    stageJson(page, /\/api\/acquisition\/snapshot/, (real) =>
      stageAcquisition(real, scene()),
    ),
    stageStream(page, /\/api\/acquisition\/stream/, (real) =>
      stageAcquisition(real, scene()),
    ),
  ]);
}

async function blurFocus(director: Director) {
  await director.page.evaluate(
    "document.activeElement && document.activeElement.blur()",
  );
}

function take(
  start: string,
  run: Take["run"],
  devices: Device[] = ["desktop"],
  extra?: (page: Page) => Promise<void>,
): Take {
  return {
    app: "admin",
    devices,
    start: () => start,
    async prepare(page) {
      await staged(page, Date.now());
      if (extra) await extra(page);
    },
    run,
  };
}

async function hold(director: Director, ms: number, scrollBy = 0) {
  await blurFocus(director);
  await director.pause(700);
  if (scrollBy) await director.scroll(scrollBy);
  await director.pause(ms);
}

export const TAKES: Takes = {
  health: take("/", (director) => hold(director, 3500, 380), [
    "desktop",
    "mobile",
  ]),
  imports: take(
    "/download",
    async (director) => {
      await blurFocus(director);
      await director.click(
        director.page
          .getByRole("tab", { name: "Queue" })
          .or(director.page.getByText("Queue", { exact: true }))
          .first(),
      );
      await director.pause(4000);
    },
    ["desktop", "mobile"],
  ),
  enrichment: take("/tasks", (director) => hold(director, 4500, 260), [
    "desktop",
    "mobile",
  ]),
  "analysis-queue": take("/analysis", (director) => hold(director, 4500, 300)),
  analysis: take(
    "/artists/kompromat",
    async (director) => {
      await blurFocus(director);
      await director.pause(900);
      for (const tab of [
        /^top tracks$/i,
        /^similar artists$/i,
        /^stats$/i,
        /^overview$/i,
      ]) {
        await director.click(
          director.page
            .getByRole("tab", { name: tab })
            .or(director.page.getByRole("button", { name: tab }))
            .filter({ visible: true })
            .first(),
        );
        await director.pause(600);
      }
    },
    ["desktop", "mobile"],
  ),
  acquisition: take(
    "/download",
    async (director) => {
      await blurFocus(director);
      const search = director.page.getByPlaceholder("Artist, album, or track");
      await director.click(search);
      await search.pressSequentially("Kompromat", { delay: 70 });
      await search.press("Enter");
      await director.pause(4000);
    },
    ["desktop"],
    async (page) => {
      await page.route(/\/api\/acquisition\/search\/soulseek$/, (route) =>
        route.fulfill({ json: { search_id: "film-search" } }),
      );
      await page.route(
        /\/api\/acquisition\/search\/soulseek\/film-search\/stream/,
        (route) =>
          route.fulfill({
            status: 200,
            headers: { "content-type": "text/event-stream" },
            body: "retry: 60000\n\n",
          }),
      );
    },
  ),
  agents: take(
    "/agents/connections",
    (director) => hold(director, 3000),
    ["desktop", "mobile"],
    (page) =>
      stageJson(page, /\/api\/admin\/agent-integrations/, (real) =>
        JSON.parse(
          JSON.stringify(real).replaceAll("Crate Hermes Agent", "Crate Agent"),
        ),
      ),
  ),
  stats: take("/system", (director) => hold(director, 3000), [
    "desktop",
    "mobile",
  ]),
  browse: take("/browse", (director) => hold(director, 2500, 300), [
    "desktop",
    "mobile",
  ]),
  "release-radar": take(
    "/new-releases",
    (director) => hold(director, 2500, 200),
    ["desktop", "mobile"],
  ),
  "system-playlists": take(
    "/playlists",
    (director) => hold(director, 2500, 200),
    ["desktop", "mobile"],
  ),
  "library-health": take("/health", (director) => hold(director, 2500, 200), [
    "desktop",
    "mobile",
  ]),
  album: take(
    "/artists/kompromat/plying-prying",
    (director) => hold(director, 2500, 420),
    ["desktop", "mobile"],
  ),
  stack: take("/stack", (director) => hold(director, 2500, 200), [
    "desktop",
    "mobile",
  ]),
};
