import { createHash } from "node:crypto";

const SOURCE_HASH_SCHEMA = "crate.listen.i18n.source.v1";

export function sourceHashInput(key: string, source: string): string {
  return `${SOURCE_HASH_SCHEMA}:${key}\n${source}`;
}

export function hashSourceMessage(key: string, source: string): string {
  return `sha256:${createHash("sha256")
    .update(sourceHashInput(key, source), "utf8")
    .digest("hex")}`;
}
