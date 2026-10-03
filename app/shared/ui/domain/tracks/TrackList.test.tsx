import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  TRACK_LIST_VIRTUALIZE_THRESHOLD,
  TrackList,
  type TrackListVirtualListProps,
} from "./index";

interface Row {
  id: number;
  title: string;
}

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    title: `Track ${index + 1}`,
  }));
}

function FakeVirtualList({
  items,
  itemKey,
  renderItem,
}: TrackListVirtualListProps<Row>) {
  return (
    <div data-testid="virtual-list">
      {items.slice(0, 5).map((item, index) => (
        <div key={itemKey?.(item, index) ?? index}>
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  );
}

describe("TrackList", () => {
  it("renders every row below the virtualization threshold", () => {
    const rows = makeRows(3);
    render(
      <TrackList
        items={rows}
        itemKey={(row) => row.id}
        renderRow={(row, index) => <span>{`${index + 1}. ${row.title}`}</span>}
        virtualList={FakeVirtualList}
      />,
    );

    expect(screen.getByText("1. Track 1")).toBeInTheDocument();
    expect(screen.getByText("3. Track 3")).toBeInTheDocument();
    expect(screen.queryByTestId("virtual-list")).not.toBeInTheDocument();
  });

  it("delegates to the injected virtual list at the threshold", () => {
    const renderRow = vi.fn((row: Row) => <span>{row.title}</span>);
    render(
      <TrackList
        items={makeRows(TRACK_LIST_VIRTUALIZE_THRESHOLD)}
        itemKey={(row) => row.id}
        renderRow={renderRow}
        virtualList={FakeVirtualList}
      />,
    );

    expect(screen.getByTestId("virtual-list")).toBeInTheDocument();
    expect(screen.getByTestId("track-list")).toHaveAttribute(
      "data-virtualized",
      "true",
    );
    expect(renderRow).toHaveBeenCalledTimes(5);
  });

  it("does not virtualize without an injected virtual list", () => {
    render(
      <TrackList
        items={makeRows(100)}
        itemKey={(row) => row.id}
        renderRow={(row) => <span>{row.title}</span>}
      />,
    );

    expect(screen.getByText("Track 100")).toBeInTheDocument();
  });

  it("honours a custom threshold", () => {
    render(
      <TrackList
        items={makeRows(10)}
        itemKey={(row) => row.id}
        renderRow={(row) => <span>{row.title}</span>}
        virtualList={FakeVirtualList}
        virtualizeThreshold={10}
      />,
    );

    expect(screen.getByTestId("virtual-list")).toBeInTheDocument();
  });

  it("renders the header with rows and the empty slot without rows", () => {
    const { rerender } = render(
      <TrackList
        items={makeRows(1)}
        itemKey={(row) => row.id}
        renderRow={(row) => <span>{row.title}</span>}
        header={<div>Title</div>}
        empty={<p>No tracks</p>}
        label="Tracks"
      />,
    );

    expect(screen.getByRole("group", { name: "Tracks" })).toBeInTheDocument();
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.queryByText("No tracks")).not.toBeInTheDocument();

    rerender(
      <TrackList
        items={[] as Row[]}
        itemKey={(row) => row.id}
        renderRow={(row) => <span>{row.title}</span>}
        header={<div>Title</div>}
        empty={<p>No tracks</p>}
      />,
    );

    expect(screen.getByText("No tracks")).toBeInTheDocument();
    expect(screen.queryByText("Title")).not.toBeInTheDocument();
  });
});
