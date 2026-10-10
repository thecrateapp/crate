import { useEffect, useState } from "react";

import { api } from "@/lib/api";

export interface TaskTypeEntry {
  type: string;
  label: string;
  category: string;
}

export interface TaskActionEntry {
  id: string;
  label: string;
  task_type: string;
  task_label: string;
  category: string;
  path: string;
  capability: string;
  icon: string;
  body: Record<string, unknown> | null;
}

export interface TaskCatalog {
  categories: Record<string, string>;
  types: TaskTypeEntry[];
  actions: TaskActionEntry[];
}

let catalog: TaskCatalog | null = null;
let pending: Promise<TaskCatalog> | null = null;
const labels = new Map<string, string>();

export function loadTaskCatalog(): Promise<TaskCatalog> {
  if (catalog) return Promise.resolve(catalog);
  pending ??= api<TaskCatalog>("/api/admin/task-catalog")
    .then((loaded) => {
      catalog = loaded;
      labels.clear();
      for (const entry of loaded.types) labels.set(entry.type, entry.label);
      return loaded;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function resetTaskCatalogForTests() {
  catalog = null;
  pending = null;
  labels.clear();
}

export function taskLabel(taskType: string): string {
  return (
    labels.get(taskType) ??
    taskType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export function useTaskCatalog(): TaskCatalog | null {
  const [loaded, setLoaded] = useState<TaskCatalog | null>(catalog);

  useEffect(() => {
    if (catalog) return;
    let alive = true;
    loadTaskCatalog()
      .then((value) => {
        if (alive) setLoaded(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return loaded;
}
