import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INSTALL_PACKAGES,
  KEY_FINGERPRINT,
  KEY_PATH,
  KEY_URL,
  PACMAN_CONF,
  REPO_URL,
  RYOKU_FORK_URL,
  RYOKU_REPO,
  STOCK_RYOKU,
  TRUST_KEY,
} from "./install";

/** The v4 fingerprint of the first key in an ASCII-armored OpenPGP block (RFC 4880 §12.2). */
function armoredFingerprint(armored: string): string {
  const body = armored
    .split("\n")
    .filter(
      (line) => line && !line.startsWith("-----") && !line.startsWith("="),
    )
    .filter((line) => !line.includes(": "))
    .join("");
  const bytes = Buffer.from(body, "base64");
  const tag = bytes[0];
  expect(tag & 0x80).toBe(0x80);
  let length: number;
  let start: number;
  if (tag & 0x40) {
    // new format: tag 6 (public key), one- or two-octet length
    expect(tag & 0x3f).toBe(6);
    if (bytes[1] < 192) {
      length = bytes[1];
      start = 2;
    } else {
      length = ((bytes[1] - 192) << 8) + bytes[2] + 192;
      start = 3;
    }
  } else {
    // old format: tag 6, length type 0 or 1
    expect((tag >> 2) & 0x0f).toBe(6);
    const lengthBytes = 1 << (tag & 0x03);
    length = bytes.readUIntBE(1, lengthBytes);
    start = 1 + lengthBytes;
  }
  const packet = bytes.subarray(start, start + length);
  expect(packet[0]).toBe(4);
  const header = Buffer.from([0x99, length >> 8, length & 0xff]);
  return createHash("sha1")
    .update(header)
    .update(packet)
    .digest("hex")
    .toUpperCase();
}

describe("the signed repository", () => {
  it("serves the key whose fingerprint the page shows", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const armored = readFileSync(join(here, "../../public", KEY_PATH), "utf8");
    expect(armored).toContain("BEGIN PGP PUBLIC KEY BLOCK");
    expect(armored).not.toContain("PRIVATE");
    expect(armoredFingerprint(armored)).toBe(KEY_FINGERPRINT);
  });

  it("requires signatures and points at the crate-for-ryoku repo release", () => {
    expect(PACMAN_CONF).toBe(
      [
        "[crate-for-ryoku]",
        "SigLevel = Required",
        "Server = https://github.com/thecrateapp/crate-for-ryoku/releases/download/repo",
      ].join("\n"),
    );
    expect(PACMAN_CONF).not.toContain("TrustAll");
    expect(REPO_URL).not.toContain("thecrateapp/ryoku/");
  });

  it("checks the key before trusting it, and locally signs it by full fingerprint", () => {
    const lines = TRUST_KEY.split("\n");
    expect(lines).toEqual([
      `curl -fsSLO ${KEY_URL}`,
      "gpg --show-keys crate-for-ryoku.gpg",
      "sudo pacman-key --add crate-for-ryoku.gpg",
      `sudo pacman-key --lsign-key ${KEY_FINGERPRINT}`,
    ]);
    expect(KEY_FINGERPRINT).toMatch(/^[0-9A-F]{40}$/);
    expect(KEY_URL).toBe("https://ryoku.cratemusic.app/crate-for-ryoku.gpg");
  });

  it("installs the mod and the desktop app from the repository", () => {
    expect(INSTALL_PACKAGES).toBe(
      "sudo pacman -Syu crate-for-ryoku crate-desktop-bin",
    );
  });

  it("goes above the stock Ryoku repository it shadows", () => {
    expect(RYOKU_REPO).toBe("ryoku");
    expect(PACMAN_CONF).not.toContain(`[${RYOKU_REPO}]`);
    expect(RYOKU_FORK_URL).toBe("https://github.com/thecrateapp/ryoku");
  });

  it("goes back to stock Ryoku by letting pacman downgrade", () => {
    expect(STOCK_RYOKU).toBe("sudo pacman -Syuu");
  });
});
