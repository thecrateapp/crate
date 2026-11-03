import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { expect, test } from "../admin-e2e/fixtures";
import sample from "../../app/web/src/content/admin/stack-map-sample.json";
import stackSnapshot from "../admin-e2e/fixtures/stack-snapshot.json";

const OUT = process.env.SITE_CAPTURE_OUT ?? "test-results/site-capture";
const LOOP_MS = Number(process.env.SITE_CAPTURE_LOOP_MS ?? 8000);
const SWING = 0.32;

type Row = [string, string, string, number, number];

const APPLICATION = sample.application as Row[];
const OBSERVABILITY = sample.observability as Row[];
const PROJECTS = sample.projects;
const WARMUP_MS = 600;

function services() {
  return (
    [
      ["application", APPLICATION],
      ["observability", OBSERVABILITY],
    ] as const
  ).flatMap(([stack, rows]) =>
    rows.map(([service, image, health]) => ({
      id: `${PROJECTS[stack]}/${service}`,
      stack_id: stack,
      service,
      project: PROJECTS[stack],
      container_id: `${service}-sample`,
      container_name: service,
      image,
      runtime_state: "running",
      health,
      status: health === "healthy" ? "Up 6 hours (healthy)" : "Up 6 hours",
      actions: ["restart", "stop"],
    })),
  );
}

function resources() {
  return Object.fromEntries(
    [...APPLICATION, ...OBSERVABILITY].map(([service, , , cpu, memory]) => [
      service,
      { cpu_percent: cpu, memory_mib: memory },
    ]),
  );
}

function snapshot() {
  const inventory = services();
  return {
    ...stackSnapshot,
    snapshot: {
      ...stackSnapshot.snapshot,
      built_at: new Date().toISOString(),
      stale_after: new Date(Date.now() + 3_600_000).toISOString(),
      stale: false,
    },
    stack: {
      available: true,
      total: inventory.length,
      running: inventory.length,
      containers: inventory.map((service) => ({
        id: service.container_id,
        name: service.service,
        image: service.image,
        state: "running",
        status: service.status,
        ports: service.service === "traefik" ? ["443/tcp"] : [],
      })),
    },
    inventory: {
      schema_version: 1,
      availability: "available",
      reason: null,
      host: { id: sample.host.name, name: sample.host.name },
      stacks: [
        {
          id: "application",
          kind: "application",
          project: PROJECTS.application,
        },
        {
          id: "observability",
          kind: "observability",
          project: PROJECTS.observability,
        },
      ],
      services: inventory,
      links: { grafana: null },
    },
  };
}

async function streamSampleActivity(page: Page) {
  await page.addInitScript(
    ({ resources, sample }) => {
      class SampleEventSource extends EventTarget {
        readonly readyState = 1;
        readonly url: string;
        onerror: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onopen: ((event: Event) => void) | null = null;
        timer = 0;

        constructor(url: string | URL) {
          super();
          this.url = String(url);
          let sequence = 0;
          const send = () => {
            const observed = new Date().toISOString();
            const jitter = (value: number) =>
              value > 1 ? Math.max(0, value + ((sequence * 7) % 3) - 1) : value;
            const { activity, host } = sample;
            this.dispatchEvent(
              new MessageEvent("activity", {
                data: JSON.stringify({
                  schema: 1,
                  sequence: ++sequence,
                  observed_at: observed,
                  window_seconds: activity.window_seconds,
                  availability: "available",
                  requests: Object.fromEntries(
                    Object.entries(activity.requests).map(([client, count]) => [
                      client,
                      { count: jitter(count), errors: 0 },
                    ]),
                  ),
                  queues: Object.fromEntries(
                    Object.entries(activity.queues).map(
                      ([queue, completed]) => [
                        queue,
                        { completed: jitter(completed), failed: 0 },
                      ],
                    ),
                  ),
                  projector: { events: jitter(activity.projector_events) },
                  listening: activity.listening,
                  resources: {
                    observed_at: observed,
                    ingress: activity.ingress,
                    host: {
                      cpu_percent: host.cpu_percent,
                      memory_used_gib: host.memory_used_gib,
                      memory_total_gib: host.memory_total_gib,
                    },
                    services: resources,
                  },
                  sources: {
                    requests: "available",
                    queues: "available",
                    projector: "available",
                    listening: "available",
                    resources: "available",
                  },
                }),
              }),
            );
          };
          queueMicrotask(() => {
            this.onopen?.(new Event("open"));
            send();
          });
          this.timer = window.setInterval(send, 2000);
        }

        close() {
          window.clearInterval(this.timer);
        }
      }
      Object.defineProperty(window, "EventSource", {
        configurable: true,
        value: SampleEventSource,
      });
    },
    { resources: resources(), sample },
  );
}

