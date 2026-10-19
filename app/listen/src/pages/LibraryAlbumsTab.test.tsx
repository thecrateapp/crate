import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useApi } from "@/hooks/use-api";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { LibraryAlbumsTab } from "./LibraryAlbumsTab";
vi.mock("@/hooks/use-api", () => ({ useApi: vi.fn() }));
it("does not call an initial failed read an empty album collection and allows retry", () => {
  const retry = vi.fn();
  vi.mocked(useApi).mockReturnValue({
    data: null,
    loading: false,
    error: "Connection lost",
    refetch: retry,
  });
  renderWithListenProviders(<LibraryAlbumsTab />);
  expect(screen.getByRole("alert")).toHaveTextContent("Connection lost");
  expect(screen.queryByText("No albums yet")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledTimes(1);
});
