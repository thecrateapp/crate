import fixture from "../../tests/admin-e2e/fixtures/translations-1an.json";
export type Sample = "ready" | "loading" | "empty" | "no-ai";
let state = {
  sample: "ready" as Sample,
  pending: 0,
  failNext: false,
  workspace: false,
  action: "Sin acciones de muestra.",
};
const listeners = new Set<() => void>();
let responses: Record<string, unknown> = structuredClone(fixture);
let finishers: (() => void)[] = [];
const root = "/api/admin/i18n/listen";
type Bundle = (typeof fixture)["/api/admin/i18n/listen/bundles/bundle-es"];
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function snapshot() {
  return state;
}
function emit() {
  for (const fn of listeners) fn();
}
export function setFailure(failNext: boolean) {
  state = { ...state, failNext };
  emit();
}
export function setWorkspace(workspace: boolean) {
  state = { ...state, workspace };
  emit();
}
export function setSample(sample: Sample) {
  if (state.pending) return;
  responses = structuredClone(fixture);
  if (sample === "empty") {
    responses[root + "/requests"] = { aiConfigured: true, requests: [] };
    responses[root + "/bundles"] = { bundles: [] };
  }
  if (sample === "no-ai")
    responses[root + "/requests"] = {
      ...fixture["/api/admin/i18n/listen/requests"],
      aiConfigured: false,
    };
  state = {
    ...state,
    sample,
    failNext: false,
    action: "Sin acciones de muestra.",
  };
  emit();
}
function wait<T>(label: string, perform: () => T): Promise<T> {
  const fail = state.failNext;
  state = {
    ...state,
    pending: state.pending + 1,
    failNext: false,
    action: label,
  };
  emit();
  return new Promise<T>((resolve, reject) => {
    finishers.push(() => {
      state = {
        ...state,
        pending: state.pending - 1,
        action: fail
          ? "Fallo de muestra. Reintenta la acción."
          : label + " · Completado localmente.",
      };
      if (fail) reject(new Error("Intentional translation sample failure"));
      else resolve(perform());
      emit();
    });
  });
}
export function complete() {
  const queue = finishers;
  finishers = [];
  for (const fn of queue) fn();
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const clone = () => structuredClone(responses[path]) as T;
  if (method === "GET" && path in responses) {
    if (state.sample === "loading" && path === root + "/requests")
      return wait("Cargando traducciones de muestra", clone);
    return clone();
  }
  const match =
    /^\/api\/admin\/i18n\/listen\/bundles\/(bundle-es|bundle-fr)\/(publish|reject|messages\/(.+)|export)$/.exec(
      path,
    );
  if (match) {
    const [, id, action, key] = match;
    if (
      (action === "export" && method !== "GET") ||
      ((action === "publish" || action === "reject") && method !== "POST") ||
      (action?.startsWith("messages/") && method !== "PATCH")
    )
      throw new Error("Unsupported sample method");
    return wait(`${method} ${path}`, () => {
      const detail = responses[root + "/bundles/" + id] as Bundle;
      if (action === "export")
        return {
          schema: "crate.i18n.bundle.export.v1",
          locale: detail.locale,
          sourceVersion: detail.sourceVersion,
          bundleVersion: detail.bundleVersion,
          messages: detail.messages,
        } as T;
      const next =
        action === "publish" || action === "reject"
          ? {
              ...detail,
              status: action === "publish" ? "published" : "rejected",
            }
          : {
              ...detail,
              messages: {
                ...detail.messages,
                [decodeURIComponent(key!)]: (body as { value: string }).value,
              },
            };
      responses[root + "/bundles/" + id] = next;
      const list = responses[root + "/bundles"] as { bundles: Bundle[] };
      list.bundles = list.bundles.map((b) =>
        b.id === id ? { ...b, status: next.status } : b,
      );
      return structuredClone(next) as T;
    });
  }
  if (
    method === "POST" &&
    /^\/api\/admin\/i18n\/listen\/locales\/(ca|de|es|eu|fr|it)\/draft-missing$/.test(
      path,
    )
  )
    return wait(
      `${method} ${path}`,
      () => ({ requestId: "request-es", status: "drafting_ai" }) as T,
    );
  throw new Error(`Unsupported translation specimen ${method} ${path}`);
}
// Installed only in this specimen document before mounting the real page. Exact catalog URLs
// are simulated; no real dev server or files are read/written. Other fetch stays untouched.
export function installCatalogSample() {
  const original = window.fetch.bind(window);
  // Match the real page's effective origin, including its supported environment override.
  const origin = (
    import.meta.env.VITE_LISTEN_DEV_ORIGIN ?? "http://127.0.0.1:5174"
  ).replace(/\/$/, "");
  const catalogs = `${origin}/__crate_i18n/catalogs`;
  window.fetch = async (input, init) => {
    const url = String(input);
    if (url === catalogs && init?.method === "GET")
      return new Response(JSON.stringify({ locales: ["es", "fr"] }), {
        status: state.workspace ? 200 : 404,
      });
    if (
      [`${catalogs}/es`, `${catalogs}/fr`].includes(url) &&
      init?.method === "PATCH"
    )
      return wait(
        "PATCH catálogo JSON de muestra",
        () => new Response("{}", { status: 200 }),
      );
    return original(input, init);
  };
  return () => {
    window.fetch = original;
  };
}
