import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api")>();
  return { ...mod, api: vi.fn(() => Promise.resolve({ ok: true })) };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { ProtectedRoute } from "./ProtectedRoute";
import {
  createMockAuthUser,
  renderWithAdminProviders,
} from "@/test/render-with-admin-providers";

const mockApi = vi.mocked(api);

function renderGate(refetch = vi.fn()) {
  return renderWithAdminProviders(
    <ProtectedRoute>
      <div>Admin console</div>
    </ProtectedRoute>,
    {
      auth: {
        user: createMockAuthUser({ password_change_required: true }),
        refetch,
      },
    },
  );
}

function fillForm(current: string, next: string, confirm = next) {
  fireEvent.change(screen.getByLabelText("Current password"), {
    target: { value: current },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: next },
  });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: confirm },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save password" }));
}

describe("PasswordChangeRequired", () => {
  beforeEach(() => {
    mockApi.mockReset();
    mockApi.mockResolvedValue({ ok: true });
    vi.mocked(toast.success).mockReset();
  });

  it("replaces the console until the initial password is changed", () => {
    renderGate();

    expect(
      screen.getByRole("heading", { name: "Choose a new password" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/admin@cratemusic.app/)).toBeInTheDocument();
    expect(screen.queryByText("Admin console")).toBeNull();
  });

  it("changes the password and reloads the session", async () => {
    const refetch = vi.fn();
    renderGate(refetch);

    fillForm("initial-secret", "a-new-password");

    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    expect(mockApi).toHaveBeenCalledWith("/api/me/password", "PUT", {
      current_password: "initial-secret",
      new_password: "a-new-password",
    });
    expect(toast.success).toHaveBeenCalledWith("Password changed");
  });

  it.each([
    ["short", "short", "Use at least 8 characters."],
    ["a-new-password", "another-password", "The new passwords do not match."],
    [
      "initial-secret",
      "initial-secret",
      "Choose a password different from the initial one.",
    ],
  ])("validates %s before calling the API", (next, confirm, message) => {
    renderGate();

    fillForm("initial-secret", next, confirm);

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(mockApi).not.toHaveBeenCalled();
  });

  it("shows the API detail when the current password is wrong", async () => {
    const refetch = vi.fn();
    mockApi.mockRejectedValueOnce(
      new ApiError(403, '{"detail":"Current password is incorrect"}'),
    );
    renderGate(refetch);

    fillForm("wrong-secret", "a-new-password");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Current password is incorrect",
    );
    expect(refetch).not.toHaveBeenCalled();
  });

  it("lets the user sign out instead", () => {
    const { authValue } = renderGate();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(authValue.logout).toHaveBeenCalledTimes(1);
  });
});
