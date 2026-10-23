import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ShowCandidateFields } from "./ShowCandidateFields";
import { ShowCandidateList } from "./ShowCandidateList";
import type { ShowDraftState } from "./show-draft";
import type { ShowCandidate, ShowOutcome } from "./show-import-types";

function complete(id: string, date = "2027-03-02"): ShowCandidate {
  return {
    item_id: id,
    artist_name: "Band",
    date,
    local_time: "",
    venue: "Sala Norte",
    city: "Madrid",
  };
}

function renderList({
  draft,
  outcomes = [],
  locked = false,
  showMissing = () => false,
  onRemove,
}: {
  draft: ShowDraftState;
  outcomes?: ShowOutcome[];
  locked?: boolean;
  showMissing?: (candidate: ShowCandidate) => boolean;
  onRemove?: (itemId: string) => void;
}) {
  const handlers = {
    onChange: vi.fn(),
    onSelect: vi.fn(),
    onFill: vi.fn(),
  };
  render(
    <ShowCandidateList
      draft={draft}
      outcomes={outcomes}
      locked={locked}
      showMissing={showMissing}
      onRemove={onRemove}
      {...handlers}
    />,
  );
  return handlers;
}

it("keeps every tour row, counts pending shows and locks saved rows", async () => {
  const user = userEvent.setup();
  const { onChange, onSelect } = renderList({
    draft: {
      candidates: [
        { item_id: "a", date: "2027-03-02" },
        { item_id: "b", date: "2027-03-04" },
        { item_id: "c", date: "2027-03-06" },
      ],
      selected: ["b"],
    },
    outcomes: [
      { item_id: "a", show_id: 7, status: "created" },
      { item_id: "b", show_id: 8, status: "conflict" },
    ],
  });
  expect(screen.getByText("1 of 2 shows selected · 1 saved")).toBeVisible();
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  expect(screen.getByLabelText("Artist for show 1")).toBeDisabled();
  expect(screen.getByLabelText("Select show 1")).toBeDisabled();
  await user.type(screen.getByLabelText("Artist for show 2"), "Band");
  expect(onChange).toHaveBeenCalled();
  expect(screen.getByLabelText("Date for show 3")).toHaveValue("2027-03-06");
  expect(screen.getByText("Show 3 · Sat, Mar 6, 2027")).toBeVisible();
  await user.click(screen.getByLabelText("Select show 3"));
  expect(onSelect).toHaveBeenCalledWith(["b", "c"]);
  expect(screen.getByText("Saved")).toBeVisible();
  expect(screen.getByText("Not saved")).toBeVisible();
  const links = screen.getAllByRole("link", { name: "Open show" });
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    "/upcoming?show_id=7",
    "/upcoming?show_id=8",
  ]);
  for (const link of links) {
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  }
});

it("clears a previously selected artist UID when the artist name is corrected", async () => {
  const onChange = vi.fn();
  render(
    <ShowCandidateFields
      candidate={{
        item_id: "a",
        artist_name: "Band",
        artist_uid: "10000000-0000-0000-0000-000000000001",
      }}
      index={null}
      locked={false}
      showMissing={false}
      onChange={onChange}
    />,
  );
  await userEvent.type(screen.getByLabelText("Artist"), "s");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ artist_name: "Bands", artist_uid: null }),
  );
  expect(screen.getByText("Leave empty if unknown.")).toBeVisible();
  expect(document.body.textContent).not.toContain("10000000");
});

it("highlights missing required fields and names them", () => {
  renderList({
    draft: { candidates: [{ item_id: "a", date: "2027-03-02" }], selected: [] },
    showMissing: () => true,
  });
  const artist = screen.getByLabelText("Artist for show 1");
  expect(artist).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Venue for show 1")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(screen.getByLabelText("Date for show 1")).not.toHaveAttribute(
    "aria-invalid",
  );
  expect(screen.getByLabelText("Time for show 1")).not.toHaveAttribute(
    "aria-invalid",
  );
  const hint = screen.getByText("Missing artist, venue and city");
  expect(hint).toBeVisible();
  expect(artist).toHaveAccessibleDescription("Missing artist, venue and city");
  expect(screen.getByText("3 missing")).toBeVisible();
  expect(screen.queryByText("*")).toBeNull();
});

