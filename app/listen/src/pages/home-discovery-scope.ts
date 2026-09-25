const HOME_DISCOVERY_CACHE_SCOPES = new Set([
  "home",
  "library",
  "global_catalog",
  "upcoming",
]);

const HOME_DISCOVERY_CACHE_SCOPE_PREFIXES = [
  "home:user:",
  "artist:",
  "album:",
  "playlist:",
];

export function shouldRefreshHomeDiscoveryForScope(scope: string): boolean {
  return (
    HOME_DISCOVERY_CACHE_SCOPES.has(scope) ||
    HOME_DISCOVERY_CACHE_SCOPE_PREFIXES.some((prefix) =>
      scope.startsWith(prefix),
    )
  );
}
