export type ExploreSelection = "genre" | "decade" | "playlistCategory";
/** Browse selections are exclusive; unrelated state, duplicate params and the hash survive. */
export function exploreSelectionLocation(
  location: { pathname: string; search: string; hash: string },
  key?: ExploreSelection,
  value?: string,
) {
  const search = new URLSearchParams(location.search);
  for (const name of ["genre", "decade", "playlistCategory"])
    search.delete(name);
  if (key && value) search.set(key, value);
  return {
    pathname: location.pathname,
    search: search.toString() ? `?${search}` : "",
    hash: location.hash,
  };
}
