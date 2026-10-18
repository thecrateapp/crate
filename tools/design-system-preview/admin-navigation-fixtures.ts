import { isOperationPath, operationApi } from "./admin-operations-fixtures";
// Only the preview Vite config redirects these Admin dependencies here.
// No network or live notification effects are mounted in the isolated demo.
export const calls: { path: string; method: string; body: unknown }[] = [];
let llmAvailable = true;
let pendingSearch: ((result: unknown) => void) | undefined;
export function setLlmAvailable(value: boolean) {
  llmAvailable = value;
}
const searchResults = {
  artists: [{ slug: "costa-norte", name: "Costa Norte" }],
  albums: [
    { slug: "luz-de-octubre", artist: "Costa Norte", name: "Luz de octubre" },
  ],
  tracks: [{ title: "Marea", artist: "Costa Norte", album: "Luz de octubre" }],
};
export function completeSearch() {
  pendingSearch?.(searchResults);
  pendingSearch = undefined;
}
export async function api(path: string, method = "GET", body?: unknown) {
  calls.push({ path, method, body });
  if (isOperationPath(path)) return operationApi(path, method);
  if (method !== "GET") return { task_id: "preview-task" };
  if (path === "/api/admin/llm/status")
    return { available: llmAvailable, model: "sample", provider: "sample" };
  if (path === "/api/admin/task-catalog")
    return {
      categories: { library: "Library" },
      types: [],
      actions: [
        {
          id: "sync-library",
          label: "Sync Library",
          task_type: "sync_library",
          task_label: "Sync Library",
          category: "library",
          path: "/api/tasks/sync-library",
          capability: "library.import.manage",
          icon: "refresh",
          body: null,
        },
      ],
    };
  if (path.startsWith("/api/search")) {
    const query =
      new URLSearchParams(path.split("?")[1]).get("q")?.toLowerCase() ?? "";
    if (query.includes("vacio")) return { artists: [], albums: [], tracks: [] };
    if (query.includes("espera"))
      return new Promise((resolve) => {
        pendingSearch = resolve;
      });
    return searchResults;
  }
  return {};
}
export function useOpsSnapshot() {
  return {
    data: { status: { issue_count: 3, running_tasks: 12, pending_imports: 2 } },
  };
}
export function useNotifications() {}
