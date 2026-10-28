import { describe, expect, it } from "vitest";
import { parseScreen, screenText, type ScreenLine } from "./terminal-screen";

const RULE = `  ${"─".repeat(20)}`;
const styles = (line: ScreenLine) =>
  line.segs.map((seg) => [seg.text, seg.style]);

describe("parseScreen", () => {
  it("keeps every character of the recording, so alignment survives", () => {
    const source = `
you@homeserver:~$ crate install

  STEP 1 OF 7
${RULE}
  Checking this machine
  Crate runs as a set of Docker containers.

  ● System          Linux (debian)
  ● Docker          not checked in a dry run
`;
    expect(screenText(parseScreen(source))).toBe(
      source.trim().replace(/^/, ""),
    );
  });

  it("reads the step header: muted counter, hairline rule, bold title, muted description", () => {
    const { lines } = parseScreen(`
  STEP 3 OF 7
${RULE}
  How you will reach Crate
  Pick how browsers and the mobile apps find this server.
`);
    expect(lines.map((line) => line.kind)).toEqual([
      "counter",
      "rule",
      "title",
      "text",
    ]);
    expect(lines[1]!.segs[1]).toEqual({ text: "─".repeat(20), style: "faint" });
    expect(lines[2]!.segs[0]!.style).toBe("title");
    expect(lines[3]!.segs[0]!.style).toBe("muted");
  });

  it("colours status dots in order and splits the row into a label and a muted detail", () => {
    const { lines } = parseScreen(
      `
  ● Memory          8 GB
  ● Docker          not checked in a dry run
`,
      { dots: ["ok", "info"] },
    );
    expect(
      lines.map((line) => line.segs.find((seg) => seg.style === "dot")?.tone),
    ).toEqual(["ok", "info"]);
    expect(styles(lines[0]!).slice(3)).toEqual([
      ["Memory          ", "text"],
      ["8 GB", "muted"],
    ]);
  });

  it("keeps a wrapped note bright, including its indented continuation", () => {
    const { lines } = parseScreen(
      `
  ● The music folder does not exist yet. Crate will create it; copy your
    albums there whenever you like.
`,
      { dots: ["warn"] },
    );
    expect(lines[0]!.segs[1]).toEqual({
      text: "●",
      style: "dot",
      tone: "warn",
    });
    expect(lines[1]!.segs).toEqual([
      { text: "    albums there whenever you like.", style: "text" },
    ]);
  });

  it("turns the focused form into a bar with an accent title, muted description and the cursor row", () => {
    const { lines } = parseScreen(`
┃ Access
┃   Ports  ·  http://localhost:8581 on this machine and your network
┃ > Public HTTPS  ·  your own domain through Cloudflare
`);
    expect(
      lines.every((line) => line.focus && line.segs[0]!.style === "bar"),
    ).toBe(true);
    expect(lines[0]!.kind).toBe("title");
    expect(lines[0]!.segs.at(-1)).toEqual({ text: "Access", style: "strong" });
    expect(lines[1]!.cursor).toBeUndefined();
    expect(lines[2]!.cursor).toBe(true);
    expect(lines[2]!.segs.at(-1)).toEqual({
      text: "> Public HTTPS  ·  your own domain through Cloudflare",
      style: "accent",
    });
  });

  it("reads multi-select options: selected names in accent, taglines muted, recommended in accent", () => {
    const { lines } = parseScreen(`
┃ What do you want to set up now?
┃ Space selects, enter continues. Nothing is required.
┃   ● Last.fm              biographies, tags and similar artists  recommended
┃ > ○ Agents (MCP)         Claude, Codex and other agents
`);
    expect(lines[1]!.segs.at(-1)!.style).toBe("muted");
    expect(styles(lines[2]!).slice(2)).toEqual([
      ["  ", "text"],
      ["● ", "accent"],
      ["Last.fm              ", "accent"],
      ["biographies, tags and similar artists  ", "muted"],
      ["recommended", "accent"],
    ]);
    expect(lines[3]!.cursor).toBe(true);
    expect(styles(lines[3]!).slice(2, 4)).toEqual([
      ["> ", "accent"],
      ["○ ", "muted"],
    ]);
  });

  it("renders confirm buttons with their padding and marks the focused one", () => {
    const { lines } = parseScreen(
      `
┃ Install Crate now?
┃
┃                                 Yes     No
`,
      { button: "Yes" },
    );
    const buttons = lines[2]!.segs.filter((seg) =>
      seg.style.startsWith("button"),
    );
    expect(buttons).toEqual([
      { text: "  Yes  ", style: "button-on" },
      { text: "  No  ", style: "button" },
    ]);
    expect(screenText({ lines: [lines[2]!], cols: 0 })).toBe(
      "┃                                 Yes     No",
    );
  });

  it("dims blurred fields and keeps the input prompt in accent", () => {
    const { lines } = parseScreen(`
  Timezone
  Used for listening stats and the nightly maintenance window.
  > Europe/Madrid

  Repeat the password
  >
`);
    expect(styles(lines[0]!)).toEqual([["  Timezone", "muted"]]);
    expect(styles(lines[2]!)).toEqual([
      ["  ", "text"],
      [">", "accent"],
      [" Europe/Madrid", "text"],
    ]);
    expect(styles(lines[5]!)).toEqual([
      ["  ", "text"],
      [">", "accent"],
    ]);
  });

  it("splits key hints into keys and faint descriptions", () => {
    const { lines } = parseScreen("shift+tab back • enter submit");
    expect(lines[0]!.kind).toBe("hint");
    expect(styles(lines[0]!)).toEqual([
      ["shift+tab", "key"],
      [" back", "faint"],
      [" • ", "faint"],
      ["enter", "key"],
      [" submit", "faint"],
    ]);
  });

  it("reads review rows, uppercase headings and elided output", () => {
    const { lines } = parseScreen(`
  Install folder  /home/you/crate

  FILES
  Write the Crate compose stack  /home/you/crate/docker-compose.yaml
  ⋮
`);
    expect(styles(lines[0]!)).toEqual([
      ["  Install folder  ", "muted"],
      ["/home/you/crate", "text"],
    ]);
    expect(lines[2]!.kind).toBe("heading");
    expect(lines[3]!.segs.at(-1)!.text).toBe(
      "/home/you/crate/docker-compose.yaml",
    );
    expect(lines[4]!.kind).toBe("gap");
  });

  it("applies strong and muted marks, flags scrollback context and measures the widest line", () => {
    const screen = parseScreen(
      `
  ● Earlier output

  Review
  Nothing has been written yet.
  Password  4c1e9a07b2d85f36e0a1c7d4
`,
      { context: 2, strong: ["4c1e9a07b2d85f36e0a1c7d4"], muted: ["Review"] },
    );
    expect(screen.lines.map((line) => !!line.context)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(screen.lines[2]!.segs[0]!.style).toBe("muted");
    expect(screen.lines[4]!.segs.at(-1)).toEqual({
      text: "4c1e9a07b2d85f36e0a1c7d4",
      style: "strong",
    });
    expect(screen.cols).toBe("  Password  4c1e9a07b2d85f36e0a1c7d4".length);
  });
});
