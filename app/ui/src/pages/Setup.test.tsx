import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { Setup } from "./Setup";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { api } from "@/lib/api";

beforeEach(() => vi.mocked(api).mockReset().mockResolvedValue({ saved: 1 }));

it("keeps account and key captions visible and preserves setup through library scan", async () => {
  const user = userEvent.setup();
  render(<Setup />);
  for (const label of ["Name (optional)", "Email", "Password"]) {
    const field = screen.getByLabelText(label);
    expect(field).toHaveAttribute("data-slot", "input");
    expect(field.closest('[data-slot="form-field"]')).toBeInTheDocument();
  }
  expect(screen.getByLabelText("Password")).toHaveAttribute(
    "autoComplete",
    "new-password",
  );
  await user.type(screen.getByLabelText("Name (optional)"), "Curator");
  await user.type(screen.getByLabelText("Email"), "curator@example.test");
  await user.type(screen.getByLabelText("Password"), "test-password");
  await user.click(screen.getByRole("button", { name: "Create Account" }));
  await screen.findByRole("heading", { name: "API Keys" });
  expect(api).toHaveBeenCalledWith("/api/setup/admin", "POST", {
    name: "Curator",
    email: "curator@example.test",
    password: "test-password",
  });
  expect(api).toHaveBeenCalledWith("/api/auth/login", "POST", {
    email: "curator@example.test",
    password: "test-password",
  });
  const lastfm = screen.getByLabelText("Last.fm API Key");
  expect(lastfm).toHaveAccessibleDescription(/Artist bios, similar artists/);
  await user.type(lastfm, "local-test-key");
  await user.click(screen.getByRole("button", { name: "Save Keys" }));
  await screen.findByRole("heading", { name: "Scan Your Library" });
  expect(api).toHaveBeenCalledWith(
    "/api/setup/keys",
    "POST",
    expect.objectContaining({ lastfm_apikey: "local-test-key" }),
  );
  await user.click(screen.getByRole("button", { name: "Start Scan" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/api/setup/scan", "POST"),
  );
  expect(
    await screen.findByRole("heading", { name: "You're all set!" }),
  ).toBeVisible();
});
