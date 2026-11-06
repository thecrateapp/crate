import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const { mockUseApi } = vi.hoisted(() => ({ mockUseApi: vi.fn() }));

vi.mock("@/hooks/use-api", () => ({ useApi: mockUseApi }));

import { RelatedAlbums } from "./RelatedAlbums";

beforeEach(() => mockUseApi.mockReset());

it("says so when the album has no related albums", () => {
  mockUseApi.mockReturnValue({ data: [], loading: false, error: null });

  render(<RelatedAlbums albumId={1} />);

  expect(screen.getByText("No related albums")).toBeInTheDocument();
});

it("shows nothing while the related albums load", () => {
  mockUseApi.mockReturnValue({ data: null, loading: true, error: null });

  const { container } = render(<RelatedAlbums albumId={1} />);

  expect(container).toBeEmptyDOMElement();
});
