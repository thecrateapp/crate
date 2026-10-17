import { expect, it } from "vitest";
import { showPayload } from "./show-import-types";

it("sends an explicit clear for optional fields on an exactly selected existing show", () => {
  expect(
    showPayload({
      item_id: "one",
      existing_show_id: 7,
      expected_revision: 2,
      local_time: "",
      tickets_url: "",
      timezone: "",
    }),
  ).toEqual({
    item_id: "one",
    existing_show_id: 7,
    expected_revision: 2,
    local_time: null,
    tickets_url: null,
    timezone: null,
  });
});

it("keeps empty fields of a new draft unknown without claiming a correction", () => {
  expect(
    showPayload({ item_id: "new", local_time: "", tickets_url: "" }),
  ).toEqual({ item_id: "new" });
});
