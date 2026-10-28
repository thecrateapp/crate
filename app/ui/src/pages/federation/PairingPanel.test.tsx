import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { renderWithAdminProviders } from "@/test/render-with-admin-providers";

import { PairingPanel } from "./PairingPanel";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));

it("uses matching input and action columns for probe and pairing", () => {
  renderWithAdminProviders(<PairingPanel canManage onChanged={vi.fn()} />);

  const probeInput = screen.getByLabelText("Probe URL");
  const pairingInput = screen.getByLabelText("Pairing URL");
  expect(screen.getByRole("heading", { name: "Pairing" })).toHaveClass(
    "crate-mono-label",
  );
  expect(probeInput.closest("[data-slot=form-field]")).not.toBeNull();
  expect(pairingInput.closest("[data-slot=form-field]")).not.toBeNull();
  const probeRow = probeInput.closest("[data-slot=pairing-input-row]");
  const pairingRow = pairingInput.closest("[data-slot=pairing-input-row]");

  expect(probeRow).toHaveClass("grid-cols-[minmax(0,1fr)_5rem]");
  expect(pairingRow).toHaveClass("grid-cols-[minmax(0,1fr)_5rem]");
  expect(probeRow?.className).toBe(pairingRow?.className);
  expect(probeRow?.querySelector("button")).toHaveClass("w-full");
  expect(pairingRow?.querySelector("button")).toHaveClass("w-full");
});

it("starts pairing through the verified pairing endpoint", async () => {
  vi.mocked(api).mockResolvedValue({});
  renderWithAdminProviders(<PairingPanel canManage onChanged={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Pairing URL"), {
    target: { value: "https://peer.example" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Pair" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/api/admin/federation/pairing/start",
      "POST",
      { url: "https://peer.example" },
    ),
  );
});

it("renders probe details on the shared token surface", async () => {
  vi.mocked(api).mockResolvedValue({ node_uid: "peer-one" });
  renderWithAdminProviders(<PairingPanel canManage onChanged={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Probe URL"), {
    target: { value: "https://peer.example" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Probe" }));

  await waitFor(() =>
    expect(document.querySelector("pre")).toHaveClass(
      "border-border-quiet",
      "bg-card",
      "font-mono",
    ),
  );
});
