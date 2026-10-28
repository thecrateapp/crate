import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("@/lib/api", () => ({
  api: apiMock,
  ApiError: class extends Error {},
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 999 },
    hasCapability: () => true,
    refetch: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { Users } from "./Users";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function account(id: number, name: string) {
  return {
    id,
    name,
    email: `user-${id}@example.com`,
    role: "user",
    roles: ["user"],
    status: "active",
    status_reason: "",
    avatar: null,
    has_password: false,
    connected_accounts: [],
    sessions: [],
    capabilities: [],
    online_now: false,
    listening_now: false,
    active_devices: 0,
    active_sessions: 0,
    current_track: null,
    last_login: null,
    created_at: "2026-10-24T08:00:00Z",
    activity_status: "active",
  };
}
const alice = account(1, "Alice A");
const bob = account(2, "Bob B");
function LocationReadout() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}
function renderUsers() {
  return render(
    <MemoryRouter initialEntries={["/users?inspect=1"]}>
      <LocationReadout />
      <Users />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((path: string, method = "GET", body?: object) => {
    if (path === "/api/auth/users") return Promise.resolve([alice, bob]);
    if (path === "/api/auth/users/1") return Promise.resolve(alice);
    if (path === "/api/auth/users/2") return Promise.resolve(bob);
    if (method === "PATCH") return Promise.resolve({ ...bob, ...body });
    return Promise.reject(new Error(`Unexpected ${method} ${path}`));
  });
});

it("keeps B's detail and next role write scoped to B when A's save resolves after switching users", async () => {
  const user = userEvent.setup();
  const pending = deferred<typeof alice>();
  apiMock.mockImplementation((path: string, method = "GET", body?: object) => {
    if (path === "/api/auth/users") return Promise.resolve([alice, bob]);
    if (path === "/api/auth/users/1") return Promise.resolve(alice);
    if (path === "/api/auth/users/2") return Promise.resolve(bob);
    if (path === "/api/auth/users/1/role") return pending.promise;
    if (path === "/api/auth/users/2/role")
      return Promise.resolve({ ...bob, ...body });
    throw new Error(`Unexpected ${method} ${path}`);
  });
  renderUsers();
  let dialog = await screen.findByRole("dialog", { name: "User Detail" });
  await within(dialog).findByRole("heading", { name: "Alice A" });
  await user.click(within(dialog).getByRole("button", { name: "Admin" }));
  await user.click(within(dialog).getByRole("button", { name: "Save roles" }));
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  await user.click(
    within(screen.getByRole("row", { name: /Bob B/ })).getByRole("button", {
      name: "Inspect",
    }),
  );
  dialog = await screen.findByRole("dialog", { name: "User Detail" });
  await within(dialog).findByRole("heading", { name: "Bob B" });
  await act(async () => {
    pending.resolve({ ...alice, roles: ["admin", "user"] });
    await pending.promise;
  });
  expect(within(dialog).getByRole("heading", { name: "Bob B" })).toBeVisible();
  expect(screen.getByTestId("location")).toHaveTextContent("inspect=2");
  await user.click(within(dialog).getByRole("button", { name: "Curator" }));
  await user.click(within(dialog).getByRole("button", { name: "Save roles" }));
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith("/api/auth/users/2/role", "PATCH", {
      roles: ["curator", "user"],
    }),
  );
});

it("offers a detail retry instead of a blank user dialog after a failed read", async () => {
  const user = userEvent.setup();
  let attempts = 0;
  apiMock.mockImplementation((path: string) => {
    if (path === "/api/auth/users") return Promise.resolve([alice, bob]);
    if (path === "/api/auth/users/1") {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("offline"))
        : Promise.resolve(alice);
    }
    throw new Error(`Unexpected ${path}`);
  });
  renderUsers();
  const dialog = await screen.findByRole("dialog", { name: "User Detail" });
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    /user detail/i,
  );
  await user.click(within(dialog).getByRole("button", { name: "Retry" }));
  expect(
    await within(dialog).findByRole("heading", { name: "Alice A" }),
  ).toBeVisible();
});

it("keeps delete confirmation pending and retryable until the deletion succeeds", async () => {
  const user = userEvent.setup();
  let rejectDelete!: (reason: Error) => void;
  const pendingDelete = new Promise<void>((_resolve, reject) => {
    rejectDelete = reject;
  });
  let deleteAttempts = 0;
  apiMock.mockImplementation((path: string, method = "GET") => {
    if (path === "/api/auth/users") return Promise.resolve([alice, bob]);
    if (path === "/api/auth/users/1") {
      if (method === "DELETE") {
        deleteAttempts += 1;
        return deleteAttempts === 1 ? pendingDelete : Promise.resolve();
      }
      return Promise.resolve(alice);
    }
    throw new Error(`Unexpected ${method} ${path}`);
  });
  render(
    <MemoryRouter>
      <Users />
    </MemoryRouter>,
  );
  const row = await screen.findByRole("row", { name: /Alice A/ });
  await user.click(within(row).getByRole("button", { name: "Delete" }));
  const dialog = await screen.findByRole("alertdialog");
  const confirm = within(dialog).getByRole("button", { name: "Delete" });
  await user.click(confirm);
  expect(dialog).toBeInTheDocument();
  expect(confirm).toBeDisabled();
  await act(async () => {
    rejectDelete(new Error("temporary"));
    await pendingDelete.catch(() => {});
  });
  expect(dialog).toBeInTheDocument();
  expect(confirm).toBeEnabled();
  await user.click(confirm);
  await waitFor(() =>
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
  );
  expect(deleteAttempts).toBe(2);
});
