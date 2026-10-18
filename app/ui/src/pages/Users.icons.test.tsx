import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router";
import fixture from "../../../../tests/admin-e2e/fixtures/users-1am.json";
const { apiMock, caps, errors } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  caps: new Set<string>(),
  errors: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  api: apiMock,
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 999 },
    refetch: vi.fn(),
    hasCapability: (cap: string) => caps.has("*") || caps.has(cap),
  }),
}));
vi.mock("@/components/users/UserMap", () => ({
  UserMap: () => <div data-testid="removed-map" />,
}));
vi.mock("sonner", () => ({ toast: { error: errors, success: vi.fn() } }));
import { Users } from "./Users";
function Location() {
  const location = useLocation();
  return <output data-testid="url">{location.search}</output>;
}
function open(entry = "/users?node=sample") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Users />
      <Location />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  caps.clear();
  caps.add("*");
  apiMock.mockReset();
  errors.mockReset();
  apiMock.mockImplementation((path: string) => {
    if (path === "/api/auth/users")
      return Promise.resolve(structuredClone(fixture.users));
    if (path === "/api/auth/users/1")
      return Promise.resolve(structuredClone(fixture.detail));
    throw new Error(`Unexpected Users test request ${path}`);
  });
});
afterEach(cleanup);
describe("Users compact list and preserved real detail/actions", () => {
  it("shows principal identity/account/presence data in rows with no map or decorative glyphs", async () => {
    open();
    const table = await screen.findByRole("table", { name: "Users" });
    const row = within(table).getByRole("row", { name: /Ada Costa/ });
    expect(within(row).getByText("ada@example.test")).toBeVisible();
    expect(within(row).getByText("Owner", {})).toBeVisible();
    expect(within(row).getByText("Active", {})).toBeVisible();
    expect(within(row).getAllByText("Listening now").length).toBeGreaterThan(0);
    expect(within(row).getByRole("button", { name: "Inspect" })).toBeEnabled();
    expect(screen.queryByTestId("removed-map")).not.toBeInTheDocument();
    expect(document.querySelectorAll("svg:not([data-admin-ux])")).toHaveLength(
      0,
    );
    expect(screen.getByRole("heading", { name: "Users" })).toHaveClass(
      "font-display",
    );
  });
  it("opens actual detail from the row and preserves unrelated URL parameters on close", async () => {
    const user = userEvent.setup();
    open();
    const row = await screen.findByRole("row", { name: /Ada Costa/ });
    await user.click(within(row).getByRole("button", { name: "Inspect" }));
    const dialog = await screen.findByRole("dialog", { name: "User Detail" });
    await within(dialog).findByText("Fictional user for the local preview.");
    expect(within(dialog).getByText("Marea")).toBeVisible();
    expect(within(dialog).getAllByText("Sample player").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByTestId("url")).toHaveTextContent(
      "?node=sample&inspect=1",
    );
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("url")).toHaveTextContent("?node=sample");
  });
  it("opens a deep-linked user without inventing data and keeps view-only controls read-only", async () => {
    caps.clear();
    caps.add("users.view");
    open("/users?node=sample&inspect=1");
    const dialog = await screen.findByRole("dialog", { name: "User Detail" });
    await within(dialog).findByText("Fictional user for the local preview.");
    for (const name of [
      "Save roles",
      "Save status",
      "Reset password",
      "Revoke all sessions",
      "Revoke",
    ])
      expect(
        within(dialog).queryByRole("button", { name }),
      ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add user" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Invite user" }),
    ).not.toBeInTheDocument();
    expect(
      apiMock.mock.calls.every(([, method]) => !method || method === "GET"),
    ).toBe(true);
  });
  it("filters by account state and searches real linked-provider data", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText("Showing 1-4 of 4 users");
    await user.click(screen.getByRole("button", { name: "Suspended 1" }));
    expect(screen.getByRole("row", { name: /Celia Norte/ })).toBeVisible();
    expect(
      screen.queryByRole("row", { name: /Ada Costa/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All 4" }));
    await user.type(
      screen.getByRole("textbox", { name: "Search users" }),
      "bandcamp",
    );
    expect(screen.getByText("Showing 1-1 of 1 users")).toBeVisible();
    expect(screen.getByRole("row", { name: /Ada Costa/ })).toBeVisible();
  });
  it("requires delete confirmation, preserves endpoint, and shows a failed delete without losing the row", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((_path: string, method?: string) => {
      if (method === "DELETE")
        return Promise.reject(new Error("sample deletion failed"));
      return Promise.resolve(structuredClone(fixture.users));
    });
    open();
    const row = await screen.findByRole("row", { name: /Bruno Mar/ });
    await user.click(within(row).getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog");
    expect(apiMock.mock.calls.some(([, method]) => method === "DELETE")).toBe(
      false,
    );
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(errors).toHaveBeenCalledWith("Failed to delete user"),
    );
    expect(apiMock).toHaveBeenCalledWith("/api/auth/users/2", "DELETE");
    expect(screen.getByRole("row", { name: /Bruno Mar/ })).toBeInTheDocument();
  });
  it("keeps role update body, disabled pending action and returned detail", async () => {
    const user = userEvent.setup();
    let finish!: (value: unknown) => void;
    apiMock.mockImplementation((path: string, method?: string) => {
      if (method === "PATCH")
        return new Promise((resolve) => {
          finish = resolve;
        });
      return Promise.resolve(
        structuredClone(
          path === "/api/auth/users" ? fixture.users : fixture.detail,
        ),
      );
    });
    open("/users?node=sample&inspect=1");
    const dialog = await screen.findByRole("dialog", { name: "User Detail" });
    await within(dialog).findByText("Fictional user for the local preview.");
    await user.click(within(dialog).getByRole("button", { name: "Curator" }));
    await user.click(
      within(dialog).getByRole("button", { name: "Save roles" }),
    );
    expect(apiMock).toHaveBeenCalledWith("/api/auth/users/1/role", "PATCH", {
      roles: ["owner", "curator"],
    });
    expect(
      within(dialog).getByRole("button", { name: "Save roles" }),
    ).toBeDisabled();
    await act(async () =>
      finish({
        ...structuredClone(fixture.detail),
        roles: ["owner", "curator"],
      }),
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Save roles" }),
      ).toBeDisabled(),
    );
  });
  it("keeps explicit labels, shared field spacing and unchanged create payload", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/api/auth/users" ? structuredClone(fixture.users) : {},
      ),
    );
    open();
    await screen.findByText("Showing 1-4 of 4 users");
    await user.click(screen.getByRole("button", { name: "Add user" }));
    const dialog = screen.getByRole("dialog", { name: "Add User" });
    for (const name of ["Name", "Email", "Password"])
      expect(within(dialog).getByLabelText(name, {}).parentElement).toHaveClass(
        "crate-form-field",
      );
    await user.type(within(dialog).getByLabelText("Name", {}), "Sample New");
    await user.type(
      within(dialog).getByLabelText("Email", {}),
      "new@example.test",
    );
    await user.type(
      within(dialog).getByLabelText("Password", {}),
      "example-only-password",
    );
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(apiMock).toHaveBeenCalledWith("/api/auth/users", "POST", {
      name: "Sample New",
      email: "new@example.test",
      password: "example-only-password",
      roles: ["user"],
    });
  });
});

