import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CrateCard } from "@/components/CrateCard";
import { I18nProvider } from "@/i18n";

const crate = {
  id: "crate-1",
  owner_id: 1,
  owner_name: "Listener",
  name: "Year-end records",
  description: "",
  visibility: "public" as const,
  is_collaborative: false,
  access: "owner" as const,
  album_count: 1,
  first_album: null,
};

describe("CrateCard", () => {
  it("exposes contextual actions alongside the crate card", () => {
    render(
      <I18nProvider initialLocale="en">
        <CrateCard crate={crate} onOpen={() => {}} onEdit={() => {}} />
      </I18nProvider>,
    );

    expect(screen.getByRole("button", { name: "More actions" })).toBeVisible();
  });
});
