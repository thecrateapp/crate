export type Tone = "ok" | "warn" | "fail" | "info";

export type SegStyle =
  | "text"
  | "muted"
  | "title"
  | "accent"
  | "strong"
  | "key"
  | "faint"
  | "dot"
  | "bar"
  | "button"
  | "button-on";

export interface Seg {
  text: string;
  style: SegStyle;
  tone?: Tone;
}

export type LineKind =
  | "blank"
  | "prompt"
  | "counter"
  | "rule"
  | "title"
  | "text"
  | "heading"
  | "hint"
  | "gap";

export interface ScreenLine {
  kind: LineKind;
  segs: Seg[];
  focus?: boolean;
  cursor?: boolean;
  context?: boolean;
}

export interface ScreenMarks {
  dots?: Tone[];
  context?: number;
  strong?: string[];
  muted?: string[];
  button?: string;
}

export interface Screen {
  lines: ScreenLine[];
  cols: number;
}

const FOCUS = "┃";
const PROMPT = /^(\S+@\S+\$) (.*)$/;
const RULE = /^(\s*)(─{3,})$/;
const COUNTER = /^\s*STEP \d+ OF \d+$/;
const HEADING = /^\s+[A-Z][A-Z ]*[A-Z]$/;
const DOT = /^(\s*)● (.*)$/;
const COLUMNS = /^(\s*)(\S.*?)(\s{2,})(\S.*)$/;
const INPUT = /^(\s*)>(?: (.*))?$/;
const OPTION = /^([> ]) ([●○]) (.*)$/;
const BUTTONS = /^(\s+)(\S+)(\s+)(\S+)$/;
const GAP = /^\s*⋮/;
const BUTTON_PAD = "  ";

const seg = (text: string, style: SegStyle, tone?: Tone): Seg =>
  tone ? { text, style, tone } : { text, style };
const bar = (rest = ""): Seg[] => [seg(FOCUS, "bar"), seg(` ${rest}`, "text")];

function columns(text: string, left: SegStyle, right: SegStyle): Seg[] {
  const match = COLUMNS.exec(text);
  if (!match) return [seg(text, left)];
  const [, indent, label, gap, value] = match;
  return [seg(`${indent}${label}${gap}`, left), seg(value!, right)];
}

function hint(text: string): Seg[] {
  return text.split(" • ").flatMap((item, index) => {
    const space = item.indexOf(" ");
    const parts =
      space < 0
        ? [seg(item, "key")]
        : [seg(item.slice(0, space), "key"), seg(item.slice(space), "faint")];
    return index ? [seg(" • ", "faint"), ...parts] : parts;
  });
}

function input(lead: Seg[], value: string | undefined): Seg[] {
  return [
    ...lead,
    seg(">", "accent"),
    ...(value ? [seg(` ${value}`, "text")] : []),
  ];
}

function option(text: string): ScreenLine {
  const [, cursor, mark, rest] = OPTION.exec(text)!;
  const on = mark === "●";
  const [, name, gap, tagline] = /^(\S.*?)(\s{2,})(.*)$/.exec(rest!) ?? [
    "",
    rest!,
    "",
    "",
  ];
  const recommended = /^(.*?\s{2,})(recommended)$/.exec(tagline!);
  const segs = [
    ...bar(),
    seg(`${cursor} `, cursor === ">" ? "accent" : "text"),
    seg(`${mark} `, on ? "accent" : "muted"),
    seg(`${name}${gap}`, on ? "accent" : "text"),
    ...(recommended
      ? [seg(recommended[1]!, "muted"), seg(recommended[2]!, "accent")]
      : tagline
        ? [seg(tagline, "muted")]
        : []),
  ];
  return { kind: "text", segs, focus: true, cursor: cursor === ">" };
}

function buttons(text: string, focused: string): ScreenLine | undefined {
  const match = BUTTONS.exec(text);
  if (!match || ![match[2], match[4]].includes(focused)) return undefined;
  const [, lead, a, between, b] = match;
  const style = (label: string): SegStyle =>
    label === focused ? "button-on" : "button";
  return {
    kind: "text",
    focus: true,
    segs: [
      ...bar(lead!.slice(BUTTON_PAD.length)),
      seg(`${BUTTON_PAD}${a}${BUTTON_PAD}`, style(a!)),
      seg(between!.slice(BUTTON_PAD.length * 2), "text"),
      seg(`${BUTTON_PAD}${b}${BUTTON_PAD}`, style(b!)),
    ],
  };
}

function focusBlock(block: string[], marks: ScreenMarks): ScreenLine[] {
  const inner = block.map((line) => line.slice(FOCUS.length).replace(/^ /, ""));
  const multi = inner.some((line) => OPTION.test(line));
  const select =
    !multi &&
    inner.some((line) => /^ {2}\S/.test(line)) &&
    inner.some((line) => line.startsWith("> "));
  let titled = false;
  return inner.map((text): ScreenLine => {
    if (!text.trim())
      return { kind: "blank", segs: [seg(FOCUS, "bar")], focus: true };
    if (multi && OPTION.test(text)) return option(text);
    const row = marks.button ? buttons(text, marks.button) : undefined;
    if (row) return row;
    if (select && text.startsWith("> "))
      return {
        kind: "text",
        segs: [...bar(), seg(text, "accent")],
        focus: true,
        cursor: true,
      };
    if (select && text.startsWith("  "))
      return { kind: "text", segs: bar(text), focus: true };
    const field = INPUT.exec(text);
    if (field)
      return {
        kind: "text",
        segs: input(bar(field[1]), field[2]),
        focus: true,
      };
    if (!titled) {
      titled = true;
      return {
        kind: "title",
        segs: [...bar(), seg(text, "strong")],
        focus: true,
      };
    }
    return { kind: "text", segs: [...bar(), seg(text, "muted")], focus: true };
  });
}

