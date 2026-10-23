import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  RELATION_EDITOR_CONFIG,
  sameTaxonomyRelations,
  TaxonomyDerivedRelationField,
  TaxonomyRelationField,
} from "./TaxonomyRelationField";

describe("TaxonomyRelationField", () => {
  it("adds and removes taxonomy nodes and saves the selected relation", () => {
    const onChange = vi.fn();
    render(
      <TaxonomyRelationField
        config={RELATION_EDITOR_CONFIG[0]}
        value={["hardcore"]}
        options={[
          { slug: "hardcore", name: "Hardcore" },
          { slug: "punk", name: "Punk" },
        ]}
        sourceSlug="rock"
        onChange={onChange}
      />,
    );

    expect(screen.getAllByText("hardcore")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove hardcore" }));
    expect(onChange).toHaveBeenLastCalledWith([]);

    fireEvent.change(screen.getByRole("textbox", { name: "Search parents" }), {
      target: { value: "punk" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Punk/ }));
    expect(onChange).toHaveBeenLastCalledWith(["hardcore", "punk"]);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("uses a unique accessible input id for each relationship field", () => {
    const options = [{ slug: "rock", name: "Rock" }];
    render(
      <>
        {RELATION_EDITOR_CONFIG.slice(0, 2).map((config) => (
          <TaxonomyRelationField
            key={config.key}
            config={config}
            value={[]}
            options={options}
            sourceSlug="punk"
            onChange={vi.fn()}
          />
        ))}
      </>,
    );

    const inputs = screen.getAllByRole("textbox");
    expect(inputs).toHaveLength(2);
    expect(inputs[0]?.id).not.toBe(inputs[1]?.id);
  });

  it("compares relationship slugs independent of casing and order", () => {
    expect(sameTaxonomyRelations(["metal", "punk"], ["PUNK", "metal"])).toBe(
      true,
    );
    expect(sameTaxonomyRelations(["metal"], ["metal", "punk"])).toBe(false);
  });

  it("renders reverse relationships as reusable genre pills", async () => {
    render(
      <TaxonomyDerivedRelationField
        label="Influences"
        helper="Derived from other genres’ influenced-by links."
        value={["post-hardcore"]}
        options={[{ slug: "post-hardcore", name: "Post-hardcore" }]}
      />,
    );

    const field = screen.getByRole("region", {
      name: "Influences relationships",
    });
    expect(field).toHaveTextContent(
      "Derived from other genres’ influenced-by links.",
    );
    const pill = screen.getByText("post-hardcore").closest(".genre-pill");
    expect(pill).toBeInTheDocument();
    await userEvent.hover(screen.getByText("post-hardcore"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Post-hardcore · post-hardcore",
    );
  });

  it("shows an empty state for a derived relationship with no sources", () => {
    render(
      <TaxonomyDerivedRelationField
        label="Influences"
        helper="Derived reverse view."
        value={[]}
        options={[]}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Influences relationships" }),
    ).toHaveTextContent("No genres linked in this direction.");
  });
});
