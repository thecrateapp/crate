import { describe, expect, it } from "vitest";

import { expectRequestRejection } from "./expect-request-rejection";

describe("expectRequestRejection", () => {
  it("accepts a rejected request", async () => {
    await expect(
      expectRequestRejection(
        Promise.reject(new Error("connection refused")),
        "unexpected success",
      ),
    ).resolves.toBeUndefined();
  });

  it("fails when a request resolves", async () => {
    await expect(
      expectRequestRejection(
        Promise.resolve(new Response()),
        "unexpected success",
      ),
    ).rejects.toThrow("unexpected success");
  });
});
