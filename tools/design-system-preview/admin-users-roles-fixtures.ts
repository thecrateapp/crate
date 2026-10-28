import usersFixture from "../../tests/admin-e2e/fixtures/users-1am.json";
import rolesFixture from "../../tests/admin-e2e/fixtures/roles-1al.json";

export class ApiError extends Error {}

export type Sample = "ready" | "loading" | "empty" | "error";

interface ReviewState {
  sample: Sample;
  pending: boolean;
  action: string;
}

type FixtureUser = (typeof usersFixture.users)[number] & {
  username: string | null;
};

let state: ReviewState = {
  sample: "ready",
  pending: false,
  action: "Muestra lista; no hay una sesión de backend conectada.",
};
let users: FixtureUser[] = [];
let details = new Map<number, Record<string, unknown>>();
let finishRead: (() => void) | undefined;
let failNextRead = false;
const listeners = new Set<() => void>();

function resetUsers() {
  users = structuredClone(usersFixture.users) as FixtureUser[];
  details = new Map(
    users.map((user) => [
      user.id,
      {
        ...structuredClone(user),
        bio: usersFixture.detail.bio,
        sessions:
          user.id === usersFixture.detail.id
            ? structuredClone(usersFixture.detail.sessions)
            : [],
      },
    ]),
  );
}

resetUsers();

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function snapshot() {
  return state;
}

function emit() {
  for (const listener of listeners) listener();
}

export function setSample(sample: Sample) {
  if (state.pending) return;
  resetUsers();
  failNextRead = sample === "error";
  state = {
    sample,
    pending: false,
    action:
      sample === "error"
        ? "La próxima lectura fallará una vez; al reintentar se recuperará."
        : "Muestra reiniciada.",
  };
  emit();
}

export function completeRead() {
  const finish = finishRead;
  if (!finish) return;
  finishRead = undefined;
  finish();
}

function response(path: string) {
  if (path === "/api/auth/users")
    return state.sample === "empty" ? [] : structuredClone(users);
  if (path === "/api/auth/roles")
    return state.sample === "empty"
      ? { roles: [], capabilities: [] }
      : structuredClone(rolesFixture);
  return undefined;
}

function updateUser(id: number, patch: Record<string, unknown>) {
  const detail = details.get(id);
  if (!detail) throw new ApiError("Unknown review user");
  Object.assign(detail, patch);
  users = users.map((user) =>
    user.id === id ? ({ ...user, ...patch } as FixtureUser) : user,
  );
  return structuredClone(detail);
}

export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  options?: RequestInit,
): Promise<T> {
  if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

  if (
    method === "GET" &&
    ["/api/auth/users", "/api/auth/roles"].includes(path)
  ) {
    if (failNextRead) {
      failNextRead = false;
      state = {
        ...state,
        action: "Fallo de lectura local; puedes reintentar.",
      };
      emit();
      throw new ApiError("Sample read failed");
    }
    if (state.sample === "loading") {
      state = {
        ...state,
        pending: true,
        action: "Lectura pendiente; complétala desde los controles de muestra.",
      };
      emit();
      return new Promise<T>((resolve) => {
        finishRead = () => {
          state = {
            ...state,
            sample: "ready",
            pending: false,
            action: "Lectura de muestra completada.",
          };
          emit();
          resolve(structuredClone(response(path)) as T);
        };
      });
    }
    return structuredClone(response(path)) as T;
  }

  if (path === "/api/auth/users" && method === "POST") {
    const values = body as { email: string; name?: string; roles?: string[] };
    const source = usersFixture.users[1]!;
    const user = {
      ...structuredClone(source),
      id: Math.max(0, ...users.map((candidate) => candidate.id)) + 1,
      email: values.email,
      name: values.name ?? values.email,
      role: values.roles?.[0] ?? "user",
      roles: values.roles ?? ["user"],
      username: null,
    } as unknown as FixtureUser;
    users = [...users, user];
    details.set(user.id, {
      ...user,
      bio: "Local review account.",
      sessions: [],
    });
    return structuredClone(user) as T;
  }

  if (path === "/api/admin/auth/invites" && method === "POST") {
    const values = body as { email: string };
    return {
      token: "local-review-invite",
      email: values.email,
      expires_at: "2026-11-05T12:00:00Z",
      max_uses: 1,
      use_count: 0,
    } as T;
  }

  const match = path.match(/^\/api\/auth\/users\/(\d+)(.*)$/);
  if (match) {
    const id = Number(match[1]);
    const suffix = match[2] ?? "";
    const detail = details.get(id);
    if (!detail) throw new ApiError("Unknown review user");
    if (method === "GET" && suffix === "") return structuredClone(detail) as T;
    if (method === "PATCH" && suffix === "/role") {
      const roles = (body as { roles: string[] }).roles;
      return updateUser(id, { roles, role: roles[0] ?? "user" }) as T;
    }
    if (method === "PATCH" && suffix === "/status")
      return updateUser(id, body as Record<string, unknown>) as T;
    if (method === "DELETE" && suffix === "") {
      updateUser(id, { status: "deleted" });
      return undefined as T;
    }
    if (method === "DELETE" && suffix.startsWith("/sessions/")) {
      const sessionId = suffix.slice("/sessions/".length);
      detail.sessions = (detail.sessions as { id: string }[]).filter(
        (session) => session.id !== sessionId,
      );
      return undefined as T;
    }
    if (method === "POST" && suffix === "/sessions/revoke-all") {
      const sessions = detail.sessions as { revoked_at?: string | null }[];
      const revoked = sessions.filter((session) => !session.revoked_at).length;
      detail.sessions = sessions.map((session) => ({
        ...session,
        revoked_at: "2026-10-22T12:00:00Z",
      }));
      return { revoked } as T;
    }
    if (method === "POST" && suffix === "/set-password") {
      updateUser(id, { has_password: true });
      const values = body as { revoke_all_sessions?: boolean };
      const sessions = detail.sessions as { revoked_at?: string | null }[];
      const revoked = values.revoke_all_sessions
        ? sessions.filter((session) => !session.revoked_at).length
        : 0;
      if (values.revoke_all_sessions) {
        detail.sessions = sessions.map((session) => ({
          ...session,
          revoked_at: "2026-10-22T12:00:00Z",
        }));
      }
      return { revoked } as T;
    }
  }

  throw new ApiError(`Unsupported local review request ${method} ${path}`);
}
