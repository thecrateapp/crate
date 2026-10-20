import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ArtistBioProfile, mergeArtistBioMembers } from "./ArtistBioProfile";

describe("ArtistBioProfile", () => {
  it.each([true, false])(
    "uses the shared text-aligned dot action for biography expansion: %s",
    (expanded) => {
      const onToggle = vi.fn();
      render(
        <ArtistBioProfile
          artistName="Artist"
          bio={"Biography. ".repeat(80)}
          bioExpanded={expanded}
          onBioToggle={onToggle}
        />,
      );
      const label = expanded ? "Less" : "More";
      const action = screen.getByRole("button", { name: label, exact: true });
      expect(action).toHaveClass("link-accent", "p-0", "min-h-11");
      expect(within(action).getByText(label)).toHaveClass(
        "crate-mono-label",
        "uppercase",
        "text-accent-action-hi",
      );
      expect(action.querySelector(".crate-status-dot")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      expect(action.querySelector("svg")).toBeNull();
      fireEvent.click(action);
      expect(onToggle).toHaveBeenCalledOnce();
    },
  );
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

  it("merges roles for the same member and period into a single row", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    render(
      <ArtistBioProfile
        artistName="Kneecap"
        bio=""
        members={[
          { name: "Mo Chara", roles: ["vocals"], begin: "2017" },
          { name: "Mo Chara", roles: ["lyrics", "vocals"], begin: "2017" },
          { name: "Mo Chara", roles: ["bass"], begin: "2010", end: "2012" },
        ]}
      />,
    );

    const current = screen.getByRole("table", { name: "Current members" });
    const former = screen.getByRole("table", { name: "Former members" });
    expect(current.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(current).toHaveTextContent("vocals, lyrics");
    expect(former.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(former).toHaveTextContent("bass");
    expect(
      consoleError.mock.calls.some((call) =>
        String(call[0]).includes("same key"),
      ),
    ).toBe(false);
    consoleError.mockRestore();
  });

  it("keeps distinct periods for the same member as separate entries", () => {
    expect(
      mergeArtistBioMembers([
        { name: "A", roles: ["drums"], begin: "2000", end: "2004" },
        { name: "A", begin: "2000", end: "2004" },
        { name: "A", roles: ["drums"], begin: "2008" },
      ]),
    ).toEqual([
      { name: "A", roles: ["drums"], begin: "2000", end: "2004" },
      { name: "A", roles: ["drums"], begin: "2008" },
    ]);
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
  it("uses canonical captions and preserves real zero metrics without inventing missing ones", () => {
    render(
      <ArtistBioProfile
        artistName="Mixed Case Artist"
        bio="Natural case biography."
        stats={{ listeners: 0, spotifyPopularity: 0 }}
        libraryStats={{ albums: 0, tracks: 0, sizeMb: 0 }}
        members={[{ name: "Current Member", roles: ["vocals"] }]}
        meta={["Since 1991"]}
      />,
    );
    for (const caption of [
      "Biography",
      "Current members",
      "listeners",
      "popularity",
      "Since 1991",
      "Member",
    ]) {
      expect(
        screen.getByText(caption).closest(".font-mono.uppercase"),
      ).toBeInTheDocument();
    }
    expect(screen.getByText("listeners")).toBeInTheDocument();
    expect(screen.queryByText("followers")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Mixed Case Artist" }),
    ).not.toHaveClass("uppercase");
    expect(
      screen.getByRole("heading", { name: "Mixed Case Artist" }),
    ).toHaveClass("font-display");
    expect(screen.getByText("Natural case biography.")).not.toHaveClass(
      "uppercase",
    );
    expect(
      screen.getByRole("group", { name: "Biography" }),
    ).toBeInTheDocument();
  });
  it("uses canonical text links and disclosure while preserving callback authority", () => {
    const onOpen = vi.fn(),
      onToggle = vi.fn();
    render(
      <ArtistBioProfile
        artistName="Artist"
        bio={"Biography. ".repeat(80)}
        onBioToggle={onToggle}
        urls={[{ type: "official homepage", url: "https://example.com" }]}
        onExternalLink={onOpen}
      />,
    );
    const link = screen.getByRole("link", { name: "Website" });
    expect(link).toHaveAttribute("data-slot", "button");
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledWith("https://example.com");
    fireEvent.click(screen.getByRole("button", { name: "Less" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
  it("preserves injected artwork without a URL and gives it priority over the native image", () => {
    const { rerender } = render(
      <ArtistBioProfile
        artistName="Artist"
        bio=""
        photoContent={<img src="/managed-artwork.jpg" alt="Managed artwork" />}
      />,
    );
    expect(
      screen.getByRole("img", { name: "Managed artwork" }),
    ).toHaveAttribute("src", "/managed-artwork.jpg");
    rerender(
      <ArtistBioProfile
        artistName="Artist"
        bio=""
        photoUrl="/other-artwork.jpg"
        photoContent={<img src="/managed-artwork.jpg" alt="Managed artwork" />}
      />,
    );
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(
      screen.getByRole("img", { name: "Managed artwork" }),
    ).toHaveAttribute("src", "/managed-artwork.jpg");
  });
});
