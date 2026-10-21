/**
 * Type-only stand-in for Listen's `@/lib/api` (mapped in this folder's
 * tsconfig). It lets `lib/library-routes` typecheck without pulling the native
 * session and platform adapters; hosts never load it, see
 * `listen-routes-plugin.ts`.
 */
export const apiAssetUrl = (path: string): string => path;
export const getApiBase = (): string => "";
export const getAuthToken = (): string | null => null;
