import { describe, expect, it } from "vitest";

import fixtures from "../fixtures/protocol-v1.json";
import { parseCastProtocolMessage } from "./protocol";

describe("cross-platform Cast protocol fixtures", () => {
  it.each(Object.entries(fixtures))("validates %s", (_name, message) => {
    expect(parseCastProtocolMessage(message).ok).toBe(true);
  });
});
