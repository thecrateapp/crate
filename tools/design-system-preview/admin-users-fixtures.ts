import fixture from "../../tests/admin-e2e/fixtures/users-1am.json";
export class ApiError extends Error {}
type Sample = "ready" | "loading" | "empty";
let state = {
  sample: "ready" as Sample,
  pending: false,
  failNext: false,
  action: "Sin acciones de muestra.",
};
type SampleUser = Omit<(typeof fixture.users)[number], "username"> & {
  username: string | null;
};
let users: SampleUser[] = structuredClone(fixture.users);
let details = new Map(
  users.map((user) => [
    user.id,
    {
      ...structuredClone(user),
      bio: fixture.detail.bio,
      sessions: user.id === 1 ? structuredClone(fixture.detail.sessions) : [],
    },
  ]),
);
const listeners = new Set<() => void>();
let finish: (() => void) | undefined;
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function snapshot() {
  return state;
}
function emit() {
  for (const listener of listeners) listener();
}
export function setSample(sample: Sample) {
  if (state.pending) throw new Error("Finish the sample action first");
  users = sample === "empty" ? [] : structuredClone(fixture.users);
  details = new Map(
    users.map((user) => [
      user.id,
      {
        ...structuredClone(user),
        bio: fixture.detail.bio,
        sessions: user.id === 1 ? structuredClone(fixture.detail.sessions) : [],
      },
    ]),
  );
  state = {
    sample,
    pending: false,
    failNext: false,
    action: "Muestra reiniciada.",
  };
  emit();
}
export function setFailure(value: boolean) {
  state = { ...state, failNext: value };
  emit();
}
export function complete() {
  const done = finish;
  if (!done) throw new Error("No pending sample action");
  finish = undefined;
  done();
}
function pending<T>(action: string, run: () => T): Promise<T> {
  if (state.pending) throw new Error("Only one sample action at a time");
  state = { ...state, pending: true, action };
  emit();
  return new Promise((resolve, reject) => {
    finish = () => {
      const fail = state.failNext;
      state = {
        ...state,
        pending: false,
        failNext: false,
        action: fail
          ? "Acción de muestra rechazada."
          : "Acción de muestra completada.",
      };
      if (fail) reject(new ApiError("Fallo ficticio solicitado"));
      else resolve(structuredClone(run()));
      emit();
    };
  });
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  options?: RequestInit,
): Promise<T> {
  if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (path === "/api/auth/users" && method === "GET") {
    if (state.sample === "loading")
      return pending("Lectura de usuarios pendiente.", () => {
        state = { ...state, sample: "ready" };
        return users;
      }) as Promise<T>;
    return structuredClone(users) as T;
  }
  const match = path.match(/^\/api\/auth\/users\/(\d+)(.*)$/);
  if (match) {
    const id = Number(match[1]),
      suffix = match[2] ?? "",
      detail = details.get(id);
    if (!detail) throw new ApiError("Usuario de muestra desconocido");
    if (method === "GET" && suffix === "") return structuredClone(detail) as T;
    if (
      (method === "PATCH" && ["/role", "/status"].includes(suffix)) ||
      (method === "DELETE" &&
        (suffix === "" || suffix.startsWith("/sessions/"))) ||
      (method === "POST" &&
        ["/set-password", "/sessions/revoke-all"].includes(suffix))
    ) {
      return pending("Cambio local de muestra pendiente.", () => {
        const values = (body ?? {}) as Record<string, unknown>;
        if (suffix === "/role") {
          detail.roles = values.roles as string[];
          detail.role = detail.roles[0] ?? "user";
        }
        if (suffix === "/status") {
          detail.status = String(values.status);
          detail.status_reason =
            typeof values.reason === "string" ? values.reason : null;
        }
        if (method === "DELETE" && suffix === "") detail.status = "deleted";
        if (suffix === "/sessions/revoke-all") detail.sessions = [];
        if (method === "DELETE" && suffix.startsWith("/sessions/"))
          detail.sessions = detail.sessions.filter(
            (session) => session.id !== suffix.slice("/sessions/".length),
          );
        if (suffix === "/set-password") {
          detail.has_password = true;
          if (values.revoke_all_sessions) detail.sessions = [];
        }
        users = users.map((user) =>
          user.id === id
            ? {
                ...user,
                role: detail.role,
                roles: detail.roles,
                status: detail.status,
                status_reason: detail.status_reason,
                has_password: detail.has_password,
              }
            : user,
        );
        return suffix === "/set-password" || suffix === "/sessions/revoke-all"
          ? { revoked: 1 }
          : detail;
      }) as Promise<T>;
    }
  }
  if (path === "/api/auth/users" && method === "POST")
    return pending("Creación local de usuario pendiente.", () => {
      const values = body as { email: string; name?: string; roles: string[] };
      const user = {
        ...structuredClone(fixture.users[1]!),
        id: users.length + 100,
        email: values.email,
        name: values.name ?? values.email,
        username: null,
        roles: values.roles,
        role: values.roles[0] ?? "user",
      };
      users.push(user);
      details.set(user.id, {
        ...user,
        bio: "Usuario creado solo en esta muestra.",
        sessions: [],
      });
      return user;
    }) as Promise<T>;
  if (path === "/api/admin/auth/invites" && method === "POST")
    return pending("Invitación local pendiente; no se envía correo.", () => ({
      token: "fictional-local-invite",
      email: (body as { email: string }).email,
      expires_at: "2026-11-01T12:00:00Z",
      max_uses: 1,
      use_count: 0,
    })) as Promise<T>;
  throw new ApiError(`Unsupported Users sample ${method} ${path}`);
}
export function installSampleClipboard() {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => {
        state = {
          ...state,
          action: "Copia simulada en memoria; portapapeles real sin cambios.",
        };
        emit();
      },
    },
  });
}
