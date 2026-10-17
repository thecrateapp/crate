// Only the preview Vite config redirects these Admin dependencies here.
// No network or live notification effects are mounted in the isolated demo.
export const calls: { path: string; method: string; body: unknown }[] = [];
export async function api(path: string, method = "GET", body?: unknown) {
  calls.push({ path, method, body });
  if (method !== "GET") return { task_id: "preview-task" };
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
  if (path.startsWith("/api/search"))
    return {
      artists: [{ id: 7, slug: "costa-norte", name: "Costa Norte" }],
      albums: [
        {
          id: 9,
          slug: "luz-de-octubre",
          artist: "Costa Norte",
          name: "Luz de octubre",
        },
      ],
      tracks: [],
    };
  return {};
}
export function useOpsSnapshot() {
  return {
    data: { status: { issue_count: 3, running_tasks: 12, pending_imports: 2 } },
  };
}
export function useNotifications() {}
