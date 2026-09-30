import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
const api = vi.hoisted(() => vi.fn());

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("@/lib/api", () => ({ api }));

import {
  CrateComposerProvider,
  useCrateComposer,
} from "@/contexts/CrateComposerContext";
import { I18nProvider } from "@/i18n";

function Harness() {
  const { openCreateCrate } = useCrateComposer();
  return (
    <button
      type="button"
      onClick={() =>
        openCreateCrate({
          album: {
            globalAlbumUid: "album-1",
            name: "Blending",
            artistName: "High Vis",
          },
        })
      }
    >
      Open crate composer
    </button>
  );
}

describe("CrateComposerProvider", () => {
  beforeEach(() => {
    navigate.mockReset();
    api.mockReset();
    api.mockImplementation(async (url: string) =>
      url === "/api/crates" ? { id: "crate-1" } : undefined,
    );
  });

  it("creates a Crate and carries the source album into it", async () => {
    render(
      <MemoryRouter>
        <I18nProvider initialLocale="es">
          <CrateComposerProvider>
            <Harness />
          </CrateComposerProvider>
        </I18nProvider>
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open crate composer" }),
    );
    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "Best of 2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Crear Crate" }));

    await waitFor(() => {
      expect(api).toHaveBeenNthCalledWith(1, "/api/crates", "POST", {
        name: "Best of 2026",
        description: "",
        is_collaborative: false,
      });
      expect(api).toHaveBeenNthCalledWith(
        2,
        "/api/crates/crate-1/albums",
        "POST",
        { global_album_uid: "album-1" },
      );
      expect(navigate).toHaveBeenCalledWith("/crate/crate-1");
    });
  });
});
