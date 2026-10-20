import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import {
  ShowConsolidationEditor,
  emptyConsolidationDraft,
} from "./ShowConsolidationEditor";
import type { ShowConsolidation } from "./show-import-types";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

const ROWS = [
  {
    id: 7,
    revision: 2,
    artist_name: "Band",
    date: "2027-03-02",
    venue: "Hall",
    city: "City",
    attendance_count: 1,
    reminder_count: 1,
  },
  {
    id: 8,
    revision: 3,
    artist_name: "Band",
    date: "2027-03-02",
    local_time: "21:00",
    venue: "Hall",
    city: "City",
    attendance_count: 0,
    reminder_count: 0,
  },
];

function Harness({
  onReview,
  initialIds,
}: {
  onReview: (selection: ShowConsolidation) => void;
  initialIds?: number[];
}) {
  const [value, setValue] = useState(emptyConsolidationDraft);
  return (
    <ShowConsolidationEditor
      value={value}
      onValueChange={setValue}
      disabled={false}
      initialIds={initialIds}
      onReview={onReview}
    />
  );
}

async function load(ids: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Show IDs"), ids);
  await user.click(screen.getByRole("button", { name: "Load shows" }));
  return user;
}

it("loads real revisions and requires an explicit keep and merge choice", async () => {
  vi.mocked(api).mockResolvedValue({ items: ROWS });
  const review = vi.fn();
  render(<Harness onReview={review} />);
  expect(
    screen.getByText(
      "2 to 10 show IDs separated by commas. Open a show on Upcoming and choose Merge duplicates to fill this in, or enter the show IDs.",
    ),
  ).toBeInTheDocument();
  const user = await load("7,8");
  expect(
    await screen.findByRole("button", { name: "Review merge" }),
  ).toBeDisabled();
  expect(vi.mocked(api).mock.calls[0]![0]).toContain("ids=7&ids=8");
  expect(
    screen.getByRole("radiogroup", { name: "Show to keep" }),
  ).toBeVisible();
  expect(screen.getByRole("radio", { name: "Keep show 7" })).toBeChecked();
  expect(screen.queryByRole("checkbox", { name: "Merge show 7" })).toBeNull();
  expect(
    screen.getByRole("checkbox", { name: "Merge show 8" }),
  ).not.toBeChecked();
  expect(screen.getAllByText("Band · Tue, Mar 2, 2027")).toHaveLength(2);
  expect(screen.getByText("#7 · Hall, City · Time unknown")).toBeVisible();
  expect(screen.getByText("1 going · 1 reminder")).toBeVisible();
  expect(screen.getByText("0 going · 0 reminders")).toBeVisible();
  await user.click(screen.getByRole("checkbox", { name: "Merge show 8" }));
  await user.click(screen.getByRole("button", { name: "Review merge" }));
  expect(review).toHaveBeenCalledWith({
    canonical_show_id: 7,
    duplicate_show_ids: [8],
    revisions: { "7": 2, "8": 3 },
  });
});

it("rejects fewer than two or repeated IDs without a request", async () => {
  render(<Harness onReview={vi.fn()} />);
  const user = await load("7,7");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Enter 2 to 10 different show IDs.",
  );
  await user.clear(screen.getByLabelText("Show IDs"));
  await user.type(screen.getByLabelText("Show IDs"), "7");
  await user.click(screen.getByRole("button", { name: "Load shows" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Enter 2 to 10 different show IDs.",
  );
  expect(api).not.toHaveBeenCalled();
});

it("explains shows that were deleted or already merged", async () => {
  vi.mocked(api).mockResolvedValue({
    items: [ROWS[0], { ...ROWS[1], merged_into_id: 7 }],
  });
  render(<Harness onReview={vi.fn()} />);
  await load("7,8");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Some of these shows were deleted or already merged. Check the IDs and load them again.",
  );
  expect(screen.queryByRole("radiogroup")).toBeNull();
});

it("shows a load failure as a sentence", async () => {
  vi.mocked(api).mockRejectedValue(
    Object.assign(new Error(JSON.stringify({ detail: "Show was not found" })), {
      status: 404,
    }),
  );
  render(<Harness onReview={vi.fn()} />);
  await load("7,8");
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Show was not found");
  expect(alert.textContent).not.toContain("detail");
});

it("uses design-system controls only", async () => {
  vi.mocked(api).mockResolvedValue({ items: ROWS });
  const { container } = render(<Harness onReview={vi.fn()} />);
  await load("7,8");
  await screen.findByRole("radiogroup", { name: "Show to keep" });
  expect(
    container.querySelector(
      'select, details, pre, input[type="checkbox"]:not([aria-hidden]), input[type="radio"]:not([aria-hidden])',
    ),
  ).toBeNull();
});

it("fills in and loads the shows it opens with, the same way «Load shows» does", async () => {
  vi.mocked(api).mockResolvedValue({ items: ROWS });
  const review = vi.fn();
  render(<Harness onReview={review} initialIds={[7, 8]} />);
  expect(screen.getByLabelText("Show IDs")).toHaveValue("7, 8");
  expect(
    await screen.findByRole("radio", { name: "Keep show 7" }),
  ).toBeChecked();
  expect(vi.mocked(api)).toHaveBeenCalledOnce();
  expect(vi.mocked(api).mock.calls[0]![0]).toContain("ids=7&ids=8");
  expect(screen.getByRole("button", { name: "Review merge" })).toBeDisabled();
  expect(review).not.toHaveBeenCalled();
});

it("fills in a lone show without loading it and asks for the others", () => {
  render(<Harness onReview={vi.fn()} initialIds={[7]} />);
  expect(screen.getByLabelText("Show IDs")).toHaveValue("7");
  expect(
    screen.getByText("Add the IDs of the other shows to merge with this one."),
  ).toBeVisible();
  expect(api).not.toHaveBeenCalled();
});

it("writes the lone-show note into a status region that was already there", () => {
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  render(<Harness onReview={vi.fn()} initialIds={[7]} />);
  const records = observer.takeRecords();
  observer.disconnect();
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent(
    "Add the IDs of the other shows to merge with this one.",
  );
  // The note changed the text of a region already in the page, which is
  // what a screen reader announces; a region that mounts with its text
  // stays silent.
  expect(
    records.some(
      (record) =>
        record.target === status || record.target.parentNode === status,
    ),
  ).toBe(true);
});

it("keeps the note's status region, empty, when there is nothing to say", async () => {
  render(<Harness onReview={vi.fn()} initialIds={[7]} />);
  const status = screen.getByRole("status");
  await userEvent.setup().type(screen.getByLabelText("Show IDs"), ", 8");
  expect(screen.getByRole("status")).toBe(status);
  expect(status).toBeEmptyDOMElement();
});
