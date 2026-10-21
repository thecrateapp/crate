import { IMAGE_SAMPLES } from "./image-identity";

/**
 * Review stand-in for Listen's `lib/library-routes` (see
 * `listen-routes-plugin.mjs`): the real module reaches the API client, auth
 * and platform adapters. Same names, local artwork and canonical-looking
 * paths, no network.
 */
export const albumCoverApiUrl = (): string => IMAGE_SAMPLES[0]!;
export const artistPhotoApiUrl = (): string => IMAGE_SAMPLES[1]!;
export const albumPagePath = (): string => "/fixture/album";
export const artistPagePath = (): string => "/fixture/artist";
