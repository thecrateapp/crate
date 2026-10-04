import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ArtistBioProfile } from "./ArtistBioProfile";

describe("ArtistBioProfile", () => {
  it("renders the full multi-paragraph bio and grouped member tables", () => {
    render(
      <ArtistBioProfile
        artistName="Denzel Curry"
        bio={"First paragraph.\n\nSecond paragraph."}
        bioExpanded
        libraryStats={{ albums: 4, tracks: 42, sizeMb: 128 }}
        members={[
          { name: "Current Member", roles: ["vocals"], begin: "2020" },
          {
            name: "Former Member",
            roles: ["guitar"],
            begin: "2015",
            end: "2019",
          },
        ]}
      />,
    );

    expect(screen.getByText("First paragraph.")).toBeInTheDocument();
    expect(screen.getByText("Second paragraph.")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("128 MB")).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Current members" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Former members" }),
    ).toBeInTheDocument();
  });

  it("formats partial and full member dates for readable table cells", () => {
    render(
      <ArtistBioProfile
        artistName="Example Band"
        bio="Band biography."
        members={[
          { name: "Former Member", begin: "1994-10", end: "1998-08-28" },
        ]}
      />,
    );

    expect(screen.getByRole("cell", { name: "Oct 1994" })).toHaveClass(
      "whitespace-nowrap",
    );
    expect(screen.getByRole("cell", { name: "28 Aug 1998" })).toHaveClass(
      "whitespace-nowrap",
    );
    expect(screen.queryByText("1994-10")).not.toBeInTheDocument();
  });

  it("renders consumer-provided labels and keeps English defaults for the rest", () => {
    render(
      <ArtistBioProfile
        artistName="Example Band"
        bio="Band biography."
        stats={{ listeners: 1200 }}
        libraryStats={{ albums: 2, tracks: 20, sizeMb: 64 }}
        labels={{
          biography: "Biografía",
          currentMembers: "Miembros actuales",
          formerMembers: "Antiguos miembros",
          member: "Miembro",
          role: "Rol",
          since: "Desde",
          from: "Inicio",
          to: "Fin",
          unknown: "Desconocido",
          listeners: "oyentes",
          albums: "álbumes",
        }}
        members={[
          { name: "Current Member", roles: ["vocals"] },
          { name: "Former Member", begin: "2015", end: "2019" },
        ]}
      />,
    );

    expect(screen.getByText("Biografía")).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Miembros actuales" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("table", { name: "Antiguos miembros" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("columnheader", { name: "Miembro" }),
    ).toHaveLength(2);
    expect(screen.getAllByRole("columnheader", { name: "Rol" })).toHaveLength(
      2,
    );
    expect(
      screen.getByRole("columnheader", { name: "Desde" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Inicio" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Fin" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "Desconocido" }),
    ).toBeInTheDocument();
    expect(screen.getByText("oyentes")).toBeInTheDocument();
    expect(screen.getByText(/álbumes/)).toBeInTheDocument();
    expect(screen.getByText(/tracks/)).toBeInTheDocument();
    expect(screen.queryByText("Current members")).not.toBeInTheDocument();
  });
});