function blurredField(block: string[]): ScreenLine[] {
  return block.map((text, index): ScreenLine => {
    if (index < block.length - 1)
      return { kind: "text", segs: [seg(text, "muted")] };
    const [, indent, value] = INPUT.exec(text)!;
    return { kind: "text", segs: input([seg(indent!, "text")], value) };
  });
}

function paragraphAt(raw: string[], start: number): string[] {
  const paragraph: string[] = [];
  for (
    let i = start;
    i < raw.length && raw[i]!.trim() && !raw[i]!.startsWith(FOCUS);
    i++
  )
    paragraph.push(raw[i]!);
  return paragraph;
}

function isField(paragraph: string[]): boolean {
  return (
    paragraph.length > 1 &&
    INPUT.test(paragraph.at(-1)!) &&
    paragraph.slice(0, -1).every((line) => !INPUT.test(line))
  );
}

function restyle(line: ScreenLine, marks: ScreenMarks): ScreenLine {
  const strong = marks.strong ?? [];
  const muted = marks.muted ?? [];
  if (!strong.length && !muted.length) return line;
  const segs = line.segs.map((part): Seg => {
    const text = part.text.trim();
    if (strong.includes(text)) return { ...part, style: "strong" };
    if (muted.includes(text)) return { ...part, style: "muted" };
    return part;
  });
  return { ...line, segs };
}

export function parseScreen(source: string, marks: ScreenMarks = {}): Screen {
  const raw = source
    .replace(/^\n/, "")
    .replace(/\s+$/, "")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""));
  const dots = [...(marks.dots ?? [])];
  const lines: ScreenLine[] = [];
  let state: "body" | "title" | "description" | "note" = "body";

  for (let i = 0; i < raw.length; i++) {
    const text = raw[i]!;

    if (text.startsWith(FOCUS)) {
      const block: string[] = [];
      while (i < raw.length && raw[i]!.startsWith(FOCUS)) block.push(raw[i++]!);
      i--;
      lines.push(...focusBlock(block, marks));
      state = "body";
      continue;
    }
    if (!text.trim()) {
      lines.push({ kind: "blank", segs: [] });
      if (state !== "title") state = "body";
      continue;
    }
    const prompt = PROMPT.exec(text);
    if (prompt) {
      lines.push({
        kind: "prompt",
        segs: [seg(`${prompt[1]} `, "text"), seg(prompt[2]!, "text")],
      });
      continue;
    }
    if (COUNTER.test(text)) {
      lines.push({ kind: "counter", segs: [seg(text, "muted")] });
      state = "title";
      continue;
    }
    const rule = RULE.exec(text);
    if (rule) {
      lines.push({
        kind: "rule",
        segs: [seg(rule[1]!, "text"), seg(rule[2]!, "faint")],
      });
      continue;
    }
    if (state === "title") {
      lines.push({ kind: "title", segs: [seg(text, "title")] });
      state = "description";
      continue;
    }
    if (state === "description") {
      lines.push({ kind: "text", segs: [seg(text, "muted")] });
      continue;
    }
    if (GAP.test(text)) {
      lines.push({ kind: "gap", segs: [seg(text, "faint")] });
      continue;
    }
    if (!/^\s/.test(text)) {
      lines.push({ kind: "hint", segs: hint(text) });
      continue;
    }
    const dot = DOT.exec(text);
    if (dot) {
      const [, indent, rest] = dot;
      const row = /\S\s{2,}\S/.test(rest!);
      const body = row ? columns(rest!, "text", "muted") : [seg(rest!, "text")];
      lines.push({
        kind: "text",
        segs: [
          seg(indent!, "text"),
          seg("●", "dot", dots.shift() ?? "ok"),
          seg(" ", "text"),
          ...body,
        ],
      });
      state = row ? "body" : "note";
      continue;
    }
    if (state === "note" && /^\s{4}\S/.test(text)) {
      lines.push({ kind: "text", segs: [seg(text, "text")] });
      continue;
    }
    if (HEADING.test(text)) {
      lines.push({ kind: "heading", segs: [seg(text, "muted")] });
      continue;
    }
    const paragraph = paragraphAt(raw, i);
    if (isField(paragraph)) {
      lines.push(...blurredField(paragraph));
      i += paragraph.length - 1;
      continue;
    }
    lines.push({
      kind: "text",
      segs: /\S\s{2,}\S/.test(text)
        ? columns(text, "muted", "text")
        : [seg(text, "text")],
    });
  }

  const context = marks.context ?? 0;
  return {
    lines: lines.map((line, index) => ({
      ...restyle(line, marks),
      ...(index < context ? { context: true } : {}),
    })),
    cols: Math.max(...raw.map((line) => [...line].length)),
  };
}

export function screenText(screen: Screen): string {
  return screen.lines
    .map((line) =>
      line.segs
        .map((part) => part.text)
        .join("")
        .replace(/\s+$/, ""),
    )
    .join("\n");
}
