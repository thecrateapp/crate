export type TokenKind =
  | "key"
  | "string"
  | "number"
  | "literal"
  | "punct"
  | "comment";

export interface Token {
  kind: TokenKind;
  text: string;
}

export interface JsonLine {
  depth: number;
  tokens: Token[];
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const scalar = (value: Json): Token => {
  if (typeof value === "string")
    return { kind: "string", text: JSON.stringify(value) };
  if (typeof value === "number") return { kind: "number", text: String(value) };
  return { kind: "literal", text: String(value) };
};

const isScalar = (value: Json) => value === null || typeof value !== "object";

export function toJsonLines(
  value: unknown,
  { maxInline = Infinity } = {},
): JsonLine[] {
  const lines: JsonLine[] = [];

  const walk = (node: Json, depth: number, lead: Token[], trail: Token[]) => {
    if (isScalar(node)) {
      lines.push({ depth, tokens: [...lead, scalar(node), ...trail] });
      return;
    }
    if (Array.isArray(node) && node.every(isScalar)) {
      const shown = node.slice(0, maxInline);
      const tokens: Token[] = [{ kind: "punct", text: "[" }];
      shown.forEach((item, index) => {
        if (index) tokens.push({ kind: "punct", text: ", " });
        tokens.push(scalar(item));
      });
      if (shown.length < node.length)
        tokens.push({ kind: "punct", text: `, … ${node.length} values` });
      tokens.push({ kind: "punct", text: "]" });
      lines.push({ depth, tokens: [...lead, ...tokens, ...trail] });
      return;
    }
    const array = Array.isArray(node);
    const entries: [string | null, Json][] = array
      ? node.map((item) => [null, item])
      : Object.entries(node);
    lines.push({
      depth,
      tokens: [...lead, { kind: "punct", text: array ? "[" : "{" }],
    });
    entries.forEach(([key, child], index) => {
      const childLead: Token[] =
        key === null
          ? []
          : [
              { kind: "key", text: JSON.stringify(key) },
              { kind: "punct", text: ": " },
            ];
      walk(
        child,
        depth + 1,
        childLead,
        index < entries.length - 1 ? [{ kind: "punct", text: "," }] : [],
      );
    });
    lines.push({
      depth,
      tokens: [{ kind: "punct", text: array ? "]" : "}" }, ...trail],
    });
  };

  walk(value as Json, 0, [], []);
  return lines;
}

export function lineText(line: JsonLine): string {
  return (
    "  ".repeat(line.depth) + line.tokens.map((token) => token.text).join("")
  );
}

export function typedAt(
  text: string,
  seconds: number,
  perSecond: number,
): string {
  const count = Math.max(
    0,
    Math.min(text.length, Math.floor(seconds * perSecond)),
  );
  return text.slice(0, count);
}
