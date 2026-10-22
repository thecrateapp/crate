import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Roles } from "./Roles";
import { api } from "@/lib/api";
import fixture from "../../../../tests/admin-e2e/fixtures/roles-1al.json";
vi.mock("@/lib/api", () => ({ api: vi.fn() }));
const mockApi = vi.mocked(api);
beforeEach(() => {
  vi.clearAllMocks();
  mockApi.mockResolvedValue(structuredClone(fixture));
});
afterEach(cleanup);
describe("Roles text catalog with the real component and mount request", () => {
  it("retires the decorative header glyph and keeps the catalog read-only", async () => {
    render(<Roles />);
    await screen.findByText("Librarian");
    expect(document.querySelectorAll("svg")).toHaveLength(0);
    expect(
      screen.getByRole("heading", { name: "Roles & Permissions" }),
    ).toHaveClass("font-display");
    expect(screen.getByText("Preset roles")).toHaveClass("font-mono");
    expect(screen.getByText("Capability matrix")).toHaveClass("font-display");
    expect(screen.getByText("Librarian")).toHaveClass("font-display");
    expect(screen.getByText("librarian")).toHaveClass("font-mono");
    expect(screen.getByText("librarian").parentElement).toHaveClass(
      "crate-form-field",
    );
    expect(screen.getByText("library", { exact: true })).toHaveClass(
      "font-mono",
    );
    expect(
      screen.getByText("library", { exact: true }).parentElement,
    ).toHaveClass("crate-form-field");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(mockApi).toHaveBeenCalledExactlyOnceWith("/api/auth/roles");
  });
  it("preserves API role order, labels, slugs, capability order and counts", async () => {
    render(<Roles />);
    await screen.findByText("Librarian");
    expect(
      screen
        .getByText("Librarian")
        .compareDocumentPosition(screen.getByText("Observer")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("3 capabilities")).toBeInTheDocument();
    expect(screen.getByText("2 capabilities")).toBeInTheDocument();
    expect(screen.getAllByText("library.view", { exact: true })).toHaveLength(
      3,
    );
    expect(
      screen.getAllByText("library.metadata.write", { exact: true }),
    ).toHaveLength(2);
    expect(screen.getByText("observer")).toBeInTheDocument();
    expect(mockApi).toHaveBeenCalledTimes(1);
  });
  it("sorts group names while preserving source order inside each group", async () => {
    render(<Roles />);
    await screen.findByText("Librarian");
    const library = screen.getByText("library", { exact: true }),
      roles = screen.getByText("roles", { exact: true }),
      users = screen.getByText("users", { exact: true });
    expect(
      library.compareDocumentPosition(roles) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      roles.compareDocumentPosition(users) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const group = within(users.parentElement!);
    expect(
      group
        .getByText("users.view")
        .compareDocumentPosition(group.getByText("users.status.manage")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(mockApi).toHaveBeenCalledTimes(1);
  });
  it("keeps textual loading until the actual pending read completes", async () => {
    let finish!: (value: unknown) => void;
    mockApi.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<Roles />);
    expect(
      screen.getByRole("status", { name: "Loading roles" }),
    ).toHaveTextContent("Loading roles...");
    expect(screen.queryByText("Librarian")).not.toBeInTheDocument();
    expect(document.querySelectorAll("svg")).toHaveLength(0);
    await act(async () => finish(structuredClone(fixture)));
    await screen.findByText("Librarian");
    expect(
      screen.queryByRole("status", { name: "Loading roles" }),
    ).not.toBeInTheDocument();
    expect(mockApi).toHaveBeenCalledExactlyOnceWith("/api/auth/roles");
  });
  it.each([
    { label: "empty", value: { roles: [], capabilities: [] } },
    { label: "null", value: null },
  ])(
    "preserves $label payload behavior without inventing role data",
    async ({ value }) => {
      mockApi.mockResolvedValueOnce(value);
      render(<Roles />);
      await waitFor(() =>
        expect(screen.queryByText("Loading roles...")).not.toBeInTheDocument(),
      );
      expect(screen.getByText("Role presets")).toBeInTheDocument();
      expect(screen.getByText("Capability catalog")).toBeInTheDocument();
      expect(screen.queryByText("Librarian")).not.toBeInTheDocument();
      expect(screen.queryByText(/capabilities$/)).not.toBeInTheDocument();
      expect(mockApi).toHaveBeenCalledExactlyOnceWith("/api/auth/roles");
    },
  );
});
