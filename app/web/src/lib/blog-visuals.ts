/** Insert server-rendered figures at explicit, author-owned Markdown markers. */
export function insertBlogVisuals(
  html: string,
  visuals: Record<string, string>,
): string {
  const used = new Set<string>();
  const rendered = html.replace(
    /<div data-blog-visual="([a-z][a-z0-9-]*)">\s*<\/div>/g,
    (_, name: string) => {
      if (!Object.hasOwn(visuals, name) || !visuals[name]?.trim())
        throw new Error(`Blog visual "${name}" has no rendered component.`);
      if (used.has(name))
        throw new Error(`Blog visual "${name}" appears more than once.`);
      used.add(name);
      return visuals[name]!;
    },
  );
  for (const name of Object.keys(visuals)) {
    if (!used.has(name))
      throw new Error(`Blog visual "${name}" has no Markdown marker.`);
  }
  return rendered;
}