test.use({
  launchOptions: {
    args: (process.env.SITE_CAPTURE_GL ?? "--enable-gpu")
      .split(" ")
      .filter(Boolean),
  },
  viewport: { width: 2048, height: 1280 },
  deviceScaleFactor: 1.5,
});

test.beforeAll(() => {
  rmSync(join(OUT, "frames"), { recursive: true, force: true });
  mkdirSync(join(OUT, "frames"), { recursive: true });
});

async function openStack(page: Page, adminApi, openAdminPage) {
  adminApi.respondTo("/api/admin/stack-snapshot", snapshot());
  await page.addInitScript(() =>
    localStorage.setItem("crate.admin.stack-map.view.v1", "3d"),
  );
  await streamSampleActivity(page);
  await openAdminPage("/stack");
  const map = page.getByRole("region", { name: "Stack topology" });
  await expect(
    map.getByRole("button", { name: "Inspect API" }).first(),
  ).toBeVisible();
  return map;
}

async function open3D(page: Page, adminApi, openAdminPage) {
  const map = await openStack(page, adminApi, openAdminPage);
  const stage = map.locator(".stack-map-3d__stage");
  await expect(map.locator(".stack-map-3d")).toHaveAttribute(
    "data-renderer-state",
    "ready",
  );
  await stage.scrollIntoViewIfNeeded();
  await page.addStyleTag({
    content: ".stack-map-3d__reset { visibility: hidden; }",
  });
  await expect
    .poll(async () => Number(await stage.getAttribute("data-pulses")))
    .toBeGreaterThan(0);
  await page.waitForTimeout(3000);
  return stage;
}

test("3D stack map", async ({ page, adminApi, openAdminPage }) => {
  const stage = await open3D(page, adminApi, openAdminPage);
  await stage.screenshot({ path: join(OUT, "stack-map-3d.png") });
});

test.describe("3D loop", () => {
  test.use({ deviceScaleFactor: 1 });

  test("3D stack map loop", async ({ page, adminApi, openAdminPage }) => {
    test.setTimeout(180_000);
    const stage = await open3D(page, adminApi, openAdminPage);
    const box = (await stage.boundingBox())!;
    writeFileSync(
      join(OUT, "loop-crop.txt"),
      [box.width, box.height, box.x, box.y].map(Math.round).join(":"),
    );
    const cdp = await page.context().newCDPSession(page);
    const frames: { file: string; at: number }[] = [];
    let recording = false;
    cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
      if (!recording) {
        await cdp
          .send("Page.screencastFrameAck", { sessionId })
          .catch(() => {});
        return;
      }
      const file = `${String(frames.length).padStart(4, "0")}.jpg`;
      frames.push({ file, at: metadata.timestamp ?? Date.now() / 1000 });
      writeFileSync(join(OUT, "frames", file), Buffer.from(data, "base64"));
      await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
    const x = box.x + box.width * 0.5;
    const y = box.y + box.height * 0.94;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92 });
    await page.waitForTimeout(WARMUP_MS);
    recording = true;
    const started = Date.now();
    while (Date.now() - started < LOOP_MS) {
      const phase = (Date.now() - started) / LOOP_MS;
      await page.mouse.move(
        x - (SWING / 0.006) * Math.sin(2 * Math.PI * phase),
        y,
      );
      await page.waitForTimeout(16);
    }
    await page.mouse.move(x, y);
    await page.waitForTimeout(200);
    await cdp.send("Page.stopScreencast");
    await page.mouse.up();
    const list = frames.flatMap((frame, index) => {
      const next = frames[index + 1]?.at ?? frame.at + 0.04;
      return [
        `file 'frames/${frame.file}'`,
        `duration ${Math.max(0.001, next - frame.at).toFixed(4)}`,
      ];
    });
    writeFileSync(join(OUT, "frames.txt"), `${list.join("\n")}\n`);
    console.log(`${frames.length} frames over ${LOOP_MS} ms`);
  });
});