it("selects all valid unsaved shows up to fifty", async () => {
  const valid = Array.from({ length: 60 }, (_, index) => complete(`v${index}`));
  const { onSelect } = renderList({
    draft: {
      candidates: [
        complete("saved"),
        { item_id: "incomplete", date: "2027-03-02" },
        ...valid,
      ],
      selected: [],
    },
    outcomes: [{ item_id: "saved", show_id: 1, status: "created" }],
  });
  expect(
    screen.getByText(
      "Up to 50 shows per save. The rest stay here for the next batch.",
    ),
  ).toBeVisible();
  // 62 rows: text queries and a direct click keep this test fast.
  fireEvent.click(screen.getByText("Select all valid"));
  expect(onSelect).toHaveBeenCalledWith(
    valid.slice(0, 50).map((candidate) => candidate.item_id),
  );
});

it("explains why nothing can be selected when no show is complete", async () => {
  const user = userEvent.setup();
  const { onSelect } = renderList({
    draft: {
      candidates: [
        { item_id: "a", date: "2027-03-02" },
        { item_id: "b", date: "2027-03-04" },
      ],
      selected: ["a"],
    },
  });
  const selectAll = screen.getByRole("button", { name: "Select all valid" });
  expect(selectAll).toBeDisabled();
  expect(screen.getByText("No show is complete yet.")).toBeVisible();
  expect(selectAll).not.toHaveAttribute("title");
  await user.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(onSelect).toHaveBeenCalledWith([]);
});

it("fills the artist for every unsaved show when none is selected", async () => {
  const user = userEvent.setup();
  const { onFill } = renderList({
    draft: {
      candidates: [
        { item_id: "a", date: "2027-03-02" },
        { item_id: "b", date: "2027-03-04" },
        { item_id: "c", date: "2027-03-06" },
      ],
      selected: [],
    },
    outcomes: [{ item_id: "a", show_id: 7, status: "created" }],
  });
  const panel = screen.getByRole("group", { name: "Fill in several shows" });
  const apply = within(panel).getByRole("button", {
    name: "Apply to all 2 unsaved shows",
  });
  expect(apply).toBeDisabled();
  const artist = screen.getByLabelText("Artist for several shows");
  await user.type(artist, "Band");
  await user.click(apply);
  expect(onFill).toHaveBeenCalledWith({ artist_name: "Band" }, ["b", "c"]);
  expect(artist).toHaveValue("");
  await user.type(
    screen.getByLabelText("Country code for several shows"),
    "es",
  );
  await user.keyboard("{Enter}");
  expect(onFill).toHaveBeenLastCalledWith({ country_code: "es" }, ["b", "c"]);
  expect(screen.getByLabelText("Country code for several shows")).toHaveValue(
    "",
  );
});

it("fills only the selected shows when some are selected", async () => {
  const user = userEvent.setup();
  const { onFill } = renderList({
    draft: {
      candidates: [
        { item_id: "a", date: "2027-03-02" },
        { item_id: "b", date: "2027-03-04" },
        { item_id: "c", date: "2027-03-06" },
      ],
      selected: ["b"],
    },
  });
  await user.type(screen.getByLabelText("Artist for several shows"), "Band");
  await user.click(
    screen.getByRole("button", { name: "Apply to 1 selected show" }),
  );
  expect(onFill).toHaveBeenCalledWith({ artist_name: "Band" }, ["b"]);
});

