import { describe, expect, it } from "vitest";

import { AdminSelect as SharedAdminSelect } from "@crate/ui/composites/AdminSelect";
import { AdminSelect } from "./AdminSelect";

describe("AdminSelect shared foundation", () => {
  it("uses the shared implementation", () => {
    expect(AdminSelect).toBe(SharedAdminSelect);
  });
});
