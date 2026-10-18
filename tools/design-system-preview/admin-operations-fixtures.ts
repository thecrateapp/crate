import logsFixture from "../../tests/admin-e2e/fixtures/logs-snapshot.json";
import stackFixture from "../../tests/admin-e2e/fixtures/stack-snapshot.json";
export type OperationSample = "ready" | "loading" | "empty" | "offline";
let mode: OperationSample = "ready";
let stack = structuredClone(stackFixture);
let outcome = "Sin acciones de muestra.";
const listeners = new Set<() => void>();
const pending: (() => void)[] = [];
const streams = new Set<SampleEventSource>();
export function setOperationSample(next: OperationSample) {
  mode = next;
  stack = structuredClone(stackFixture);
  pending.length = 0;
  outcome = "Sin acciones de muestra.";
  listeners.forEach((listener) => listener());
}
export function subscribeOperationSample(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function operationOutcome() {
  return outcome;
}
export function completeOperationActions() {
  pending.splice(0).forEach((complete) => complete());
}
export function isOperationPath(path: string) {
  return /^\/api\/(?:admin\/(?:logs-snapshot|stack-snapshot)|stack\/container\/)/.test(
    path,
  );
}
function logSnapshot() {
  return mode === "empty"
    ? { logs: [], workers: [] }
    : {
        ...logsFixture,
        workers: logsFixture.workers.map((worker, index) =>
          index ? worker : { ...worker, last_seen: new Date().toISOString() },
        ),
      };
}
function stackSnapshot() {
  return mode === "empty"
    ? {
        ...stack,
        stack: { available: true, running: 0, total: 0, containers: [] },
      }
    : mode === "offline"
      ? {
          ...stack,
          stack: { available: false, running: 0, total: 0, containers: [] },
        }
      : stack;
}
export async function operationApi(path: string, method: string) {
  if (method === "GET") {
    if (mode === "loading") return new Promise(() => {});
    if (path.startsWith("/api/admin/logs-snapshot")) {
      if (mode === "offline") throw new Error("Sample unavailable");
      return logSnapshot();
    }
    if (path.startsWith("/api/admin/stack-snapshot")) return stackSnapshot();
    return {
      name: path.split("/")[4],
      logs: "2026-10-17T12:00:00Z Sample service log\n2026-10-17T12:01:00Z Sample queue ready",
    };
  }
  outcome = `${method} ${path} · muestra local`;
  listeners.forEach((listener) => listener());
  return new Promise((resolve) => {
    pending.push(() => {
      const [, name, action] = path.match(/\/container\/([^/]+)\/(\w+)$/) ?? [];
      const container = stack.stack.containers.find(
        (item) => item.name === name,
      );
      if (container && (action === "start" || action === "stop")) {
        container.state = action === "start" ? "running" : "exited";
        container.status =
          action === "start" ? "Up · sample" : "Exited · sample";
        stack.stack.running = stack.stack.containers.filter(
          (item) => item.state === "running",
        ).length;
      }
      streams.forEach((stream) => stream.emit());
      resolve({ ok: true });
    });
  });
}
export class SampleEventSource {
  readonly readyState = 1;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(readonly url: string) {
    streams.add(this);
  }
  close() {
    streams.delete(this);
  }
  emit() {
    this.onmessage?.({
      data: JSON.stringify(
        this.url.includes("logs-stream") ? logSnapshot() : stackSnapshot(),
      ),
      origin: window.location.origin,
    } as MessageEvent);
  }
}
