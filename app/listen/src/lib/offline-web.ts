type WebOfflineCacheReader = Pick<Cache, "match">;
type WebOfflineCacheWriter = Pick<Cache, "match" | "put">;

export async function hasWebOfflineAsset(
  cache: WebOfflineCacheReader,
  urls: string[],
): Promise<boolean> {
  for (const url of urls) {
    if (await cache.match(url)) return true;
  }
  return false;
}

export async function cacheWebOfflineAsset(
  cache: WebOfflineCacheWriter,
  cacheKey: string,
  fetchAsset: () => Promise<Response>,
  expectedBytes?: number | null,
): Promise<void> {
  if (await cache.match(cacheKey)) return;
  const response = await fetchAsset();
  if (!response.ok) {
    throw new Error(`Failed to cache track (${response.status})`);
  }
  const actualBytes = Number(response.headers.get("content-length") || 0);
  const expected = Math.max(0, Number(expectedBytes || 0));
  if (expected > 0 && actualBytes > 0 && actualBytes !== expected) {
    throw new Error("Offline copy failed integrity check");
  }
  await cache.put(cacheKey, response.clone());
}

export async function deleteWebOfflineAssets(
  cache: Pick<Cache, "delete">,
  urls: string[],
): Promise<void> {
  await Promise.all(urls.map((url) => cache.delete(url)));
}
