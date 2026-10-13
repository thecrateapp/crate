import { en, type MessageKey } from "./en";

const dictionaries: Record<string, Record<MessageKey, string>> = { en };

export const locales = Object.keys(dictionaries);

export function t(
  key: MessageKey,
  locale = "en",
  values: Record<string, string> = {},
): string {
  const message = (dictionaries[locale] ?? en)[key] ?? en[key];
  return message.replace(
    /\{(\w+)\}/g,
    (_, name: string) => values[name] ?? `{${name}}`,
  );
}