it("removes only unsaved shows while several remain", async () => {
  const onRemove = vi.fn();
  const user = userEvent.setup();
  renderList({
    draft: {
      candidates: [
        { item_id: "a", date: "2027-03-02" },
        { item_id: "b", date: "2027-03-04" },
      ],
      selected: [],
    },
    outcomes: [{ item_id: "a", show_id: 7, status: "created" }],
    onRemove,
  });
  expect(screen.queryByRole("button", { name: "Remove show 1" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Remove show 2" }));
  expect(onRemove).toHaveBeenCalledWith("b");
});

it("never offers to remove an imported show", () => {
  renderList({
    draft: {
      candidates: [
        { item_id: "a", date: "2027-03-02", source_draft_id: "draft-1" },
        { item_id: "b", date: "2027-03-04", source_draft_id: "draft-1" },
        { item_id: "c", date: "2027-03-06" },
      ],
      selected: [],
    },
    onRemove: vi.fn(),
  });
  expect(screen.queryByRole("button", { name: "Remove show 1" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove show 2" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Remove show 3" }),
  ).toBeInTheDocument();
});

it("shows source and model, with full evidence in the shared tooltip", async () => {
  const user = userEvent.setup();
  renderList({
    draft: {
      candidates: [
        {
          ...complete("a"),
          source_ref: "upload:0f3c",
          evidence: "MAR 02 SALA NORTE",
          extractor_model: "gemini/gemini-3.8-flash",
        },
      ],
      selected: [],
    },
  });
  expect(screen.getByText("Source: Uploaded image")).toBeVisible();
  expect(screen.getByText("From the source")).toBeVisible();
  const evidence = screen.getByText("MAR 02 SALA NORTE");
  expect(evidence).not.toHaveAttribute("title");
  await user.hover(evidence);
  expect(await screen.findByRole("tooltip")).toHaveTextContent(
    "MAR 02 SALA NORTE",
  );
  expect(screen.getByText("Read by gemini-3.8-flash")).toBeVisible();
  expect(document.body.textContent).not.toContain("upload:");
  expect(document.body.textContent).not.toContain("gemini/");
});

it("uses design-system controls only", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  const { container } = render(
    <ShowCandidateList
      draft={{ candidates: [complete("a"), complete("b")], selected: ["a"] }}
      outcomes={[]}
      locked={false}
      showMissing={() => false}
      onChange={onChange}
      onSelect={vi.fn()}
      onFill={vi.fn()}
    />,
  );
  const toggle = screen.getByRole("button", {
    name: "More details for show 1",
  });
  expect(toggle).toHaveTextContent(/^More details$/);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(toggle).toHaveTextContent("Fewer details");
  expect(toggle).toHaveAccessibleName("Fewer details for show 1");
  expect(
    screen.getByRole("button", { name: "More details for show 2" }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByLabelText("Timezone for show 1")).toHaveAttribute(
    "maxlength",
    "64",
  );
  expect(screen.getByLabelText("Postal code for show 1")).toHaveAttribute(
    "maxlength",
    "32",
  );
  expect(
    document.getElementById(toggle.getAttribute("aria-controls")!),
  ).toBeVisible();
  expect(screen.getByLabelText("Timezone for show 1")).toHaveAttribute(
    "placeholder",
    "Europe/Madrid",
  );
  await user.click(screen.getByRole("combobox", { name: "Status for show 1" }));
  await user.click(screen.getByRole("option", { name: "On sale" }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ item_id: "a", status: "onsale" }),
  );
  await user.type(screen.getByLabelText("Lineup for show 1"), "A, B");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ item_id: "a", lineup: ["A", "B"] }),
  );
  await user.type(screen.getByLabelText("Latitude for show 1"), "4");
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ item_id: "a", latitude: 4 }),
  );
  expect(
    container.querySelector(
      'select, details, pre, input[type="checkbox"]:not([aria-hidden]), input[type="radio"]:not([aria-hidden])',
    ),
  ).toBeNull();
});

it("heads each row at level 3, under the panel's level-2 title", () => {
  renderList({
    draft: { candidates: [complete("a"), complete("b")], selected: [] },
  });
  expect(
    screen.getByRole("heading", { level: 3, name: /^Show 1 · / }),
  ).toBeVisible();
  expect(screen.queryAllByRole("heading", { level: 4 })).toHaveLength(0);
});

it("keeps the single show's details toggle named without a row number", async () => {
  const user = userEvent.setup();
  render(
    <ShowCandidateFields
      candidate={complete("a")}
      index={null}
      locked={false}
      showMissing={false}
      onChange={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: "More details" }));
  expect(screen.getByLabelText("Timezone")).toHaveAttribute("maxlength", "64");
  expect(screen.getByLabelText("Postal code")).toHaveAttribute(
    "maxlength",
    "32",
  );
});
