/**
 * Turns a machine-readable key into human-readable prose: splits snake_case
 * and camelCase boundaries into separate words, lowercases them, and
 * capitalizes only the first letter.
 */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!spaced) return spaced;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
