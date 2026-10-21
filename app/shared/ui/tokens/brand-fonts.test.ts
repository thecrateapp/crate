import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

const fonts = resolve(process.cwd(), "../fonts");
const read = (path: string) => readFileSync(resolve(fonts, path), "utf8");

describe("shared brand font packaging", () => {
  it.each(["ibm-plex-sans"])(
    "%s ships verified Latin and extended Latin with its license",
    (family) => {
      const source = JSON.parse(read(`${family}/sources.json`));
      const css = read("ibm-plex-sans.css");
      expect(read(`${family}/OFL.txt`)).toContain("SIL OPEN FONT LICENSE");
      expect(source.files).toHaveLength(2);
      for (const file of source.files) {
        const bytes = readFileSync(resolve(fonts, `${family}/${file.file}`));
        expect(bytes.subarray(0, 4).toString()).toBe("wOF2");
        expect(bytes.length).toBe(file.bytes);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          file.sha256,
        );
        expect(css).toContain(`url(${family}/${file.file})`);
      }
      expect(css).toContain("font-weight: 100 700");
      expect(css).not.toMatch(/url\(https?:/);
    },
  );

  it("loads the same self-hosted fonts for Admin, Listen and the native shell", () => {
    for (const app of ["listen", "ui"]) {
      const css = readFileSync(
        resolve(fonts, `../../${app}/src/index.css`),
        "utf8",
      );
      expect(css).toContain('fonts/ibm-plex-sans.css"');
      expect(css).toContain('fonts/bricolage-grotesque.css"');
      expect(css).toContain('fonts/jetbrains-mono.css"');
      expect(css).not.toMatch(/fonts\/(?:poppins|hubot-mona|saira)\.css/);
    }
    const main = readFileSync(
      resolve(fonts, "../../listen/src/main.tsx"),
      "utf8",
    );
    expect(main).not.toContain("fonts/poppins.css");
    const desktop = readFileSync(
      resolve(fonts, "../../listen-desktop/src/main.tsx"),
      "utf8",
    );
    expect(desktop).toContain("listen/src/index.css");
    expect(desktop).not.toContain("fonts/poppins.css");
  });
});
