import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useApi: vi.fn(),
  api: vi.fn(),
  crate: null as unknown,
}));

vi.mock("@/hooks/use-api", () => ({ useApi: mocks.useApi }));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: mocks.api };
});

import { CrateEditor } from "@/components/CrateEditor";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import type { CrateDetail } from "@/pages/crates-types";

const crateId = "7ee76303-7aa6-4317-a5d3-18c2e1360b1c";

const editorProps = {
  crateId,
  onBack: vi.fn(),
  onCreated: vi.fn(),
  onDeleted: vi.fn(),
};

function CrateEditorHarness() {
  const [, setRevision] = useState(0);
  return (
    <>
      <button onClick={() => setRevision((revision) => revision + 1)}>
        Refresh crate snapshot
      </button>
      <CrateEditor {...editorProps} />
    </>
  );
}

function crateDetail(name: string): CrateDetail {
  return {
    id: crateId,
    owner_id: 1,
    name,
    description: "",
    visibility: "private",
    is_collaborative: false,
    access: "owner",
    album_count: 0,
    first_album: null,
    updated_at: null,
    albums: [],
  };
}

describe("CrateEditor", () => {
  beforeEach(() => {
    mocks.crate = crateDetail("Original name");
    mocks.useApi.mockImplementation(() => ({
      data: mocks.crate,
      loading: false,
      error: null,
      refetch: vi.fn(),
    }));
  });

  it("resets the editable draft when the persisted snapshot changes without an updated_at", () => {
    renderWithListenProviders(<CrateEditorHarness />, {
      locale: "en",
    });

    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Unsaved name" },
    });
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Unsaved name",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh crate snapshot" }),
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Unsaved name",
    );

    mocks.crate = crateDetail("Updated from server");
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh crate snapshot" }),
    );

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Updated from server",
    );
  });
});
