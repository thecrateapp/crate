import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { renderWithAdminProviders } from "@/test/render-with-admin-providers";
import {
  NOT_CONFIGURED_SUMMARY,
  sampleSummary,
  sampleSync,
} from "@/test/error-inbox-fixtures";

import { ErrorsTile } from "./ErrorsTile";

const only = (...granted: string[]) => ({
  hasCapability: (capability: string) => granted.includes(capability),
  hasAnyCapability: (required: readonly string[]) =>
    required.some((item) => granted.includes(item)),
});

function tile(label: string) {
  return screen
    .getByText(label, { exact: true })
    .closest<HTMLElement>("div.\\@container")!;
}

describe("ErrorsTile", () => {
  it("links to errors page", () => {
    const summary = sampleSummary();
    renderWithAdminProviders(<ErrorsTile errors={summary} />);

    expect(screen.getByRole("link", { name: "Open errors" })).toHaveAttribute(
      "href",
      "/errors",
    );
    expect(within(tile("Open")).getByText("7")).toBeInTheDocument();
    expect(within(tile("Critical")).getByText("3")).toBeInTheDocument();
    expect(within(tile("New 24h")).getByText("2")).toBeInTheDocument();
    expect(within(tile("Regressions 24h")).getByText("1")).toBeInTheDocument();

    const top = screen.getByRole("list", { name: "Top of the critical lane" });
    const links = within(top).getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveTextContent(
      "UpstreamUnavailable: api-unavailable (502)",
    );
    expect(links[0]).toHaveAttribute(
      "href",
      `/errors/${summary.top_critical[0]!.id}`,
    );
  });

  it("renders unavailable when missing", () => {
    const { unmount } = renderWithAdminProviders(
      <ErrorsTile errors={undefined} />,
    );
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("The error summary is unavailable in this sample."),
    ).toBeInTheDocument();
    unmount();

    renderWithAdminProviders(<ErrorsTile errors={null} />);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Open")).not.toBeInTheDocument();
  });

  it("says when error tracking is not configured", () => {
    renderWithAdminProviders(<ErrorsTile errors={NOT_CONFIGURED_SUMMARY} />);

    expect(screen.getByText("Not configured")).toBeInTheDocument();
    expect(
      screen.getByText(/Error tracking is not set up/),
    ).toBeInTheDocument();
  });

  it("reports a failed sync in plain words", () => {
    renderWithAdminProviders(
      <ErrorsTile
        errors={sampleSummary({
          sync: sampleSync({ status: "failed", error_code: "SENTRY_AUTH" }),
        })}
      />,
    );

    expect(screen.getByText("Sync failed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sentry rejected the token",
    );
  });

  it("does not link people who cannot open the inbox", () => {
    // The API drops issue titles (event text) for people without ops.errors.view.
    const summary = sampleSummary();
    const withoutTitles = {
      ...summary,
      top_critical: summary.top_critical.map((issue) => ({
        id: issue.id,
        short_id: issue.short_id,
        service: issue.service,
        crate_score: issue.crate_score,
      })),
    };
    renderWithAdminProviders(<ErrorsTile errors={withoutTitles} />, {
      auth: only("ops.health.view"),
    });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("CRATE-READPLANE-2D")).toBeInTheDocument();
    expect(
      screen.queryByText("UpstreamUnavailable: api-unavailable (502)"),
    ).not.toBeInTheDocument();
  });

  it("renders without an auth provider, as in previews", () => {
    render(
      <MemoryRouter>
        <ErrorsTile errors={sampleSummary()} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
