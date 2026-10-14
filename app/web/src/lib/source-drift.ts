import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

export function repoFile(path: string): string {
  return resolve(ROOT, path);
}

const stripLineComments = (source: string, marker: string) =>
  source
    .split("\n")
    .map((line) => {
      const index = line.indexOf(marker);
      return index === -1 ? line : line.slice(0, index);
    })
    .join("\n");

export function readTsNumberArrays(source: string): Record<string, number[]> {
  const clean = stripLineComments(source, "//");
  return Object.fromEntries(
    [...clean.matchAll(/(\w+)\s*:\s*\[([-\d.,\s]*)\]/g)].map(
      ([, name, values]) => [
        name,
        values!
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .map(Number),
      ],
    ),
  );
}

export function readPyDict(source: string, name: string): unknown {
  const start = source.search(new RegExp(`^${name}\\b[^=\\n]*=\\s*\\{`, "m"));
  if (start === -1) throw new Error(`${name} not found`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (; end < source.length; end += 1) {
    const char = source[end];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) break;
  }
  const literal = stripLineComments(source.slice(open, end + 1), "#")
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(literal);
}

export function readPyConstants(
  source: string,
  prefix: string,
): Record<string, number | string> {
  return Object.fromEntries(
    [
      ...source.matchAll(
        new RegExp(`^(${prefix}\\w*)\\s*=\\s*("[^"]*"|-?[\\d.]+)\\s*$`, "gm"),
      ),
    ].map(([, name, value]) => [
      name,
      value!.startsWith('"') ? value!.slice(1, -1) : Number(value),
    ]),
  );
}

export function readPyTuples(
  source: string,
  prefix: string,
): Record<string, number[]> {
  return Object.fromEntries(
    [
      ...source.matchAll(
        new RegExp(`^(${prefix}\\w*)\\s*=\\s*\\(([-\\d.,\\s]*)\\)`, "gm"),
      ),
    ].map(([, name, values]) => [
      name,
      values!
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map(Number),
    ]),
  );
}
