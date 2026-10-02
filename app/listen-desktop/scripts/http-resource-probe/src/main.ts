import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { expectRequestRejection } from "./expect-request-rejection";

type ProbeFailure = { scenario: string; iteration: number; error: string };

const status = document.querySelector<HTMLElement>("#status");
const iterations = 25;
const failures: ProbeFailure[] = [];
const completedScenarioCounts: Record<string, number> = {};

function recordDiagnostic(message: string): void {
  void invoke("record_probe_diagnostic", { message }).catch(() => undefined);
}

window.addEventListener("error", (event) => {
  recordDiagnostic(`window-error:${event.message}`);
});
window.addEventListener("unhandledrejection", (event) => {
  recordDiagnostic(`unhandled-rejection:${String(event.reason)}`);
});
recordDiagnostic("frontend-module-loaded");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function control(
  origin: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return window.fetch(`${origin}${path}`, init);
}

async function waitForServerEvent(
  origin: string,
  name: string,
  iteration: number,
): Promise<void> {
  const response = await control(
    origin,
    `/wait/${name}?iteration=${iteration}`,
  );
  assert(response.ok, `fixture did not signal ${name}`);
}

async function releaseScenario(origin: string, name: string): Promise<void> {
  const response = await control(origin, `/release/${name}`, {
    method: "POST",
  });
  assert(response.ok, `fixture did not release ${name}`);
}

async function waitForZeroResources(): Promise<number> {
  const deadline = performance.now() + 5_000;
  let count = await invoke<number>("resource_count");
  while (count !== 0 && performance.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 10));
    count = await invoke<number>("resource_count");
  }
  return count;
}

async function runScenario(
  origin: string,
  name: string,
  exercise: (iteration: number) => Promise<void>,
): Promise<void> {
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    try {
      const before = await waitForZeroResources();
      assert(
        before === 0,
        `resource table was not empty before request: ${before}`,
      );
      await exercise(iteration);
      const after = await waitForZeroResources();
      assert(after === 0, `resource table retained ${after} resources`);
    } catch (error) {
      failures.push({
        scenario: name,
        iteration,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (status) status.textContent = `${name}: ${iteration}/${iterations}`;
  }
  completedScenarioCounts[name] = iterations;
  await releaseScenario(origin, name);
}

async function run(): Promise<void> {
  let origin = "";
  try {
    recordDiagnostic("probe-run-started");
    origin = await invoke<string>("fixture_origin");
    recordDiagnostic("fixture-origin-received");
    const refusedOrigin = await invoke<string>("refused_origin");
    await runScenario(origin, "consumed-200", async () => {
      const response = await tauriFetch(`${origin}/ok`);
      assert(response.status === 200, `unexpected status ${response.status}`);
      assert(
        (await response.text()) === "resource-body",
        "unexpected response body",
      );
    });
    await runScenario(origin, "consumed-500", async () => {
      const response = await tauriFetch(`${origin}/error`);
      assert(response.status === 500, `unexpected status ${response.status}`);
      assert(
        (await response.text()) === "server-error",
        "unexpected error body",
      );
    });
    await runScenario(origin, "connection-refused", async () => {
      await expectRequestRejection(
        tauriFetch(refusedOrigin),
        "connection-refused request unexpectedly succeeded",
      );
    });
    await runScenario(origin, "bodyless-204", async () => {
      const response = await tauriFetch(`${origin}/empty`);
      assert(response.status === 204, `unexpected status ${response.status}`);
      assert(response.body === null, "204 response unexpectedly has a body");
    });
    await runScenario(origin, "abort-before-headers", async (iteration) => {
      const controller = new AbortController();
      const request = tauriFetch(`${origin}/delayed`, {
        signal: controller.signal,
      });
      await waitForServerEvent(origin, "delayed-started", iteration);
      controller.abort();
      await request.then(
        () => {
          throw new Error("aborted request unexpectedly succeeded");
        },
        () => undefined,
      );
    });
    await runScenario(origin, "cancel-after-first-chunk", async () => {
      const response = await tauriFetch(`${origin}/stream`);
      assert(response.status === 200, `unexpected status ${response.status}`);
      assert(response.body !== null, "stream response has no body");
      const reader = response.body.getReader();
      const firstChunk = await reader.read();
      assert(!firstChunk.done, "stream ended before its first chunk");
      assert(
        new TextDecoder().decode(firstChunk.value) === "first",
        "unexpected first stream chunk",
      );
      await reader.cancel();
    });

    const report = {
      passed: failures.length === 0,
      iterationsPerScenario: iterations,
      resourceBaseline: 0,
      failures,
      completedScenarioCounts,
      scenarios: [
        "consumed-200",
        "consumed-500",
        "connection-refused",
        "bodyless-204",
        "abort-before-headers",
        "cancel-after-first-chunk",
      ],
    };
    const posted = await window.fetch(`${origin}/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
    assert(posted.ok, "fixture rejected the probe report");
    await invoke("finish_probe", { report });
  } catch (error) {
    recordDiagnostic(
      `probe-error:${error instanceof Error ? error.message : String(error)}`,
    );
    failures.push({
      scenario: "probe-setup",
      iteration: 0,
      error: error instanceof Error ? error.message : String(error),
    });
    if (origin) {
      try {
        await window.fetch(`${origin}/result`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            passed: false,
            iterationsPerScenario: iterations,
            resourceBaseline: 0,
            failures,
            completedScenarioCounts,
          }),
        });
        await invoke("finish_probe", { report: { passed: false, failures } });
      } catch {
        // The runner will report a timeout and preserve the application log.
      }
    }
  }
}

void run();
