import { createRef } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from "./card";

describe("Card object composition", () => {
  it("supports a named native article and semantic title without swallowing actions or content", async () => {
    const click = vi.fn();
    render(
      <Card as="article" aria-labelledby="title">
        <CardHeader>
          <CardTitle as="h2" id="title">
            Saved query
          </CardTitle>
          <CardDescription>Tracks matching this query.</CardDescription>
          <CardAction>
            <button type="button" onClick={click}>
              Edit
            </button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <a href="#tracks">0 tracks</a>
        </CardContent>
        <CardFooter>Updated today</CardFooter>
      </Card>,
    );
    const card = screen.getByRole("article", { name: "Saved query" });
    expect(
      within(card).getByRole("heading", { level: 2, name: "Saved query" }),
    ).toBeVisible();
    expect(within(card).getByText("Tracks matching this query.")).toBeVisible();
    expect(within(card).getByRole("link")).toHaveAttribute("href", "#tracks");
    expect(within(card).getByText("Updated today")).toBeVisible();
    await userEvent.click(within(card).getByRole("button", { name: "Edit" }));
    expect(click).toHaveBeenCalledOnce();
  });
  it("retains div defaults, native refs and caller layout props", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Card ref={ref} data-testid="object" className="mt-4">
        <CardContent>{0}</CardContent>
      </Card>,
    );
    expect(ref.current).toBe(screen.getByTestId("object"));
    expect(ref.current?.tagName).toBe("DIV");
    expect(ref.current).toHaveClass("mt-4");
    expect(ref.current).toHaveTextContent("0");
  });
});
