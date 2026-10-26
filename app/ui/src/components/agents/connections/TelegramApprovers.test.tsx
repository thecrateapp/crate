import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentIntegration } from "@/lib/agent-integrations";

import { TelegramApprovers, type TelegramBindings } from "./TelegramApprovers";

const { apiMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock },
}));

const listPath = "/api/admin/agent-telegram/bindings";

function connection(principal_id: string, name: string): AgentIntegration {
  return {
    principal_id,
    name,
    kind: "service",
    enabled: true,
    grants: ["ops.status.read"],
    require_approval: true,
    policy_revision: 1,
    last_activity_at: null,
    credentials: [],
    authorizations: null,
  };
}

const connections = [
  connection("service-reader", "Library reader"),
  connection("service-operator", "Crate Operator"),
];

const bound: TelegramBindings = {
  instance_id: "crate-0123456789ab",
  items: [
    {
      binding_id: "binding-one",
      principal_id: "service-operator",
      principal_name: "Crate Operator",
      user_id: 7,
      username: "diego",
      telegram_user_id: 12345678,
      created_at: "2026-10-01T00:00:00Z",
    },
    {
      binding_id: "binding-two",
      principal_id: "service-reader",
      principal_name: null,
      user_id: 9,
      username: null,
      telegram_user_id: 87654321,
      created_at: "2026-10-02T00:00:00Z",
    },
  ],
};

function mockList(list: TelegramBindings | Error) {
  apiMock.mockImplementation((path: string, method = "GET") => {
    if (method !== "GET") return Promise.resolve({ revoked: true });
    if (path === listPath)
      return list instanceof Error
        ? Promise.reject(list)
        : Promise.resolve(list);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

beforeEach(() => {
  apiMock.mockReset();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
});

describe("TelegramApprovers", () => {
  it("lists the active approvers with their connection and Telegram user", async () => {
    mockList(bound);
    render(<TelegramApprovers connections={connections} />);

    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Crate Operator")).toBeInTheDocument();
    expect(
      within(rows[0]!).getByText("Approver diego · Telegram user 12345678"),
    ).toBeInTheDocument();
    expect(
      within(rows[1]!).getByText("Unnamed connection"),
    ).toBeInTheDocument();
    expect(
      within(rows[1]!).getByText("Approver User #9 · Telegram user 87654321"),
    ).toBeInTheDocument();
  });

  it("explains how to set up Crate Operator when the instance has none", async () => {
    mockList({ instance_id: null, items: [] });
    render(<TelegramApprovers connections={connections} />);

    expect(
      await screen.findByText(/Crate Operator is not set up on this instance/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("make agent-init AGENT_PROFILE=operator"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Connection")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Bind me as approver" }),
    ).not.toBeInTheDocument();
  });

  it("binds the signed-in user to the Crate Operator connection by default", async () => {
    const user = userEvent.setup();
    mockList({ instance_id: "crate-0123456789ab", items: [] });
    render(<TelegramApprovers connections={connections} />);

    const select = await screen.findByLabelText("Connection");
    expect(select).toHaveValue("service-operator");
    const submit = screen.getByRole("button", { name: "Bind me as approver" });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText("Your Telegram user ID"), "abc");
    expect(submit).toBeDisabled();
    await user.clear(screen.getByLabelText("Your Telegram user ID"));
    await user.type(screen.getByLabelText("Your Telegram user ID"), "12345678");
    await user.click(submit);

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/agent-telegram/bind",
        "POST",
        { principal_id: "service-operator", telegram_user_id: 12345678 },
      ),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Telegram approver bound");
    await waitFor(() =>
      expect(
        apiMock.mock.calls.filter(([path]) => path === listPath).length,
      ).toBe(2),
    );
  });

  it("binds another chosen connection", async () => {
    const user = userEvent.setup();
    mockList({ instance_id: "crate-0123456789ab", items: [] });
    render(<TelegramApprovers connections={connections} />);

    await user.selectOptions(
      await screen.findByLabelText("Connection"),
      "service-reader",
    );
    await user.type(screen.getByLabelText("Your Telegram user ID"), "42");
    await user.click(
      screen.getByRole("button", { name: "Bind me as approver" }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/agent-telegram/bind",
        "POST",
        { principal_id: "service-reader", telegram_user_id: 42 },
      ),
    );
  });

  it("reports a refused binding", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((_path: string, method = "GET") => {
      if (method === "POST")
        return Promise.reject(
          new Error(JSON.stringify({ detail: "Missing approval permission" })),
        );
      return Promise.resolve({ instance_id: "crate-0123456789ab", items: [] });
    });
    render(<TelegramApprovers connections={connections} />);

    await user.type(
      await screen.findByLabelText("Your Telegram user ID"),
      "12345678",
    );
    await user.click(
      screen.getByRole("button", { name: "Bind me as approver" }),
    );

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Missing approval permission",
      ),
    );
  });

  it("removes an approver only after confirmation", async () => {
    const user = userEvent.setup();
    mockList(bound);
    render(<TelegramApprovers connections={connections} />);

    const rows = await screen.findAllByRole("listitem");
    await user.click(within(rows[0]!).getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText("Remove the approver of Crate Operator?"),
    ).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith(expect.anything(), "DELETE");
    await user.click(
      within(dialog).getByRole("button", { name: "Remove approver" }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/api/admin/agent-telegram/bindings/binding-one",
        "DELETE",
      ),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Telegram approver removed");
  });

  it("shows a load error with a retry", async () => {
    const user = userEvent.setup();
    mockList(new Error(JSON.stringify({ detail: "Forbidden" })));
    render(<TelegramApprovers connections={connections} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
    mockList(bound);
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
