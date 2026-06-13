import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
}));

vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
  }),
  verticalListSortingStrategy: {},
  arrayMove: vi.fn((items: unknown[]) => items),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: {
      toString: vi.fn(() => ""),
    },
  },
}));

import { PlaylistCreateModal } from "@/components/playlists/PlaylistCreateModal";

describe("PlaylistCreateModal", () => {
  it("uses the Listen glass panel surface", () => {
    render(
      <PlaylistCreateModal
        open
        initialTracks={[]}
        submitting={false}
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => {})}
      />,
    );

    expect(
      screen
        .getByRole("heading", { name: "Create playlist" })
        .closest(".listen-glass-panel"),
    ).toBeInTheDocument();
  });
});
