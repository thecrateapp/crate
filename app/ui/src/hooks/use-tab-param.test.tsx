import { act, renderHook, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";

import { useTabParam } from "./use-tab-param";

const values = ["overview", "albums", "shows"] as const;
function setup(entry = "/artist?tab=albums", options = {}) {
  const router = createMemoryRouter([{ path: "*", element: <Slot /> }], {
    initialEntries: [
      "/previous",
      {
        pathname: entry.split("?")[0],
        search: entry.includes("?")
          ? `?${entry.split("?")[1]!.split("#")[0]}`
          : "",
        hash: entry.includes("#") ? `#${entry.split("#")[1]}` : "",
        state: { origin: "library" },
      },
    ],
    initialIndex: 1,
  });
  let children: ReactNode;
  function Slot() {
    return children;
  }
  const hook = renderHook(
    () => {
      const [tab, setTab] = useTabParam(values, "overview", options);
      return { tab, setTab, location: useLocation() };
    },
    {
      wrapper: ({ children: content }) => {
        children = content;
        return <RouterProvider router={router} />;
      },
    },
  );
  return { ...hook, router };
}

describe("app-local URL tabs", () => {
  it.each([
    ["/artist", "overview"],
    ["/artist?tab=", "overview"],
    ["/artist?tab=unknown&node=peer", "overview"],
    ["/artist?tab=albums", "albums"],
    ["/artist?tab=shows", "shows"],
  ])("reads %s as %s without rewriting the URL", (entry, expected) => {
    const { result } = setup(entry);
    expect(result.current.tab).toBe(expected);
    expect(
      result.current.location.pathname + result.current.location.search,
    ).toBe(entry);
  });

  it("round-trips valid tabs while retaining repeated/encoded query, path, hash and state", async () => {
    const { result } = setup(
      "/artist?tab=albums&node=peer%20two&tag=a&tag=b#discography",
    );
    act(() => result.current.setTab("shows"));
    await waitFor(() => expect(result.current.tab).toBe("shows"));
    const location = result.current.location;
    expect(new URLSearchParams(location.search).get("node")).toBe("peer two");
    expect(new URLSearchParams(location.search).getAll("tag")).toEqual([
      "a",
      "b",
    ]);
    expect(new URLSearchParams(location.search).getAll("tab")).toEqual([
      "shows",
    ]);
    expect(location.pathname).toBe("/artist");
    expect(location.hash).toBe("#discography");
    expect(location.state).toEqual({ origin: "library" });
    act(() => result.current.setTab("overview"));
    await waitFor(() =>
      expect(
        new URLSearchParams(result.current.location.search).get("tab"),
      ).toBe("overview"),
    );
  });

  it("ignores invalid writes and avoids duplicate history entries", async () => {
    const { result, router } = setup();
    const key = result.current.location.key;
    act(() => {
      result.current.setTab("invalid");
      result.current.setTab("albums");
    });
    expect(result.current.location.key).toBe(key);
    await act(() => router.navigate(-1));
    expect(result.current.location.pathname).toBe("/previous");
  });

  it("coalesces repeated writes before the router commits a render", async () => {
    const { result, router } = setup();
    act(() => {
      result.current.setTab("shows");
      result.current.setTab("shows");
    });
    await waitFor(() => expect(result.current.tab).toBe("shows"));
    await act(() => router.navigate(-1));
    expect(result.current.tab).toBe("albums");
    act(() => result.current.setTab("shows"));
    await waitFor(() => expect(result.current.tab).toBe("shows"));
  });

  it("pushes tab changes and follows back, forward and external navigation", async () => {
    const { result, router } = setup();
    act(() => result.current.setTab("shows"));
    await waitFor(() => expect(result.current.tab).toBe("shows"));
    await act(() => router.navigate(-1));
    expect(result.current.tab).toBe("albums");
    await act(() => router.navigate(1));
    expect(result.current.tab).toBe("shows");
    await act(() => router.navigate("/artist?tab=unknown&node=peer"));
    expect(result.current.tab).toBe("overview");
    expect(result.current.location.search).toBe("?tab=unknown&node=peer");
  });

  it("supports explicit replacement without adding a history entry", async () => {
    const { result, router } = setup("/artist?tab=albums", { replace: true });
    act(() => result.current.setTab("shows"));
    await waitFor(() => expect(result.current.tab).toBe("shows"));
    await act(() => router.navigate(-1));
    expect(result.current.location.pathname).toBe("/previous");
  });

  it("supports a named parameter without taking ownership of tab or other filters", async () => {
    const { result } = setup("/artist?tab=untouched&section=albums&node=peer", {
      param: "section",
    });
    expect(result.current.tab).toBe("albums");
    act(() => result.current.setTab("shows"));
    await waitFor(() => expect(result.current.tab).toBe("shows"));
    expect(result.current.location.search).toBe(
      "?tab=untouched&section=shows&node=peer",
    );
  });
});
