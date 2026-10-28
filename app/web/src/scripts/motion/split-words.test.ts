import { describe, expect, it } from "vitest";
import { splitWords } from "./split-words";

describe("splitWords", () => {
  it("wraps each word in a masked span and keeps the text accessible", () => {
    const p = document.createElement("p");
    p.innerHTML =
      'Own your music. <span class="hl">Refuse the middleman.</span>';
    splitWords(p);
    expect(p.getAttribute("aria-label")).toBe(
      "Own your music. Refuse the middleman.",
    );
    expect(p.querySelectorAll(".w").length).toBe(6);
    expect(p.querySelector(".hl .w")?.textContent).toBe("Refuse");
    const order = [...p.querySelectorAll<HTMLElement>(".w")].map((w) =>
      w.style.getPropertyValue("--i"),
    );
    expect(order).toEqual(["0", "1", "2", "3", "4", "5"]);
  });
});
