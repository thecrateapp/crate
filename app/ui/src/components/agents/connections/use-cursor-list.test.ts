import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: apiMock }));

import { useCursorList } from "./use-cursor-list";

interface Row {
  id: string;
  revision: number;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  apiMock.mockReset();
});

describe("useCursorList", () => {
  it("does not let a reload sent before a replace overwrite the fresh row", async () => {
    apiMock.mockResolvedValueOnce({
      items: [{ id: "a", revision: 1 }],
      next_cursor: null,
    });
    const { result } = renderHook(() =>
      useCursorList<Row>("/rows", (row) => row.id),
    );
    await waitFor(() =>
      expect(result.current.items).toEqual([{ id: "a", revision: 1 }]),
    );

    // A reload goes out and is still pending when the row changes.
    const staleRead = deferred<{ items: Row[]; next_cursor: null }>();
    const freshRead = deferred<{ items: Row[]; next_cursor: null }>();
    apiMock
      .mockReturnValueOnce(staleRead.promise)
      .mockReturnValueOnce(freshRead.promise);
    act(() => result.current.reload());
    act(() => result.current.replace({ id: "a", revision: 2 }));
    expect(result.current.items).toEqual([{ id: "a", revision: 2 }]);
    // The replace re-issued the read.
    expect(apiMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      staleRead.resolve({
        items: [{ id: "a", revision: 1 }],
        next_cursor: null,
      });
      await staleRead.promise;
    });
    expect(result.current.items).toEqual([{ id: "a", revision: 2 }]);

    await act(async () => {
      freshRead.resolve({
        items: [{ id: "a", revision: 2 }],
        next_cursor: null,
      });
      await freshRead.promise;
    });
    expect(result.current.items).toEqual([{ id: "a", revision: 2 }]);
  });

  it("keeps the loaded pages on reload and reads the same range again", async () => {
    apiMock
      .mockResolvedValueOnce({
        items: [{ id: "a", revision: 1 }],
        next_cursor: "a",
      })
      .mockResolvedValueOnce({
        items: [{ id: "b", revision: 1 }],
        next_cursor: null,
      });
    const { result } = renderHook(() =>
      useCursorList<Row>("/rows?limit=1", (row) => row.id),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    apiMock
      .mockResolvedValueOnce({
        items: [{ id: "a", revision: 2 }],
        next_cursor: "a",
      })
      .mockResolvedValueOnce({
        items: [{ id: "b", revision: 2 }],
        next_cursor: null,
      });
    act(() => result.current.reload());

    await waitFor(() =>
      expect(result.current.items).toEqual([
        { id: "a", revision: 2 },
        { id: "b", revision: 2 },
      ]),
    );
    expect(apiMock).toHaveBeenLastCalledWith("/rows?limit=1&cursor=a");
  });
});
