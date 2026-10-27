export type TokenKind =
  | "plain"
  | "comment"
  | "string"
  | "command"
  | "flag"
  | "variable"
  | "key"
  | "literal";

export interface Token {
  kind: TokenKind;
  text: string;
}

const grammars: Record<string, RegExp> = {
  bash: new RegExp(
    [
      String.raw`(?<comment>(?<=^|\s)#[^\n]*)`,
      String.raw`(?<string>"(?:[^"\\\n]|\\.)*"|'[^'\n]*')`,
      String.raw`(?<variable>\$\{[^}\n]+\}|\$[A-Za-z_]\w*)`,
      String.raw`(?<flag>(?<=\s)--?[A-Za-z][\w-]*)`,
      String.raw`(?<command>(?<=(?:^|&&|\|\||[|;])[ \t]*(?:\$ )?)(?<!\\\n[ \t]*)[A-Za-z_][\w./-]*)`,
    ].join("|"),
    "gm",
  ),
  json: new RegExp(
    [
      String.raw`(?<key>"(?:[^"\\\n]|\\.)*"(?=\s*:))`,
      String.raw`(?<string>"(?:[^"\\\n]|\\.)*")`,
      String.raw`(?<literal>\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)`,
    ].join("|"),
    "g",
  ),
  yaml: new RegExp(
    [
      String.raw`(?<comment>(?<=^|\s)#[^\n]*)`,
      String.raw`(?<key>(?<=^[ \t]*(?:- )?)[\w.-]+(?=:(?:\s|$)))`,
      String.raw`(?<string>"(?:[^"\\\n]|\\.)*"|'[^'\n]*')`,
      String.raw`(?<literal>\b(?:true|false|null)\b|\b\d+(?:\.\d+)?\b)`,
    ].join("|"),
    "gm",
  ),
};

const aliases: Record<string, string> = {
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  yml: "yaml",
  jsonc: "json",
};

export function resolveLanguage(language: string | undefined): string {
  const normalized = (language ?? "").toLowerCase();
  return aliases[normalized] ?? normalized;
}

export function highlight(code: string, language?: string): Token[] {
  const grammar = grammars[resolveLanguage(language)];
  if (!grammar) return [{ kind: "plain", text: code }];

  const tokens: Token[] = [];
  let cursor = 0;
  for (const match of code.matchAll(grammar)) {
    const index = match.index ?? 0;
    if (index > cursor)
      tokens.push({ kind: "plain", text: code.slice(cursor, index) });
    const kind = Object.entries(match.groups ?? {}).find(
      ([, value]) => value !== undefined,
    )?.[0] as TokenKind | undefined;
    tokens.push({ kind: kind ?? "plain", text: match[0] });
    cursor = index + match[0].length;
  }
  if (cursor < code.length)
    tokens.push({ kind: "plain", text: code.slice(cursor) });
  return tokens;
}