it("preserves status update reason and session-revocation policy", async () => {
  const user = userEvent.setup();
  apiMock.mockImplementation(
    (path: string, method?: string, body?: Record<string, unknown>) => {
      if (method === "PATCH")
        return Promise.resolve({
          ...structuredClone(fixture.detail),
          status: body?.status,
          status_reason: body?.reason,
        });
      return Promise.resolve(
        structuredClone(
          path === "/api/auth/users" ? fixture.users : fixture.detail,
        ),
      );
    },
  );
  open("/users?inspect=1");
  const dialog = await screen.findByRole("dialog", { name: "User Detail" });
  await within(dialog).findByText("Fictional user for the local preview.");
  await user.click(within(dialog).getByRole("radio", { name: "Suspended" }));
  await user.type(
    within(dialog).getByRole("textbox", {
      name: "Reason for suspension/deletion",
    }),
    "Sample review",
  );
  await user.click(within(dialog).getByRole("button", { name: "Save status" }));
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith("/api/auth/users/1/status", "PATCH", {
      status: "suspended",
      reason: "Sample review",
      revoke_sessions: true,
    }),
  );
});
it("preserves password request and does not submit before explicit action", async () => {
  const user = userEvent.setup();
  apiMock.mockImplementation((path: string, method?: string) =>
    Promise.resolve(
      method === "POST"
        ? { revoked: 2 }
        : structuredClone(
            path === "/api/auth/users" ? fixture.users : fixture.detail,
          ),
    ),
  );
  open("/users?inspect=1");
  const detail = await screen.findByRole("dialog", { name: "User Detail" });
  await within(detail).findByText("Fictional user for the local preview.");
  await user.click(
    within(detail).getByRole("button", { name: "Reset password" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Reset local password",
  });
  const input = within(dialog).getByLabelText("New password", {});
  await user.clear(input);
  await user.type(input, "local-example-only");
  expect(apiMock.mock.calls.some(([, method]) => method === "POST")).toBe(
    false,
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Reset password" }),
  );
  await waitFor(() =>
    expect(apiMock).toHaveBeenCalledWith(
      "/api/auth/users/1/set-password",
      "POST",
      { new_password: "local-example-only", revoke_all_sessions: true },
    ),
  );
});
it("normalizes invite email and keeps the single-use expiry contract", async () => {
  const user = userEvent.setup();
  apiMock.mockImplementation((_path: string, method?: string) =>
    Promise.resolve(
      method === "POST"
        ? {
            token: "fictional",
            email: "new@example.test",
            expires_at: null,
            max_uses: 1,
            use_count: 0,
          }
        : structuredClone(fixture.users),
    ),
  );
  open();
  await screen.findByText("Showing 1-4 of 4 users");
  await user.click(screen.getByRole("button", { name: "Invite user" }));
  const dialog = screen.getByRole("dialog", { name: "Invite user" });
  await user.type(
    within(dialog).getByLabelText("Email", {}),
    "New@Example.test",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Create invite" }),
  );
  await within(dialog).findByRole("button", { name: "Copy link" });
  expect(apiMock).toHaveBeenCalledWith("/api/admin/auth/invites", "POST", {
    email: "new@example.test",
    expires_in_hours: 336,
    max_uses: 1,
  });
});

it("keeps the password submit name while its actual request is pending", async () => {
  const user = userEvent.setup();
  let finish!: (value: unknown) => void;
  apiMock.mockImplementation((path: string, method?: string) =>
    method === "POST"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(
          structuredClone(
            path === "/api/auth/users" ? fixture.users : fixture.detail,
          ),
        ),
  );
  open("/users?inspect=1");
  const detail = await screen.findByRole("dialog", { name: "User Detail" });
  await within(detail).findByText("Fictional user for the local preview.");
  await user.click(
    within(detail).getByRole("button", { name: "Reset password" }),
  );
  const password = screen.getByRole("dialog", { name: "Reset local password" });
  await user.click(
    within(password).getByRole("button", { name: "Reset password" }),
  );
  expect(
    within(password).getByRole("button", { name: "Reset password" }),
  ).toBeDisabled();
  await act(async () => finish({ revoked: 2 }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Reset local password" }),
    ).not.toBeInTheDocument(),
  );
});
