const CARTO_DARK_TILE_TEMPLATE =
  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

export function cartoBasemapTileUrl(
  apiKey: string | undefined = import.meta.env.VITE_CARTO_API_KEY,
): string {
  const normalizedApiKey = apiKey?.trim();
  if (!normalizedApiKey) return CARTO_DARK_TILE_TEMPLATE;

  return `${CARTO_DARK_TILE_TEMPLATE}?key=${encodeURIComponent(
    normalizedApiKey,
  )}`;
}
