import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { PlayerQueueHeader } from "./PlayerQueueHeader";

describe("player queue source navigation", () => {
  it("opens the saved path through the queue's source link", () => {
    const close = vi.fn();
    render(
      <MemoryRouter initialEntries={["/queue"]}>
        <Routes>
          <Route
            path="/queue"
            element={
              <PlayerQueueHeader
                title="Queue"
                summary="2 tracks"
                source="Punk to Electronic"
                sourceHref="/paths/77"
                closeLabel="Close queue"
                onClose={close}
              />
            }
          />
          <Route path="/paths/77" element={<h1>Saved path detail</h1>} />
        </Routes>
      </MemoryRouter>,
    );

    const link = screen.getByRole("link", { name: "Punk to Electronic" });
    expect(link).toHaveAttribute("href", "/paths/77");
    fireEvent.click(link);
    expect(
      screen.getByRole("heading", { name: "Saved path detail" }),
    ).toBeInTheDocument();
  });

  it("preserves ordinary source captions and the queue close action", () => {
    const close = vi.fn();
    render(
      <PlayerQueueHeader
        title="Queue"
        summary="2 tracks"
        source="An album"
        closeLabel="Close queue"
        onClose={close}
      />,
    );
    expect(screen.getByText("An album")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close queue" }));
    expect(close).toHaveBeenCalledOnce();
  });
});
